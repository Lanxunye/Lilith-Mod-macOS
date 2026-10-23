# macOS 封包前自查 · 2026-10-23

版本：`0.3.4-macos.dev7.2`。封包脚本只生成本地源码审查包、插件预览包及文件哈希，不执行 Git 推送、创建仓库或上传 Release。另按用户要求，在本机 Steam 正式游戏旁以可回退方式安装并验证了 Mod；游戏 .app 保持原样，该本机部署不属于公开 ZIP 的内容。

## 已检查及修正

- dev6.1：正式游戏托盘会动态注册 `LilithMenuTarget`，旧 Mod dylib 抢占同名类，导致游戏把空 Class 传给 `objc_registerClassPair` 后崩溃。LLDB 已捕获类名、空参数及游戏调用栈；Mod 原生类统一改为独立命名空间，键盘窗口子类注册补充失败保护。原生回归中旧库必然复现同名冲突，新库可与游戏类共存。正式游戏现已成功注册托盘和 Mod 菜单，聊天服务返回 200；这不代替长期稳定性验收。
- 正式版启动器补充异常信号退出码和所属进程组清理，防止原生崩溃被当成正常退出或遗留占用端口的后台服务。提供有备份的本机安装与停用脚本；公开插件 ZIP 仍不含游戏、加载器二进制和运行时。

- 游戏内聊天自动派发 → 本机 DSH SDK 实际读写 → 莉莉丝交付已通过；重启续办、停止独立进程、文件下载及单次交付已验证。
- 游戏“停止”使用独立鉴权控制请求，不被普通聊天的忙碌状态挡住。
- 构建脚本支持外部游戏目录和 SDK 路径、只构建模式；新增带原始 DLL 哈希检查的 loader 重建脚本。游戏/生成 interop 不进公开包。
- 自查发现原生库原先默认要求编译主机 macOS 27，安装标识还包含本机路径及 `.new` 后缀；已显式改为 macOS 11.0 编译目标和 `@rpath` 标识。旧系统仍需实机验证。
- 关闭继承的 Windows 上游更新目标；Mac 更新未开放，避免误下载安装 Windows 资产。
- 整理 Mac 主说明、Windows 上游归档、依赖清单、空密钥 Mac 配置样例与不发布资产的 CI 配置。
- Companion 没有第三方 npm 依赖，已增加 lockfile。Node 24.22.1 从官方分发下载并核对 SHA-256，仅在本地隔离目录测试，不替换系统 Node。
- 封包使用允许清单；扫描实际配置中的 Key/运行 token 精确值、密钥模式、本机用户路径及游戏/私人文件名；不把实际凭据写入报告。

## 本地验证范围

25 组 Node 与 5 个 C# 程序通过；Windows 音乐注册表 fixture 按既有平台限制跳过。Mod 与 loader 重建均 0 警告、0 错误。精确 be.790 原始 loader 经公开重建脚本产生的修改后 DLL 与当前已验证副本逐字节一致。

另从候选源码树独立重建和回归：发现封包清单漏了 lore-candidates 测试所需的脚本，已补齐后重新通过。公开包包含参数化的开发启动器与工作流转换脚本，不依赖私有启动快捷方式。

测试覆盖：普通聊天不误派发、手动覆盖、队列、去重、排队/执行中补充、续办、停止、重置、文件范围、符号链接、禁止覆盖原文件、JSON-RPC UTF-8 分帧、超时和子进程退出。

GitHub CI 配置为 Ubuntu/macOS 的可移植测试，不请求游戏程序集、不执行发布；远端 CI 尚未运行。当前已实际验证的操作系统为 macOS 27.0.1、Apple Silicon + Rosetta；不宣称 Intel、较低 macOS 或多屏已验收。

## 依赖与待处理项

| 项目 | 结论 |
| --- | --- |
| BepInEx be.790 ZIP | 已固定 URL、原始归档 SHA-256 和原 loader SHA-256；预览不携带其二进制 |
| 加载器 CoreCLR 6.0.7 x64 | .NET 6 已于 2024-11-12 结束支持，正式版本需评估兼容的受支持运行时方案 |
| Node | 24.18.0 原实测；24.22.1 新版隔离回归，未修改全局安装 |
| SDK 8.0.426 / clang | 本机构建通过；SDK 为开发依赖，不捆绑给玩家 |
| DSH 0.2.1-rc.2 | 可选；SDK 联调通过，不打包桌面应用、内部插件或凭据 |
| ComfyUI / 模型 | 可选；不打包模型和本机缓存，用户准备自己的工作流 |
| 许可证 | 保留 MIT/素材声明，附上游 LGPL 文本及补丁重建材料；预览不包含修改后 LGPL DLL |
| 干净机器安装与卸载 | 尚未完成；本次插件预览不是一键安装包 |
| 长时运行、Intel、低版本 macOS、多屏 | 尚未完成正式发布验收 |
| GitHub 仓库 | 源码目标 Lanxunye/Lilith-Mod-macOS；源码公开，尚不发布一键游戏安装包 |

因此可以审查源码与开发预览产物，**不能将其标记为普通玩家可直接安装的正式稳定版**。真实模型、GPU 和游戏运行结果是功能验证，不代替依赖支持期、安装和跨设备验收。

来源：[Microsoft .NET 6 支持结束公告](https://devblogs.microsoft.com/dotnet/dotnet-6-end-of-support/)、[BepInEx 固定版本许可证](https://github.com/BepInEx/BepInEx/blob/4e98359/LICENSE)、[Node 官方分发校验](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt)。本次未把“无 npm 依赖”等同于整个运行栈无漏洞，也未完成第三方二进制的完整 CVE 审计。

本地封包脚本：

```sh
python3 scripts/prepare-github-macos.py \
  --output /path/to/new-review-output \
  --binary-dir /path/to/compiled-plugin-directory \
  --secret-config /path/to/private/config.json \
  --secret-config /path/to/private/runtime.json
```

脚本拒绝覆写已有目录。输出 `repository/`、两个 ZIP、`audit.json` 及每个目录的 `SHA256SUMS.txt`；有命中时只生成经过脱敏的阻断报告，不生成 ZIP。


## QQ 测试版与公开源码

QQ 桥接已集成莉莉丝 WebUI，明确显示 Beta。使用指南覆盖模型配置、独立控制台、游戏构建、ComfyUI、DSH、QQ 登录和 OneBot 双向鉴权；群聊额度、说话人与文字引用的限制已写明。公开仓库只从允许清单生成，包含源码和空密钥样例，不包括本机私信草稿、个人账号、登录票据或聊天存档。
