# 《不存在的莉莉丝》Mod · macOS 移植与功能扩展

基于 **Dreamer（[@cza2019](https://github.com/cza2019)）** 的开源项目 **[The-NOexistenceN-of-Lilith-Mod](https://github.com/cza2019/The-NOexistenceN-of-Lilith-Mod)**（上游 v0.3.4）。原项目为 Steam 桌宠游戏《不存在的莉莉丝》增加 AI 对话、角色记忆、剧情检索和音乐联动。本仓库在此基础上进行 macOS 适配及扩展，属于独立衍生项目，保留上游 MIT 版权、素材声明与贡献归属，未宣称获得上游官方背书。

**当前版本：0.3.4-macos.dev15 · 开发预览；QQ 桥接：Beta 测试版。**


> **下载与部署**：[GitHub Releases](https://github.com/Lanxunye/Lilith-Mod-macOS/releases) → 下载 `macOS-setup.zip` 结尾的附件 → 解压 → 双击 **一键部署.command**。完整步骤见 [部署教程](docs/deployment-macos.md)。该入口自动准备 Node 并部署 WebUI；游戏插件安装要求先具备兼容加载器。QQ 桥接仍为 Beta。

本项目让官方 Mac 桌宠、浏览器控制台和 QQ 共享莉莉丝的固定人设，并按通道权限使用记忆、情绪与本机能力。聊天通过本机 DSH 接入；绘图使用本地 ComfyUI；QQ 使用用户自己的小号与 OneBot 协议端。可先只安装控制台，再逐项开启游戏、QQ、绘图、看图和朗读。

## 功能与状态

- [网易云音乐阅读与兴趣](docs/music-learning.md)：本机当前歌曲识别，读取主人指定歌单、歌词和本地缓存声音特征；独立 DSH 整理感想与自身兴趣，经现有主动搭话分享，仅限主人 QQ 私聊和桌面聊天。

- [B站自主阅读与兴趣积累](docs/bili-learning.md)：莉莉丝自行选题，初始偏向摄影艺术；读取字幕、简介和公开评论，只在主人 QQ 私聊分析和分享。需要手机扫码登录；当前没有视频画面和音频理解。

- [DSH 原生联网搜索](docs/web-search.md)：桌面、主人私聊与白名单群独立开关；官方 Search/Fetch、来源引用、公开关键词过滤和每日请求预算。

- [表情精准选图与多样性](docs/sticker-selection.md)：私聊结合完整待发回复选图，睡前排除惊恐等错配；在贴切候选中轮换并回避近期重复。

- [每轮能力与交付状态同步](docs/host-awareness.md)：语音、绘图、表情及本机时钟随当前通道和开关刷新；天气与系统定位暂缓。
- [主人公开事实跨渠道同步](docs/owner-public-memory.md)：按绑定QQ号同步称呼及公开偏好，私聊经历保留私密。

- 原游戏“放点音乐 → 外部播放器”网易云唤起修复：原生菜单与成功台词已获用户实测确认，见 [排查与修复](docs/macos-music-launch.md)。
- 普通桌面 Spaces 跟随（dev7.2）：原生窗口测试与本机多桌面切换实机验收通过。
- 官方 Mac 游戏适配：透明桌宠、聊天与气泡、中文输入和候选栏定位、窗口与小画室交互。
- [启动入口统一拉起服务](docs/startup-services.md)：检测并复用聊天后台、DSH、QQ 协议端与 ComfyUI；本机配置允许时补启动已有服务，保留登录和暂停设置。
- [系统定位与当地天气](docs/weather.md)：单次系统定位、近似位置天气查询、时效与失败状态进入每轮能力快照；仅桌面与主人私聊，第三方位置查询需要单独同意。
- 共用上游莉莉丝人设，支持模型对话、角色记忆与有原文来源的上下文摘要。
- 本地 ComfyUI 绘图及聊天自主表情；连续三轮聊天最多触发一次表情。
- 本机莉莉丝第三轮 LoRA（160 步） 朗读：游戏聊天框可切换；QQ 私聊和白名单群聊分别控制，默认仅将逐句标记为温柔的回复转成语音，也可切换全部语音。合成成功只发语音，失败回退文字，见 [朗读与 QQ 语音](docs/chat-speech.md)。
- [QQ 大图识别](docs/qq-image-flow.md)：原图最多读取 20 MiB，超过 6 MiB 时本机生成缩放压缩副本再提交视觉模型，保留原图；图片下载等待最多 30 秒。

2026-10-27 第三轮语调精修完成四组训练试验后，主人人工试听选定主 Talker 160 步作为最优候选，现已接入正式版。自动声学指标与听感判断的差异、检查点及局限见 [第三轮训练记录](docs/tts-round3-20261027.md)；本次未修改语境适配层。
- 桌面、WebUI 和 QQ 对话统一使用本机 DeepSeek Harness（DSH）原生认证与模型；独立工作区、完整 Purge 莉莉丝适配版、删除与高危操作逐次明文确认。
- DSH 桌面侧栏“莉莉丝”面板：桌宠/主人私聊记录同步、原会话续聊回写、工作区 JSONL 导出；保留操作确认。
- DSH 情绪插件：基于鱼的心情 0.7.0 的莉莉丝 SDK 适配；桌面与主人私聊共享情绪，控制台可查看原因与关闭判断/注入，见 [情绪说明](DSH.md#情绪插件2026-10-25)。
- **QQ 桥接（测试版）**：在莉莉丝 WebUI 统一配置、检查连接、暂停、查看交付与额度。主人私聊、白名单群聊、成员区分和同群文字引用；选择性接话、@ 优先，按话题停止，所有群每天合计最多 100 条（北京时间）。
- **群聊本地生图**：白名单群内实际 @ 莉莉丝并明确请求绘图，使用既有 ComfyUI 工作流；由莉莉丝自然回应，完成后独立发图，每群每天最多 10 次提交；绘图前编排可见场景，明确处理睡姿和闭眼，编排失败时使用本地回退，见 [群聊生图说明](docs/qq-group-art.md)。
- **完整 QQ 指令帮助**：主人私聊发送 `/lls`、`/lls help` 或 `/lls ?` 查看全部命令、参数与别名；帮助和参数校验共用命令表，错误输入会显示完整帮助。

QQ 私聊和群聊基础收发已由用户实机验收；原生 DSH 的正式端私聊回复也获用户确认。主人私聊可在逐次确认后执行本机任务，群聊不开放 DSH 或通用本机工具。图片识别须单独配置，私聊与群聊表情各有开关，按库内描述选择并记录交付反馈。群聊绘图仅在明确请求时触发，不开放群文件、任意路径或自选工作流。语音情绪识别与句末韵律仍需持续核听；不承诺文件或视频识别、全部自主能力或长期稳定性均已验收。第三方 QQ 协议存在账号风控风险，不承诺免封。

桌宠原生互动现可累积当日心情与长期依赖度；额外心情每天本机时间 0:00 重置。规则见 [互动与情绪加成](docs/pet-affection.md)。

## 如何使用

优先按 [从零部署、配置、升级与回退](docs/deployment-macos.md) 操作。一键包会把程序放到当前用户目录，保留各版本，不要求全局安装 Node 或 npm。游戏 1.1.0 的兼容加载器仍需自备；部署包内的 **安装游戏插件.command** 会检查加载器、要求游戏退出、展示准确目录并备份旧插件，随后安装本版插件。


完整步骤见 **[使用指南：控制台、模型、游戏、绘图、DSH 与 QQ](docs/usage.md)**。

仅体验本机 WebUI / QQ 桥接，不必先加载游戏插件：

```sh
git clone https://github.com/Lanxunye/Lilith-Mod-macOS.git
cd Lilith-Mod-macOS
# 先安装 Node.js 24；无第三方 npm 运行依赖
npm ci --ignore-scripts --prefix companion
node scripts/open-console.cjs
# 直接打开 QQ 配置标签页：
node scripts/open-console.cjs --tab=qq
```

先安装兼容的 DeepSeek Harness 并在其原生模型/账户设置中完成认证，再在莉莉丝控制台连接 DSH；正式对话不使用旧 Mod API Key。视觉识别等独立服务仍在本机配置。QQ 还需自行安装和登录协议端，按 [QQ 接入步骤](docs/usage.md#qq-桥接测试版) 配置双方令牌。

**全新游戏的加载器仍需单独安装；本版一键包可以部署控制台，并在已有兼容加载器上安装/更新游戏插件。** 需要合法的 Steam Mac 游戏、自备对应的 BepInEx/CLR、interop 和本地构建工具；Apple Silicon 需要 Rosetta 运行 x86_64 游戏。请按 [macOS 构建与预览边界](docs/macos-preview.md) 操作。源码不附游戏、模型、QQ、NapCat、加载器二进制或个人配置。

### 游戏朗读与 QQ 快捷命令

游戏聊天框点击“朗读：关／开”控制本机播放，开启后只读新回复，不补读历史。桌面回复先启动语音，再显示对应文字并触发游戏原有逐字动画；关闭朗读或语音失败时正常显示文字。QQ 私聊语音、群聊语音与游戏朗读分别控制，WebUI 的 QQ 标签页也可调整语音开关和模式。语音使用本机 Qwen3-TTS 0.6B、MLX 与已验收的莉莉丝第三轮 LoRA（160 步），模型及参考音频需自行准备，源码不附带这些资源。

以下管理命令由**绑定主人在好友私聊**中发送：

| 命令 | 作用 |
| --- | --- |
| `/lls`、`/lls help`、`/lls ?` | 显示全部可执行命令 |
| `/lls state`，别名 `/lls states` | 查询通道开关、语音模式、合成服务及群聊绘图额度 |
| `/lls tts [on\|off]` | 私聊语音开关 |
| `/lls group tts [on\|off]`，别名 `/lls gtts` | 白名单群聊语音开关 |
| `/lls tts all` | 在“全部语音／仅温柔语音”之间切换 |
| `/lls tts gentle` | 直接设为仅温柔语音 |
| `/lls group [on\|off]` | 白名单群聊回复总开关 |
| `/lls draw [on\|off]`，别名 `/lls groupart` | 群聊本地生图开关 |

`[on|off]` 是可选参数，输入时不带方括号；省略时切换开关。模式切换不会自动打开任何语音通道。默认 `gentle` 模式要求当前条目有有效温柔标记，其他条目继续用文字；`all` 模式允许其他语气使用语音。合成失败、长文本或需要保留参考链接时回退文字。群聊语音仍受群聊总开关、白名单、参与判断和每日发送额度约束。完整说明见 [QQ 命令表](docs/qq-commands.md)。

## 文档与开发

- [使用指南](docs/usage.md) · [macOS 依赖与构建](docs/macos-preview.md)
- [QQ 桥接 Beta：设计与实现边界](QQBOT.md)
- [QQ 完整命令](docs/qq-commands.md) · [语音与温柔模式](docs/chat-speech.md) · [群聊本地生图](docs/qq-group-art.md)
- [绘图与聊天表情](COMFYUI.md) · [DSH 原生对话与操作确认](DSH.md)
- [依赖锁定清单](dependencies-macos.json) · [发布检查](docs/release-macos-preflight.md)
- [原 Windows 文档](docs/upstream/README.windows.zh-CN.md)（不能照此安装到 Mac）

```sh
npm test --prefix companion
# 另需 .NET SDK 8；运行 7 组可移植托管测试和 Node 测试：
bash scripts/test-macos.sh
```

GitHub Actions 运行 Linux / macOS 的源码测试，不执行游戏。Release 附件由维护者在本地构建、检查后上传，附 SHA-256；不包含游戏、加载器或个人数据。请勿在 Issue、截图、日志或 PR 中附带 API Key、QQ 登录票据、个人聊天或游戏资源。

## 已知边界与授权

目前仅在开发者的 Mac / 游戏 1.1.0 环境完成部分实机验收，干净机器安装、Intel Mac、较低 macOS、多屏和长时间运行尚需验证。原生库的 macOS 11 编译目标不代表旧系统实测通过；固定加载器仍依赖已结束支持的 .NET 6，属于正式发布待处理项。WebUI/QQ 可独立运行在 Node 24 上。

原创代码沿用 [MIT License](LICENSE)，保留 `Copyright (c) 2026 Dreamer`。游戏角色、上游赞赏码和第三方组件分别受 [素材声明](ASSET-NOTICE.md) 与 [第三方声明](THIRD-PARTY-NOTICES.md) 约束。感谢原作者开源，以及 BepInEx、DeepSeek Harness、ComfyUI、NapCat 等上游项目。
