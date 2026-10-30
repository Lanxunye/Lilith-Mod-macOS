using System;
using System.Collections.Generic;
using UnityEngine;
using System.Runtime.InteropServices;
using Il2CppInterop.Runtime;

namespace LilithMod;

// The original buttons call CollectButtons -> OnButtonClicked -> this delegate.
// Rebind only the native music-option delegate, without detouring IL2CPP code.
internal static class MacBuiltInMusicBridge
{
    private sealed class Binding
    {
        internal readonly Il2CppSystem.Action<int> Original;
        internal readonly Il2CppSystem.Action<int> Replacement;
        internal readonly System.Action<int> Handler;
        internal Binding(Il2CppSystem.Action<int> original, Il2CppSystem.Action<int> replacement, System.Action<int> handler)
        { Original = original; Replacement = replacement; Handler = handler; }
    }
    private static readonly Dictionary<IntPtr, Binding> Bindings = new();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void NativeSelection(IntPtr target, int index, IntPtr method);
    private static readonly NativeSelection RootedSelection = OnNativeSelection;
    private static readonly IntPtr SelectionPointer = Marshal.GetFunctionPointerForDelegate(RootedSelection);
    private static bool _preflighted;
    private static float _nextPoll;

    private static void OnNativeSelection(IntPtr target, int index, IntPtr method)
    {
        try { if (Bindings.TryGetValue(target, out var binding)) binding.Handler(index); }
        catch (Exception error) { LilithModPlugin.PluginLog.LogWarning("Native music selection callback failed: " + error); }
    }

    private static Binding MakeBinding(PlayerLineController controller, Il2CppSystem.Action<int> original, System.Action<int> handler)
    {
        // Clone a game-created native delegate. This avoids ClassInjector, which is
        // unavailable with this stripped macOS IL2CPP build. Only this clone changes.
        var replacement = original.Clone().Cast<Il2CppSystem.Action<int>>();
        if (replacement.Pointer == original.Pointer) throw new InvalidOperationException("Native delegate clone aliases original");
        replacement.method_ptr = SelectionPointer;
        replacement.invoke_impl = SelectionPointer;
        replacement.m_target = controller;
        replacement.method_code = controller.Pointer;
        return new Binding(original, replacement, handler);
    }

    private static void Preflight(PlayerLineController controller)
    {
        if (_preflighted) return;
        var native = Il2CppSystem.Delegate.CreateDelegate(Il2CppType.Of<Il2CppSystem.Action<int>>(),
            controller, "<ShowMusicMenu>b__111_0", false, true).Cast<Il2CppSystem.Action<int>>();
        bool reached = false;
        var test = MakeBinding(controller, native, index => reached = index == -1);
        Bindings[controller.Pointer] = test;
        try { test.Replacement.Invoke(-1); }
        finally { Bindings.Remove(controller.Pointer); }
        if (!reached) throw new InvalidOperationException("Native music delegate did not reach the managed callback");
        _preflighted = true;
        LilithModPlugin.PluginLog.LogInfo("Built-in music callback preflight passed: native clone -> rooted callback; no UI action; no ClassInjector; native detours=0");
    }
    private static bool _errorLogged;

    internal static void Tick()
    {
        if (Time.unscaledTime < _nextPoll) return;
        _nextPoll = Time.unscaledTime + (PlayerLineController.IsAnyOptionsShowing ? 0.03f : 0.25f);
        try
        {
            foreach (var controller in UnityEngine.Object.FindObjectsOfType<PlayerLineController>(true)) { Preflight(controller); Adapt(controller); }
        }
        catch (Exception error)
        {
            if (!_errorLogged)
            {
                _errorLogged = true;
                LilithModPlugin.PluginLog.LogWarning("Built-in music bridge failed: " + error);
            }
        }
    }

    private static void Adapt(PlayerLineController controller)
    {
        var original = controller._customSelectCallback;
        if (original is null) return;
        if (Bindings.TryGetValue(controller.Pointer, out var bound)
            && original.Pointer == bound.Replacement.Pointer) return;
        string name = original.Method?.Name ?? "";
        // The shipped menu has exactly two options: internal music, external player.
        // Guard its native method identity as well as its shape; unrelated menus stay native.
        bool musicMenu = name.StartsWith("<ShowMusicMenu>b__", StringComparison.Ordinal)
            && original.Target?.Pointer == controller.Pointer && controller._buttons?.Count == 2;
        var picker = name.StartsWith("<ShowExternalPlayerPicker>b__", StringComparison.Ordinal)
            ? original.Target?.TryCast<PlayerLineController.__c__DisplayClass117_0>() : null;
        if (!musicMenu && picker is null) return;
        System.Action<int> handler = index =>
        {
            try
            {
                if (musicMenu && index == 1 && ExternalPlayerLauncher.HasChosenDefault && IsNetease(ExternalPlayerLauncher.CurrentPlayer))
                {
                    AudioManager.IsUserMusicActive = true; // Same state set by the native option callback.
                    Dispatch(controller);
                    return;
                }
                if (picker is not null && index >= 0 && index < picker.players.Length && IsNetease(picker.players[index]))
                {
                    var chosen = picker.onChosen;
                    bool chosenLaunches = chosen?.Method?.Name == "OpenExternalPlayerWithReaction";
                    bool openAfter = picker.openAfterSelect;
                    if (chosenLaunches || openAfter)
                    {
                        // Keep the game's default-player persistence and other selection callbacks.
                        // Suppress only its broken launch, then perform the same reaction with the real result.
                        try
                        {
                            picker.openAfterSelect = false;
                            if (chosenLaunches) picker.onChosen = null;
                            original.Invoke(index);
                        }
                        finally { picker.onChosen = chosen; picker.openAfterSelect = openAfter; }
                        Dispatch(controller);
                        return;
                    }
                }
                original.Invoke(index);
                Adapt(controller); // A native selection can immediately create the player picker.
            }
            catch (Exception error)
            {
                LilithModPlugin.PluginLog.LogWarning("Built-in music selection failed: " + error);
                TrayIntegration.Notify("这次没有成功打开音乐播放器，请查看游戏日志。");
            }
        };
        var binding = MakeBinding(controller, original, handler);
        Bindings[controller.Pointer] = binding;
        controller._customSelectCallback = binding.Replacement;
        LilithModPlugin.PluginLog.LogInfo($"Built-in 放点音乐 callback adapted: branch={(musicMenu ? "music-options" : "player-picker")}; method={name}; native detours=0");
    }

    private static bool IsNetease(ExternalPlayerLauncher.PlayerDef? player)
        => player is not null && MacMusicAppNames.IsNetease(player.Id, player.ExeName);

    private static void Dispatch(PlayerLineController controller)
    {
        controller.Hide(); // Original OpenExternalPlayerWithReaction also hides immediately.
        bool opened;
        try { opened = new MacExternalMusicLauncher().Open(ExternalMusicPlayer.NeteaseCloudMusic); }
        catch (Exception error)
        {
            opened = false;
            LilithModPlugin.PluginLog.LogWarning("macOS music activation failed: " + error.Message);
        }
        if (opened)
        {
            ExternalPlayerLauncher.HasOpenedThisSession = true;
            PlayerLineController.HasOpenedThisSession = true;
            ExternalMusicState.SetArmed(true);
        }
        int line = opened ? PlayerLineController.OpenPlayerOkLineId : PlayerLineController.OpenPlayerFailLineId;
        string fallback = opened ? "帮你把{player}叫出来啦~听到好歌要告诉莉莉丝哦！" : "咦，没能叫出{player}呢……是不是没安装呀？";
        string text = PlayerLineController.LocalizedLine(line, fallback).Replace("{player}", ExternalPlayerLauncher.CurrentPlayer.DisplayName);
        DialogueManager.instance?.Say(text, opened ? "emoji_smile_3" : "", 4f, line, true);
        // Playback observation and sway remain handled by the existing macOS music monitor.
        LilithModPlugin.PluginLog.LogInfo($"Built-in 放点音乐 selected: player=cloudmusic; opened={opened}; reactionLine={line}; route=original-option-to-macos-bundle");
    }
}
