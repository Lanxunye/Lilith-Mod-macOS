# Purge · 莉莉丝适配版（本地）

基于 [kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) 社区版 **1.6.55**，固定上游提交 `5ba6fadac493b07669ab7379c3e6bda618f286a0`。保留小杨 / YuJunZhiXue、社区维护者及 MIT 许可证署名。本分支适配标记为 `lilith-compat.1`，包名和上游版本保持不变，区别记录在 `package.json.lilithAdaptation`。

这是 Purge 本体的局部适配，继续使用原 `lib/index.js` 入口、面板、CLI、规则与技能管理、提示词注入、能力发现、诊断、备份、回滚和预设结构；不是只读诊断替身。2026-10-25 已装载到正式莉莉丝的独立 DSH profile；未修改普通 DSH 桌面 profile。

## 必要改动

- 固定人设：`lilith/character.json` 与当前 Mod 已验收角色文件字节相同，SHA256 为 `1b476084bf1a4f00dad74f8bb1a46c9110e5c94abf3d71418ba61d54ccc21d26`。默认注入及实时装配固定角色、性格、关系和确认规则。自定义提示词仍可使用，其原始文件不被改写。
- **保持关闭 Harness 助手说明**：`includeHarnessIdentity: false`，保留原有 Harness 身份清理功能。关闭通用助手自我介绍不等于删除莉莉丝人设。
- 保留 boost 和重试功能，但改为莉莉丝版本，不再要求取消确认或绕过拒绝。确认等待不能被误判为模型拒绝而重试。
- 保留原 80 条补丁定义及合并基础。26 条削弱审批、删除提醒、拒绝处理、引用数据边界或人设保护的补丁在本分支明确不适用，使用原有 `na` 状态，不伪造已应用；名单在 `lib/lilith-policy.js`。其余 54 条仍按原来的宿主适用性和锚点检查处理，不能把 54 理解为全部已应用。
- 权限仍为全盘范围，审批预设为 `lilith-full-access`，删除、写入、终端/代码、外发、付费及未知工具逐次确认。新增执行守卫，不能通过普通 `pre-execute: allow` 绕过。
- 保留上游版本查询，但禁止直接把未适配的上游包自动/手动覆盖到本分支；更新需先审查并重新生成本地适配包，避免确认守卫被升级抹掉。

## 接入要求与边界

本适配包用于莉莉丝独立 DSH profile，不应用到主人的普通 DSH profile。必须由已完成统一 DSH 接入的 Lilith Companion 提供认证本机确认端点：

- `LILITH_DSH_GUARD_URL=http://127.0.0.1:<实际端口>/v1/dsh/guard`
- `LILITH_DSH_GUARD_TOKEN`：由宿主在内存中生成，不能写进提示词或聊天。
- `LILITH_DSH_HOST_HOME` / `LILITH_DSH_PROTECTED_PATHS`：真实用户目录与敏感数据根。

守卫成功加载后提供 `lilithGuardReady`，Purge 主插件依赖此服务；完成实际钩子装载后提供 `lilithPurgeReady`，SDK 启动也依赖它。自动应用宿主补丁、自动更新和审批拒绝绕过均关闭。缺少通道、授权、会话绑定或守卫时不执行工具。由宿主核对主人输入的本次专用明文确认短语，绑定会话、参数、工作区、有效期和一次性调用；模型不能代替主人确认。群聊、内部判断会话不能调用本机工具。

普通 UTF-8 小文件读取和目录列举有可信只读工具；凭据、认证和审批资料受保护。其他工具默认再次确认。插件代码本身属于受信任代码：任意插件直接调用 Node 文件/进程接口不经过工具守卫，本方案不能宣称是恶意插件的操作系统沙箱。

正式莉莉丝 profile 已通过真实模型对话、注入探针和删除确认拦截，主人确认 QQ 私聊收到正常回复。此次仅加载独立 profile 的插件运行时，没有对正式 app.asar 应用全局宿主补丁。以上不代表上游全部宿主补丁、普通 DSH 桌面面板、所有插件及长期运行均已实机验收。

## 本地验证与打包

```sh
npm ci --ignore-scripts
npm run test:lilith
npm pack --ignore-scripts --pack-destination ../purge-builds
```

`test:lilith` 检查固定人设、关闭助手身份、保留工具面、守卫强制依赖、审批不可绕过、失败关闭、授权一次性、参数/会话/工作区篡改、取消/超时、敏感文件与别名保护。另运行上游相关回归测试；其中将依赖旧 boost / 重试话术及默认 never 审批的断言同步为新确认规则，其余回归断言保留。权限诊断同步识别全盘 / ask，避免把正确的莉莉丝设置误报为故障。原版测试仍完整保存在上游备份中。未宣称全部上游测试、Windows 或正式宿主补丁已经验收。

上游 README、AGENTS 其余部分描述原始社区版。涉及自动授权、跳过再次确认、默认注入、更新和补丁计数时，以本适配说明及用户明确要求为准。
