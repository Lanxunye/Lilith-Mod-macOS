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
    internal void Tick(bool ready, Action<bool, string> deliver)
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
                deliver(item.GetProperty("role").GetString() == "user", item.GetProperty("content").GetString() ?? "");
                _cursor = seq;
            }
            _cursor = Math.Max(_cursor, latest);
        }
        catch { /* Atomic file may be replaced between reads; retry next interval. */ }
    }
}
