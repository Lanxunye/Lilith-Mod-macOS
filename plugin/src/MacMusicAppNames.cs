using System;

namespace LilithMod;

internal static class MacMusicAppNames
{
    // The original launcher joins these to /Applications and checks directories.
    // They must be .app bundle names, not Launch Services display names.
    internal static string[] Netease => new[] { "NeteaseMusic.app", "网易云音乐.app", "cloudmusic.app" };
    internal static bool IsNetease(string? id, string? executable)
    {
        string key = (id ?? "").Trim().ToLowerInvariant();
        string exe = (executable ?? "").Trim().ToLowerInvariant();
        return key == "netease" || key == "cloudmusic" || key == "neteasemusic"
            || exe == "cloudmusic.exe" || exe == "cloudmusic" || exe == "neteasemusic";
    }
}
