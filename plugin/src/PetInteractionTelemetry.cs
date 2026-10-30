using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HarmonyLib;
using UnityEngine;

namespace LilithMod;

internal sealed class PetInteractionEvent
{
    public string id { get; set; } = "";
    public string kind { get; set; } = "";
    public long at { get; set; }
}

// Observe native semantic events; never replace the game's animation or save logic.
internal static class PetInteractionTelemetry
{
    private static readonly ConcurrentQueue<PetInteractionEvent> Queue = new();
    private static readonly Dictionary<string, long> LastObserved = new();
    private static readonly List<string> Hooked = new();
    private static readonly object Gate = new();
    private static long _blanketIntent;
    private static long _lastObservedAt;
    private static long _lastAckAt;
    private static int _sending;
    private static float _nextSend;
    private static bool _enabled;
    private static bool _logInitialized;
    private static bool _gestureInitialized;
    private static bool _wasRubbing, _wasPatting;
    private static float _nextPoll, _nextHandlerLookup;
    private static CharacterInteractionHandler? _handler;
    private static readonly HashSet<string> NativeSeen = new();
    private static readonly Queue<string> NativeSeenOrder = new();
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    internal static void InitializePolling()
    {
        _enabled = true;
        Hooked.Add("native-interaction-log-poll");
        Hooked.Add("native-head-gesture-state-poll");
        Publish();
        LilithModPlugin.PluginLog.LogInfo("Pet interaction telemetry: read-only native log and gesture polling enabled");
    }
    private static void PollNative()
    {
        if (Time.unscaledTime < _nextPoll) return;
        _nextPoll = Time.unscaledTime + .25f;
        try
        {
            var log = Archive.Instance?.interactionLog;
            if (log is not null)
            {
                var occurrences = new Dictionary<string, int>();
                for (int i = Math.Max(0, log.Count - 64); i < log.Count; i++)
                {
                    var row = log[i]; if (row is null) continue;
                    string raw = row.kind + "\0" + row.time;
                    occurrences.TryGetValue(raw, out int occurrence); occurrences[raw] = occurrence + 1;
                    string key = raw + "\0" + occurrence;
                    if (!NativeSeen.Add(key)) continue;
                    NativeSeenOrder.Enqueue(key);
                    if (!_logInitialized) continue; // Never replay saved interactions at launch.
                    if (DateTime.TryParseExact(row.time, LilithInteractionLog.TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var date)
                        || DateTime.TryParse(row.time, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out date))
                        RecordKind(row.kind, new DateTimeOffset(date).ToUnixTimeMilliseconds());
                }
                while (NativeSeenOrder.Count > 512) NativeSeen.Remove(NativeSeenOrder.Dequeue());
                if (!_logInitialized) { _logInitialized = true; Publish(); }
            }
            if (_handler == null && Time.unscaledTime >= _nextHandlerLookup)
            { _nextHandlerLookup = Time.unscaledTime + 3f; _handler = UnityEngine.Object.FindObjectOfType<CharacterInteractionHandler>(); }
            if (_handler != null)
            {
                bool rub = NativeFlag(_handler, "_headRubActive"), pat = NativeFlag(_handler, "_headPetPlaying");
                if (_gestureInitialized && rub && !_wasRubbing) Observe("head_rub");
                if (_gestureInitialized && pat && !_wasPatting) Observe("head_pat");
                _wasRubbing = rub; _wasPatting = pat; _gestureInitialized = true;
            }
        }
        catch { /* Native state may be rebuilding; inspect again next tick. */ }
    }

    internal static void Apply(Harmony harmony)
    {
        Patch(harmony, typeof(LilithInteractionLog), "Record", nameof(Recorded));
        Patch(harmony, typeof(CharacterInteractionHandler), "StartHeadRub", nameof(HeadRubbed));
        Patch(harmony, typeof(CharacterInteractionHandler), "PlayHeadPetReaction", nameof(HeadPatted));
        Patch(harmony, typeof(CharacterInteractionHandler), "OnCoverBlanketChoice", nameof(BlanketRequested), true);
        Patch(harmony, typeof(LilithStateManager), "SetActionType", nameof(ActionChanged));
        _enabled = Hooked.Contains("LilithInteractionLog.Record") || Hooked.Contains("CharacterInteractionHandler.StartHeadRub") || Hooked.Contains("CharacterInteractionHandler.PlayHeadPetReaction");
        Publish();
        LilithModPlugin.PluginLog.LogInfo("Pet interaction telemetry registered: " + string.Join(", ", Hooked));
    }
    private static void Patch(Harmony harmony, Type type, string method, string handler, bool prefix = false)
    {
        try
        {
            MethodInfo target = AccessTools.Method(type, method);
            if (target is null) return;
            var callback = new HarmonyMethod(typeof(PetInteractionTelemetry), handler);
            harmony.Patch(target, prefix: prefix ? callback : null, postfix: prefix ? null : callback);
            Hooked.Add(type.Name + "." + method);
        }
        catch (Exception e) { LilithModPlugin.PluginLog.LogWarning("Pet hook unavailable: " + type.Name + "." + method + " (" + e.GetType().Name + ")"); }
    }
    private static void Recorded(string __0)
    { RecordKind(__0, Now); }
    private static void RecordKind(string kind, long at)
    {
        try
        {
            if (kind == LilithInteractionLog.TouchHead) Observe("head_touch", at);
            else if (kind == LilithInteractionLog.TouchHand) Observe("hand_touch", at);
            else if (kind == LilithInteractionLog.TouchFace) Observe("face_touch", at);
        }
        catch { /* Telemetry must not interrupt native interaction. */ }
    }
    private static bool NativeFlag(CharacterInteractionHandler instance, string name)
    {
        try { return AccessTools.Property(typeof(CharacterInteractionHandler), name)?.GetValue(instance) is true; }
        catch { return false; }
    }
    private static void HeadRubbed(CharacterInteractionHandler __instance)
    { if (NativeFlag(__instance, "_headRubActive")) Observe("head_rub"); }
    private static void HeadPatted(CharacterInteractionHandler __instance)
    { if (NativeFlag(__instance, "_headPetPlaying")) Observe("head_pat"); }
    private static void BlanketRequested() { _blanketIntent = Now; }
    private static void ActionChanged(LilithActionType __0)
    {
        if (__0 == LilithActionType.CoverBlanket && _blanketIntent > 0 && Now - _blanketIntent <= 5000)
        { _blanketIntent = 0; Observe("cover_blanket"); }
    }
    private static void Observe(string kind, long? observedAt = null)
    {
        long at = Now;
        lock (Gate)
        {
            if (LastObserved.TryGetValue(kind, out long last) && at - last < 500) return;
            LastObserved[kind] = at;
            _lastObservedAt = at;
        }
        if (Queue.Count >= 64) return;
        Queue.Enqueue(new PetInteractionEvent { id = Guid.NewGuid().ToString(), kind = kind, at = observedAt ?? at });
        Publish();
    }
    private static void Publish()
    {
        try
        {
            lock (Gate)
            {
                string file = Path.Combine(ModPaths.DataRoot, "pet-interactions-game.json");
                string text = JsonSerializer.Serialize(new { schema = 1, pid = Environment.ProcessId, enabled = _enabled && _logInitialized,
                    hooked = Hooked.ToArray(), last_observed_at = _lastObservedAt, last_ack_at = _lastAckAt });
                File.WriteAllText(file + ".tmp", text);
                File.Move(file + ".tmp", file, true);
            }
        }
        catch { }
    }
    internal static void Tick(CompanionClient client, CancellationToken lifetime)
    {
        if (_enabled) PollNative();
        if (!_enabled || Queue.IsEmpty || Time.unscaledTime < _nextSend || Interlocked.CompareExchange(ref _sending, 1, 0) != 0) return;
        _nextSend = Time.unscaledTime + 1f;
        var batch = new List<PetInteractionEvent>();
        while (batch.Count < 16 && Queue.TryDequeue(out var item)) batch.Add(item);
        _ = Deliver(client, batch, lifetime);
    }
    internal static void Disable() { _enabled = false; Publish(); }
    private static async Task Deliver(CompanionClient client, List<PetInteractionEvent> batch, CancellationToken lifetime)
    {
        bool sent = false;
        try { sent = await client.SendPetInteractionsAsync(batch, lifetime).ConfigureAwait(false); }
        catch { }
        finally
        {
            if (!sent && !lifetime.IsCancellationRequested)
                foreach (var item in batch) if (Queue.Count < 64) Queue.Enqueue(item);
            if (sent) { _lastAckAt = Now; Publish(); }
            Interlocked.Exchange(ref _sending, 0);
        }
    }
}
