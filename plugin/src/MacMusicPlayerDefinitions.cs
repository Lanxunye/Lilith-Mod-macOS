using System;
using UnityEngine;

namespace LilithMod;

// Correct the original game's platform data instead of replacing its menu,
// callbacks, reactions or playback routines. No global Harmony patch is needed.
internal static class MacMusicPlayerDefinitions
{
    private static bool _patched;
    private static bool _errorLogged;
    private static float _nextAttempt;

    internal static void Tick()
    {
        if (_patched) return;
        if (Time.unscaledTime < _nextAttempt) return;
        _nextAttempt = Time.unscaledTime + 2f;
        try
        {
            int count = 0;
            var players = ExternalPlayerLauncher.AllPlayers;
            for (int index = 0; index < players.Length; index++)
            {
                var player = players[index];
                if (player is null || !MacMusicAppNames.IsNetease(player.Id, player.ExeName)) continue;
                // The original definition contains the Windows process name
                // cloudmusic, which `open -a` cannot resolve on macOS.
                player.MacAppNames = MacMusicAppNames.Netease;
                // PlayerDef is an IL2CPP VALUE TYPE. Array access boxes a copy;
                // changing its fields without assigning the element back leaves
                // the original game's launch data unchanged.
                players[index] = player;
                if (players[index].MacAppNames[0] != "NeteaseMusic.app")
                    throw new InvalidOperationException("Original music player array write-back failed");
                count++;
            }
            if (count > 0)
            {
                _patched = true;
                LilithModPlugin.PluginLog.LogInfo($"Mac original music player value committed: NeteaseMusic.app; count={count}; original menu/reactions retained");
            }
        }
        catch (Exception error)
        {
            if (!_errorLogged)
            {
                _errorLogged = true;
                LilithModPlugin.PluginLog.LogWarning($"Mac music player definition fix unavailable: {error.GetType().Name}: {error.Message}");
            }
        }
    }

}
