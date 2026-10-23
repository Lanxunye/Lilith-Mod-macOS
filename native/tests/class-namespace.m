#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <dlfcn.h>
#import <stdio.h>

// The real game's tray allocates this class after the Mod dylib is loaded.
// Loading the bridge must leave that name available to the game.
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2) return 64;
        void *bridge = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
        if (!bridge) { fprintf(stderr, "Bridge load failed: %s\n", dlerror()); return 1; }
        Class gameClass = objc_allocateClassPair(NSObject.class, "LilithMenuTarget", 0);
        if (!gameClass) {
            fprintf(stderr, "Collision: Mod claimed the official game's LilithMenuTarget class.\n");
            return 2;
        }
        objc_registerClassPair(gameClass);
        if (objc_lookUpClass("LilithMenuTarget") != gameClass) return 3;
        const char *exports[] = {"lilith_install_menu", "lilith_focus_chat", "lilith_editor_layout",
                                "lilith_install_studio_menu", "lilith_window_diagnostics"};
        for (unsigned i = 0; i < sizeof(exports) / sizeof(exports[0]); i++)
            if (!dlsym(bridge, exports[i])) return 4;
        puts("Native bridge preserves the official game's tray class namespace and ABI.");
        return 0;
    }
}
