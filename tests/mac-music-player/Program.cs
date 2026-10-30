using LilithMod;
void Check(bool value, string message) { if (!value) throw new Exception(message); }
Check(MacMusicAppNames.IsNetease("cloudmusic", ""), "original id");
Check(MacMusicAppNames.IsNetease("netease", ""), "Mod provider id");
Check(MacMusicAppNames.IsNetease("", "CloudMusic.exe"), "legacy executable");
Check(!MacMusicAppNames.IsNetease("spotify", "Spotify.exe"), "other players untouched");
Check(!MacMusicAppNames.IsNetease("my-cloudmusic-clone", "other.exe"), "partial names rejected");
Check(MacMusicAppNames.Netease[0] == "NeteaseMusic.app", "official Mac app first");
Check(MacMusicAppNames.Netease.Last() == "cloudmusic.app", "old name last");
Check(MacMusicAppNames.Netease.All(n => n.EndsWith(".app")), "native launcher requires application bundle directory names");
Console.WriteLine("mac-music-player: original ids, executable alias, other-player isolation and official Mac app priority passed.");
