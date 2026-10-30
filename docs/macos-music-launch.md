# 原游戏“放点音乐”网易云启动修复

目标是原游戏互动菜单中的“放点音乐 → 外部播放器”，并非 Mod 新增的音乐菜单。

## 问题与定位

本机安装了 `/Applications/NeteaseMusic.app`，bundle ID 为 `com.netease.163music`。系统使用 `/usr/bin/open -b com.netease.163music` 可以打开应用；原游戏则报告 `[ExtPlayer] mac 唤起失败，找不到 cloudmusic（多半未安装）`。

仅修正 `PlayerDef.MacAppNames` 不足以解决问题：原游戏的 IL2CPP 启动例程即使收到正确路径仍返回失败，不能把错误提示等同于应用确实未安装。原始例程吞掉了内部异常，具体底层原因尚未取得直接证据。

实机日志确认按钮经过 `CollectButtons → OnButtonClicked → _customSelectCallback`，音乐菜单的回调是 `<ShowMusicMenu>b__111_0`。该回调的索引 1 进入 `OpenExternalPlayerEntry → OpenExternalPlayerWithReaction`，所以直接查找按钮上的同名启动监听无法接管它。原生程序集静态分析还确认了首次选择播放器的回调及成功、失败台词。

## 修复方式

- 保留原游戏菜单、选项标签和内置音乐分支。只适配音乐选项回调与播放器选择回调中的网易云启动分支；其他播放器仍调用原回调。
- 将网易云的应用候选更正为 `.app` 包名。`PlayerDef` 是 IL2CPP 值类型，修改后按索引写回原数组。
- 启动时调用现有 macOS 启动器，通过 bundle ID 激活网易云；启动结果决定使用原游戏的成功或失败台词及表情。
- 首次选择播放器时保留原游戏的默认播放器保存逻辑，避免丢失选择。
- 当前 macOS IL2CPP 运行库的 `ClassInjector` 不可用；通过克隆游戏原生委托并绑定固定、受托管根引用保护的 Cdecl 回调完成适配，不启用全局 Harmony，不改写原生机器码。
- 启动时使用无界面行为的委托自检，确认原生委托能够进入回调后才安装菜单适配。

只更新 `BepInEx/plugins/LilithMod.dll` 并重启正式游戏。未改应用包、原存档、凭据、QQ 配置、常驻 Companion 或 `liblilith_macos.dylib`。旧 DLL 保留于 `~/Library/Application Support/LilithModBackups/`，可停止游戏后回退。

## 验证边界

插件构建零错误、零警告；Mac 播放器专项测试通过；正式游戏已记录回调自检通过并正常加载。主人已确认原游戏菜单成功打开网易云且台词正常；同一轮日志记录 `Built-in 放点音乐 selected: player=cloudmusic; opened=True; reactionLine=2051337; route=original-option-to-macos-bundle`，与点击结果相互印证。外部 `open` 命令成功不作为原生菜单验收的替代。

本次范围为应用唤起和对应台词。原版 macOS 播放控制兼容性并未据此宣称全面验证；现有 macOS 播放观察与音乐动作同步模块继续工作。
