# 游戏入口统一启动服务

2026-10-29：正式游戏的 `启动莉莉丝Mod.command`、工作区的 `启动正式版.command`、控制台入口以及 `莉莉丝常驻服务.command` 的默认 start 操作，接入同一服务启动流程。

启动时先连接或启动常驻 Companion，再并行检查原生 DSH、QQ 协议端与 ComfyUI。QQ 仍使用已有独立客户端及其登录缓存；DSH 使用既有认证与莉莉丝专用纯聊天配置，不向模型注册 REA 或操作工具。网易云、B站阅读和本机朗读继续由原有模块按需处理，不自动打开网易云、浏览器或另行运行阅读任务。

已通过身份/健康检查的服务直接复用。启动锁让同时点击游戏与控制台也只执行一次服务拉起。端口被其他服务占用时提示错误，不杀进程、不更改端口。已运行但未完成登录的 QQ 保留运行，提示扫码或核对 OneBot 配置。不会重置 QQ 登录、改写令牌、解除暂停、打开原来关闭的桥接或重发旧绘图。

聊天后台与依赖采用独立进程，关闭游戏不会把 QQ、ComfyUI 或常驻聊天一起关闭。没有注册系统登录项或定时重启任务；重启电脑后使用上述入口即会再次检查并拉起。辅助服务未就绪时显示状态，桌宠可继续启动；聊天后台端口冲突仍沿用游戏原有的保护，避免连接到其他服务。

## 本机配置

私有数据目录 `~/Library/Application Support/LilithAI/startup-services.json` 指定已安装的依赖。游戏内原有的 QQ/ComfyUI 总开关仍需启用；此文件仅允许自动启动，不改变收发权限。

```json
{
  "version": 1,
  "qq": { "enabled": true, "root": "/绝对路径/已有独立QQ目录" },
  "comfy": { "enabled": true, "installation": "/绝对路径/已有ComfyUI安装目录" }
}
```

QQ 目录需包含 `LilithQQ.app`、`napcat/napcat.mjs` 及既有独立用户目录；自动启动直接运行既有客户端，不调用旧的强制重启脚本。ComfyUI 安装目录需包含 `ComfyUI/main.py` 与 `ComfyUI/.venv/bin/python`，使用已配置的本机监听地址及端口，沿用已验收的禁用自定义/API节点参数。不下载依赖、模型或插件。安装目录应由本机所有者配置。

公开安装器会带上通用启动脚本，但不打包个人目录配置、登录态或第三方软件；其他机器需自行填写安装位置。

## 查看与恢复

入口会逐项显示服务状态。完整结果在私有数据目录的 `startup-status.json`；本流程新启动的 QQ/ComfyUI 日志在 `service-logs/qq-startup.log` 与 `service-logs/comfy-startup.log`。状态报告不包含认证密钥。

也可以在游戏运行期间独立检查或补启动，不开第二个游戏：

```sh
"<游戏目录>/LilithMod/runtime/node/bin/node" "<游戏目录>/LilithMod/launch-installed-macos.cjs" --check-services
"<游戏目录>/LilithMod/runtime/node/bin/node" "<游戏目录>/LilithMod/launch-installed-macos.cjs" --services-only
```

`--check-services` 只探测并保存检查结果，不启动进程；`--services-only` 补齐配置允许启动的服务。两者均不提交绘图或发送测试消息。登录过期需要主人在 QQ 客户端确认，启动器不能代替扫码。

隔离测试覆盖冷启动、并发复用、DSH 就绪、QQ 暂停/登录失效、凭据保持、端口冲突及过期启动锁恢复。正式部署仅需更新启动支持文件，无需替换游戏、停止 QQ 或改写聊天数据库。
