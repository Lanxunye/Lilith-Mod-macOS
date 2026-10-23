# macOS loader compatibility source

This directory contains the port's helper, main-queue dispatcher and Cecil patch program. The upstream loader is BepInEx `6.0.0-be.790+4e98359`, LGPL-2.1, source: https://github.com/BepInEx/BepInEx/tree/4e98359 . The original Mod's MIT notice is retained at the repository root; upstream BepInEx remains governed by its own license.

The source package and plugin preview do not redistribute the upstream or modified BepInEx DLL, its bundled .NET runtime, Unity base libraries, generated game interop or the game. Reproduce the compatibility patch locally from the pinned original DLL:

```sh
export LILITH_GAME_DIR=/path/to/game-directory-containing-BepInEx
export LILITH_DOTNET_PATH=/path/to/dotnet-sdk-8/dotnet
bash scripts/build-loader-macos.sh /path/to/original/BepInEx.Unity.IL2CPP.dll /path/to/new-output
```

The script checks the original loader SHA-256 and requires a new output directory. It does not install or replace files in the game. Build inputs must include the original be.790 `Mono.Cecil.dll`. Keep all original component notices. Before redistributing a modified LGPL binary, prepare the complete corresponding upstream source and modification/build materials together with its license; this preview deliberately omits that binary.
