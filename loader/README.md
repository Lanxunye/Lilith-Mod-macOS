# 加载器构建资料（维护者）

普通玩家请使用 [一键安装包](../docs/deployment-macos.md)。安装器从官方来源下载固定 BepInEx，在本机运行随包的开源补丁工具；不需要玩家安装 SDK 或编译。包内只带本项目的兼容助手、调度库和补丁工具，不分发修改后的上游加载器或游戏程序集。以下是维护者手动重建步骤。

# macOS loader compatibility source

This directory contains the port's helper, main-queue dispatcher and Cecil patch program. The upstream loader is BepInEx `6.0.0-be.790+4e98359`, LGPL-2.1, source: https://github.com/BepInEx/BepInEx/tree/4e98359 . The original Mod's MIT notice is retained at the repository root; upstream BepInEx remains governed by its own license.

The source package and setup do not redistribute the upstream or modified BepInEx DLL, its bundled .NET runtime, Unity base libraries, generated game interop or the game. Reproduce the compatibility patch locally from the pinned original DLL:

```sh
export LILITH_GAME_DIR=/path/to/game-directory-containing-BepInEx
export LILITH_DOTNET_PATH=/path/to/dotnet-sdk-8/dotnet
bash scripts/build-loader-macos.sh /path/to/original/BepInEx.Unity.IL2CPP.dll /path/to/new-output
```

The script checks the original loader SHA-256 and requires a new output directory. It does not install or replace files in the game. Build inputs must include the original be.790 `Mono.Cecil.dll`. Keep all original component notices. Before redistributing a modified LGPL binary, prepare the complete corresponding upstream source and modification/build materials together with its license; this preview deliberately omits that binary.

## 一键安装包所需工具

维护者构建发布用的兼容助手、C 调度库及 .NET 8 补丁工具：

```sh
bash scripts/build-installer-tools.sh /path/to/original/BepInEx.Unity.IL2CPP.dll /path/to/NEW-loader-tools
```

同样使用上方两个环境变量。输出包含本机验证用的修改后加载器，但 `build-public-release.py --loader-dir` 只将自有工具放入安装包，修改后的上游 DLL 仅用于计算固定校验值，不随包发布。
