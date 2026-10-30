# 依赖下载与用途

基础安装通过 `一键安装Mod.command` 自动下载；也可先运行 `下载基础依赖.command`。所有下载在使用前核验固定校验值。精确版本、下载地址和摘要见 [机器可读清单](../dependencies-macos.json)。**不会下载或安装 DSH。**

| 组件 | 用途 | 下载来源 |
| --- | --- | --- |
| Node.js 24.22.1 | 运行本机聊天控制台和安装器 | [Node 官方下载](https://nodejs.org/dist/v24.22.1/) |
| BepInEx be.790 | 加载 Mac 游戏插件；由安装器在本机生成兼容补丁 | [固定官方下载](https://builds.bepinex.dev/projects/bepinex_be/790/BepInEx-Unity.IL2CPP-macos-x64-6.0.0-be.790%2B4e98359.zip) |
| .NET 8.0.32 运行时 | 仅在安装时运行配套加载器补丁工具，不是 SDK | [arm64](https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.32/dotnet-runtime-8.0.32-osx-arm64.tar.gz) · [x64](https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.32/dotnet-runtime-8.0.32-osx-x64.tar.gz) |
| Rosetta | Apple Silicon 运行 x86_64 游戏 | 由 macOS 提示安装，许可由玩家自行确认 |

基础依赖不需要全局安装，不会下载 Homebrew 或申请 sudo。BepInEx 固定包包含其自己的 .NET 6.0.7 加载运行时；该上游运行时已停止支持，后续加载器升级仍需单独验证。本项目不会把“固定版本可用”当作长期支持承诺。

## 可选功能

- 绘图：[ComfyUI 官方项目](https://github.com/Comfy-Org/ComfyUI)，模型与放置位置见 [模型下载指南](models.md)。默认绘图链路使用 Z-Image Turbo、Qwen3 4B 文本编码器和 VAE；不是 Qwen 20B。
- QQ：[NapCat 官方项目](https://github.com/NapNeko/NapCatQQ)。玩家自行安装、登录和准备 QQ 小号；本项目不打包 QQ 安装程序、登录票据或协议端。
- 语音：[模型下载指南](models.md) 中提供基础模型来源。私人音色、角色 LoRA 和参考音频不随包提供。
- 识图：在控制台自行配置兼容视觉服务，凭据只保存在自己的电脑。
- 音乐声音特征：可选 FFmpeg；不安装时仍可使用聊天及歌曲文字信息。

这些可选服务不会因安装基础 Mod 而自动下载。先接通聊天，再按需要添加，能减少下载量和配置步骤。
