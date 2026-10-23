#import <AppKit/AppKit.h>

extern void *lilith_player_window(void);
extern int lilith_focus_chat(int acquire);
static NSScrollView *editorScroll;
static unsigned submitRequests;
static NSRect lastCandidateRect;
static unsigned candidateQueries;
static unsigned lastKeyCode;

@interface LMAIMacOSModChatEditor : NSTextView
@end
@implementation LMAIMacOSModChatEditor
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)setAccessibilityFocused:(BOOL)focused {
    [super setAccessibilityFocused:focused];
    if (focused && (!NSApp.active || !self.window.keyWindow || self.window.firstResponder != self)) lilith_focus_chat(1);
}
- (BOOL)handleEditingShortcut:(NSEvent *)event {
    if (!(event.modifierFlags & NSEventModifierFlagCommand) || (event.modifierFlags & NSEventModifierFlagControl)) return NO;
    NSString *key = event.charactersIgnoringModifiers.lowercaseString;
    if ([key isEqualToString:@"a"]) [self selectAll:nil];
    else if ([key isEqualToString:@"c"]) [self copy:nil];
    else if ([key isEqualToString:@"x"]) [self cut:nil];
    else if ([key isEqualToString:@"v"]) [self pasteAsPlainText:nil];
    else if ([key isEqualToString:@"z"]) {
        if (event.modifierFlags & NSEventModifierFlagShift) { if (self.undoManager.canRedo) [self.undoManager redo]; }
        else if (self.undoManager.canUndo) [self.undoManager undo];
    } else return NO;
    return YES;
}
- (BOOL)performKeyEquivalent:(NSEvent *)event {
    if (self.window.firstResponder == self && [self handleEditingShortcut:event]) return YES;
    return [super performKeyEquivalent:event];
}
- (void)mouseDown:(NSEvent *)event {
    lilith_focus_chat(1);
    [super mouseDown:event];
}
- (void)keyDown:(NSEvent *)event {
    lastKeyCode = event.keyCode;
    if ([self handleEditingShortcut:event]) return;
    // An IME confirmation belongs to the input method, not the chat send action.
    if ((event.keyCode == 36 || event.keyCode == 76) && !self.hasMarkedText
        && !(event.modifierFlags & NSEventModifierFlagShift)) {
        submitRequests = 1;
        return;
    }
    // Unity's application event loop is not AppKit's standard text dispatch.
    // Give the active input context first refusal instead of inserting raw keys.
    if ([self.inputContext handleEvent:event]) return;
    [super keyDown:event];
}
- (BOOL)shouldChangeTextInRange:(NSRange)range replacementString:(NSString *)replacement {
    if (replacement && self.string.length - range.length + replacement.length > 2000) return NO;
    return [super shouldChangeTextInRange:range replacementString:replacement];
}
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
    NSRect rect = [super firstRectForCharacterRange:range actualRange:actualRange];
    lastCandidateRect = rect;
    candidateQueries++;
    return rect;
}
@end
static LMAIMacOSModChatEditor *editor;

int lilith_editor_layout(double x, double y, double width, double height,
                         double screenWidth, double screenHeight, double fontPixels, int visible) {
    NSWindow *window = (__bridge NSWindow *)lilith_player_window();
    if (!visible || !window || width <= 0 || height <= 0 || screenWidth <= 0 || screenHeight <= 0) {
        if (editorScroll) {
            if (editor.window.firstResponder == editor) [editor.window makeFirstResponder:editor.window.contentView];
            editorScroll.hidden = YES;
        }
        return 0;
    }
    NSView *parent = window.contentView;
    NSRect bounds = parent.bounds;
    CGFloat sx = bounds.size.width / screenWidth, sy = bounds.size.height / screenHeight;
    NSRect frame = NSMakeRect(bounds.origin.x + x * sx,
        bounds.origin.y + (parent.isFlipped ? screenHeight - y - height : y) * sy, width * sx, height * sy);
    if (!editor) {
        editorScroll = [[NSScrollView alloc] initWithFrame:frame];
        editorScroll.drawsBackground = NO;
        editorScroll.borderType = NSNoBorder;
        editorScroll.hasVerticalScroller = NO;
        editorScroll.hasHorizontalScroller = NO;
        editor = [[LMAIMacOSModChatEditor alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
        editor.richText = NO;
        editor.importsGraphics = NO;
        editor.allowsUndo = YES;
        editor.drawsBackground = NO;
        editor.textColor = [NSColor colorWithCalibratedWhite:.94 alpha:1];
        editor.insertionPointColor = NSColor.whiteColor;
        editor.textContainerInset = NSMakeSize(2, 2);
        editor.textContainer.lineFragmentPadding = 0;
        editor.verticallyResizable = YES;
        editor.horizontallyResizable = NO;
        editor.autoresizingMask = NSViewWidthSizable;
        editor.textContainer.widthTracksTextView = YES;
        editor.automaticQuoteSubstitutionEnabled = NO;
        editor.automaticDashSubstitutionEnabled = NO;
        editor.automaticTextReplacementEnabled = NO;
        editor.continuousSpellCheckingEnabled = NO;
        [editor setAccessibilityLabel:@"莉莉丝聊天输入栏"];
        editorScroll.documentView = editor;
    }
    if (editorScroll.superview != parent) {
        [editorScroll removeFromSuperview];
        [parent addSubview:editorScroll positioned:NSWindowAbove relativeTo:nil];
    }
    BOOL moved = !NSEqualRects(editorScroll.frame, frame);
    if (moved) {
        editorScroll.frame = frame;
        [editor setFrameSize:NSMakeSize(frame.size.width, MAX(frame.size.height, editor.frame.size.height))];
        editor.textContainer.containerSize = NSMakeSize(frame.size.width, CGFLOAT_MAX);
    }
    CGFloat fontSize = MAX(10, fontPixels * sy);
    if (!editor.font || fabs(editor.font.pointSize - fontSize) > .05)
        editor.font = [NSFont systemFontOfSize:fontSize];
    editorScroll.hidden = NO;
    if (moved) [editor.inputContext invalidateCharacterCoordinates];
    return 1;
}
int lilith_editor_focus(void) {
    if (!editor || editorScroll.hidden || !editor.window) return 0;
    BOOL focused = [editor.window makeFirstResponder:editor];
    if (focused && NSApp.active && editor.window.keyWindow) [editor.inputContext activate];
    return focused;
}
const char *lilith_editor_text(void) { return editor ? editor.string.UTF8String : ""; }
void lilith_editor_set_text(const char *text) {
    NSString *value = text ? [NSString stringWithUTF8String:text] : @"";
    if (editor && ![editor.string isEqualToString:value]) {
        [editor.inputContext discardMarkedText];
        editor.string = value;
        [editor setSelectedRange:NSMakeRange(value.length, 0)];
    }
}
int lilith_editor_take_submit(void) { int value = submitRequests != 0; submitRequests = 0; return value; }
void lilith_editor_dispose(void) {
    if (editor.window.firstResponder == editor) [editor.window makeFirstResponder:editor.window.contentView];
    [editorScroll removeFromSuperview];
    editorScroll = nil; editor = nil; submitRequests = 0;
}
const char *lilith_editor_diagnostics(void) {
    static NSString *snapshot;
    NSRect frame = editorScroll ? [editorScroll convertRect:editorScroll.bounds toView:nil] : NSZeroRect;
    NSRect screen = editor.window ? [editor.window convertRectToScreen:frame] : NSZeroRect;
    NSDictionary *value = @{@"visible": @(editor && !editorScroll.hidden),
        @"appActive": @(NSApp.active), @"keyWindow": @(editor.window.keyWindow),
        @"canBecomeKey": @(editor.window.canBecomeKeyWindow), @"windowClass": editor.window ? NSStringFromClass(editor.window.class) : @"",
        @"responder": editor.window.firstResponder ? NSStringFromClass(editor.window.firstResponder.class) : @"",
        @"focused": @(editor && editor.window.isKeyWindow && editor.window.firstResponder == editor),
        @"marked": @(editor.hasMarkedText), @"length": @(editor.string.length),
        @"inputSource": editor.inputContext.selectedKeyboardInputSource ?: @"",
        @"frame": NSStringFromRect(screen), @"candidateRect": NSStringFromRect(lastCandidateRect),
        @"candidateQueries": @(candidateQueries), @"lastKeyCode": @(lastKeyCode)};
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    snapshot = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return snapshot.UTF8String;
}

static void (*studioMenuCallback)(int);
@interface LMAIMacOSModStudioMenuTarget : NSObject
- (void)selected:(NSMenuItem *)item;
@end
@implementation LMAIMacOSModStudioMenuTarget
- (void)selected:(NSMenuItem *)item { if (studioMenuCallback) studioMenuCallback((int)item.tag); }
@end
void lilith_install_studio_menu(void (*callback)(int)) {
    static LMAIMacOSModStudioMenuTarget *target;
    static NSMenuItem *item;
    studioMenuCallback = callback;
    if (item || !NSApp.mainMenu) return;
    target = [LMAIMacOSModStudioMenuTarget new];
    item = [[NSMenuItem alloc] initWithTitle:@"小画室" action:nil keyEquivalent:@""];
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"小画室"];
    NSArray *titles = @[@"显示小画室预览", @"放大画室", @"缩小画室", @"画室居中", @"向左移动", @"向右移动", @"向上移动", @"向下移动"];
    for (NSUInteger index = 0; index < titles.count; index++) {
        NSMenuItem *command = [[NSMenuItem alloc] initWithTitle:titles[index] action:@selector(selected:) keyEquivalent:@""];
        command.target = target; command.tag = index; [menu addItem:command];
    }
    item.submenu = menu;
    [NSApp.mainMenu insertItem:item atIndex:MIN(1, NSApp.mainMenu.numberOfItems)];
}
