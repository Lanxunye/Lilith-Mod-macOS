using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using UnityEngine;

namespace LilithMod;

internal static class MacNative
{
    internal static readonly MacPlatformService GamePlatform = new();
    private const string Library = "liblilith_macos.dylib";
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void TickCallback(IntPtr context);
    [DllImport(Library, EntryPoint = "lilith_schedule_tick")]
    internal static extern void Schedule(IntPtr context, TickCallback callback, double delay);
    [DllImport(Library, EntryPoint = "lilith_mouse_button")]
    internal static extern int MouseButton(int button);
    [DllImport(Library, EntryPoint = "lilith_focus_chat")]
    internal static extern int FocusChat(int acquire);
    [DllImport(Library, EntryPoint = "lilith_has_focus")]
    internal static extern int HasFocus();
    [DllImport(Library, EntryPoint = "lilith_editor_layout")]
    internal static extern int EditorLayout(double x, double y, double width, double height,
        double screenWidth, double screenHeight, double fontPixels, int visible);
    [DllImport(Library, EntryPoint = "lilith_editor_text")]
    private static extern IntPtr EditorTextNative();
    internal static string EditorText() => Marshal.PtrToStringUTF8(EditorTextNative()) ?? "";
    [DllImport(Library, EntryPoint = "lilith_editor_set_text")]
    internal static extern void EditorSetText([MarshalAs(UnmanagedType.LPUTF8Str)] string text);
    [DllImport(Library, EntryPoint = "lilith_editor_take_submit")]
    internal static extern int EditorTakeSubmit();
    [DllImport(Library, EntryPoint = "lilith_editor_dispose")]
    internal static extern void EditorDispose();
    [DllImport(Library, EntryPoint = "lilith_editor_diagnostics")]
    private static extern IntPtr EditorDiagnosticsNative();
    internal static string EditorDiagnostics() => Marshal.PtrToStringUTF8(EditorDiagnosticsNative()) ?? "{}";
    [DllImport(Library, EntryPoint = "lilith_window_diagnostics")]
    private static extern IntPtr WindowDiagnosticsNative();
    internal static string WindowDiagnostics() => Marshal.PtrToStringUTF8(WindowDiagnosticsNative()) ?? "unavailable";
    [DllImport(Library, EntryPoint = "lilith_player_window")]
    internal static extern IntPtr PlayerWindow();
    [DllImport(Library, EntryPoint = "lilith_fit_primary_screen")]
    internal static extern int FitPrimaryScreen(IntPtr handle);
    [DllImport(Library, EntryPoint = "lilith_mouse_position")]
    internal static extern int MousePosition(out double x, out double y, out double width, out double height);
    [DllImport(Library, EntryPoint = "lilith_key")]
    internal static extern int Key(int code);
    [DllImport(Library, EntryPoint = "lilith_begin_input")]
    internal static extern void BeginInput();
    [DllImport(Library, EntryPoint = "lilith_take_mouse_edges")]
    internal static extern uint TakeMouseEdges();
    [DllImport(Library, EntryPoint = "lilith_take_key_edge")]
    internal static extern int TakeKeyEdge(int code);
    [DllImport(Library, EntryPoint = "lilith_menu_count")]
    internal static extern int MenuCount(IntPtr menu);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void MenuCallback(int action);
    [DllImport(Library, EntryPoint = "lilith_install_studio_menu")]
    internal static extern void InstallStudioMenu(MenuCallback callback);
    [DllImport(Library, EntryPoint = "lilith_install_menu")]
    internal static extern void InstallMenu(IntPtr menu, MenuCallback callback,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string chat,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string settings);
    [DllImport(Library, EntryPoint = "lilith_popup_menu")]
    internal static extern void PopupMenu(MenuCallback callback,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string chat,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string music,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string settings);
}

internal sealed class MacFramePump : IDisposable
{
    private static readonly MacNative.TickCallback RootedCallback = Tick;
    private static MacFramePump? _active;
    private readonly LilithRuntimeBehaviour _runtime;
    private int _lastFrame = -1;
    private bool _disposed;
    private int _errors;
    private int _windowDiagnosticsRemaining = 3;
    private float _nextWindowDiagnostics;

    internal MacFramePump(LilithRuntimeBehaviour runtime)
    {
        _runtime = runtime;
        _active = this;
        MacNative.BeginInput();
        MacNative.Schedule(IntPtr.Zero, RootedCallback, 0.016);
    }

    private static void Tick(IntPtr context)
    {
        MacFramePump? pump = _active;
        if (pump is null || pump._disposed) return;
        try
        {
            int frame = Time.frameCount;
            if (frame != pump._lastFrame)
            {
                pump._lastFrame = frame;
                MacInput.Tick();
                pump._runtime.Update();
                pump._runtime.LateUpdate();
                MacWindowCompatibility.TryRestore();
                if (Environment.GetEnvironmentVariable("LILITH_MAC_WINDOW_DIAGNOSTICS") == "1"
                    && pump._windowDiagnosticsRemaining > 0 && Time.unscaledTime >= pump._nextWindowDiagnostics)
                {
                    pump._windowDiagnosticsRemaining--;
                    pump._nextWindowDiagnostics = Time.unscaledTime + 5;
                    MacWindowCompatibility.Log();
                }
            }
        }
        catch (Exception error)
        {
            if (pump._errors++ < 3) LilithModPlugin.PluginLog.LogError($"Mac runtime tick failed: {error}");
        }
        if (!pump._disposed) MacNative.Schedule(IntPtr.Zero, RootedCallback, 0.016);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (ReferenceEquals(_active, this)) _active = null;
        _runtime.OnDestroy();
    }
}

internal static class MacWindowCompatibility
{
    private static bool _restoreAttempted;
    internal static void TryRestore()
    {
        if (_restoreAttempted || Environment.GetEnvironmentVariable("LILITH_MAC_REPAIR_WINDOW") == "0") return;
        var window = TransparentWindowNew.instance;
        if (window is null || !window.windowInitialized) return;
        if (TransparentWindowNew.Hwnd != IntPtr.Zero) { _restoreAttempted = true; return; }
        IntPtr handle = MacNative.PlayerWindow();
        if (handle == IntPtr.Zero) return;
        _restoreAttempted = true;
        try
        {
            // A background launch can finish the game's initialization with a null key-window handle.
            // Resolve only this process's Unity view, then use the game's transparency/click-through logic.
            LilithModPlugin.PluginLog.LogInfo($"Mac window recovery: handle={handle}, topMost={window.isTopMost}");
            window.hwnd = handle;
            MacNative.GamePlatform.SetTransparentWindow(handle);
            MacNative.FitPrimaryScreen(handle);
            window.SetTopMost(window.isTopMost);
            window.BeginMacTransparencyReassert(10f);
            LilithModPlugin.PluginLog.LogInfo($"Mac window recovery result: {MacNative.WindowDiagnostics()}");
        }
        catch (Exception error) { LilithModPlugin.PluginLog.LogWarning($"Mac window recovery failed: {error}"); }
    }

    internal static void Log()
    {
        try
        {
            var window = TransparentWindowNew.instance;
            LilithModPlugin.PluginLog.LogInfo($"Mac window diagnostics: {MacNative.WindowDiagnostics()}; "
                + $"Unity={Screen.width}x{Screen.height}, mode={Screen.fullScreenMode}; "
                + $"transparentComponent={window is not null}, initialized={window?.windowInitialized}, "
                + $"handle={TransparentWindowNew.Hwnd}, platformHandle={MacNative.GamePlatform.GetAppWindowHandle()}");
            LilithModPlugin.PluginLog.LogInfo($"Mac screen preferences: {MacScreenBootstrapper.BuildPrefsSummary()}; "
                + $"restartArguments={MacScreenBootstrapper.BuildRestartArguments()}; "
                + $"executable={MacScreenBootstrapper.ResolveExecutablePath()}");
        }
        catch (Exception error) { LilithModPlugin.PluginLog.LogWarning($"Mac window diagnostics failed: {error}"); }
    }
}

internal static class MacTrayBridge
{
    private static readonly MacNative.MenuCallback Root = Select;
    private static void Select(int action)
    {
        try
        {
            if (action == 0) TrayIntegration.ShowChat();
            else if (action == 1) TrayIntegration.OpenApiConfiguration();
            else if (action == 2) TrayIntegration.OpenPreferredPlayer();
        }
        catch (Exception error) { LilithModPlugin.PluginLog.LogWarning(error); }
    }
    internal static void Install(IntPtr menu) => MacNative.InstallMenu(menu, Root,
        ModLocalization.T("menu.chat"), ModLocalization.T("menu.mod_settings"));
    internal static void Popup() => MacNative.PopupMenu(Root, ModLocalization.T("menu.chat"),
        ModLocalization.T("menu.listen_music"), ModLocalization.T("menu.mod_settings"));
}

internal static class MacInput
{
    private static readonly bool[] Buttons = new bool[3];
    private static readonly bool[] Previous = new bool[3];
    private static uint _mouseEdges;
    private static readonly System.Collections.Generic.HashSet<KeyCode> KeyEdges = new();
    private static readonly System.Collections.Generic.Dictionary<KeyCode, int> Codes = new()
    { [KeyCode.F8] = 100, [KeyCode.Return] = 36, [KeyCode.KeypadEnter] = 76,
      [KeyCode.LeftShift] = 56, [KeyCode.RightShift] = 60,
      [KeyCode.LeftControl] = 59, [KeyCode.RightControl] = 62 };
    private static readonly System.Collections.Generic.Dictionary<KeyCode, bool> Keys = new();
    private static readonly System.Collections.Generic.Dictionary<KeyCode, bool> PreviousKeys = new();
    internal static void Tick()
    {
        _mouseEdges = MacNative.TakeMouseEdges();
        KeyEdges.Clear();
        for (int i = 0; i < Buttons.Length; i++) { Previous[i] = Buttons[i];
            Buttons[i] = MacNative.MouseButton(i) != 0 || UnityEngine.Input.GetMouseButton(i); }
        foreach (var pair in Codes)
        { PreviousKeys[pair.Key] = Keys.TryGetValue(pair.Key, out bool down) && down;
            if (MacNative.TakeKeyEdge(pair.Value) != 0) KeyEdges.Add(pair.Key);
            Keys[pair.Key] = MacNative.Key(pair.Value) != 0 || UnityEngine.Input.GetKey(pair.Key); }
    }
    internal static bool GetMouseButton(int i) => Buttons[i];
    // Initiating UI actions requires a click delivered to this app, not a global click in another app.
    internal static bool GetMouseButtonDown(int i) => (_mouseEdges & (1u << i)) != 0;
    internal static bool GetMouseButtonUp(int i) => (_mouseEdges & (1u << (i + 8))) != 0 || (!Buttons[i] && Previous[i]) || UnityEngine.Input.GetMouseButtonUp(i);
    internal static bool GetKey(KeyCode key) => Keys.TryGetValue(key, out bool down) ? down : UnityEngine.Input.GetKey(key);
    internal static bool GetKeyDown(KeyCode key) => KeyEdges.Contains(key) || (Keys.TryGetValue(key, out bool down)
        ? (down && !(PreviousKeys.TryGetValue(key, out bool was) && was)) || UnityEngine.Input.GetKeyDown(key) : UnityEngine.Input.GetKeyDown(key));
    internal static Vector3 mousePosition
    {
        get
        {
            if (MacNative.MousePosition(out double x, out double y, out double w, out double h) != 0 && w > 0 && h > 0)
                return new Vector3((float)(x * Screen.width / w), (float)(y * Screen.height / h), 0);
            return UnityEngine.Input.mousePosition;
        }
    }
    internal static Vector2 mouseScrollDelta => UnityEngine.Input.mouseScrollDelta;
    internal static string compositionString => UnityEngine.Input.compositionString ?? "";
    internal static string inputString => UnityEngine.Input.inputString;
}

internal sealed class MacChatFocusController : IChatFocusController
{
    public bool HasKeyboardFocus => MacNative.HasFocus() != 0;
    public bool Acquire() => MacNative.FocusChat(1) != 0;
    public void Release() => MacNative.FocusChat(0);
    public void Dispose() => Release();
}

internal sealed class MacCharacterScreenLocator : ICharacterScreenLocator
{
    public bool TryGetPlacementArea(out CharacterScreenPlacement placement)
    {
        placement = default;
        if (!CharacterController.TryGetCharacterDesktopPoint(out int x, out _)) return false;
        RectInt desktop = MacNative.GamePlatform.GetVirtualScreenBounds();
        if (!MacNative.GamePlatform.TryGetWorkArea(out RectInt work) || desktop.width <= 0 || desktop.height <= 0) return false;
        float sx = Screen.width / (float)desktop.width;
        float sy = Screen.height / (float)desktop.height;
        placement = new CharacterScreenPlacement((x - desktop.x) * sx,
            (work.xMin - desktop.xMin) * sx, (desktop.yMax - work.yMax) * sy,
            (work.xMax - desktop.xMin) * sx, (desktop.yMax - work.yMin) * sy);
        return true;
    }
    public bool IsScreenPointVisible(float x, float y) => x >= 0 && y >= 0 && x < Screen.width && y < Screen.height;
}

internal sealed class MacSettingsLauncher : ISettingsLauncher
{
    public bool Open(out string error)
    {
        try { OpenPage("settings"); error = ""; return true; }
        catch (Exception e) { error = e.Message; return false; }
    }

    internal static void OpenPage(string page)
    {
        using JsonDocument runtime = JsonDocument.Parse(File.ReadAllText(Path.Combine(ModPaths.DataRoot, "runtime.json")));
        JsonElement root = runtime.RootElement;
        string token = root.GetProperty("token").GetString()!;
        int port = root.GetProperty("port").GetInt32();
        Process.Start(new ProcessStartInfo("/usr/bin/open")
        {
            UseShellExecute = false,
            ArgumentList = { $"http://127.0.0.1:{port}/ui/{page}#token={Uri.EscapeDataString(token)}" }
        });
    }
}

internal sealed class MacExternalMusicLauncher : IExternalMusicLauncher
{
    public ExternalMusicPlayer PreferredPlayer() => MusicAppLauncher.PreferredPlayer();
    public bool Open(ExternalMusicPlayer player)
    {
        string id = player switch
        {
            ExternalMusicPlayer.Spotify => "com.spotify.client",
            ExternalMusicPlayer.AppleMusic => "com.apple.Music",
            ExternalMusicPlayer.QqMusic => "com.tencent.QQMusicMac",
            ExternalMusicPlayer.NeteaseCloudMusic => "com.netease.163music",
            ExternalMusicPlayer.AmazonMusic => "com.amazon.music",
            _ => ""
        };
        if (id.Length == 0) return false;
        using Process? process = Process.Start(new ProcessStartInfo("/usr/bin/open")
        { UseShellExecute = false, ArgumentList = { "-b", id } });
        return process is not null && process.WaitForExit(2000) && process.ExitCode == 0;
    }
}
