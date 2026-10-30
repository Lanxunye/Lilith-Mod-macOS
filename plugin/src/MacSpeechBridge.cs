using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace LilithMod;

internal sealed class MacSpeechBridge
{
    private float _nextPoll;
    private bool _enabled;
    private volatile bool _pending;
    private string _error = "";

    internal void Tick(UnityChatView? view)
    {
        if (view is null || Time.unscaledTime < _nextPoll) return;
        _nextPoll = Time.unscaledTime + .4f;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(ModPaths.DataRoot, "speech-state.json")));
            _enabled = doc.RootElement.GetProperty("enabled").GetBoolean();
            _error = doc.RootElement.TryGetProperty("error", out var value) ? value.GetString() ?? "" : "";
        }
        catch { /* Service startup or atomic replacement; retain the last confirmed setting. */ }
        view.SetSpeechState(_enabled, _pending, _error.Length > 0);
    }

    internal void Toggle(CompanionClient client, CancellationToken lifetime)
    {
        if (_pending) return;
        _pending = true;
        _ = Apply(client, !_enabled, lifetime);
    }

    private async Task Apply(CompanionClient client, bool enabled, CancellationToken lifetime)
    {
        try
        {
            await client.SetSpeechEnabledAsync(enabled, lifetime).ConfigureAwait(false);
            _enabled = enabled;
            _error = "";
            LilithModPlugin.PluginLog.LogInfo($"CHAT_SPEECH_TOGGLE enabled={enabled}");
        }
        catch (Exception error)
        {
            _error = "speech_settings_unavailable";
            LilithModPlugin.PluginLog.LogWarning($"Chat speech toggle failed: {error.GetType().Name}");
        }
        finally { _pending = false; }
    }
}
