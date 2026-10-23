# 扩展服务契约 · macOS dev6

当前 DSH 已通过本机 SDK 真实联调，ComfyUI 已通过本机工作流真实联调。所有 `/v1/` 路由沿用 Companion 本次运行的 Bearer token，仅在本机监听；配置页 token 经 URL fragment 传入后移除。

## DSH

主要接入使用 `dsh --profile sdk` 的 stdio JSON-RPC，独立 home、profile 和任务目录。默认自动协作：莉莉丝理解并派发任务，DSH 执行，再由莉莉丝交付结果。任务不替换普通聊天，也不接管桌面端会话。

当前任务接口：

- `GET /v1/tasks?session_id=desktop-pet`：列表。
- `GET /v1/tasks/<id>`：状态、结果和实际产物。
- `POST /v1/tasks/<id>/stop`：停止独占任务进程。
- `GET /v1/tasks/<id>/files/<name>`：带鉴权的产物下载。
- 原聊天消息接口增加 `task_mode: auto|chat|dsh` 与可选 `task_id`。

凭据来自 Mod 的 `provider.api_key`，独立于桌面 DSH 的凭据库；DSH Messages 地址单独配置，默认使用 DeepSeek 官方 Messages 根地址，不复用普通聊天的 Chat Completions 根地址。范围与完整字段见 [DSH.md](DSH.md)，设计规划见 [DSH 接入设计](DSH接入设计-20261022.md)。

旧 `POST /v1/integrations/dsh/chat` HTTP 桥保留兼容，依赖显式 `endpoint`，请求包含 `protocol_version: 1`、`request_id`、`messages`、`context`、`stream: false`；只支持 system/user/assistant 文本消息，推荐响应 `{ "text": "回复内容" }`。该旧端点不等同于当前 SDK 任务接口，不用于自动任务执行。

## ComfyUI

当前画室与聊天表情接口为 `/v1/art/profile`、`/v1/art/jobs`、`/v1/art/jobs/<id>` 及带鉴权的图像路由。固定工作流、角色规则、排队和表情配额见 [COMFYUI.md](COMFYUI.md)。本机实际工作流为 Z-Image Turbo 配合 Qwen3 4B 文本编码器。

旧 `/v1/integrations/comfy/jobs` 工作流适配接口继续保留，但普通聊天与小画室使用带角色和次数约束的画室服务。当前 DSH 不直接编排 ComfyUI。
