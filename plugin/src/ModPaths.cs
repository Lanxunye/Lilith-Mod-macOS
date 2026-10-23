using System;
using System.IO;

namespace LilithMod;

internal static class ModPaths
{
    internal static string DataRoot => Environment.GetEnvironmentVariable("LILITH_AI_DATA_DIR")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        "Library", "Application Support", "LilithAI");

    // Legacy Windows player discovery only; all Mod data files use DataRoot directly.
    internal static string ApplicationData => Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
}
