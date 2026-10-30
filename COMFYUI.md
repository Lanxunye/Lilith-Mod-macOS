# 本地绘图设置

本功能是可选项。基础聊天不需要 ComfyUI。模型、工作流和本地服务由自己的电脑运行，不随基础安装自动下载。

1. 安装 [ComfyUI](https://github.com/Comfy-Org/ComfyUI)。
2. 按 [模型下载指南](docs/models.md) 准备 Z-Image Turbo、Qwen3 4B 文本编码器和 VAE，放到对应目录。默认工作流不需要 Qwen 20B。
3. 在 ComfyUI 自己的界面载入随包 `companion/workflows/lilith-zimage-local.json`，确认它可以出图。
4. 在莉莉丝设置中填写本机 ComfyUI 地址（通常是 `http://127.0.0.1:8188`），导入工作流并检查连接。
5. 在 QQ 设置页配置并测试视觉服务，用于成图检查；随后打开小画室测试，再按需要开启聊天或 QQ 绘图。

绘图会先理解请求、整理场景和画面设计，再提交本机工作流。角色与风格规则由 Mod 提供；输出仍受模型能力影响，不能保证每次都完全符合要求。

QQ 私聊需要明确 @ 请求，默认不设每日次数上限；群聊需要白名单和明确 @ 请求，每群每天最多 10 次提交。表情与普通绘图是不同开关，已有表情按上下文和发送频率选择。

[日常使用](docs/usage.md#绘图与表情) · [群聊绘图](docs/qq-group-art.md) · [模型下载](docs/models.md)
