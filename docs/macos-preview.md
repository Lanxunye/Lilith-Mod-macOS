# macOS 开发预览 · 0.3.4-macos.dev7.2

这是官方 macOS 游戏的 Mod 移植源码与插件预览，**尚不是解压即用的正式安装包**。当前按本机游戏 1.1.0 / Unity 2021.3.45f2 / x86_64 分支验证；Apple Silicon 通过 Rosetta 运行游戏与加载器。

## 功能

- 透明桌宠窗口、游戏内聊天、macOS 原生中文输入与候选栏定位。
- 对话模型、角色记忆、游戏称呼、原生角色气泡。
- 本机 ComfyUI 插画与聊天表情；每连续三轮对话最多一次表情。
- 莉莉丝理解任务 → DSH 独立 SDK 执行 → 莉莉丝交付结果；支持自动/手动、补充、续办、停止与文件保存。
- 小画室移动、缩放、布局记忆与菜单控制。

## 依赖

游戏本体、游戏生成的 interop、BepInEx、Unity 基础库、.NET、Node、DSH、ComfyUI 和模型均不放入源码包或插件预览包。使用者自行合法安装；不要上传个人 Key 或存档。

| 组件 | 当前要求和验证范围 |
| --- | --- |
| 游戏 | Steam macOS 1.1.0；使用 x86_64 游戏与 IL2CPP 加载器 |
| Apple Silicon | Rosetta 2，由用户自行完成 Apple 安装与许可流程 |
| BepInEx | 固定 6.0.0-be.790+4e98359，加本仓库 loader 源码产生的兼容补丁 |
| 加载器 CLR | be.790 捆绑 .NET 6.0.7 x64；.NET 6 已结束支持，属于正式发布待处理项 |
| Companion | Node.js 24；没有第三方 npm 依赖，附 package-lock |
| 开发构建 | .NET SDK 8、macOS clang、AppKit/ApplicationServices、用户自己的 interop |
| DSH（可选） | 本机 DeepSeek Harness 0.2.1-rc.2 的 sdk profile；模型调用仍可能联网 |
| 绘图（可选） | 用户自行运行 ComfyUI 与已配置的本地工作流/模型 |

原生 dylib 的编译最低版本为 macOS 11.0；目前实际运行只在检查报告记录的本机系统验证，不能将编译目标视为旧系统已经通过实机测试。

## 本地构建

先在独立游戏副本准备对应 BepInEx 与用户游戏生成的 interop；原 Steam 安装保持独立。`LILITH_GAME_DIR` 指包含 `BepInEx/` 的目录，而不是 `.app` 路径。

```sh
export LILITH_GAME_DIR=/path/to/isolated-game-directory
export LILITH_DOTNET_PATH=/path/to/dotnet-sdk-8/dotnet
export LILITH_NODE_PATH=/path/to/node-24/bin/node

# 只生成构建文件；不把 Mod 安装到游戏
LILITH_BUILD_ONLY=1 bash scripts/build-macos.sh
bash scripts/test-macos.sh
```

输出位于 `plugin/bin/Release/net6.0/`。loader 兼容补丁的精确输入校验和构建方式见 [loader/README.md](../loader/README.md)。不提供自动安装 Rosetta、覆盖 Steam 游戏或关闭系统保护的脚本。

原生桥命名冲突回归：`bash scripts/test-native-macos.sh`。dev6.1 修复了旧库占用游戏托盘 Objective-C 类名的问题；不要使用旧 dev6 插件载荷测试正式游戏。

开发启动脚本 `scripts/launch-macos.py` 支持上述游戏目录和 Node 路径，以及独立日志/数据根 `LILITH_PROBE_DIR`。它要求副本已经装好 Mod 和兼容 loader；只构建输出不会自动安装。脚本拒绝从 Steam `steamapps/common` 目录启动，并为游戏准备独立 HOME 和存档写入隔离。建议将开发数据目录放在用户 `Library` 之外；脚本的存档隔离依赖 macOS 自带 `sandbox-exec`，其跨系统兼容仍需验收。

```sh
export LILITH_PROBE_DIR=/path/to/private-development-state
python3 scripts/launch-macos.py
```

数据与日志留在该独立目录；不要将其加入 Git。加载器要求的主线程环境变量由启动器设置。此脚本不自动下载依赖、不生成游戏 interop，也不自动安装兼容补丁。

## 配置

配置示例为 `companion/config.macos.example.json`，Key 留空、模拟回复开启、DSH 和绘图默认关闭。进入游戏的 Mod 设置后填写自己的服务信息。

DSH 使用 Mod 的 `provider.api_key`，不自动读取桌面 DSH 的凭据。外部读取范围需要用户显式设置；首版只开放受约束的文本文件工具和可选联网检索，不开放终端、浏览器控制或消息发送。普通绘图仍走原有 ComfyUI 通道。

GitHub 更新目标在本移植分支留空，防止把 Windows 上游 Release 当作 Mac 更新。确定自己的仓库和 Mac 发布资产后再配置；本项目源码仓库为 https://github.com/Lanxunye/Lilith-Mod-macOS ，尚未提供 Mac 自动更新或一键安装正式版。

## 发布边界

公开预览仅包含 Mod 自有构建文件和源码；不携带已修改的 BepInEx DLL。若以后捆绑修改后的 LGPL 组件，应同时准备完整对应源码、修改和构建材料及原许可证。

仍需完成的发布验收：加载器运行时支持方案、在干净 Mac 上的依赖准备/安装/卸载、较低 macOS 版本与 Intel 实机、多屏及长时间运行。当前产物用于开发者审查，不标记为面向普通玩家的一键安装正式版。
