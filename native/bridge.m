#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static NSRunningApplication *previousApp;
static NSWindow *chatWindow;
static BOOL previousIgnore;
static void (*menuCallback)(int);
static id inputMonitor;
static unsigned mouseEdges;
static unsigned char keyEdges[128];
static NSPoint eventPoint;
static __weak NSWindow *eventWindow;
static CFAbsoluteTime eventTime;
static Class originalChatWindowClass;
static Class keyableChatWindowClass;
static BOOL chatCanBecomeKey(id self, SEL selector) { return YES; }
extern int lilith_editor_focus(void);
void *lilith_player_window(void);
int lilith_follow_spaces(void *handle);
void lilith_begin_input(void) {
    if (inputMonitor) return;
    NSEventMask mask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown
        | NSEventMaskRightMouseUp | NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp | NSEventMaskKeyDown
        | NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged;
    inputMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) {
        NSEventType type = event.type;
        if (type == NSEventTypeKeyDown) {
            if (event.keyCode < 128 && !event.isARepeat) keyEdges[event.keyCode] = 1;
        } else {
            eventPoint = event.locationInWindow;
            eventWindow = event.window;
            eventTime = CFAbsoluteTimeGetCurrent();
            if ((mask & NSEventMaskFromType(type)) && (type == NSEventTypeLeftMouseDown || type == NSEventTypeLeftMouseUp
                || type == NSEventTypeRightMouseDown || type == NSEventTypeRightMouseUp
                || type == NSEventTypeOtherMouseDown || type == NSEventTypeOtherMouseUp) && event.buttonNumber < 3) {
            BOOL up = type == NSEventTypeLeftMouseUp || type == NSEventTypeRightMouseUp || type == NSEventTypeOtherMouseUp;
            mouseEdges |= 1u << (event.buttonNumber + (up ? 8 : 0));
            }
        }
        return event;
    }];
}
unsigned lilith_take_mouse_edges(void) { unsigned value = mouseEdges; mouseEdges = 0; return value; }
int lilith_take_key_edge(int code) {
    if (code < 0 || code >= 128) return 0;
    int value = keyEdges[code]; keyEdges[code] = 0; return value;
}

// Objective-C class names are process-global. The official game's tray creates
// "LilithMenuTarget" dynamically, so the Mod must use its own namespace.
@interface LMAIMacOSModMenuTarget : NSObject
- (void)selected:(NSMenuItem *)item;
@end
@implementation LMAIMacOSModMenuTarget
- (void)selected:(NSMenuItem *)item { if (menuCallback) menuCallback((int)[item tag]); }
@end
static LMAIMacOSModMenuTarget *menuTarget;

static void addItem(NSMenu *menu, const char *title, NSInteger tag) {
    if (!menuTarget) menuTarget = [LMAIMacOSModMenuTarget new];
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:[NSString stringWithUTF8String:title]
                                               action:@selector(selected:) keyEquivalent:@""];
    [item setTarget:menuTarget]; [item setTag:tag]; [menu addItem:item];
}

int lilith_menu_count(void *menu) { return (int)[(__bridge NSMenu *)menu numberOfItems]; }
void lilith_install_menu(void *menu, void (*callback)(int), const char *chat, const char *settings) {
    menuCallback = callback;
    NSMenu *native = (__bridge NSMenu *)menu;
    [native addItem:[NSMenuItem separatorItem]];
    addItem(native, chat, 0); addItem(native, settings, 1);
}
void lilith_popup_menu(void (*callback)(int), const char *chat, const char *music, const char *settings) {
    menuCallback = callback;
    NSMenu *menu = [NSMenu new];
    addItem(menu, chat, 0); addItem(menu, music, 2); addItem(menu, settings, 1);
    [menu popUpMenuPositioningItem:nil atLocation:[NSEvent mouseLocation] inView:nil];
}

void lilith_schedule_tick(void *context, dispatch_function_t callback, double delay) {
    // The game's window setup can overwrite collectionBehavior, or replace the
    // Unity window. Re-resolve it periodically, including while Unity is idle.
    // Keep this in the existing native tick ABI so installed plugins need only
    // the matching dylib update, not a managed plugin replacement.
    static unsigned spacesTick;
    if ([NSThread isMainThread] && (spacesTick++ % 30) == 0)
        lilith_follow_spaces(lilith_player_window());
    dispatch_after_f(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
                     dispatch_get_main_queue(), context, callback);
}

int lilith_mouse_button(int button) {
    return CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, (CGMouseButton)button);
}
int lilith_key(int code) { return CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, (CGKeyCode)code); }
int lilith_mouse_position(double *x, double *y, double *width, double *height) {
    NSWindow *window = (__bridge NSWindow *)lilith_player_window();
    if (!window) return 0;
    NSView *view = [window contentView];
    // Preserve the current delivered event for one pump interval, never a stale one-second position.
    NSPoint location = window == eventWindow && CFAbsoluteTimeGetCurrent() - eventTime < .075
        ? eventPoint : [window convertPointFromScreen:[NSEvent mouseLocation]];
    NSPoint point = [view convertPoint:location fromView:nil];
    NSRect bounds = [view bounds];
    *x = point.x; *y = point.y; *width = bounds.size.width; *height = bounds.size.height;
    return 1;
}

int lilith_has_focus(void) {
    NSWindow *player = (__bridge NSWindow *)lilith_player_window();
    return NSApp.active && player && player.keyWindow;
}

void *lilith_player_window(void) {
    for (NSWindow *window in [NSApp windows]) {
        if ([window isVisible] && [NSStringFromClass(window.contentView.class) isEqualToString:@"PlayerWindowView"])
            return (__bridge void *)window;
    }
    return NULL;
}

// Ordinary desktop Spaces share one pet window. Do not move the window's
// frame or steal focus, and do not alter floating/click-through/fullscreen policy.
int lilith_follow_spaces(void *handle) {
    if (![NSThread isMainThread]) return 0;
    NSWindow *window = (__bridge NSWindow *)handle;
    if (!window || ![[NSApp windows] containsObject:window]) return 0;
    NSWindowCollectionBehavior previous = window.collectionBehavior;
    // AppKit defines these two behaviors as mutually exclusive.
    NSWindowCollectionBehavior next = (previous & ~NSWindowCollectionBehaviorMoveToActiveSpace)
        | NSWindowCollectionBehaviorCanJoinAllSpaces;
    if (previous != next) window.collectionBehavior = next;
    return (window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces) != 0;
}

int lilith_fit_primary_screen(void *handle) {
    NSWindow *window = (__bridge NSWindow *)handle;
    NSScreen *screen = NSScreen.screens.firstObject;
    // AppKit frames use points. CGDisplay/Unity bounds can be backing pixels on Retina.
    if (!window || !screen || ![[NSApp windows] containsObject:window]) return 0;
    [window setFrame:screen.frame display:YES];
    return 1;
}

// Read only our process's windows; opt-in startup diagnostics consume this snapshot.
const char *lilith_window_diagnostics(void) {
    static NSString *snapshot;
    NSMutableArray *windows = [NSMutableArray new];
    for (NSWindow *window in [NSApp windows]) {
        if ([window isKindOfClass:[NSPanel class]]) continue;
        NSView *view = [window contentView];
        [windows addObject:@{
            @"number": @(window.windowNumber), @"visible": @(window.visible),
            @"key": @(window.keyWindow), @"opaque": @(window.opaque),
            @"canBecomeKey": @(window.canBecomeKeyWindow), @"class": NSStringFromClass(window.class),
            @"ignoresMouseEvents": @(window.ignoresMouseEvents),
            @"style": @(window.styleMask), @"level": @(window.level),
            @"collectionBehavior": @(window.collectionBehavior),
            @"joinsAllSpaces": @((window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces) != 0),
            @"onActiveSpace": @(window.onActiveSpace),
            @"frame": NSStringFromRect(window.frame),
            @"backgroundAlpha": @(window.backgroundColor.alphaComponent),
            @"viewClass": NSStringFromClass(view.class),
            @"layerOpaque": @(view.layer.opaque)
        }];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:windows options:0 error:nil];
    snapshot = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"[]";
    return snapshot.UTF8String;
}

int lilith_focus_chat(int acquire) {
    if (!acquire) {
        if (chatWindow) [chatWindow setIgnoresMouseEvents:previousIgnore];
        if (chatWindow && originalChatWindowClass && object_getClass(chatWindow) == keyableChatWindowClass)
            object_setClass(chatWindow, originalChatWindowClass);
        chatWindow = nil;
        if (NSApp.active && previousApp && [previousApp processIdentifier] != getpid())
            [previousApp activateWithOptions:0];
        previousApp = nil;
        return 1;
    }
    NSWindow *player = (__bridge NSWindow *)lilith_player_window();
    if (!player) return 0;
    if (!NSApp.active || !chatWindow) {
        previousApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
    }
    if (chatWindow != player) previousIgnore = player.ignoresMouseEvents;
    chatWindow = player;
    // Borderless NSWindow defaults to refusing keyboard focus. Change only this
    // player instance, with no added ivars; restore its original class on release.
    if (!player.canBecomeKeyWindow) {
        originalChatWindowClass = object_getClass(player);
        NSString *name = [@"LMAIMacOSModKey_" stringByAppendingString:NSStringFromClass(originalChatWindowClass)];
        keyableChatWindowClass = NSClassFromString(name);
        if (!keyableChatWindowClass) {
            keyableChatWindowClass = objc_allocateClassPair(originalChatWindowClass, name.UTF8String, 0);
            if (!keyableChatWindowClass) return 0;
            BOOL keyAdded = class_addMethod(keyableChatWindowClass, @selector(canBecomeKeyWindow), (IMP)chatCanBecomeKey, "c@:");
            BOOL mainAdded = class_addMethod(keyableChatWindowClass, @selector(canBecomeMainWindow), (IMP)chatCanBecomeKey, "c@:");
            if (!keyAdded || !mainAdded) {
                objc_disposeClassPair(keyableChatWindowClass);
                keyableChatWindowClass = Nil;
                return 0;
            }
            objc_registerClassPair(keyableChatWindowClass);
        }
        if (class_getSuperclass(keyableChatWindowClass) != originalChatWindowClass) return 0;
        object_setClass(player, keyableChatWindowClass);
    }
    [chatWindow setIgnoresMouseEvents:NO];
    [NSApp activateIgnoringOtherApps:YES];
    [chatWindow makeKeyAndOrderFront:nil];
    lilith_editor_focus();
    return [chatWindow isKeyWindow];
}
