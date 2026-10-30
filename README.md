# 莉莉丝 Mod · macOS 版

让《不存在的莉莉丝》的 Mac 桌宠陪你聊天，也可以接入你自己的 QQ 小号，使用本地绘图、表情和朗读功能。

基于 **Dreamer（[@cza2019](https://github.com/cza2019)）** 开源的 **[The-NOexistenceN-of-Lilith-Mod](https://github.com/cza2019/The-NOexistenceN-of-Lilith-Mod)**（上游 v0.3.4）制作，保留原作者版权和 MIT 许可。本项目负责 macOS 适配与功能扩展，是独立衍生版本。

**当前版本：macOS dev16，开发预览版。** 基础安装要求 macOS 13.5+；开发环境为 Apple Silicon Mac 与 Steam Mac 游戏 1.1.0，其他机器仍需反馈。

## 第一次安装：从这里开始

你需要先准备：

- 已购买、安装并至少启动过一次的 Steam Mac 版游戏 **1.1.0**。
- **macOS 13.5 或更新版本**；Apple Silicon Mac 需要 Rosetta。Intel Mac 尚未完成实机验收。
- 能正常联网的电脑。真实 AI 聊天还需要你自行安装并配置 **DeepSeek Harness（DSH）**。

**不用自己安装 Node、不用编译代码，也不用手动处理加载器。** 一键包自动下载并核验所需基础依赖；**不包含或下载 DSH、游戏本体、模型、密钥和私人数据**。

1. 打开 **[直接下载安装包](https://github.com/Lanxunye/Lilith-Mod-macOS/releases/download/v0.3.4-macos.dev16/Lilith-Mod-0.3.4-macos.dev16-macOS-setup.zip)**，或进入 [dev16 下载页](https://github.com/Lanxunye/Lilith-Mod-macOS/releases/tag/v0.3.4-macos.dev16) 选择以 **`macOS-setup.zip`** 结尾的附件。不要选页面底部的 Source code。
2. 解压 ZIP，退出正在运行的莉莉丝，Steam 保持登录。
3. 双击 **`一键安装Mod.command`**。安装器会显示游戏位置；确认正确后输入 **`安装`** 并回车。等待下载、校验、备份和安装完成。
4. 按安装器提示启动游戏目录中的 **`启动莉莉丝Mod.command`**。第一次启动需要自动生成配套文件，可能要等几分钟。
5. 游戏中按 **F8 / Fn+F8** 打开聊天，点击“设置”。先在 DSH 中配置好模型，再回到控制台连接 DSH，即可聊天。

遇到系统阻止打开、非默认 Steam 路径或下载失败，请看 **[分步安装与常见问题](docs/deployment-macos.md)**。安装不会自动关闭系统安全保护或代你接受 Rosetta 许可。

> **启动入口很重要：**直接打开 `Lilith.app` 会进入原版。想从 Steam 的“开始”加载 Mod，按 [Steam 启动设置](docs/deployment-macos.md#让-steam开始也加载-mod) 操作。安装器会备份旧附加组件，保留游戏 .app、存档和聊天设置。

## 能做什么

| 功能 | 使用方式 |
| --- | --- |
| 桌宠聊天 | 在正式 Mac 游戏中按 F8；保留莉莉丝原有人设和表达风格 |
| 网页聊天与设置 | 浏览器控制台与桌宠共享记录，可独立使用 |
| 情绪与记忆 | 桌面和主人私聊共享状态；原生互动可影响心情与依赖度 |
| QQ 私聊与群聊 | 使用自己的小号；按白名单、开关与每日额度工作，区分群友和文字引用 |
| 绘图与表情 | 可接入本地 ComfyUI；QQ 群聊绘图需要明确 @，每群每天最多 10 张 |
| 图片识别 | 可另行配置兼容视觉服务，重复图片复用识别结果 |
| 朗读与 QQ 语音 | 可接入本地语音服务；私有角色音色和参考音频不随包提供 |
| 联网查询 | 按设置调用 DSH 官方搜索服务，并给出来源 |
| 音乐与 B 站阅读 | 可选扩展，需单独准备服务或账号；不把字幕阅读当成完整视频理解 |

更多操作见 **[使用指南](docs/usage.md)**、[QQ 指令表](docs/qq-commands.md)、[绘图设置](COMFYUI.md) 和 [模型下载](docs/models.md)。不使用的功能可以保持关闭。

## 更省 token 的默认设置

本版默认启用，不需要玩家额外安装插件：

- 莉莉丝的 DSH **仅用于聊天，关闭全部操作工具和 REA**。不能读取或修改文件、执行终端、管理插件或调用子代理。普通 DSH 应用自身不受影响。
- 群聊只带 **最近 5 条历史**，去掉重复信息；群成员记忆只保留少量相关事实，不额外调用群聊摘要模型。
- 接话和选表情使用不带思考的短判断；正常聊天的思考设置保留。
- 重复图片使用识别缓存；控制台显示当日输入、缓存输入和输出用量。

实际 token 和费用随消息、引用、候选表情及服务计价变化；界面统计尚不覆盖全部独立服务。[查看方案与用法](docs/dialogue-cost-control.md)

## 可选依赖从哪里下载

安装器会自动下载 **Node.js 24、BepInEx 和安装时使用的 .NET 8 运行时**，并核验固定校验值。也可先双击 **`下载基础依赖.command`** 下载到本机缓存，再安装 Mod。**不会安装 DSH。**

- [基础依赖来源与手动下载](docs/dependencies.md)
- [本地绘图、语音模型下载和放置位置](docs/models.md)
- [连接自己安装的 DSH](DSH.md)

QQ、绘图、视觉与语音不是首次聊天的前置条件。QQ 需要自行准备小号及协议端；第三方 QQ 接入存在账号风险，无法承诺免封。

## 更新、恢复与当前范围

新版本解压后重新运行一键安装器。旧版会备份；更新前退出游戏。若后台仍在使用旧版本，请按 [升级步骤](docs/deployment-macos.md#升级与恢复) 重启后台。请勿混合不同版本文件。

桌宠支持普通桌面之间跟随，**不覆盖其他应用的全屏空间**。全屏时看不到桌宠属于当前预期行为，返回普通桌面即可。完整新机安装、Intel Mac 与长期运行仍需更多测试；不承诺文件或视频识别功能。

## 开发资料与致谢

开发者可阅读 [构建说明](docs/macos-preview.md)、[加载器源码](loader/README.md)、[依赖锁定清单](dependencies-macos.json) 和 [发布检查](docs/release-macos-preflight.md)。Windows 安装方法保留在 [上游文档](docs/upstream/README.windows.zh-CN.md)，不要照此安装到 Mac。

源码沿用 [MIT License](LICENSE)，保留 `Copyright (c) 2026 Dreamer`。角色与第三方资源的归属见 [素材声明](ASSET-NOTICE.md) 和 [第三方声明](THIRD-PARTY-NOTICES.md)。感谢原作者以及 BepInEx、DeepSeek Harness、ComfyUI、NapCat 等项目。

Issue、日志和截图请隐藏密钥、QQ 登录票据及私人聊天。
