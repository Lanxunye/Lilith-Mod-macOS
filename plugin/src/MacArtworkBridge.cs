using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using UnityEngine;

namespace LilithMod;

// Companion owns GPU/network work. Unity only reads atomic local job records and finished PNGs.
internal sealed class MacArtworkBridge
{
    private float _nextPoll;
    private readonly HashSet<string> _shown = new();
    private readonly HashSet<string> _announced = new();
    private int _errors;
    internal void Tick(UnityChatView? view, Action showChat, Action<string> announce,
        Action<string, string> deliverSticker)
    {
        if (view is null || Time.unscaledTime < _nextPoll) return;
        _nextPoll = Time.unscaledTime + 2f;
        string root = Path.Combine(ModPaths.DataRoot, "artwork");
        if (!Directory.Exists(root)) return;
        try
        {
            string stateName = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("desktop-pet"))).ToLowerInvariant();
            string statePath = Path.Combine(root, "chat-state", stateName + ".json");
            string epoch = "";
            if (File.Exists(statePath))
            {
                using var state = JsonDocument.Parse(File.ReadAllText(statePath));
                epoch = Text(state.RootElement, "epoch");
            }
            string[] files = Directory.GetFiles(root, "*.json")
                .Where(f => Guid.TryParse(Path.GetFileNameWithoutExtension(f), out _))
                .OrderBy(File.GetLastWriteTimeUtc).ToArray();
            foreach (string file in files)
            {
                using var record = JsonDocument.Parse(File.ReadAllText(file));
                var item = record.RootElement;
                if (Text(item, "delivery") != "chat_sticker" || Text(item, "session_id") != "desktop-pet"
                    || epoch.Length == 0 || Text(item, "chat_epoch") != epoch) continue;
                string stickerId = Text(item, "id");
                if (!Guid.TryParse(stickerId, out _) || _shown.Contains(stickerId)) continue;
                string phase = Text(item, "status");
                if (phase == "failed")
                {
                    _shown.Add(stickerId);
                    announce("这次表情包没有画好，我们可以继续聊。");
                }
                else if (phase == "completed" && Text(item, "asset_file") == stickerId + ".png")
                {
                    string stickerImage = Path.Combine(root, stickerId + ".png");
                    if (!File.Exists(stickerImage) || new FileInfo(stickerImage).Length > 32 * 1024 * 1024) continue;
                    deliverSticker(stickerId, Text(item, "caption"));
                    _shown.Add(stickerId);
                    LilithModPlugin.PluginLog.LogInfo($"LILITH_MAC_CHAT_STICKER: id={stickerId}; turn={item.GetProperty("chat_turn")}");
                }
            }
            // Manual artwork and ordinary illustrations retain the separate gallery preview.
            string? selected = files.LastOrDefault(f =>
            {
                using var record = JsonDocument.Parse(File.ReadAllText(f));
                return Text(record.RootElement, "delivery") != "chat_sticker";
            });
            if (selected is null) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(selected));
            var job = doc.RootElement;
            if (Text(job, "session_id") != "desktop-pet") return;
            string id = Text(job, "id");
            if (!Guid.TryParse(id, out _) || _shown.Contains(id)) return;
            string status = Text(job, "status");
            if (status == "queued" || status == "rendering")
            {
                if (_announced.Add(id)) announce("莉莉丝正在本机绘制，完成后会在这里展示。");
                return;
            }
            if (status == "failed")
            {
                _shown.Add(id);
                announce("这次绘图没有完成。可以在小画室查看原因或重新绘制。");
                return;
            }
            string asset = Text(job, "asset_file");
            if (status != "completed" || asset != id + ".png") return;
            string image = Path.Combine(root, asset);
            if (!File.Exists(image) || new FileInfo(image).Length > 32 * 1024 * 1024) return;
            showChat();
            view.ShowArtwork(File.ReadAllBytes(image), Text(job, "caption"), Text(job, "kind") == "sticker");
            _shown.Add(id);
            announce(Text(job, "kind") == "sticker" ? "表情包画好了，可以在小画室保存带字图片。" : "画好了，可以在小画室查看和保存。");
            LilithModPlugin.PluginLog.LogInfo($"LILITH_MAC_ART_DISPLAYED: id={id}; kind={Text(job, "kind")}");
        }
        catch (Exception e)
        {
            if (_errors++ < 3) LilithModPlugin.PluginLog.LogWarning($"Artwork preview unavailable: {e.GetType().Name}");
        }
    }
    private static string Text(JsonElement value, string key) => value.TryGetProperty(key, out var property)
        && property.ValueKind == JsonValueKind.String ? property.GetString() ?? "" : "";
}
