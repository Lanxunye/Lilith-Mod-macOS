using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using UnityEngine;

namespace LilithMod;

internal static class TaskChatMode
{
    // Every conversation now uses DSH; the button opens its status/approval console.
    internal static string Mode { get => "auto"; set { } }
    internal static string Label => "DSH 对话";
    internal static void Cycle() => MacSettingsLauncher.OpenPage("chat");
}

internal sealed class MacTaskBridge
{
    private float _nextPoll;
    private bool _initialized;
    private readonly HashSet<string> _delivered = new();
    internal void Tick(UnityChatView? view, Func<bool> canDeliver, Action<string> deliver)
    {
        if (view is null || Time.unscaledTime < _nextPoll) return;
        _nextPoll = Time.unscaledTime + 1f;
        string nativeState = Path.Combine(ModPaths.DataRoot, "dsh-lilith", "status.json");
        if (File.Exists(nativeState))
        {
            try
            {
                using var state = JsonDocument.Parse(File.ReadAllText(nativeState));
                JsonElement data = state.RootElement;
                bool active = data.TryGetProperty("active", out var current) && current.ValueKind == JsonValueKind.True;
                int pending = data.TryGetProperty("pending", out var count) && count.TryGetInt32(out var n) ? n : 0;
                bool running = data.TryGetProperty("running", out var runtime) && runtime.ValueKind == JsonValueKind.True;
                view.SetTaskStatus(active ? "DSH 处理中" : pending > 0 ? "等待明文确认" : running ? "DSH 已连接" : "DSH 待连接", "莉莉丝独立工作区");
                return;
            }
            catch { return; }
        }
        string root = Path.Combine(ModPaths.DataRoot, "dsh-tasks");
        if (!Directory.Exists(root)) return;
        try
        {
            string[] files = Directory.GetFiles(root, "*.json")
                .Where(f => Guid.TryParse(Path.GetFileNameWithoutExtension(f), out _))
                .OrderBy(File.GetLastWriteTimeUtc).ToArray();
            string status = "任务按需委托", goal = "";
            foreach (string file in files)
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                JsonElement t = doc.RootElement;
                if (Text(t, "session_id") != "desktop-pet" || (t.TryGetProperty("archived", out var archived) && archived.ValueKind == JsonValueKind.True)) continue;
                string id = Text(t, "id"), phase = Text(t, "status");
                status = phase switch { "queued" => "等待执行", "starting" => "准备中", "running" => "执行中", "stopping" => "正在停止", "completed" => "已完成", "needs_input" => "需要补充", "stopped" => "已停止", "interrupted" => "已中断", _ => "未完成" };
                goal = Text(t, "goal");
                bool terminal = phase is "completed" or "needs_input" or "failed" or "stopped" or "interrupted";
                if (!_initialized && terminal) _delivered.Add(id);
                string text = Text(t, "delivery_text");
                if (_initialized && terminal && text.Length > 0 && !_delivered.Contains(id) && canDeliver())
                { deliver(text); _delivered.Add(id); }
            }
            _initialized = true;
            view.SetTaskStatus(status, goal);
        }
        catch { /* Atomic state may be replaced between polls; retry next frame interval. */ }
    }
    private static string Text(JsonElement item, string key) => item.TryGetProperty(key, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
}
