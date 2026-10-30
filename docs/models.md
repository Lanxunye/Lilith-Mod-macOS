# 模型下载与放置目录

2026-10-30 核对。本页提供模型发布方和 ComfyUI 维护方的来源；模型遵守各自许可证，不随本项目 ZIP 分发。只用 DSH 云端对话 / QQ 文字聊天时，不需要下载本页绘图或语音权重。

## 绘图：与包内工作流一一对应的三个文件

工作流为 [`companion/workflows/lilith-zimage-local.json`](../companion/workflows/lilith-zimage-local.json)。绘图主模型是 **Z-Image Turbo**，Qwen3 4B 在这里担任文本编码器；不是 Qwen-Image 20B，也不需要下载 Qwen 20B。以下是 [ComfyUI 官方 Z-Image 教程](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) 所用的分体模型格式。

| 用途 / 工作流节点 | 文件与下载页 | 直接下载 | 放置目录（相对 ComfyUI） | 下载大小 |
| --- | --- | --- | --- | --- |
| 绘图主模型 / UNETLoader 66 | [z_image_turbo_bf16.safetensors](https://huggingface.co/Comfy-Org/Z-Image-Turbo/blob/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors) | [下载文件](https://huggingface.co/Comfy-Org/Z-Image-Turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors?download=true) | `models/diffusion_models/` | 12.31 GB |
| 文本编码器 / CLIPLoader 62 | [qwen_3_4b.safetensors](https://huggingface.co/Comfy-Org/Z-Image-Turbo/blob/main/split_files/text_encoders/qwen_3_4b.safetensors) | [下载文件](https://huggingface.co/Comfy-Org/Z-Image-Turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors?download=true) | `models/text_encoders/` | 8.04 GB |
| VAE / VAELoader 63 | [ae.safetensors](https://huggingface.co/Comfy-Org/Z-Image-Turbo/blob/main/split_files/vae/ae.safetensors) | [下载文件](https://huggingface.co/Comfy-Org/Z-Image-Turbo/resolve/main/split_files/vae/ae.safetensors?download=true) | `models/vae/` | 335 MB |

以上三个权重合计约 **20.69 GB（十进制）**。还需为环境、输出和运行缓存留出空间；下载文件大小不等于推理需要的内存。不要整库下载其他精度、LoRA 或重复模型，也不要将 HTML 错误页改名为 `.safetensors`。

最终目录应为：

```text
ComfyUI/models/diffusion_models/z_image_turbo_bf16.safetensors
ComfyUI/models/text_encoders/qwen_3_4b.safetensors
ComfyUI/models/vae/ae.safetensors
```

保持文件名与工作流一致。放好后重启/刷新 ComfyUI，在节点下拉框中确认文件可见，再导入 API 工作流并在莉莉丝小画室测试。更换量化版或重命名文件需同步修改工作流和核验兼容性；不能只替换名字后假设已适配。

### 可复现下载与校验

[`packaging/models.json`](../packaging/models.json) 保存了本次核对的仓库提交、固定版本下载 URL、字节数及 SHA-256。上表的 `main` 链接方便打开；希望避免远端更新时，使用该清单里的固定提交 URL。

下载完成后可用 `shasum -a 256 <文件路径>` 与清单中的 `sha256` 逐项比较；若大小或哈希不符，先重新下载或核对远端版本，不要加载不明文件。Hugging Face 可能需要网络访问或账号权限；本项目不提供未知镜像，也不代替用户接受模型条款。

## 本地语音：Qwen3-TTS 0.6B

| 来源 | 下载入口 | 适用范围 |
| --- | --- | --- |
| Qwen 官方原始模型 | [Qwen3-TTS-12Hz-0.6B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) · [文件列表](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base/tree/main) | 原始模型格式及官方使用说明；不能把 CUDA 示例直接当作 Mac MLX 部署命令 |
| MLX Community 转换版 | [Qwen3-TTS-12Hz-0.6B-Base-bf16](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) · [文件列表](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16/tree/main) | 面向 MLX / Apple Silicon 的社区转换，非 Qwen 官方原始权重仓库；按所选语音引擎的说明使用 |

语音模型应下载完整仓库，保留模型配置、分片索引与 tokenizer 等配套文件，不要只取单个权重文件。已安装 Hugging Face CLI 的用户可按模型页提供的命令下载，例如：

```sh
hf download mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16 --local-dir ./models/Qwen3-TTS-12Hz-0.6B-Base-bf16
```

**基础模型不包含维护者本机的莉莉丝 LoRA、参考音频或定制服务端。** 本项目当前的语音适配器还校验本地服务接口与适配器哈希；仅下载一个公开基座，不能直接复现维护者声音或保证接口立刻可用。需准备自己有权使用的声音材料与兼容语音服务，再按 [朗读与 QQ 语音说明](chat-speech.md) 配置。不要将语音模型放入 ComfyUI 的绘图编码器目录。

## 对话、看图与搜索

- **文字对话与搜索**：使用本机 DSH 已配置的模型服务，不要求下载 DeepSeek 权重。模型/服务的认证在 DSH 配置，不能把语音或绘图权重当作聊天模型。参见 [DSH 接入](../DSH.md)。
- **阿里云看图**：当前走用户单独配置的视觉服务 API，无需本地下载视觉权重；凭据只填本机控制台。
- **角色 LoRA**：发行包不附未经明确授权的角色训练权重或私有声音材料；不能把包内角色提示词文件当作模型文件。
