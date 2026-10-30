# macOS 预览组件声明

macOS 源码审查包和插件预览包仅包含 Mod 代码、原生桥接库及原项目许可范围内的素材；不捆绑 BepInEx、修改后的加载器、CoreCLR、Node、游戏程序集、Unity 基础库或绘图模型。它们不是将下列组件重新授权为 MIT。

- BepInEx：固定 `6.0.0-be.790+4e98359`，LGPL-2.1；上游源码及许可证：https://github.com/BepInEx/BepInEx/tree/4e98359 。兼容补丁的源码和重建说明在 `loader/`；本预览不分发修改后的 LGPL DLL。
- Node.js：外部 Node 24，使用其自身许可证；Companion 无第三方 npm 依赖。
- .NET：加载器捆绑 CLR 6.0.7 x64；开发构建使用 SDK 8。组件遵循 Microsoft 及其第三方条款，不随本预览分发。.NET 6 已结束支持。
- DSH：用户自行安装的可选服务，通过 SDK 协议接入，不携带其应用、插件或凭据。
- ComfyUI 与模型：用户自行准备，不分发 checkpoint、编码器、VAE 或模型许可证。
- AppKit、Foundation、ApplicationServices、CoreGraphics：系统框架，由用户 macOS 提供。

原项目的角色头像与赞赏码按 `ASSET-NOTICE.md` 单独告知，不属于 MIT 代码许可。原 Windows 分发摘要留在下方，仅作历史对照。

---

# 第三方组件声明

Windows 发布包捆绑以下运行组件，玩家无需另行安装。各组件仍受其原许可证约束，
不属于本项目根目录 MIT 许可证的重新授权范围。

## BepInEx 6 IL2CPP

- 用途：随 Unity IL2CPP 游戏启动并加载 Mod 插件。
- 版本：6.0.0-be.769。
- 许可证：GNU Lesser General Public License v2.1。
- 发布包附带：`BepInEx-LICENSE.txt`。

## Unity 2021.3.45 基础类库

- 用途：供 BepInEx在玩家电脑上首次生成 IL2CPP互操作程序集，避免首次启动依赖外部下载。
- 来源：BepInEx Unity基础类库服务所提供的 `2021.3.45.zip`。
- 权利归属：Unity相关名称、程序集和组件的权利归其各自权利人所有。
- 发布包位置：`BepInEx/unity-libs/2021.3.45.zip`；该文件不属于本项目 MIT许可证的重新授权范围。

## Node.js

- 用途：运行本地 Lilith Companion 服务。
- 版本：Windows 发布时固定为 Node.js 24 LTS。
- 许可证：Node.js 许可证及其第三方组件条款。
- 发布包附带：`BepInEx/plugins/companion/node-LICENSE.txt`。

## Microsoft .NET Runtime 与 Windows SDK 组件

- 用途：BepInEx CoreCLR，以及自包含的 Windows 媒体会话桥接与 grounding viewer。
- 许可证：对应 Microsoft .NET、Windows SDK 及第三方组件许可。
- 发布包附带：`DotNet-LICENSE.txt` 与 `DotNet-ThirdPartyNotices.txt`。

## Microsoft Edge WebView2 SDK

- 用途：在独立窗口显示 Gemini Google Search 的 grounded 输出、来源与 Search Suggestions。
- SDK 版本：`Microsoft.Web.WebView2 1.0.4078.44`。
- 运行时：使用玩家系统中的 WebView2 Evergreen Runtime；发布包不携带完整浏览器内核。
- 发布包附带：`BepInEx/plugins/grounding-viewer/WebView2-LICENSE.txt` 与 `WebView2-NOTICE.txt`。

本项目不修改上述组件的许可证。若发布包内随附的完整许可证文本与本摘要存在
差异，以随附文本及组件上游项目的许可证为准。

### dsh-speak-up

来源：https://github.com/Yuuyuko-uu/dsh-speak-up ，Yuuyuko-uu，0.2.3，固定提交见 dsh-speak-up-lilith/UPSTREAM.json。上游 package.json 声明 MIT；该提交无独立 LICENSE 文件。适配保留来源并随附 MIT 文本，只复用本地触发算法，未启用上游网络更新和网页。

### dsh-bili-subagent 与 bilibili-mcp

来源：https://github.com/Yuuyuko-uu/dsh-bili-subagent ，Yuuyuko-uu，基于 c1overzz/dsh-bili-scroll，MIT。固定上游 0.8.7 提交与适配范围见 `dsh-bili-subagent-lilith/UPSTREAM.json`；保留原始源码供比对。字幕、简介、搜索和评论读取流程参考其内置 bilibili-mcp（Copyright (c) 2026 AGI_Ananas，MIT），许可文本合并保存在适配包 `LICENSE`。正式适配包不装载原版社交工具或原定时器。Python 依赖安装于独立运行环境，沿用各自许可证，安装版本记录于 `requirements.lock.txt`。

### Purge 莉莉丝适配源码

来源：https://github.com/kingcharleslzy-ai/dsh-purge ，Copyright (c) 2026 小杨，MIT。本版在 `dsh-purge-lilith/` 分发已适配源码和原许可；不包含私人配置、node_modules 或安装时应用的宿主二进制补丁。适配说明见该目录 `LILITH-ADAPTATION.md`。部署包首次按官方 SHA-256 下载 Node 24.22.1，由下载组件保留其自身许可证；ZIP 不捆绑 Node。
