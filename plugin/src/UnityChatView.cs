using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using BepInEx;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes.Arrays;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using Object = UnityEngine.Object;
using Input = LilithMod.MacInput;

namespace LilithMod;

internal sealed class UnityChatView : IChatView
{
    private const float CompactHeight = 196f;
    private const float ExpandedHeight = 540f;
    private const float PanelWidth = 560f;
    private const float SafeMargin = 18f;
    private const float HistoryWheelStep = 72f;
    private const float HistoryScrollSharpness = 16f;
    private const float HistoryRowGap = 10f;
    private const float HistoryRowMinimum = 58f;
    private const float HistoryBodyPadding = 24f;
    private const float CitationRowHeight = 32f;
    private const int MaxHistoryRows = 24;

    private static readonly Color White = new(0.94f, 0.94f, 0.92f, 1f);
    private static readonly Color SoftWhite = new(0.78f, 0.78f, 0.76f, 1f);
    private static readonly Color Red = new(0.66f, 0.04f, 0.06f, 1f);
    private static readonly Color RedHover = new(0.82f, 0.08f, 0.1f, 1f);
    private static readonly Color Black = new(0.025f, 0.025f, 0.025f, 0.97f);
    private static readonly Color Dark = new(0.075f, 0.075f, 0.075f, 0.97f);

    private readonly Action<string> _onSubmit;
    private readonly Action _onConfigure;
    private readonly Action _onResetSession;
    private readonly Action _onForgetPlayer;
    private readonly Action _onStopTask;
    private TextMeshProUGUI? _taskStatusLabel;
    private TextMeshProUGUI? _taskModeLabel;
    internal void SetTaskStatus(string status, string goal)
    {
        if (_taskStatusLabel is not null) _taskStatusLabel.text = goal.Length == 0 ? status : status + " · " + goal;
    }
    private readonly string _preferencesPath;
    private readonly IChatFocusController _focusController;
    private readonly ICharacterScreenLocator _characterScreenLocator;
    private readonly List<ChatMessage> _messages = new();
    private static readonly Dictionary<IntPtr, (Button Button, Action Callback)> MacButtons = new();
    private IntPtr _pressedMacButton;
    private readonly List<HistoryRowView> _historyRows = new();
    private readonly Dictionary<string, Texture2D> _stickerTextures = new();
    private static readonly Queue<int> StudioMenuCommands = new();
    private static readonly MacNative.MenuCallback StudioMenuAction = action => StudioMenuCommands.Enqueue(action);

    internal void RevealChatSticker()
    {
        if (!IsVisible) Show(ChatOpenReason.LilithBubble);
        else SetExpanded(true);
        ScrollToBottom();
    }

    private Texture2D? StickerTexture(string? id)
    {
        if (id is null || !Guid.TryParse(id, out _)) return null;
        if (_stickerTextures.TryGetValue(id, out var cached)) return cached;
        string file = Path.Combine(ModPaths.DataRoot, "artwork", id + ".png");
        if (!File.Exists(file) || new FileInfo(file).Length > 32 * 1024 * 1024) return null;
        var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        if (!ImageConversion.LoadImage(texture, File.ReadAllBytes(file), false) || texture.width > 4096 || texture.height > 4096)
        { Object.Destroy(texture); return null; }
        _stickerTextures[id] = texture;
        return texture;
    }

    private GameObject? _root;
    private GameObject? _ownedEventSystem;
    private Canvas? _canvas;
    private CanvasScaler? _canvasScaler;
    private RectTransform? _canvasRect;
    private RectTransform? _panel;
    private RectTransform? _header;
    private GameObject? _historyRoot;
    private RectTransform? _historyContent;
    private ScrollRect? _historyScroll;
    private TMP_InputField? _input;
    private RectTransform? _inputViewport;
    private Button? _sendButton;
    private TextMeshProUGUI? _titleLabel;
    private TextMeshProUGUI? _historyButtonLabel;
    private TextMeshProUGUI? _settingsButtonLabel;
    private TextMeshProUGUI? _placeholderLabel;
    private TextMeshProUGUI? _sendButtonLabel;
    private TextMeshProUGUI? _resetLabel;
    private TextMeshProUGUI? _statusText;
    private GameObject? _memoryMenu;
    private TextMeshProUGUI? _forgetLabel;
    private TMP_FontAsset? _font;
    private Sprite? _avatar;
    private Texture2D? _avatarTexture;
    private Texture2D? _artTexture;
    private RectTransform? _artPanel;
    private RawImage? _artImage;
    private TextMeshProUGUI? _artCaption;
    private TextMeshProUGUI? _artTitle;
    private RectTransform? _artHeader;
    private RectTransform? _artResize;
    private RectTransform? _artGallery;
    private bool _artDragging, _artResizing;
    private Vector2 _artPointerStart, _artPositionStart;
    private float _artWidthStart;
    private bool _nativeEditorReady;
    private float _nextUiDiagnostics;
    private readonly string _artPreferencesPath = Path.Combine(ModPaths.DataRoot, "art-ui.json");

    internal void ShowArtwork(byte[] png, string caption, bool sticker)
    {
        var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        if (!ImageConversion.LoadImage(texture, png, false) || texture.width > 4096 || texture.height > 4096)
        { Object.Destroy(texture); return; }
        if (_artTexture is not null) Object.Destroy(_artTexture);
        _artTexture = texture;
        if (_artPanel is null)
        {
            GameObject panel = CreateObject("LilithMod.ArtPreview", _root!.transform);
            _artPanel = panel.GetComponent<RectTransform>();
            SetAnchored(_artPanel, _canvasRect!.rect.width - 358f, _canvasRect.rect.height - 470f, 340f, 426f, false, false);
            panel.AddComponent<Image>().color = Black;
            AddHardBorder(panel.transform);
            _artTitle = AddText("ArtTitle", panel.transform, "莉莉丝的小画室", 18f, White);
            _artHeader = _artTitle.rectTransform;
            _artTitle.raycastTarget = false;
            SetAnchored(_artHeader, 12f, -6f, 280f, 34f, false, true);
            AddButton("ArtClose", panel.transform, "×", -8f, -6f, 28f, 28f,
                () => _artPanel.gameObject.SetActive(false), true);
            var image = CreateObject("Artwork", panel.transform);
            _artImage = image.AddComponent<RawImage>();
            _artImage.raycastTarget = false;
            SetAnchored(image.GetComponent<RectTransform>(), 10f, -46f, 320f, 320f, false, true);
            _artCaption = AddText("ArtCaption", panel.transform, "", 21f, White);
            _artCaption.alignment = TextAlignmentOptions.Center;
            SetAnchored(_artCaption.rectTransform, 10f, -370f, 320f, 28f, false, true);
            _artGallery = AddButton("ArtGallery", panel.transform, "打开画室 / 保存", 10f, -402f, 292f, 22f,
                () => MacSettingsLauncher.OpenPage("art")).GetComponent<RectTransform>();
            var resize = AddText("ArtResize", panel.transform, "◢", 20f, SoftWhite);
            _artResize = resize.rectTransform;
            SetAnchored(_artResize, -4f, 4f, 24f, 24f, true, false);
            LoadArtPreferences();
        }
        _artPanel.gameObject.SetActive(true);
        _artImage!.texture = texture;
        _artImage.uvRect = new Rect(0, 0, 1, 1);
        _artCaption!.text = sticker ? caption : "";
        LayoutArtWindow();
    }
    private Sprite? _fallbackBackground;
    private Texture2D? _fallbackBackgroundTexture;
    private bool _expanded;
    private bool _dragging;
    private bool _forgetArmed;
    private bool _historyScrollAnimating;
    private bool _historyDirty = true;
    private float _historyScrollTarget;
    private Vector2 _dragPointerStart;
    private Vector2 _dragPanelStart;
    private float _userScale = 1f;
    private bool _hasSessionPosition;
    private float _sessionPositionX = 0.5f;
    private float _sessionPositionY = 0.08f;
    private int _lastScreenWidth;
    private int _lastScreenHeight;
    private float _nextPreferencesPoll;
    private DateTime _preferencesWriteTimeUtc;
    private int _restoreInputFocusFrame = -1;
    private string _locale = "";
    private bool _disposed;
    private GameObject? _transientRoot;
    private RectTransform? _transientPanel;
    private TextMeshProUGUI? _transientLabel;

    internal void UpdateTransientReply(string text, Rect rect)
    {
        if (string.IsNullOrEmpty(text)) { _transientRoot?.SetActive(false); return; }
        if (_transientRoot is null)
        {
            _transientRoot = CreateObject("LilithMod.TransientReply", null);
            Object.DontDestroyOnLoad(_transientRoot);
            Canvas canvas = _transientRoot.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = short.MaxValue - 10;
            GameObject panel = CreateObject("Reply", _transientRoot.transform);
            _transientPanel = panel.GetComponent<RectTransform>();
            _transientPanel.anchorMin = _transientPanel.anchorMax = _transientPanel.pivot = Vector2.zero;
            Image background = panel.AddComponent<Image>();
            background.color = new Color(0.025f, 0.025f, 0.035f, 0.9f);
            background.raycastTarget = false;
            _transientLabel = AddText("Text", panel.transform, text, 26f, White);
            _transientLabel.raycastTarget = false;
            _transientLabel.alignment = TextAlignmentOptions.Center;
            _transientLabel.enableWordWrapping = true;
            Stretch(_transientLabel.rectTransform, 12f, 8f, 12f, 8f);
        }
        _transientRoot.SetActive(true);
        _transientPanel!.anchoredPosition = new Vector2(rect.x, Screen.height - rect.y - rect.height);
        _transientPanel.sizeDelta = new Vector2(rect.width, rect.height);
        _transientLabel!.text = text;
    }

    public UnityChatView(
        Action<string> onSubmit,
        Action onConfigure,
        Action onResetSession,
        Action onForgetPlayer,
        Action onStopTask)
    {
        _onSubmit = onSubmit;
        _onConfigure = onConfigure;
        _onResetSession = onResetSession;
        _onForgetPlayer = onForgetPlayer;
        _onStopTask = onStopTask;
        _preferencesPath = Path.Combine(ModPaths.DataRoot,
            "ui.json");
        _focusController = ChatFocusController.Create();
        _characterScreenLocator = CharacterScreenLocator.Create();
        Build();
        MacNative.InstallStudioMenu(StudioMenuAction);
    }

    public bool IsVisible => _root is not null && _root.activeSelf;

    public bool PointerOverPanel => IsVisible
        && ((_panel is not null && RectTransformUtility.RectangleContainsScreenPoint(_panel, Input.mousePosition, null))
            || (_artPanel is not null && _artPanel.gameObject.activeSelf
                && RectTransformUtility.RectangleContainsScreenPoint(_artPanel, Input.mousePosition, null)));

    public void Show(ChatOpenReason reason)
    {
        if (_root is null)
        {
            return;
        }
        _root.SetActive(true);
        SetExpanded(reason == ChatOpenReason.LilithBubble);
        ApplyOpenPosition();
        if (!_hasSessionPosition)
        {
            _hasSessionPosition = true;
            CaptureSessionPosition();
            LilithModPlugin.PluginLog.LogInfo(
                $"Chat session position initialized: x={_sessionPositionX:0.000}; " +
                $"y={_sessionPositionY:0.000}");
        }
        ScrollToBottom();
        RequestInputFocus();
    }

    public void Hide()
    {
        MacNative.EditorLayout(0, 0, 0, 0, 1, 1, 18, 0);
        _nativeEditorReady = false;
        _focusController.Release();
        _memoryMenu?.SetActive(false);
        _forgetArmed = false;
        _root?.SetActive(false);
    }

    public void SetMessages(IReadOnlyList<ChatMessage> messages)
    {
        if (MessagesEqual(messages))
        {
            return;
        }
        _messages.Clear();
        _messages.AddRange(messages);
        MarkHistoryDirty();
    }

    public void AddMessage(ChatMessage message)
    {
        _messages.Add(message);
        MarkHistoryDirty();
    }

    public void ClearMessages()
    {
        _messages.Clear();
        MarkHistoryDirty();
    }

    public void SetBusy(bool busy, string status = "")
    {
        if (_sendButton is not null)
        {
            _sendButton.interactable = !busy;
        }
        if (_statusText is not null)
        {
            _statusText.text = busy
                ? (string.IsNullOrWhiteSpace(status) ? ModLocalization.T("chat.status.connecting") : status)
                : string.Empty;
            _statusText.color = busy ? RedHover : SoftWhite;
        }
    }

    public void Tick()
    {
        if (_taskModeLabel is not null) _taskModeLabel.text = TaskChatMode.Label;
        ProcessStudioMenuCommands();
        if (!IsVisible || _panel is null || _header is null || _canvasRect is null)
        {
            return;
        }

        UpdateNativeEditor();
        PollMacControls();
        TickArtWindow();
        bool pointerOverPanel = PointerOverPanel;
        if (pointerOverPanel)
        {
            PassThroughMouseHook.SetOverCharacter(true);
        }

        UpdateSmoothHistoryScroll();
        UpdateInputFocus();

        if (Input.GetMouseButtonDown(0)
            && _inputViewport is not null
            && RectTransformUtility.RectangleContainsScreenPoint(_inputViewport, Input.mousePosition, null))
        {
            RequestInputFocus();
        }

        if (Screen.width != _lastScreenWidth || Screen.height != _lastScreenHeight)
        {
            UpdateCanvasScale();
            Canvas.ForceUpdateCanvases();
            LoadPreferences();
            if (_artPanel is not null) { LoadArtPreferences(); LayoutArtWindow(); }
            if (_hasSessionPosition)
            {
                ApplySessionPosition();
                ClampToCanvas();
                CaptureSessionPosition();
            }
            else
            {
                ApplyOpenPosition();
            }
        }
        if (Time.unscaledTime >= _nextPreferencesPoll)
        {
            _nextPreferencesPoll = Time.unscaledTime + 1f;
            ReloadPreferencesIfChanged();
            ApplyLocalization();
        }

        if (Input.GetMouseButtonDown(0)
            && _pressedMacButton == IntPtr.Zero
            && RectTransformUtility.RectangleContainsScreenPoint(_header, Input.mousePosition, null)
            && ScreenPointInCanvas(Input.mousePosition, out Vector2 pointer))
        {
            _dragging = true;
            _dragPointerStart = pointer;
            _dragPanelStart = _panel.anchoredPosition;
        }
        if (_dragging && Input.GetMouseButton(0) && ScreenPointInCanvas(Input.mousePosition, out Vector2 current))
        {
            _panel.anchoredPosition = _dragPanelStart + current - _dragPointerStart;
            ClampToCanvas();
        }
        if (_dragging && Input.GetMouseButtonUp(0))
        {
            _dragging = false;
            _hasSessionPosition = true;
            CaptureSessionPosition();
            LilithModPlugin.PluginLog.LogInfo(
                $"Chat session position updated: x={_sessionPositionX:0.000}; " +
                $"y={_sessionPositionY:0.000}");
        }
        UpdateNativeEditor();
        WriteUiDiagnostics();
    }

    private void UpdateNativeEditor()
    {
        if (_inputViewport is null || _input is null) return;
        Rect rect = _inputViewport.rect;
        Vector2 lower = RectTransformUtility.WorldToScreenPoint(null, _inputViewport.TransformPoint(new Vector3(rect.xMin, rect.yMin, 0)));
        Vector2 upper = RectTransformUtility.WorldToScreenPoint(null, _inputViewport.TransformPoint(new Vector3(rect.xMax, rect.yMax, 0)));
        float height = upper.y - lower.y;
        bool ready = MacNative.EditorLayout(lower.x, lower.y, upper.x - lower.x, height,
            Screen.width, Screen.height, 18f * height / Mathf.Max(1, rect.height), IsVisible ? 1 : 0) != 0;
        if (ready != _nativeEditorReady)
        {
            _nativeEditorReady = ready;
            _input.enabled = !ready;
            _input.textComponent.enabled = !ready;
        }
        if (!ready) return;
        if (_placeholderLabel is not null) _placeholderLabel.enabled = MacNative.EditorText().Length == 0;
        if (MacNative.EditorTakeSubmit() != 0) SubmitCurrentInput();
    }

    private void LayoutArtWindow()
    {
        if (_artPanel is null || _canvasRect is null) return;
        var bounds = StudioWindowBounds.Clamp(_artPanel.anchoredPosition.x, _artPanel.anchoredPosition.y,
            _artPanel.rect.width, _canvasRect.rect.width, _canvasRect.rect.height);
        _artPanel.anchoredPosition = new Vector2(bounds.X, bounds.Y);
        _artPanel.sizeDelta = new Vector2(bounds.Width, bounds.Height);
        float box = bounds.Width - 20f;
        if (_artImage is not null && _artTexture is not null)
        {
            float aspect = _artTexture.width / (float)_artTexture.height;
            float width = aspect >= 1f ? box : box * aspect;
            float height = aspect >= 1f ? box / aspect : box;
            SetAnchored(_artImage.rectTransform, 10f + (box - width) / 2f, -46f - (box - height) / 2f, width, height, false, true);
        }
        if (_artHeader is not null) _artHeader.sizeDelta = new Vector2(bounds.Width - 55f, 34f);
        if (_artCaption is not null) SetAnchored(_artCaption.rectTransform, 10f, -bounds.Width - 30f, box, 28f, false, true);
        if (_artGallery is not null) SetAnchored(_artGallery, 10f, -bounds.Width - 62f, bounds.Width - 48f, 22f, false, true);
    }

    private void TickArtWindow()
    {
        if (_artPanel is null || !_artPanel.gameObject.activeSelf || _canvasRect is null) return;
        Vector3 mouse = Input.mousePosition;
        if (Input.GetMouseButtonDown(0) && _pressedMacButton == IntPtr.Zero && ScreenPointInCanvas(mouse, out var start))
        {
            _artResizing = _artResize is not null && RectTransformUtility.RectangleContainsScreenPoint(_artResize, mouse, null);
            _artDragging = !_artResizing && _artHeader is not null && RectTransformUtility.RectangleContainsScreenPoint(_artHeader, mouse, null);
            if (_artResizing || _artDragging)
            { _artPointerStart = start; _artPositionStart = _artPanel.anchoredPosition; _artWidthStart = _artPanel.rect.width; }
        }
        if ((_artDragging || _artResizing) && (Input.GetMouseButton(0) || Input.GetMouseButtonUp(0))
            && ScreenPointInCanvas(mouse, out var current))
        {
            Vector2 delta = current - _artPointerStart;
            if (_artDragging) _artPanel.anchoredPosition = _artPositionStart + delta;
            else
            {
                // Keep the top left corner fixed while dragging the lower right grip.
                var size = StudioWindowBounds.Clamp(18, 18, _artWidthStart + (delta.x - delta.y) / 2f,
                    _canvasRect.rect.width, _canvasRect.rect.height);
                _artPanel.sizeDelta = new Vector2(size.Width, size.Height);
                _artPanel.anchoredPosition = _artPositionStart + new Vector2(0, _artWidthStart - size.Width);
            }
            LayoutArtWindow();
        }
        if ((_artDragging || _artResizing) && Input.GetMouseButtonUp(0))
        { _artDragging = _artResizing = false; SaveArtPreferences(); }
        LayoutArtWindow();
    }

    private void ProcessStudioMenuCommands()
    {
        while (StudioMenuCommands.TryDequeue(out int action))
        {
            if (_artPanel is null || _canvasRect is null) { MacSettingsLauncher.OpenPage("art"); continue; }
            if (!IsVisible) Show(ChatOpenReason.Command);
            _artPanel.gameObject.SetActive(true);
            Vector2 position = _artPanel.anchoredPosition;
            float width = _artPanel.rect.width;
            if (action is 1 or 2)
            {
                var size = StudioWindowBounds.Clamp(position.x, position.y, width + (action == 1 ? 40 : -40), _canvasRect.rect.width, _canvasRect.rect.height);
                _artPanel.sizeDelta = new Vector2(size.Width, size.Height);
                position.y += width - size.Width;
            }
            if (action == 3) position = new Vector2((_canvasRect.rect.width - _artPanel.rect.width) / 2, (_canvasRect.rect.height - _artPanel.rect.height) / 2);
            if (action == 4) position.x -= 40;
            if (action == 5) position.x += 40;
            if (action == 6) position.y += 40;
            if (action == 7) position.y -= 40;
            _artPanel.anchoredPosition = position;
            LayoutArtWindow();
            SaveArtPreferences();
        }
    }

    private void LoadArtPreferences()
    {
        try
        {
            if (!File.Exists(_artPreferencesPath) || _artPanel is null || _canvasRect is null) return;
            var settings = JsonSerializer.Deserialize<StudioPreferences>(File.ReadAllText(_artPreferencesPath));
            if (settings is null) return;
            var bounds = StudioWindowBounds.Clamp(18, 18, settings.Width, _canvasRect.rect.width, _canvasRect.rect.height);
            _artPanel.sizeDelta = new Vector2(bounds.Width, bounds.Height);
            _artPanel.anchoredPosition = new Vector2(18 + Mathf.Clamp01(settings.X) * Mathf.Max(0, _canvasRect.rect.width - bounds.Width - 36),
                18 + Mathf.Clamp01(settings.Y) * Mathf.Max(0, _canvasRect.rect.height - bounds.Height - 36));
        }
        catch (Exception error) { LilithModPlugin.PluginLog.LogWarning($"Art window preferences unavailable: {error.GetType().Name}"); }
    }

    private void SaveArtPreferences()
    {
        if (_artPanel is null || _canvasRect is null) return;
        try
        {
            var settings = new StudioPreferences { Width = _artPanel.rect.width,
                X = Mathf.Clamp01((_artPanel.anchoredPosition.x - 18) / Mathf.Max(1, _canvasRect.rect.width - _artPanel.rect.width - 36)),
                Y = Mathf.Clamp01((_artPanel.anchoredPosition.y - 18) / Mathf.Max(1, _canvasRect.rect.height - _artPanel.rect.height - 36)) };
            File.WriteAllText(_artPreferencesPath + ".tmp", JsonSerializer.Serialize(settings));
            File.Move(_artPreferencesPath + ".tmp", _artPreferencesPath, true);
            LilithModPlugin.PluginLog.LogInfo($"LILITH_MAC_ART_LAYOUT: width={settings.Width:0}; x={settings.X:0.000}; y={settings.Y:0.000}");
        }
        catch (Exception error) { LilithModPlugin.PluginLog.LogWarning($"Art window preferences save failed: {error.GetType().Name}"); }
    }

    private sealed class StudioPreferences
    {
        public float X { get; set; } = 1f;
        public float Y { get; set; } = 1f;
        public float Width { get; set; } = 340f;
    }

    private void WriteUiDiagnostics()
    {
        if (Environment.GetEnvironmentVariable("LILITH_MAC_UI_DIAGNOSTICS") != "1" || Time.unscaledTime < _nextUiDiagnostics) return;
        _nextUiDiagnostics = Time.unscaledTime + .5f;
        try
        {
            using var editor = JsonDocument.Parse(MacNative.EditorDiagnostics());
            string json = JsonSerializer.Serialize(new { editor = editor.RootElement,
                art = new { visible = _artPanel?.gameObject.activeSelf == true, x = _artPanel?.anchoredPosition.x,
                    y = _artPanel?.anchoredPosition.y, width = _artPanel?.rect.width, height = _artPanel?.rect.height },
                frame = Time.frameCount });
            string file = Path.Combine(ModPaths.DataRoot, "ui-diagnostics.json");
            File.WriteAllText(file + ".tmp", json); File.Move(file + ".tmp", file, true);
        }
        catch (Exception error) { LilithModPlugin.PluginLog.LogDebug($"UI diagnostics: {error.GetType().Name}"); }
    }

    private void PollMacControls()
    {
        Vector3 pointer = Input.mousePosition;
        if (Input.GetMouseButtonDown(0))
        {
            if (Environment.GetEnvironmentVariable("LILITH_MAC_SELFTEST") == "1")
                LilithModPlugin.PluginLog.LogInfo($"MAC_INPUT_DOWN x={pointer.x}; y={pointer.y}; unity={UnityEngine.Input.mousePosition}; screen={Screen.width}x{Screen.height}");
            _pressedMacButton = IntPtr.Zero;
            foreach (var pair in MacButtons)
            {
                Button button = pair.Value.Button;
                if (button.gameObject.activeInHierarchy && button.interactable
                    && RectTransformUtility.RectangleContainsScreenPoint(button.GetComponent<RectTransform>(), pointer, null))
                { _pressedMacButton = pair.Key;
                    if (Environment.GetEnvironmentVariable("LILITH_MAC_SELFTEST") == "1")
                        LilithModPlugin.PluginLog.LogInfo($"MAC_INPUT_BUTTON {button.gameObject.name}");
                    break; }
            }
        }
        if (Input.GetMouseButtonUp(0))
        {
            IntPtr pressed = _pressedMacButton;
            _pressedMacButton = IntPtr.Zero;
            if (MacButtons.TryGetValue(pressed, out var entry) && entry.Button.gameObject.activeInHierarchy
                && entry.Button.interactable && RectTransformUtility.RectangleContainsScreenPoint(
                    entry.Button.GetComponent<RectTransform>(), pointer, null)) entry.Callback();
        }
        if (!_nativeEditorReady && _input is not null && _focusController.HasKeyboardFocus
            && Input.compositionString.Length == 0
            && (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter))
            && !Input.GetKey(KeyCode.LeftShift) && !Input.GetKey(KeyCode.RightShift))
            SubmitCurrentInput();
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        MacNative.EditorDispose();
        foreach (var texture in _stickerTextures.Values) Object.Destroy(texture);
        _stickerTextures.Clear();
        if (_artTexture is not null) Object.Destroy(_artTexture);
        if (_transientRoot is not null) Object.Destroy(_transientRoot);
        MacButtons.Clear();
        _focusController.Dispose();
        if (_root is not null)
        {
            Object.Destroy(_root);
        }
        if (_ownedEventSystem is not null)
        {
            Object.Destroy(_ownedEventSystem);
        }
        if (_avatar is not null)
        {
            Object.Destroy(_avatar);
        }
        if (_avatarTexture is not null)
        {
            Object.Destroy(_avatarTexture);
        }
        if (_fallbackBackground is not null)
        {
            Object.Destroy(_fallbackBackground);
        }
        if (_fallbackBackgroundTexture is not null)
        {
            Object.Destroy(_fallbackBackgroundTexture);
        }
    }

    private void Build()
    {
        _font = FindFont(ModLocalization.CurrentLocale);
        _avatar = LoadAvatar();
        Sprite background = FindSprite("Settings_Bg_FixSize") ?? CreateCheckerBackground();

        _root = CreateObject("LilithMod.ChatCanvas", null);
        Object.DontDestroyOnLoad(_root);
        _canvas = _root.AddComponent<Canvas>();
        _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        _canvas.sortingOrder = short.MaxValue - 20;
        _canvasScaler = _root.AddComponent<CanvasScaler>();
        _canvasScaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
        UpdateCanvasScale();
        _root.AddComponent<GraphicRaycaster>();
        _canvasRect = _root.GetComponent<RectTransform>();
        EnsureEventSystem();

        GameObject panelObject = CreateObject("Panel", _root.transform);
        _panel = panelObject.GetComponent<RectTransform>();
        _panel.anchorMin = Vector2.zero;
        _panel.anchorMax = Vector2.zero;
        _panel.pivot = Vector2.zero;
        _panel.sizeDelta = new Vector2(PanelWidth, CompactHeight);
        _panel.anchoredPosition = new Vector2(24f, 80f);
        Image panelImage = panelObject.AddComponent<Image>();
        panelImage.sprite = background;
        panelImage.type = background.border.sqrMagnitude > 0f ? Image.Type.Sliced : Image.Type.Tiled;
        panelImage.color = Color.white;
        AddHardBorder(panelObject.transform);

        GameObject headerObject = CreateObject("Header", panelObject.transform);
        _header = headerObject.GetComponent<RectTransform>();
        SetTopStretch(_header, 0f, 0f, 0f, 42f);
        Image headerImage = headerObject.AddComponent<Image>();
        headerImage.color = Black;

        RectTransform accent = AddImage("Accent", headerObject.transform, Red);
        SetAnchored(accent, 0f, 0f, 8f, 42f, false, true);

        RectTransform avatarRect = AddImage("Avatar", headerObject.transform, Color.white, _avatar);
        SetAnchored(avatarRect, 15f, -3f, 36f, 36f, false, true);

        _titleLabel = AddText("Title", headerObject.transform, string.Empty, 20f, White, FontStyles.Bold);
        SetAnchored(_titleLabel.rectTransform, 59f, -5f, 220f, 32f, false, true);

        _statusText = AddText("Status", headerObject.transform, string.Empty, 14f, SoftWhite);
        _statusText.alignment = TextAlignmentOptions.MidlineRight;
        SetAnchored(_statusText.rectTransform, 280f, -7f, 66f, 28f, false, true);

        Button historyButton = AddButton(
            "HistoryButton",
            headerObject.transform,
            string.Empty,
            350f,
            -5f,
            68f,
            32f,
            ToggleHistory);
        _historyButtonLabel = historyButton.GetComponentInChildren<TextMeshProUGUI>();
        Button settingsButton = AddButton("SettingsButton", headerObject.transform, string.Empty, 422f, -5f, 68f, 32f, _onConfigure);
        _settingsButtonLabel = settingsButton.GetComponentInChildren<TextMeshProUGUI>();
        AddButton("MemoryButton", headerObject.transform, "⋯", 494f, -5f, 28f, 32f, ToggleMemoryMenu);
        AddButton("CloseButton", headerObject.transform, "×", 524f, -5f, 28f, 32f, Hide);

        BuildHistory(panelObject.transform);
        BuildComposer(panelObject.transform);
        GameObject taskStrip = CreateObject("TaskStrip", panelObject.transform);
        SetBottomStretch(taskStrip.GetComponent<RectTransform>(), 12f, 100f, 12f, 32f);
        Button modeButton = AddButton("TaskMode", taskStrip.transform, TaskChatMode.Label, 0f, 0f, 116f, 30f, TaskChatMode.Cycle, false, false);
        _taskModeLabel = modeButton.GetComponentInChildren<TextMeshProUGUI>();
        _taskStatusLabel = AddText("TaskStatus", taskStrip.transform, "任务按需委托", 13f, SoftWhite);
        _taskStatusLabel.richText = false;
        _taskStatusLabel.enableWordWrapping = false;
        _taskStatusLabel.overflowMode = TextOverflowModes.Ellipsis;
        SetAnchored(_taskStatusLabel.rectTransform, 124f, 0f, 264f, 30f, false, false);
        AddButton("TaskDetails", taskStrip.transform, "任务", 394f, 0f, 64f, 30f, () => MacSettingsLauncher.OpenPage("chat"), false, false);
        AddButton("TaskStop", taskStrip.transform, "停止", 464f, 0f, 64f, 30f, _onStopTask, false, false);
        BuildMemoryMenu(panelObject.transform);
        ApplyLocalization(force: true);
        LoadPreferences();
        SetExpanded(false);
        _root.SetActive(false);
    }

    private void BuildHistory(Transform parent)
    {
        _historyRoot = CreateObject("History", parent);
        RectTransform rootRect = _historyRoot.GetComponent<RectTransform>();
        Stretch(rootRect, 12f, 50f, 12f, 144f);
        Image rootImage = _historyRoot.AddComponent<Image>();
        rootImage.color = new Color(0.02f, 0.02f, 0.02f, 0.93f);

        GameObject viewportObject = CreateObject("Viewport", _historyRoot.transform);
        RectTransform viewport = viewportObject.GetComponent<RectTransform>();
        Stretch(viewport, 6f, 6f, 6f, 6f);
        Image viewportImage = viewportObject.AddComponent<Image>();
        viewportImage.color = new Color(0f, 0f, 0f, 0.01f);
        Mask mask = viewportObject.AddComponent<Mask>();
        mask.showMaskGraphic = false;

        GameObject contentObject = CreateObject("Content", viewportObject.transform);
        _historyContent = contentObject.GetComponent<RectTransform>();
        _historyContent.anchorMin = new Vector2(0f, 1f);
        _historyContent.anchorMax = new Vector2(1f, 1f);
        _historyContent.pivot = new Vector2(0.5f, 1f);
        _historyContent.anchoredPosition = Vector2.zero;
        _historyContent.sizeDelta = Vector2.zero;

        _historyScroll = _historyRoot.AddComponent<ScrollRect>();
        _historyScroll.viewport = viewport;
        _historyScroll.content = _historyContent;
        _historyScroll.horizontal = false;
        _historyScroll.vertical = true;
        _historyScroll.movementType = ScrollRect.MovementType.Clamped;
        _historyScroll.scrollSensitivity = 0f;
    }

    private void BuildComposer(Transform parent)
    {
        GameObject composer = CreateObject("Composer", parent);
        RectTransform composerRect = composer.GetComponent<RectTransform>();
        SetBottomStretch(composerRect, 12f, 12f, 12f, 82f);
        Image composerImage = composer.AddComponent<Image>();
        composerImage.color = Dark;
        AddHardBorder(composer.transform, 1f, new Color(0.65f, 0.65f, 0.63f, 1f));

        GameObject viewportObject = CreateObject("InputViewport", composer.transform);
        RectTransform viewport = viewportObject.GetComponent<RectTransform>();
        _inputViewport = viewport;
        Stretch(viewport, 11f, 8f, 91f, 8f);
        Mask mask = viewportObject.AddComponent<Mask>();
        Image maskImage = viewportObject.AddComponent<Image>();
        maskImage.color = new Color(0f, 0f, 0f, 0.01f);
        mask.showMaskGraphic = false;

        TextMeshProUGUI inputText = AddText("InputText", viewportObject.transform, string.Empty, 18f, White);
        inputText.enableWordWrapping = true;
        inputText.alignment = TextAlignmentOptions.TopLeft;
        Stretch(inputText.rectTransform, 2f, 2f, 2f, 2f);

        _placeholderLabel = AddText("Placeholder", viewportObject.transform, string.Empty, 18f, new Color(0.55f, 0.55f, 0.53f, 1f));
        _placeholderLabel.fontStyle = FontStyles.Italic;
        Stretch(_placeholderLabel.rectTransform, 2f, 2f, 2f, 2f);

        _input = composer.AddComponent<TMP_InputField>();
        _input.textViewport = viewport;
        _input.textComponent = inputText;
        _input.placeholder = _placeholderLabel;
        _input.lineType = TMP_InputField.LineType.MultiLineSubmit;
        _input.characterLimit = 2000;
        _input.richText = false;
        // AppKit owns macOS editing and IME; TMP remains the portable fallback.
        _input.enabled = false;
        inputText.enabled = false;

        _sendButton = AddButton("SendButton", composer.transform, string.Empty, 453f, 9f, 73f, 52f, SubmitCurrentInput);
        _sendButtonLabel = _sendButton.GetComponentInChildren<TextMeshProUGUI>();
    }

    private void BuildMemoryMenu(Transform parent)
    {
        _memoryMenu = CreateObject("MemoryMenu", parent);
        RectTransform menuRect = _memoryMenu.GetComponent<RectTransform>();
        menuRect.anchorMin = new Vector2(1f, 1f);
        menuRect.anchorMax = new Vector2(1f, 1f);
        menuRect.pivot = new Vector2(1f, 1f);
        menuRect.sizeDelta = new Vector2(242f, 133f);
        menuRect.anchoredPosition = new Vector2(-8f, -46f);
        Image image = _memoryMenu.AddComponent<Image>();
        image.color = Black;
        AddHardBorder(_memoryMenu.transform, 1f);

        Button reset = AddButton("ResetSession", _memoryMenu.transform, string.Empty, 7f, 49f, 228f, 35f, () =>
        {
            _memoryMenu?.SetActive(false);
            _onResetSession();
        }, false, false);
        _resetLabel = reset.GetComponentInChildren<TextMeshProUGUI>();
        Button forget = AddButton("ForgetPlayer", _memoryMenu.transform, string.Empty, 7f, 8f, 228f, 35f, ConfirmForget, false, false);
        _forgetLabel = forget.GetComponentInChildren<TextMeshProUGUI>();
        AddButton("OpenArtStudio", _memoryMenu.transform, "绘图 / 表情包", 7f, 90f, 228f, 35f,
            () => { _memoryMenu.SetActive(false); MacSettingsLauncher.OpenPage("art"); }, false, false);
        _memoryMenu.SetActive(false);
    }

    private void SubmitFromInput(string value)
    {
        if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift))
        {
            return;
        }
        if (_sendButton is { interactable: false })
        {
            RequestInputFocus();
            return;
        }
        SubmitText(value);
    }

    private void InputSelected(string _)
    {
        LilithModPlugin.PluginLog.LogInfo("Unity chat input selected");
        _focusController.Acquire();
    }

    private void SubmitCurrentInput()
    {
        SubmitText(_nativeEditorReady ? MacNative.EditorText() : _input?.text ?? string.Empty);
    }

    private void SubmitText(string value)
    {
        string message = value.Trim();
        if (message.Length == 0 || _sendButton is { interactable: false })
        {
            RequestInputFocus();
            return;
        }
        if (_input is not null) _input.text = string.Empty;
        if (_nativeEditorReady) MacNative.EditorSetText("");
        RequestInputFocus();
        _onSubmit(message);
    }

    private void RequestInputFocus()
    {
        // TMP_InputField deactivates itself after invoking onSubmit. Restoring in
        // the following frame avoids having that teardown overwrite our focus.
        _restoreInputFocusFrame = Time.frameCount + 1;
    }

    private void UpdateInputFocus()
    {
        if (_input is null)
        {
            return;
        }

        if (_nativeEditorReady)
        {
            if (_restoreInputFocusFrame >= 0 && Time.frameCount >= _restoreInputFocusFrame)
            { _restoreInputFocusFrame = -1; _focusController.Acquire(); }
            return;
        }
        EventSystem? eventSystem = EventSystem.current;
        bool anotherUnityControlSelected = eventSystem is not null
            && eventSystem.currentSelectedGameObject != _input.gameObject;
        if (_input.isFocused
            && (!_focusController.HasKeyboardFocus || anotherUnityControlSelected))
        {
            _input.DeactivateInputField();
            if (eventSystem?.currentSelectedGameObject == _input.gameObject)
            {
                eventSystem.SetSelectedGameObject(null);
            }
        }

        if (_restoreInputFocusFrame < 0 || Time.frameCount < _restoreInputFocusFrame)
        {
            return;
        }
        _restoreInputFocusFrame = -1;
        FocusInputNow();
    }

    private void FocusInputNow()
    {
        if (_input is null || !_input.interactable || !IsVisible)
        {
            return;
        }

        _focusController.Acquire();
        if (!_focusController.HasKeyboardFocus)
        {
            _input.DeactivateInputField();
            return;
        }

        EventSystem? eventSystem = EventSystem.current;
        eventSystem?.SetSelectedGameObject(_input.gameObject);
        _input.Select();
        _input.ActivateInputField();
        int end = _input.text?.Length ?? 0;
        _input.caretPosition = end;
        _input.selectionAnchorPosition = end;
        _input.selectionFocusPosition = end;
    }

    private void ToggleHistory()
    {
        SetExpanded(!_expanded);
        ScrollToBottom();
        LilithModPlugin.PluginLog.LogInfo($"Chat history expanded={_expanded}");
    }

    private void ToggleMemoryMenu()
    {
        if (_memoryMenu is null)
        {
            return;
        }
        bool show = !_memoryMenu.activeSelf;
        _forgetArmed = false;
        if (_forgetLabel is not null)
        {
            _forgetLabel.text = ModLocalization.T("chat.forget_player");
        }
        _memoryMenu.SetActive(show);
    }

    private void ConfirmForget()
    {
        if (!_forgetArmed)
        {
            _forgetArmed = true;
            if (_forgetLabel is not null)
            {
                _forgetLabel.text = ModLocalization.T("chat.forget_confirm");
                _forgetLabel.color = RedHover;
            }
            return;
        }
        _forgetArmed = false;
        _memoryMenu?.SetActive(false);
        _onForgetPlayer();
    }

    private void SetExpanded(bool expanded)
    {
        _expanded = expanded;
        if (_historyButtonLabel is not null)
        {
            _historyButtonLabel.text = expanded
                ? ModLocalization.T("chat.hide_history")
                : ModLocalization.T("chat.history");
        }
        if (_panel is not null)
        {
            _panel.sizeDelta = new Vector2(
                PanelWidth,
                expanded ? AvailableExpandedHeight() : CompactHeight);
        }
        _historyRoot?.SetActive(expanded);
        if (expanded)
        {
            RenderHistory();
        }
        ClampToCanvas();
    }

    private float AvailableExpandedHeight()
    {
        if (_canvasRect is null)
        {
            return ExpandedHeight;
        }
        return ChatUiScale.FitPanelHeight(
            _canvasRect.rect.height,
            _userScale,
            CompactHeight,
            ExpandedHeight,
            SafeMargin);
    }

    private void RenderHistory()
    {
        if (!_expanded || !_historyDirty || _historyContent is null)
        {
            return;
        }

        float y = 0f;
        var usedStickers = new HashSet<string>();
        int firstMessage = Mathf.Max(0, _messages.Count - MaxHistoryRows);
        int visibleCount = _messages.Count - firstMessage;
        for (int rowIndex = 0; rowIndex < visibleCount; rowIndex++)
        {
            ChatMessage message = _messages[firstMessage + rowIndex];
            float historyWidth = _historyRoot?.GetComponent<RectTransform>().rect.width ?? 0f;
            float bodyWidth = historyWidth > 1f ? Mathf.Max(1f, historyWidth - 62f) : 454f;
            HistoryRowView row = GetOrCreateHistoryRow(rowIndex);
            row.Root.SetActive(true);
            RectTransform rowRect = row.Rect;
            rowRect.anchorMin = new Vector2(0f, 1f);
            rowRect.anchorMax = new Vector2(1f, 1f);
            rowRect.pivot = new Vector2(0.5f, 1f);
            rowRect.anchoredPosition = new Vector2(0f, -y);

            TextMeshProUGUI body = row.Body;
            body.text = message.Text;
            body.enableWordWrapping = true;
            body.alignment = TextAlignmentOptions.TopLeft;
            Vector2 preferred = body.GetPreferredValues(message.Text, bodyWidth, Mathf.Infinity);
            int citationCount = Math.Min(5, message.Citations?.Count ?? 0);
            bool hasCitations = citationCount > 0;
            Texture2D? sticker = StickerTexture(message.ArtworkId);
            row.Sticker.gameObject.SetActive(sticker is not null);
            row.Sticker.texture = sticker;
            float stickerSize = sticker is not null ? Mathf.Min(210f, bodyWidth) : 0f;
            if (sticker is not null)
            {
                usedStickers.Add(message.ArtworkId!);
                SetAnchored(row.Sticker.rectTransform, 54f, -8f, stickerSize, stickerSize, false, true);
            }
            body.rectTransform.offsetMax = new Vector2(-8f, sticker is not null ? -stickerSize - 16f : -8f);
            body.rectTransform.offsetMin = new Vector2(54f, hasCitations ? 38f : 8f);
            ConfigureCitationButtons(row, message.Citations, citationCount);
            // TMP can render a wrapped line outside a short stretched RectTransform.
            // Leave enough vertical room for the measured text plus both padding and
            // keep overflow clipped so adjacent script entries cannot visually overlap.
            float rowHeight = Mathf.Max(
                HistoryRowMinimum,
                Mathf.Ceil(preferred.y) + HistoryBodyPadding + (hasCitations ? CitationRowHeight : 0f)
                    + (sticker is not null ? stickerSize + 8f : 0f));
            rowRect.sizeDelta = new Vector2(0f, rowHeight);
            body.overflowMode = TextOverflowModes.Truncate;

            if (message.Speaker == ChatSpeaker.Lilith)
            {
                row.Portrait.gameObject.SetActive(true);
                row.Speaker.gameObject.SetActive(false);
            }
            else
            {
                string name = message.Speaker == ChatSpeaker.User
                    ? ModLocalization.T("common.you")
                    : ModLocalization.T("common.system");
                row.Portrait.gameObject.SetActive(false);
                row.Speaker.gameObject.SetActive(true);
                row.Speaker.text = name;
                row.Speaker.color = message.Speaker == ChatSpeaker.System ? RedHover : SoftWhite;
            }

            body.color = message.Speaker == ChatSpeaker.System ? SoftWhite : White;
            y += rowHeight + HistoryRowGap;
        }
        for (int i = visibleCount; i < _historyRows.Count; i++)
        {
            _historyRows[i].Root.SetActive(false);
        }
        foreach (string id in _stickerTextures.Keys.Where(id => !usedStickers.Contains(id)).ToArray())
        { Object.Destroy(_stickerTextures[id]); _stickerTextures.Remove(id); }
        _historyContent.sizeDelta = new Vector2(0f, y);
        _historyDirty = false;
        ScrollToBottom();
    }

    private void MarkHistoryDirty()
    {
        _historyDirty = true;
        if (_expanded)
        {
            RenderHistory();
        }
    }

    private bool MessagesEqual(IReadOnlyList<ChatMessage> messages)
    {
        if (_messages.Count != messages.Count)
        {
            return false;
        }
        for (int i = 0; i < messages.Count; i++)
        {
            if (_messages[i] != messages[i])
            {
                return false;
            }
        }
        return true;
    }

    private HistoryRowView GetOrCreateHistoryRow(int index)
    {
        if (index < _historyRows.Count)
        {
            return _historyRows[index];
        }
        if (_historyContent is null)
        {
            throw new InvalidOperationException("Chat history is not initialized");
        }

        GameObject root = CreateObject("Message", _historyContent);
        RectTransform rect = root.GetComponent<RectTransform>();
        TextMeshProUGUI body = AddText("Body", root.transform, string.Empty, 18f, White);
        body.enableWordWrapping = true;
        body.alignment = TextAlignmentOptions.TopLeft;
        body.overflowMode = TextOverflowModes.Truncate;
        Stretch(body.rectTransform, 54f, 8f, 8f, 8f);

        RectTransform portraitRect = AddImage("Lilith", root.transform, Color.white, _avatar);
        SetAnchored(portraitRect, 8f, -8f, 36f, 36f, false, true);
        Image portrait = portraitRect.GetComponent<Image>();
        var stickerObject = CreateObject("ChatSticker", root.transform);
        RawImage sticker = stickerObject.AddComponent<RawImage>();
        sticker.raycastTarget = false;
        sticker.gameObject.SetActive(false);

        TextMeshProUGUI speaker = AddText(
            "Speaker",
            root.transform,
            string.Empty,
            15f,
            SoftWhite,
            FontStyles.Bold);
        speaker.alignment = TextAlignmentOptions.Top;
        SetAnchored(speaker.rectTransform, 5f, -9f, 42f, 28f, false, true);

        var sourceButtons = new List<Button>();
        var sourceLabels = new List<TextMeshProUGUI>();
        for (int sourceIndex = 0; sourceIndex < 5; sourceIndex++)
        {
            Button sourceButton = AddButton(
                $"Source{sourceIndex + 1}",
                root.transform,
                string.Empty,
                54f + sourceIndex * 46f,
                6f,
                40f,
                24f,
                () => { },
                false,
                false);
            TextMeshProUGUI sourceLabel = sourceButton.GetComponentInChildren<TextMeshProUGUI>();
            sourceLabel.fontSize = 13f;
            sourceButton.gameObject.SetActive(false);
            sourceButtons.Add(sourceButton);
            sourceLabels.Add(sourceLabel);
        }

        var row = new HistoryRowView(root, rect, body, portrait, speaker, sourceButtons, sourceLabels, sticker);
        _historyRows.Add(row);
        return row;
    }

    private static void ConfigureCitationButtons(
        HistoryRowView row,
        IReadOnlyList<ChatCitation>? citations,
        int citationCount)
    {
        for (int index = 0; index < row.SourceButtons.Count; index++)
        {
            Button button = row.SourceButtons[index];
            bool visible = citations is not null && index < citationCount;
            button.gameObject.SetActive(visible);
            button.onClick.RemoveAllListeners();
            if (!visible) continue;
            row.SourceLabels[index].text = $"↗ {index + 1}";
            string url = citations![index].Url;
            MacButtons[button.Pointer] = (button, () => OpenCitation(url));
        }
    }

    private static void OpenCitation(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out Uri? uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            return;
        }
        Application.OpenURL(uri.AbsoluteUri);
    }

    private void ScrollToBottom()
    {
        if (_historyScroll is null)
        {
            return;
        }
        Canvas.ForceUpdateCanvases();
        _historyScroll.verticalNormalizedPosition = 0f;
        _historyScrollTarget = 0f;
        _historyScrollAnimating = false;
    }

    private void UpdateSmoothHistoryScroll()
    {
        if (!_expanded || _historyScroll is null || _historyContent is null
            || _historyScroll.viewport is null || _historyRoot is null)
        {
            _historyScrollAnimating = false;
            return;
        }

        RectTransform historyRect = _historyRoot.GetComponent<RectTransform>();
        bool pointerOverHistory = RectTransformUtility.RectangleContainsScreenPoint(
            historyRect,
            Input.mousePosition,
            null);
        float wheelDelta = pointerOverHistory ? Input.mouseScrollDelta.y : 0f;
        float scrollableHeight = Mathf.Max(
            0f,
            _historyContent.rect.height - _historyScroll.viewport.rect.height);

        if (Mathf.Abs(wheelDelta) > 0.001f && scrollableHeight > 0.5f)
        {
            if (!_historyScrollAnimating)
            {
                _historyScrollTarget = _historyScroll.verticalNormalizedPosition;
            }
            _historyScrollTarget = Mathf.Clamp01(
                _historyScrollTarget + (wheelDelta * HistoryWheelStep / scrollableHeight));
            _historyScrollAnimating = true;
        }

        if (!_historyScrollAnimating)
        {
            _historyScrollTarget = _historyScroll.verticalNormalizedPosition;
            return;
        }

        float current = _historyScroll.verticalNormalizedPosition;
        float blend = 1f - Mathf.Exp(-HistoryScrollSharpness * Time.unscaledDeltaTime);
        float next = Mathf.Lerp(current, _historyScrollTarget, blend);
        _historyScroll.verticalNormalizedPosition = next;
        if (Mathf.Abs(next - _historyScrollTarget) <= 0.0005f)
        {
            _historyScroll.verticalNormalizedPosition = _historyScrollTarget;
            _historyScrollAnimating = false;
        }
    }

    private TMP_FontAsset? FindFont(string locale)
    {
        try
        {
            DialogueBubbleUI? bubble = Object.FindObjectOfType<DialogueBubbleUI>(true);
            TMP_FontAsset? gameFont = bubble?._dialogueText?.font;
            char required = ModLocalization.NormalizeLocale(locale) switch
            {
                "zh-CN" => '莉',
                "zh-TW" => '體',
                "ja" => 'リ',
                _ => 'A'
            };
            if (gameFont is not null && gameFont.HasCharacter(required, true, false))
            {
                return gameFont;
            }
            TMP_FontAsset[] fonts = Resources.FindObjectsOfTypeAll<TMP_FontAsset>();
            return fonts.FirstOrDefault(item => item.HasCharacter(required, true, false))
                ?? gameFont
                ?? fonts.FirstOrDefault(item => item.name.Contains("UIFont", StringComparison.OrdinalIgnoreCase))
                ?? fonts.FirstOrDefault();
        }
        catch
        {
            return TMP_Settings.defaultFontAsset;
        }
    }

    private Sprite? LoadAvatar()
    {
        try
        {
            string path = Path.Combine(Paths.PluginPath, "assets", "lilith-avatar.png");
            if (!File.Exists(path))
            {
                LilithModPlugin.PluginLog.LogWarning($"Chat avatar is missing: {path}");
                return null;
            }
            _avatarTexture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!ImageConversion.LoadImage(_avatarTexture, File.ReadAllBytes(path), false))
            {
                return null;
            }
            _avatarTexture.wrapMode = TextureWrapMode.Clamp;
            return Sprite.Create(
                _avatarTexture,
                new Rect(0f, 0f, _avatarTexture.width, _avatarTexture.height),
                new Vector2(0.5f, 0.5f),
                100f);
        }
        catch (Exception error)
        {
            LilithModPlugin.PluginLog.LogWarning($"Chat avatar load failed: {error.GetType().Name}: {error.Message}");
            return null;
        }
    }

    private void EnsureEventSystem()
    {
        EventSystem? current = EventSystem.current;
        if (current is not null && current.isActiveAndEnabled)
        {
            if (current.currentInputModule is null)
            {
                current.gameObject.AddComponent<StandaloneInputModule>();
            }
            LilithModPlugin.PluginLog.LogInfo($"Using game EventSystem: {current.gameObject.name}");
            return;
        }
        _ownedEventSystem = new GameObject("LilithMod.EventSystem");
        Object.DontDestroyOnLoad(_ownedEventSystem);
        _ownedEventSystem.AddComponent<EventSystem>();
        _ownedEventSystem.AddComponent<StandaloneInputModule>();
        LilithModPlugin.PluginLog.LogInfo("Created fallback Unity EventSystem for chat input");
    }

    private Sprite? FindSprite(string name)
    {
        try
        {
            return Resources.FindObjectsOfTypeAll<Sprite>()
                .FirstOrDefault(item => string.Equals(item.name, name, StringComparison.Ordinal));
        }
        catch
        {
            return null;
        }
    }

    private Sprite CreateCheckerBackground()
    {
        _fallbackBackgroundTexture = new Texture2D(32, 32, TextureFormat.RGBA32, false);
        Color first = new(0.08f, 0.08f, 0.08f, 1f);
        Color second = new(0.13f, 0.13f, 0.13f, 1f);
        for (int y = 0; y < 32; y++)
        {
            for (int x = 0; x < 32; x++)
            {
                _fallbackBackgroundTexture.SetPixel(x, y, ((x / 8) + (y / 8)) % 2 == 0 ? first : second);
            }
        }
        _fallbackBackgroundTexture.wrapMode = TextureWrapMode.Repeat;
        _fallbackBackgroundTexture.Apply();
        _fallbackBackground = Sprite.Create(
            _fallbackBackgroundTexture,
            new Rect(0f, 0f, 32f, 32f),
            new Vector2(0.5f, 0.5f),
            100f);
        return _fallbackBackground;
    }

    private void LoadPreferences()
    {
        try
        {
            if (!File.Exists(_preferencesPath) || _panel is null)
            {
                return;
            }
            ChatUiPreferences preferences = JsonSerializer.Deserialize<ChatUiPreferences>(File.ReadAllText(_preferencesPath))
                ?? new ChatUiPreferences();
            _preferencesWriteTimeUtc = File.GetLastWriteTimeUtc(_preferencesPath);
            _userScale = ChatUiScale.ClampUserScale(preferences.Scale);
            _panel.localScale = new Vector3(_userScale, _userScale, 1f);
            SetExpanded(_expanded);
            if (_hasSessionPosition)
            {
                ApplySessionPosition();
            }
        }
        catch (Exception error)
        {
            LilithModPlugin.PluginLog.LogWarning($"Chat UI preferences load failed: {error.GetType().Name}: {error.Message}");
        }
        ClampToCanvas();
    }

    private void CaptureSessionPosition()
    {
        if (_panel is null || _canvasRect is null)
        {
            return;
        }
        Vector2 available = AvailablePanelSpace();
        _sessionPositionX = available.x <= 0f
            ? 0.5f
            : Mathf.Clamp01((_panel.anchoredPosition.x - SafeMargin) / available.x);
        _sessionPositionY = available.y <= 0f
            ? 0.1f
            : Mathf.Clamp01((_panel.anchoredPosition.y - SafeMargin) / available.y);
    }

    private void ReloadPreferencesIfChanged()
    {
        try
        {
            if (!File.Exists(_preferencesPath))
            {
                return;
            }
            DateTime writeTime = File.GetLastWriteTimeUtc(_preferencesPath);
            if (writeTime != _preferencesWriteTimeUtc)
            {
                LoadPreferences();
            }
        }
        catch
        {
            // The next poll will retry after the settings process finishes writing.
        }
    }

    private void ApplyLocalization(bool force = false)
    {
        string locale = ModLocalization.CurrentLocale;
        if (!force && string.Equals(locale, _locale, StringComparison.Ordinal))
        {
            return;
        }
        _locale = locale;
        TMP_FontAsset? localizedFont = FindFont(locale);
        if (localizedFont is not null && localizedFont != _font)
        {
            _font = localizedFont;
            if (_root is not null)
            {
                foreach (TextMeshProUGUI label in _root.GetComponentsInChildren<TextMeshProUGUI>(true))
                {
                    label.font = localizedFont;
                }
            }
        }
        if (_titleLabel is not null)
        {
            _titleLabel.text = ModLocalization.T("chat.title");
            _titleLabel.enableAutoSizing = locale == "en";
            _titleLabel.fontSizeMin = 14f;
            _titleLabel.fontSizeMax = 20f;
        }
        if (_settingsButtonLabel is not null)
        {
            _settingsButtonLabel.text = ModLocalization.T("chat.settings");
            _settingsButtonLabel.enableAutoSizing = locale == "en";
            _settingsButtonLabel.fontSizeMin = 12f;
            _settingsButtonLabel.fontSizeMax = 16f;
        }
        if (_placeholderLabel is not null)
        {
            _placeholderLabel.text = ModLocalization.T("chat.placeholder");
        }
        if (_sendButtonLabel is not null)
        {
            _sendButtonLabel.text = ModLocalization.T("chat.send");
        }
        if (_resetLabel is not null)
        {
            _resetLabel.text = ModLocalization.T("chat.reset_session");
        }
        if (_forgetLabel is not null)
        {
            _forgetLabel.text = _forgetArmed
                ? ModLocalization.T("chat.forget_confirm")
                : ModLocalization.T("chat.forget_player");
        }
        if (_historyButtonLabel is not null)
        {
            _historyButtonLabel.text = _expanded
                ? ModLocalization.T("chat.hide_history")
                : ModLocalization.T("chat.history");
        }
        MarkHistoryDirty();
    }

    private void ApplyOpenPosition()
    {
        if (_panel is null || _canvasRect is null)
        {
            return;
        }

        if (_hasSessionPosition)
        {
            ClampToCanvas();
            if (IsPanelOnVisibleMonitor())
            {
                CaptureSessionPosition();
                return;
            }
            _hasSessionPosition = false;
            LilithModPlugin.PluginLog.LogWarning(
                "Remembered chat position was outside every monitor; docking beside Lilith");
        }

        float canvasScale = _canvasScaler?.scaleFactor ?? 1f;
        bool characterAvailable = _characterScreenLocator.TryGetPlacementArea(out CharacterScreenPlacement placement)
            && canvasScale > 0f;
        if (characterAvailable)
        {
            DockOppositeCharacter(placement, canvasScale);
        }
        else
        {
            _panel.anchoredPosition = new Vector2(24f, 80f);
        }
        ClampToCanvas();
    }

    private void ApplySessionPosition()
    {
        if (_panel is null)
        {
            return;
        }
        Vector2 available = AvailablePanelSpace();
        _panel.anchoredPosition = new Vector2(
            _sessionPositionX * available.x + SafeMargin,
            _sessionPositionY * available.y + SafeMargin);
    }

    private void DockOppositeCharacter(CharacterScreenPlacement placement, float canvasScale)
    {
        if (_panel is null || _canvasRect is null)
        {
            return;
        }
        Vector2 position = _panel.anchoredPosition;
        float areaLeft = placement.Left / canvasScale;
        float areaRight = placement.Right / canvasScale;
        float areaBottom = placement.Bottom / canvasScale;
        float areaTop = placement.Top / canvasScale;
        position.x = ChatPanelPlacement.OppositeEdgeXInArea(
            placement.CharacterX / canvasScale,
            areaLeft,
            areaRight,
            _panel.rect.width,
            _userScale,
            SafeMargin);
        float highestBottom = Math.Max(
            areaBottom + SafeMargin,
            areaTop - _panel.rect.height * _userScale - SafeMargin);
        position.y = Mathf.Clamp(
            areaBottom + 80f,
            areaBottom + SafeMargin,
            highestBottom);
        _panel.anchoredPosition = position;
    }

    private bool IsPanelOnVisibleMonitor()
    {
        if (_panel is null)
        {
            return false;
        }
        Vector3 worldCenter = _panel.TransformPoint(_panel.rect.center);
        Vector2 screenCenter = RectTransformUtility.WorldToScreenPoint(null, worldCenter);
        return _characterScreenLocator.IsScreenPointVisible(screenCenter.x, screenCenter.y);
    }

    private void UpdateCanvasScale()
    {
        if (_canvasScaler is null)
        {
            return;
        }
        _lastScreenWidth = Screen.width;
        _lastScreenHeight = Screen.height;
        float automaticScale = ChatUiScale.Calculate(Screen.height);
        _canvasScaler.scaleFactor = automaticScale;
    }

    private bool ScreenPointInCanvas(Vector2 screenPoint, out Vector2 localPoint)
    {
        localPoint = Vector2.zero;
        return _canvasRect is not null
            && RectTransformUtility.ScreenPointToLocalPointInRectangle(_canvasRect, screenPoint, null, out localPoint);
    }

    private Vector2 AvailablePanelSpace()
    {
        if (_canvasRect is null || _panel is null)
        {
            return Vector2.zero;
        }
        float width = Mathf.Max(0f, _canvasRect.rect.width - _panel.rect.width * _userScale - SafeMargin * 2f);
        float height = Mathf.Max(0f, _canvasRect.rect.height - _panel.rect.height * _userScale - SafeMargin * 2f);
        return new Vector2(width, height);
    }

    private void ClampToCanvas()
    {
        if (_panel is null || _canvasRect is null)
        {
            return;
        }
        Vector2 available = AvailablePanelSpace();
        Vector2 position = _panel.anchoredPosition;
        position.x = Mathf.Clamp(position.x, SafeMargin, SafeMargin + available.x);
        position.y = Mathf.Clamp(position.y, SafeMargin, SafeMargin + available.y);
        _panel.anchoredPosition = position;
    }

    private static GameObject CreateObject(string name, Transform? parent)
    {
        var components = new Il2CppReferenceArray<Il2CppSystem.Type>(1);
        components[0] = Il2CppType.Of<RectTransform>();
        var result = new GameObject(name, components);
        if (parent is not null)
        {
            result.transform.SetParent(parent, false);
        }
        return result;
    }

    private TextMeshProUGUI AddText(
        string name,
        Transform parent,
        string text,
        float size,
        Color color,
        FontStyles style = FontStyles.Normal)
    {
        GameObject gameObject = CreateObject(name, parent);
        TextMeshProUGUI result = gameObject.AddComponent<TextMeshProUGUI>();
        result.font = _font;
        result.text = text;
        result.fontSize = size;
        result.fontStyle = style;
        result.color = color;
        result.enableWordWrapping = false;
        result.overflowMode = TextOverflowModes.Overflow;
        result.raycastTarget = false;
        return result;
    }

    private static RectTransform AddImage(string name, Transform parent, Color color, Sprite? sprite = null)
    {
        GameObject gameObject = CreateObject(name, parent);
        Image image = gameObject.AddComponent<Image>();
        image.color = color;
        image.sprite = sprite;
        image.preserveAspect = sprite is not null;
        return gameObject.GetComponent<RectTransform>();
    }

    private Button AddButton(
        string name,
        Transform parent,
        string label,
        float x,
        float y,
        float width,
        float height,
        Action callback,
        bool anchorRight = false,
        bool anchorTop = true)
    {
        GameObject gameObject = CreateObject(name, parent);
        RectTransform rect = gameObject.GetComponent<RectTransform>();
        SetAnchored(rect, x, y, width, height, anchorRight, anchorTop);
        Image image = gameObject.AddComponent<Image>();
        image.color = Dark;
        Button button = gameObject.AddComponent<Button>();
        ColorBlock colors = button.colors;
        colors.normalColor = Dark;
        colors.highlightedColor = new Color(0.2f, 0.2f, 0.2f, 1f);
        colors.pressedColor = Red;
        colors.selectedColor = colors.highlightedColor;
        colors.disabledColor = new Color(0.08f, 0.08f, 0.08f, 0.6f);
        colors.colorMultiplier = 1f;
        button.colors = colors;
        MacButtons[button.Pointer] = (button, callback);
        AddHardBorder(gameObject.transform, 1f, new Color(0.7f, 0.7f, 0.68f, 1f));

        TextMeshProUGUI text = AddText("Label", gameObject.transform, label, 16f, White);
        text.alignment = TextAlignmentOptions.Center;
        Stretch(text.rectTransform, 2f, 2f, 2f, 2f);
        return button;
    }

    private static void AddHardBorder(Transform parent, float thickness = 2f, Color? color = null)
    {
        Color edge = color ?? White;
        RectTransform top = AddImage("BorderTop", parent, edge);
        SetTopStretch(top, 0f, 0f, 0f, thickness);
        RectTransform bottom = AddImage("BorderBottom", parent, edge);
        SetBottomStretch(bottom, 0f, 0f, 0f, thickness);
        RectTransform left = AddImage("BorderLeft", parent, edge);
        SetAnchored(left, 0f, 0f, thickness, 0f, false, true, true);
        RectTransform right = AddImage("BorderRight", parent, edge);
        SetAnchored(right, 0f, 0f, thickness, 0f, true, true, true);
    }

    private static void Stretch(RectTransform rect, float left, float top, float right, float bottom)
    {
        rect.anchorMin = Vector2.zero;
        rect.anchorMax = Vector2.one;
        rect.offsetMin = new Vector2(left, bottom);
        rect.offsetMax = new Vector2(-right, -top);
    }

    private static void SetTopStretch(
        RectTransform rect,
        float left,
        float top,
        float right,
        float height)
    {
        rect.anchorMin = new Vector2(0f, 1f);
        rect.anchorMax = Vector2.one;
        rect.pivot = new Vector2(0.5f, 1f);
        rect.offsetMin = new Vector2(left, -top - height);
        rect.offsetMax = new Vector2(-right, -top);
    }

    private static void SetBottomStretch(
        RectTransform rect,
        float left,
        float bottom,
        float right,
        float height)
    {
        rect.anchorMin = Vector2.zero;
        rect.anchorMax = new Vector2(1f, 0f);
        rect.pivot = new Vector2(0.5f, 0f);
        rect.offsetMin = new Vector2(left, bottom);
        rect.offsetMax = new Vector2(-right, bottom + height);
    }

    private static void SetAnchored(
        RectTransform rect,
        float x,
        float y,
        float width,
        float height,
        bool anchorRight,
        bool anchorTop,
        bool stretchVertical = false)
    {
        float ax = anchorRight ? 1f : 0f;
        float ay = anchorTop ? 1f : 0f;
        rect.anchorMin = new Vector2(ax, stretchVertical ? 0f : ay);
        rect.anchorMax = new Vector2(ax, stretchVertical ? 1f : ay);
        rect.pivot = new Vector2(anchorRight ? 1f : 0f, anchorTop ? 1f : 0f);
        rect.anchoredPosition = new Vector2(x, y);
        rect.sizeDelta = new Vector2(width, stretchVertical ? 0f : height);
    }

    private sealed class HistoryRowView
    {
        public HistoryRowView(
            GameObject root,
            RectTransform rect,
            TextMeshProUGUI body,
            Image portrait,
            TextMeshProUGUI speaker,
            IReadOnlyList<Button> sourceButtons,
            IReadOnlyList<TextMeshProUGUI> sourceLabels,
            RawImage sticker)
        {
            Root = root;
            Rect = rect;
            Body = body;
            Portrait = portrait;
            Speaker = speaker;
            SourceButtons = sourceButtons;
            SourceLabels = sourceLabels;
            Sticker = sticker;
        }

        public GameObject Root { get; }

        public RectTransform Rect { get; }

        public TextMeshProUGUI Body { get; }
        public RawImage Sticker { get; }

        public Image Portrait { get; }

        public TextMeshProUGUI Speaker { get; }

        public IReadOnlyList<Button> SourceButtons { get; }

        public IReadOnlyList<TextMeshProUGUI> SourceLabels { get; }
    }

    private sealed class ChatUiPreferences
    {
        public bool HasPosition { get; set; }

        public float X { get; set; } = 0.5f;

        public float Y { get; set; } = 0.08f;

        public float Scale { get; set; } = 1f;
    }
}
