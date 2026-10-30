# macOS 部署教程 · dev15

适用版本：`0.3.4-macos.dev15`，2026-10-30。QQ 桥接为 Beta。本项目基于 [Dreamer / cza2019 原 Mod](https://github.com/cza2019/The-NOexistenceN-of-Lilith-Mod)，保留原版权；它是独立的 Mac 衍生项目。

## 先选择部署范围

| 目标 | 一键包负责 | 仍需准备 |
| --- | --- | --- |
| 浏览器聊天与设置 | 下载并校验 Node 24.22.1、安装程序、创建启动入口、打开本机控制台 | 真实聊天需要本机 DSH 及其模型认证；初次可用模拟回复检查界面 |
| QQ 小号机器人 | WebUI 配置、身份检测、人设/记忆与消息交付逻辑 | 自己的小号、主人账号、已安装并登录的 NapCat / OneBot |
| 官方 Mac 游戏桌宠 | 检查游戏及加载器、备份并安装本版 DLL、原生桥与启动支持文件 | Steam 游戏 1.1.0、已验证的兼容 BepInEx/CLR/interop；Apple Silicon 需要 Rosetta |
| 本地绘图 / 朗读 / 看图 | 服务接口、工作流、通道开关与交付反馈 | ComfyUI / Qwen 模型、TTS 服务或独立视觉服务凭据 |

**一键不等于包含游戏和全部模型。** 包中不附 QQ、NapCat、DSH、BepInEx、修改后的 LGPL 加载器、CLR、游戏 interop、模型、私人参考音频、密钥或聊天数据。Node 从官方站点下载并按代码内固定 SHA-256 核验。首次下载需要联网；不会安装 Homebrew、请求 sudo、自动接受 Rosetta 许可或关闭 Gatekeeper。

## 1. 下载与校验

1. 从 [本仓库 Releases](https://github.com/Lanxunye/Lilith-Mod-macOS/releases) 选择 dev15，下载 `Lilith-Mod-0.3.4-macos.dev15-macOS-setup.zip` 和 `SHA256SUMS.txt`。不要误选 GitHub 自动生成的 Source code ZIP；它没有预编译插件和包内校验清单。
2. 在终端进入下载目录，执行 `shasum -a 256 -c SHA256SUMS.txt`。若只下载一个 ZIP，会出现另一个源码 ZIP 缺失的提示；只需核对自己下载的 ZIP 对应行显示 OK，也可以同时下载两个 ZIP 再执行检查。
3. 用归档实用工具解压到独立目录，避免混入旧版本文件。包内 `SHA256SUMS.txt` 校验各个文件；包外同名文件校验 ZIP 本身。
4. 双击 `一键部署.command`。若 macOS 提示来源或阻止打开，先核对下载来源与校验结果，再按系统允许的“打开”流程自行操作；不要批量关闭系统安全保护。

若 Terminal 提示文件不可执行，进入解压目录运行：

```sh
chmod +x 一键部署.command 安装游戏插件.command
/bin/bash 一键部署.command
```

脚本识别当前运行架构，只下载对应 arm64 或 x64 Node。下载失败、校验失败、服务端口冲突会停止并给出提示，不会静默换成未知镜像。

## 2. 一键部署控制台

部署后程序位于：

```text
~/Library/Application Support/LilithMod/versions/0.3.4-macos.dev15/
~/Library/Application Support/LilithMod/runtime/node-v24.22.1-darwin-<架构>/
~/Library/Application Support/LilithMod/打开莉莉丝控制台.command
```

首次默认数据目录为 `~/Library/Application Support/LilithAI/`，默认地址 `http://127.0.0.1:6186`。本机若原来配置成 6187 等端口，继续使用原设置；教程示例中的端口也要同步替换。程序目录与私人数据目录分开，重新解压、安装不会清空历史或重置 QQ 开关。

控制台自动打开“设置”。后续双击安装目录里的 `打开莉莉丝控制台.command` 即可，不必保留最初的下载 ZIP。该入口启动或复用常驻后台；退出游戏不关闭常驻服务。**本版不会注册系统开机登录项**，电脑重启后应再次使用此入口或游戏的 Mod 启动入口。

同版本已安装且内容相同时直接复用；同版本内容不同则拒绝覆盖。目录中的版本不要手动混装。打开已有旧服务时会复用它，不强制中断聊天；升级后需要按第 8 节显式重启后台，才会加载新代码。

验证：进入 QQ 标签页或设置页能看到本机构建号。只检查界面可保留“模拟回复”；该模式不证明 DSH 或 QQ 真实收发已通过。

## 3. 连接 DSH：真实对话的必要步骤

1. 自行安装兼容的 DeepSeek Harness；本机验证版本及来源见 [依赖清单](../dependencies-macos.json) 与 [DSH 说明](../DSH.md)。在 DSH 的原生账户/模型设置完成认证，先确认普通 DSH 会话能正常回答。
2. 在莉莉丝设置页选择本机 DSH，按页面填写本机安装位置/SDK profile。正式聊天使用 DSH 原生认证，旧 Mod 对话 API Key 不再用于正式链路；视觉服务 Key 仍独立。
3. 点击“连接 DSH”，确认状态为 `native_sdk_connected`。连接后关闭模拟回复，用 WebUI 发送一句测试文字。
4. 保留独立莉莉丝工作区与 profile。默认工作区 `~/Documents/Lilith-DSH-Workspace`；其数据在 `LilithAI/dsh-lilith/home`。普通 DSH 桌面装了插件，不代表莉莉丝 profile 也已装载。

本仓库附 `dsh-purge-lilith/`、情绪、记忆、主动表达、B站只读适配和 DSH 桌面面板源码。它们不是 DSH 应用本身。按各目录 README 与 `DSH.md` 的版本要求安装到莉莉丝独立 profile，勿用未适配 Purge 替换已验证版本。首次只接通基础对话也可，扩展需逐个安装并检查就绪状态。

基础莉莉丝人设由宿主统一注入。桌面与主人私聊可以提出本机任务；删除、写入、终端、外发及高危操作需要绑定具体参数的再次明文确认。群聊和内部判断不开放通用本机工具。工具守卫不等于操作系统沙箱；只安装可信插件。

如需 DSH 桌面续聊，另外安装 [dsh-desktop-bridge](../dsh-desktop-bridge/README.md)，重启 DSH 后使用侧栏“莉莉丝”面板“发送并回写”。它不往普通 DSH 会话列表伪造聊天。

## 4. 安装到官方游戏

### 尚未装过兼容加载器

先自行完成 [macOS 依赖与构建](macos-preview.md) 和 [loader 重建说明](../loader/README.md)，建议从游戏副本验证。仅解压原版 BepInEx 不等于加载器兼容补丁已经就绪。需要与游戏匹配的本机生成 interop，不可下载他人的游戏程序集。首次加载器构建需要 .NET SDK 8、Xcode Command Line Tools 及固定上游依赖。

当前固定 BepInEx 使用已结束支持的 .NET 6；完整游戏的干净机器自动部署、旧 macOS、Intel 机器及多屏长期运行均未完整验收。若不愿处理加载器，先使用 WebUI / QQ，不要把 Windows 包覆盖到 Mac 游戏。

### 已有兼容加载器

1. 保存进度并退出所有 Lilith 实例；Steam 保持已登录。
2. 双击部署包中的 `安装游戏插件.command`。默认目标为 Steam 标准路径中包含 `Lilith.app` 的游戏目录。
3. 安装器检查游戏 bundle ID/1.1.0、x64 运行能力、关键依赖及加载器 SHA-256。缺失或版本不符会拒绝安装。
4. 核对终端展示的准确游戏目录，输入 `INSTALL`。它先备份旧插件，再安装新 DLL、原生桥、公开角色资料和 Companion；不替换 `Lilith.app`，不改游戏存档或私人设置。
5. 从游戏目录双击 `启动莉莉丝Mod.command`，用 F8 / Fn+F8 打开聊天。直接打开原 `.app` 可能只运行原版。

自定义 Steam 库路径：

```sh
/bin/bash scripts/bootstrap-macos.sh --game --game-dir="/Volumes/游戏盘/SteamLibrary/steamapps/common/The NOexistenceN of Lilith"
```

备份位于 `~/Library/Application Support/LilithMod/backups/<时间>/`。旧插件目录在安装暂存目录中也会保留，不自动清理私人文件。本版安装器会更新启动入口，但不会替你修改 Steam 启动选项、系统登录项或强制关闭正在运行的游戏。

## 5. QQ 桥接 Beta

1. 准备专用 QQ 小号和主人账号，自己安装兼容 NapCat / OneBot，并由本人完成扫码与安全验证。普通小号使用第三方接入存在风控风险，不能保证免封。
2. NapCat 启用 HTTP Server，仅监听 `127.0.0.1`，例如 6190，设置随机 API Token。
3. 启用 HTTP Client，事件地址示例 `http://127.0.0.1:6186/onebot/events`；格式为 **array**，HTTP Client token 是事件签名 Secret。
4. 在莉莉丝 WebUI → QQ 桥接填写小号、唯一主人、API 地址、API Token 和事件 Secret。**NapCat WebUI 登录密钥、OneBot API Token、事件 Secret、模型 Key 是不同用途。** 两端相应字段必须一致。
5. 启用桥接，先保留“暂停”，保存后点击“检查小号连接”。它只验证身份，不发送消息；成功后再由你取消暂停并保存。
6. 主人发一句好友私聊，在 WebUI 查看回复与交付回执。非主人私聊忽略；群聊需单独加入群白名单。

群聊按成员区分记忆，支持同群文字引用、选择性接话、@ 优先与按话题结束；所有白名单群合计每日最多 100 条。实际 @ 并明确要求绘图才触发群聊生图，**每群每天最多 10 次提交**。主人私聊生图也需实际 @ 或支持的明确前缀，不设群聊的日额度。表情、看图、语音、群聊绘图均有独立开关。

主人私聊发送 `/lls help` 查看当前版本的完整命令，`/lls state`（或 `states`）查看状态。`/lls group off` 关闭群聊；`/lls draw off` 关闭群聊生图；`/lls pdraw off` 关闭私聊生图；`/lls tts off` 关闭私聊语音。更完整说明见 [QQ 命令表](qq-commands.md) 与 [使用指南](usage.md)。

先前本机出现过“控制台正常、QQ 未连接”：重启后 QQ 宿主没启动，6190 端口拒绝连接。可在 [统一启动设置](startup-services.md) 指定你已安装的 QQ 与 ComfyUI 目录，再通过 Mod 或控制台入口补启动。公开包不包含维护者机器上的目录、QQ 登录或自动配置，不能套用维护者端口而不核对自己的设置。

## 6. 绘图、看图、语音与联网搜索

- **绘图**：本机启动 ComfyUI，设置页指定 loopback 地址与许可工作流。当前默认工作流是 `companion/workflows/lilith-zimage-local.json`，涉及的模型以 JSON 中实际节点名称为准；仓库不附模型。请求先经 DSH 场景/美术编排，再提交许可工作流；通过视觉复核才交付，失败可能消耗计算但不发未经确认的图。见 [ComfyUI](../COMFYUI.md)。
- **看图/表情库**：在 QQ 页面单独启用并配置视觉服务。模型提供图片描述与标签，表情按语境和已交付轮次选择；库内图片需自己提供。角色卡不能保证每次图片语义都准确，可人工纠正。视频、群文件、合并转发不作识别承诺。
- **语音**：本地 Qwen TTS、MLX、LoRA 与参考音频自行准备，不能把维护者已经训练好的私人声音当作包内资源。指定本机服务，先测合成，再开对应桌面/QQ通道。见 [朗读说明](chat-speech.md)。
- **搜索**：桌面、主人私聊、群聊分别控制，通过本机 DSH 的官方 DeepSeek Search/Fetch 接口与预算管理，不需要把搜索 Key 写入 GitHub。默认不开启新用户未配置的服务。见 [搜索说明](web-search.md)。
- **音乐缓存声学统计**：另需本机 FFmpeg；当前默认查找 `/opt/homebrew/bin/ffmpeg`。一键包不下载或分发 FFmpeg，未安装时报告 `ffmpeg_unavailable`，不影响普通聊天、曲名元数据或网易云唤起。
- **B站/音乐/天气**：均是可选能力，分别阅读 [B站](bili-learning.md)、[网易云](music-learning.md)、[天气](weather.md)。B站账号由本人登录，位置/第三方天气访问按界面许可开启；不自动发公开评论或替你播放音乐。

## 7. 首次验收清单

- [ ] 控制台能打开，构建号为 dev15；关闭模拟回复后 DSH 能真实回答。
- [ ] 启用 QQ 后身份检查通过，主人私聊一问一答能看到平台交付回执。
- [ ] 启用群聊后只在白名单群处理；关闭群聊后仍可使用主人管理命令。
- [ ] 安装游戏后从 Mod 入口启动，透明桌宠、中文输入、气泡、普通 Spaces 跟随正常。
- [ ] 原游戏“放点音乐 → 外部播放器”能打开网易云并显示成功台词。
- [ ] 每个可选能力先独立测试再开启自主调用；密钥、模型及登录状态均由自己准备。

上面是新使用者的检查清单，不表示维护者已在所有干净机器完成验收。一键包已做隔离安装、重复安装、篡改拒绝和游戏前置条件检查；维护者本机原生音乐与 QQ 基础收发此前已获实测确认。

## 8. 升级、回退与卸载

升级前保存游戏，确认没有进行中的绘图或本机任务。先退出游戏，再停止当前后台，否则旧后台会继续被复用。停止常驻后台会使 QQ 暂时停止处理，也会停止它持有的 DSH 会话；不退出你的普通 DSH 桌面或 QQ 客户端。

```sh
# 在旧程序版本目录执行；也可使用该版本下载的解压目录
"<Node24路径>" scripts/companion-service.cjs status
"<Node24路径>" scripts/companion-service.cjs stop
```

双击新包的一键入口，再按需要更新游戏插件。新版本与旧版本并存，启动入口指向最新安装版本。回退时停止后台，用旧版本目录中的 `scripts/open-console.cjs` 启动；游戏插件从安装备份恢复。**本版不会自动回滚数据库结构**，跨版本恢复数据前先离线备份整个 `LilithAI/`，勿用旧配置强行覆盖新历史。

卸载控制台：停止常驻服务，然后通过 Finder 移走自己安装的 `LilithMod/` 程序目录。私人数据在独立的 `LilithAI/`，是否保留由你决定；安装器不自动删除它。停用游戏加载器应按原加载器/已有停用工具说明操作，保留 Steam 原游戏 .app；不要把一键包的“插件更新”当作加载器卸载工具。

## 9. 故障排查

| 现象 | 检查顺序 |
| --- | --- |
| Node 下载或校验失败 | 官方 nodejs.org 网络 → 重试；不要跳过 SHA-256，也不要执行来源不明替代包 |
| 页面未授权 | 用安装生成的入口重新打开；不要公开带 token 的地址或 runtime.json |
| 端口占用 | `companion-service.cjs status` 确认已有服务归属；不要杀未知进程或盲目换端口 |
| 安装后仍是旧构建 | 旧常驻后台仍在运行；按升级步骤停止后用新入口打开 |
| QQ API 拒绝连接 | 宿主是否运行 → 监听端口 → 登录状态 → Token → WebUI身份检查 |
| 身份通过但收不到消息 | HTTP Client 上报端口、路径、array、签名 Secret → 暂停开关 → 主人/群白名单 |
| DSH 401 或未完成回复 | 先测试原生 DSH 模型 → 再连接莉莉丝SDK → 检查适配插件就绪；不需要更换 QQ Token |
| 游戏插件安装拒绝 | 游戏版本、已退出、兼容加载器哈希、interop、Rosetta；详见 macos-preview.md |
| 不自动出图/语音 | 通道开关 → 本地服务健康 → 模型/工作流名称 → 权限与额度 → 页面错误 |

日志可能包含私人聊天、路径和票据。提 Issue 前仅保留版本、脱敏错误码与复现步骤，不上传 `config.json`、`qq.json`、`runtime.json`、SQLite、登录目录或整个游戏。
