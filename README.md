# 《不存在的莉莉丝》Mod · macOS 移植与功能扩展

基于 **Dreamer（[@cza2019](https://github.com/cza2019)）** 的开源项目 **[The-NOexistenceN-of-Lilith-Mod](https://github.com/cza2019/The-NOexistenceN-of-Lilith-Mod)**（上游 v0.3.4）。原项目为 Steam 桌宠游戏《不存在的莉莉丝》增加 AI 对话、角色记忆、剧情检索和音乐联动。本仓库在此基础上进行 macOS 适配及扩展，属于独立衍生项目，保留上游 MIT 版权、素材声明与贡献归属，未宣称获得上游官方背书。

**当前版本：0.3.4-macos.dev7.1 · 开发预览；QQ 桥接：Beta 测试版。**

## 功能与状态

- 官方 Mac 游戏适配：透明桌宠、聊天与气泡、中文输入和候选栏定位、窗口与小画室交互。
- 共用上游莉莉丝人设，支持模型对话、角色记忆与有原文来源的上下文摘要。
- 本地 ComfyUI 绘图及聊天自主表情；连续三轮聊天最多触发一次表情。
- DeepSeek Harness（DSH）协作：莉莉丝接收任务 → 在用户允许的范围内委派 → 获取并交付结果。
- **QQ 桥接（测试版）**：在莉莉丝 WebUI 统一配置、检查连接、暂停、查看交付与额度。主人私聊、白名单群聊、成员区分和同群文字引用；@ 开启一轮，最多回复 10 条，所有群每天合计最多 50 条（北京时间）。

QQ 私聊和群聊基础收发已由用户实机验收；说话人与引用改进已部署并通过本地回归，仍需持续实测。游戏与 QQ 的跨窗口显示已有源码及编译验证，**新版插件的完整实机同步尚未验收**。QQ 不执行 DSH、不自主绘图，也不支持文件、图片、表情和视频识别；ComfyUI 图片发送到 QQ 尚待实现。第三方 QQ 协议存在账号风控风险，不承诺免封。

## 如何使用

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

首次在“Mod 设置”配置自己的模型地址、名称与 API Key，关闭模拟回复并保存。密钥只填本机页面，不上传 GitHub。QQ 还需自行安装和登录协议端，按 [QQ 接入步骤](docs/usage.md#qq-桥接测试版) 配置双方令牌。

**游戏插件当前不是解压即用安装包。** 需要合法的 Steam Mac 游戏、自备对应的 BepInEx/CLR、interop 和本地构建工具；Apple Silicon 需要 Rosetta 运行 x86_64 游戏。请按 [macOS 构建与预览边界](docs/macos-preview.md) 操作。源码不附游戏、模型、QQ、NapCat、加载器二进制或个人配置。

## 文档与开发

- [使用指南](docs/usage.md) · [macOS 依赖与构建](docs/macos-preview.md)
- [QQ 桥接 Beta：设计与实现边界](QQBOT.md)
- [绘图与聊天表情](COMFYUI.md) · [DSH 任务协作](DSH.md)
- [依赖锁定清单](dependencies-macos.json) · [发布检查](docs/release-macos-preflight.md)
- [原 Windows 文档](docs/upstream/README.windows.zh-CN.md)（不能照此安装到 Mac）

```sh
npm test --prefix companion
# 另需 .NET SDK 8；运行 5 组可移植托管测试和 Node 测试：
bash scripts/test-macos.sh
```

GitHub Actions 运行 Linux / macOS 的源码测试，不执行游戏或发布安装包。请勿在 Issue、截图、日志或 PR 中附带 API Key、QQ 登录票据、个人聊天或游戏资源。

## 已知边界与授权

目前仅在开发者的 Mac / 游戏 1.1.0 环境完成部分实机验收，干净机器安装、Intel Mac、较低 macOS、多屏和长时间运行尚需验证。原生库的 macOS 11 编译目标不代表旧系统实测通过；固定加载器仍依赖已结束支持的 .NET 6，属于正式发布待处理项。WebUI/QQ 可独立运行在 Node 24 上。

原创代码沿用 [MIT License](LICENSE)，保留 `Copyright (c) 2026 Dreamer`。游戏角色、上游赞赏码和第三方组件分别受 [素材声明](ASSET-NOTICE.md) 与 [第三方声明](THIRD-PARTY-NOTICES.md) 约束。感谢原作者开源，以及 BepInEx、DeepSeek Harness、ComfyUI、NapCat 等上游项目。
