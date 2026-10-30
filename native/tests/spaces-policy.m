#import <AppKit/AppKit.h>
#import <dlfcn.h>
#import <stdio.h>

// Hidden process-owned windows exercise actual AppKit behavior. No other
// application's windows or system Spaces preferences are read or changed.
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2) return 64;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        void *library=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);
        if (!library) return 1;
        int (*follow)(void *)=dlsym(library,"lilith_follow_spaces");
        if (!follow || follow(NULL)) return 2;
        NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(50,60,320,240)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed=NO;
        window.ignoresMouseEvents=YES;
        window.level=NSFloatingWindowLevel;
        window.collectionBehavior=NSWindowCollectionBehaviorMoveToActiveSpace|NSWindowCollectionBehaviorStationary|NSWindowCollectionBehaviorFullScreenNone;
        NSRect frame=window.frame;
        if (!follow((__bridge void *)window)) return 3;
        if (!(window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces)
            || (window.collectionBehavior & NSWindowCollectionBehaviorMoveToActiveSpace)
            || !(window.collectionBehavior & NSWindowCollectionBehaviorStationary)) return 4;
        if (!NSEqualRects(frame,window.frame)||!window.ignoresMouseEvents
            ||window.level!=NSFloatingWindowLevel||window.visible||window.keyWindow) return 5;
        if (!(window.collectionBehavior & NSWindowCollectionBehaviorFullScreenNone)
            || (window.collectionBehavior & NSWindowCollectionBehaviorFullScreenAuxiliary)) return 8;
        // Reassert after game code resets the behavior, without changing focus/frame.
        window.collectionBehavior=NSWindowCollectionBehaviorDefault;
        if (!follow((__bridge void *)window)||!follow((__bridge void *)window)) return 6;
        if (!NSEqualRects(frame,window.frame)||window.visible||window.keyWindow) return 7;
        [window close];
        puts("Spaces policy: ordinary desktops only, full-screen exclusion preserved, geometry/level/input/focus unchanged and reset recovery passed.");
        return 0;
    }
}
