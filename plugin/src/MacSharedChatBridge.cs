using System;
using System.IO;
using System.Text.Json;
using UnityEngine;

namespace LilithMod;

// Companion publishes an atomic projection; Unity mutations remain on its main thread.
internal sealed class MacSharedChatBridge
{
    private float _nextPoll;
    private long _cursor;
    private bool _initialized;
    internal void Initialize(long cursor) { _cursor = cursor; _initialized = true; }
    internal void Tick(bool ready, Action<bool, string, bool> deliver)
        => Tick(ready, (user, text, dialogue, emotion, duration) => deliver(user, text, dialogue));
    internal void Tick(bool ready, Action<bool, string, bool, string, int> deliver)
    {
        if (!ready || Time.unscaledTime < _nextPoll) return;
        _nextPoll = Time.unscaledTime + 1f;
        try
        {
            string file = Path.Combine(ModPaths.DataRoot, "shared-chat-events.json");
            if (!File.Exists(file)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var root = doc.RootElement;
            long latest = root.GetProperty("cursor").GetInt64();
            // Initial history load already contains these messages.
            if (!_initialized) { _cursor = latest; _initialized = true; return; }
            foreach (var item in root.GetProperty("messages").EnumerateArray())
            {
                long seq = item.GetProperty("seq").GetInt64();
                if (seq <= _cursor) continue;
                bool isUser = item.GetProperty("role").GetString() == "user";
                string text = item.GetProperty("content").GetString() ?? "";
                string channel = item.TryGetProperty("channel", out var c) ? c.GetString() ?? "" : "";
                string request = item.TryGetProperty("request_id", out var r) ? r.GetString() ?? "" : "";
                bool proactive = !isUser && channel == "proactive" && request.StartsWith("speak-up:", StringComparison.Ordinal);
                JsonElement metadata = default;
                bool part = !isUser && item.TryGetProperty("reply_part", out metadata) && metadata.ValueKind == JsonValueKind.Object;
                string emotion = part && metadata.TryGetProperty("emotion", out var e) ? e.GetString() ?? "neutral" : "neutral";
                int duration = part && metadata.TryGetProperty("duration_ms", out var d) && d.TryGetInt32(out var ms) ? Math.Clamp(ms, 1000, 45000) : 6500;
                deliver(isUser, channel == "qq" ? "[QQ] " + text : text, proactive || part, emotion, duration);
                _cursor = seq;
                // A delayed frame must not flash several queued replies at once.
                if (part) { _nextPoll = Time.unscaledTime + 1.8f; return; }
            }
            _cursor = Math.Max(_cursor, latest);
        }
        catch { /* Atomic file may be replaced between reads; retry next interval. */ }
    }
}
