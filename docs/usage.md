# 使用指南（macOS 开发预览）

本项目基于 [Dreamer / cza2019 的原 Mod](https://github.com/cza2019/The-NOexistenceN-of-Lilith-Mod)。当前分发源码，游戏安装仍面向开发者；QQ 桥接为测试版。以下示例不包含任何真实账号、密钥或个人目录。

## 1. 启动莉莉丝 WebUI

安装 Node.js 24，克隆仓库后运行：

```sh
npm ci --ignore-scripts --prefix companion
node scripts/open-console.cjs
```

启动器会启动或复用本机常驻 Companion，并用本机认证打开控制台。默认数据目录是 `~/Library/Application Support/LilithAI/`，默认服务端口 6186，仅监听本机。页面包含聊天、绘图、Mod 设置、记忆、扩展服务和 **QQ 桥接 · 测试版**，不需要把管理端口暴露到公网。

已有旧版游戏持有服务时，常驻启动器会提示先退出游戏，不自动关闭游戏。首次尝试可使用单独的数据目录；同一数据目录在启动和打开页面时必须一致：

```sh
export LILITH_AI_DATA_DIR="$HOME/Library/Application Support/LilithAI-preview"
node scripts/open-console.cjs --tab=settings
```

如果该目录使用默认端口且已有其他服务占用，先退出对应服务或在该目录 `config.json` 中选择其他 `listen_port`；不要让两个 Companion 绑定同一端口。

```sh
node scripts/companion-service.cjs status
node scripts/companion-service.cjs stop
# 再次启动并认证打开；也可选 --tab=art 或 --tab=qq
node scripts/open-console.cjs --tab=chat
```

控制台认证信息来自私有 `runtime.json`。不要把带 `#token=` 的完整地址发给别人；页面打开后会清除地址中的 token。页面报未授权时重新运行打开脚本。独立常驻服务不会随游戏退出而停止；电脑休眠、QQ 或协议端退出后仍需检查连接。

## 2. 配置对话模型

在“Mod 设置 → 对话服务”填写服务商、API 基础地址、模型名称、API 密钥，点击 **保存设置**。先保留模拟回复以验证页面；需要真实模型时关闭模拟回复，再保存并发送一句文字。API 费用和可用性取决于服务商。Key 不会从 DeepSeek/Hermes 桌面软件自动同步到这里。

聊天、记忆、摘要、绘图和任务记录保存在本机。记忆可在控制台查看和编辑；摘要是有原文证据的摘录，不能保证无限记忆。不要将个人数据目录纳入 Git 或提供给其他人。

## 3. 加载到官方 Mac 游戏

需要 Steam 合法安装的《不存在的莉莉丝》Mac 版，目前对应游戏 1.1.0 / Unity 2021.3.45f2 / x86_64；Apple Silicon 需要 Rosetta 2。另需固定版本 BepInEx、加载器兼容补丁、CLR、自己的游戏 interop、Node 24、.NET SDK 8 和 Xcode Command Line Tools。

1. 先阅读 [精确依赖与构建步骤](macos-preview.md) 和 [loader 重建说明](../loader/README.md)。在游戏副本中准备加载器和 interop，不上传游戏文件。
2. 设置 `LILITH_GAME_DIR`（包含 `BepInEx/` 的目录）、`LILITH_DOTNET_PATH` 与 `LILITH_NODE_PATH`。用 `LILITH_BUILD_ONLY=1 bash scripts/build-macos.sh` 仅生成构建文件；不设置该变量会把插件复制到指定的隔离游戏目录。
3. 按预览文档用 `scripts/launch-macos.py` 启动已准备好的隔离副本，检查聊天、中文输入和设置入口。F8 / Fn+F8 打开聊天。不要同时启动原版和 Mod 的多个游戏实例。
4. `scripts/install-steam-macos.py --help` 是开发者使用的正式目录 sidecar 安装工具，需要自备已验证的运行时目录、插件载荷、Node 目录和初始化数据目录。它不是自动下载依赖的安装器，遇到已有安装会拒绝覆盖。建议先通过副本测试，再按脚本要求备份、退出所有游戏实例后安装。

成功通过该安装工具部署后，游戏目录会出现 `启动莉莉丝Mod.command`、`停用莉莉丝Mod.command`、`莉莉丝常驻服务.command`。先启动 Steam，再通过 Mod 启动入口运行；直接启动原 `.app` 或未配置启动选项的 Steam 会运行原版。停用工具移动本次附加文件到备份，不删除游戏和用户数据；如果手动设置了 Steam 启动选项，需要一并清空。

尚无经干净机器验收的一键 Mac 安装包，不要下载 Windows 的 `winhttp.dll` 包覆盖 Mac 游戏。QQ ↔ 游戏跨窗口显示仍须更新相应插件并实机验证，不能把 WebUI 收发通过视为所有游戏端同步都已通过。

## 4. 本地绘图与 DSH（可选）

- **ComfyUI**：自行安装并启动 ComfyUI 和模型。在“扩展服务”配置本机地址、工作流与输出目录，按 [绘图说明](../COMFYUI.md) 导入 API 工作流。可以在“绘图与表情包”手动生成，也可按配置开启对话自主绘图。工作流内模型必须与本机实际模型名称匹配；仓库不分发模型。聊天表情最多每连续三轮一次。
- **DSH**：自行安装兼容的 DeepSeek Harness，在“扩展服务”配置 SDK 启动命令、模型与允许读取的路径，见 [DSH 使用说明](../DSH.md)。可选择仅聊天、自动协作或本条交给 DSH，并在任务卡中停止。DSH 不自动拥有全部文件权限；当前工具范围以实现和用户设置为准。

这些能力属于桌面/WebUI 对话路径，QQ 测试版不执行 DSH，也不自主绘图。QQ 发送 ComfyUI 图片尚未实现。

## QQ 桥接（测试版）

### 前置条件

准备自己的 QQ 小号和主人账号。普通小号使用第三方协议存在封禁风险，不能承诺免封；验证码和安全验证由用户本人处理。自行按 [NapCat 官方项目](https://github.com/NapNeko/NapCatQQ) 的说明部署协议端，当前本机验证组合见 [依赖清单](../dependencies-macos.json)。本仓库不附 QQ、NapCat、登录数据、密码、扫码票据或自动扫码程序。

### 登录与连接

1. 启动并登录协议端。NapCat 的管理页登录 Token 来自自己的 NapCat 配置或启动日志，**不是 DeepSeek Key，也不是下面的 OneBot Token**。QQ 登录扫码由用户确认。
2. 在 NapCat 配置 OneBot **HTTP Server**，仅监听 `127.0.0.1`，例如端口 `3000`，启用鉴权并设置随机的 API Token。
3. 设置 OneBot **HTTP Client** 事件上报为 `http://127.0.0.1:6186/onebot/events`（Companion 若改端口也需同步），格式选 **array**。HTTP Client 的 `token` 用于 HMAC-SHA1 事件签名，需与莉莉丝页面的事件 Secret 完全一致。
4. 运行 `node scripts/open-console.cjs --tab=qq`，进入莉莉丝控制台的 **QQ 桥接 · 测试版**。填写小号 QQ、主人 QQ、OneBot HTTP API 地址，例如 `http://127.0.0.1:3000`、对应 API Token，以及事件 Secret。两个 Secret 建议使用不同的随机值，均不要公开。
5. 勾选启用，先保留“暂停收发”，保存配置，点击 **检查小号连接**。检查只验证实际登录账号与配置的小号一致，不会发送消息。完成后取消暂停并保存。
6. 用已互为好友的主人 QQ 发一句文字私聊，检查实际回复及页面交付状态。除绑定主人外的私聊、陌生人和自身回声会忽略。

### 群聊

先由用户自行将小号加入目标群，在控制台开启“白名单群聊”，将允许群号填写为 JSON **字符串数组**（例如 `["100000001", "100000002"]`，仅为格式示例），保存即可。

- 必须由群消息中的明确 @ 小号开启一轮；@全体不算，单独引用也不代替 @。
- 首次回复包含在本轮额度内，最多回复 10 条；轮内会回复同群其他成员的后续文字。重复 @ 不重置当前额度，结束后需再次 @。
- 所有白名单群合计每天最多 50 条，按北京时间自然日计数，重启不清零；失败或回执不明的发送也保守计入。私聊不占这 50 条。
- 以 QQ 号区分成员、以群名片/昵称称呼；群记忆按成员记录。群聊上下文与主人私聊隔离，不向桌宠或主人私聊转发群记录。
- 支持同群一层引用的文字与作者；跨群、私聊、撤回或不可读引用不猜测。群文件、图片、表情、视频、合并转发不读取或识别，引用附件也不下载。

### 状态与排障

WebUI 可查看暂停状态、错误、消息交付回执、群聊剩余轮次和今日额度。回执未知标为 `unknown` 并暂停，不盲目重发；先在 QQ 核对是否已送达，再处理恢复。

- **连接失败**：检查 QQ/协议端已启动、API 地址端口和 API Token；确认登录小号与页面账号一致。
- **完全收不到消息**：确认未暂停，QQ 好友/群白名单匹配，NapCat HTTP Client 上报地址正确，array 格式与事件 Secret 相同。仅 API Token 正确不足以通过事件签名。
- **群里不回复**：检查是否明确 @ 小号、每轮 10 条是否已结束、当天 50 条是否耗尽；在控制台查看状态。
- **模型报 401**：检查莉莉丝“Mod 设置”的模型 Key；不是修改 NapCat Token。
- **控制台过期**：重新运行 `open-console.cjs`；不需要因此重复扫码登录 QQ。
- **反馈问题**：提交去除密钥、真实 QQ、群号和聊天内容的最小复现与版本信息。不要上传 `config.json`、`runtime.json`、`qq.json`、SQLite 或登录目录。
