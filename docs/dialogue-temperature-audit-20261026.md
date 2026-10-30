# 对话温度与冷淡语气检查报告

检查日期：2026-10-26（北京时间）。本轮只读检查正式配置、源码、部署前备份和已安装 DSH 程序，未修改对话参数、人格、情绪、记忆或服务状态，未发送 QQ 测试消息。

## 结论与确定程度

**没有发现本轮朗读／QQ 语音更新降低文字温度或改写人格提示词的证据。** 对照本轮部署前备份，`server.js` 的改动是朗读实例、语音接口、停止播放和 QQ 合成器注入；`qq-capabilities.js` 的改动是合成器接入与状态显示。文字生成参数与提示词未改。正式安装目录与工作区的 9 个关键对话、风格和状态模块文件一致。

**现有提示词的收敛要求、长度预算和情绪注入机制更值得优先调整。** 这是代码与配置支持的原因候选，尚未做隔离对照生成，不能把主观冷淡直接归因于某一条规则。

## 1. 实际文字采样路径

| 检查项 | 结果 |
| --- | --- |
| 旧 Companion provider.temperature | `0.75`，仍然存在 |
| 正式文字对话引擎 | DSH 原生 SDK，桌面、主人私聊与群聊共用 |
| DSH 模型 | `deepseek-official / deepseek-flash` |
| reasoningEffort | `high`，它是推理设置，不是温度 |
| Companion → DSH initialize | 传模型、推理设置、maxTokens；未传 temperature 或 top_p |
| 已安装 DSH 默认模型配置 | 只保存 provider、model、reasoningEffort |
| 已安装 DeepSeek 适配器 | 仅在 options.temperature 存在时才把 temperature 写入请求 |

因此，控制台旧 provider 的 `0.75` **不能视为当前 DSH 对话已生效的温度**，单改这个值不能据此预期正式私聊／群聊改变。本次未捕获实际远端请求，也未读取服务端实现，无法给出远端最终采用的数值，更不能把它写成 0、0.75 或 1。

位置：`companion/src/server.js:82`、`companion/src/dsh-runtime.js:60`、`companion/src/dsh-profile.js:136`。本机 DSH 独立模型配置位于用户数据目录的 `dsh-lilith/home/profiles/lilith/cordis.patch.yml`。

Qwen3-TTS 的音频采样温度属于已经生成文字之后的音频合成，不控制聊天模型措辞。

## 2. 会压缩表达的提示词

### 所有对话的表达补充

`character/lilith-expression.json`，版本 `2026.10.25-expression.1`，在本轮语音部署之前已经上线。

- 第 7 行：“意思说到就可以停”，并要求不额外补一串问题。
- 第 9 行：“无需每句话都表演傲娇”。
- 第 13 行：“平静交谈也自然成立，不必每次追加关系宣言”。
- 第 20 行起示例整体较短，问候与接梗尤其简短。

这些规则各自有合理目的，但叠加后可能让模型偏向短、平、少情绪词的表达。原基础人格仍写有温柔、好奇、调皮和主人伴侣关系，没有被删成冷淡人设。

### 群聊额外收敛

`character/qq-group-style.json:6` 明确建议闲聊“一两句、约 10 至 45 字”；第 7 行进一步限制昵称、语气词、括号动作和爱意；第 14 行要求像群里实际会发的一句话。这些要求比单纯温度设置更直接影响群聊的表达长度和热度。

### 全局长度预算

当前 `config.json` 的 `conversation.reply_max_chars` 为 **100**。`companion/src/server.js:1195` 要求提前规划短回复，并在此总长度内自然结束；分条也共用该长度预算。这不是本轮语音更新新加的限制，但会压缩回应、情绪和后续展开的空间。

## 3. 情绪插件状态与注入条件

正式情绪插件 `0.7.0-lilith.5` 已加载，自动判断开启，未报告失败。检查时基础心情 **95/100**，当天互动加成 **+4**，合计 **99/100**；没有低心情或负面维度占主导的迹象。数值是检查时的快照，会继续变化。

当前配置：`injectMode=event`、`injectConfidence=60`、`injectPerDay=6`、`sigMood=3`、`sigDim=5`。情绪记录并不等于每轮都把情绪描述注入模型：小变化、已注入的版本、低置信度或当日次数达到上限会跳过。本次服务运行的计数为判断 8 次、情绪事件注入 0 次，不能把它解读为当天从未注入。

还要区分两个入口：`lilith-pet-interactions` 会在有效主人来源的轮次提供基础心情和互动状态；`feiyu-mood` 的详细情绪事件才受上述条件限制。因此“事件注入 0 次”不等于模型完全拿不到心情状态。

群聊不使用主人私聊的签名情绪轮次；它有独立交流状态，不能期待提高主人情绪值就自动改变所有群友对话。

实现位置：`dsh-feiyu-mood-lilith/index.mjs:98`、`:104`；本机设置位于 `~/Library/Application Support/LilithAI/dsh-lilith/home/feiyu-mood/config.json`。

## 4. QQ 独立交流状态

当前 `mind_mode=active`，会把衍生的交流状态放进私聊和群聊的本轮上下文。检查时绑定主人的社交熟悉度标签为 **familiar**，而非 **close**；主人没有处于少打扰／回避期限。

此标签源于交流计数和亲近度，不是原作的伴侣关系定义。代码明确要求衍生状态不得替换人设，不过同时出现“熟人”状态和“已确定伴侣”描述，可能形成表达上的干扰。最近 20 条审计标签为 new 8 条、familiar 12 条，没有 reserved；这不足以支持“代码把所有人设成回避状态”的判断。

位置：`companion/src/qq-mind.js:39`、`:73`、`:92`，注入位置 `companion/src/server.js:1849`。

## 建议调整顺序（未执行）

1. 先调整 `character/lilith-expression.json` 的正向情绪表达与示例，避免只有“不要”和短回应示例。
2. 单独检查 `character/qq-group-style.json` 的 10 至 45 字偏好与全局 100 字预算，按需要放宽，不把字数等同于热情。
3. 核对情绪插件的事件注入模式、频率与实际提示文本；不要只提高心情数值。
4. 将 QQ 的社交熟悉度标签与绑定主人的既定关系区分清楚，再观察表达。
5. 若仍需调整文字采样，须在 DSH 真正支持的调用层传递并验证，不能仅修改旧 Companion provider.temperature。

修改工作区提示词后，仍需同步到正式游戏的 `BepInEx/plugins/character/` 才会生效；情绪插件使用其独立安装包内的风格副本。源码文件和正式副本当前一致，本轮未替主人改写它们。

## 证据范围

- 本轮语音部署前备份：`~/Library/Application Support/LilithAI/deploy-backups/chat-speech-2026-10-26T05-48-21-555Z`。
- DSH 仅定点提取默认模型与 DeepSeek 适配器两个包；REA 静态分析依据：`ev_8a71957d2247d95ced19da427e7ecf4110cce0acae323a56900750fa89fbbbce`，摘要视图：`ev_47850267b9cf3aa4921aae90679489861a4d151b66f58cb7dd87db263051044f`。静态分析不代表已捕获真实网络请求，动态覆盖仍有边界。
- 未执行新模型对话、未重置记忆或关系、未重启正式服务；没有用测试输入影响真实聊天历史。
