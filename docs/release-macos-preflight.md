# macOS dev16 发布检查

本页面向维护者。玩家请从[安装教程](deployment-macos.md)开始。

## 发布内容

- 源码包与一键安装包各一份，附 SHA-256 清单。
- 安装包只含自有插件、原生桥、补丁工具和允许公开的资源；在线下载固定版本依赖，在玩家本机生成兼容加载器。
- 不附游戏、游戏生成的互操作程序集、修改后的上游加载器、DSH、模型、凭据、私人记录及登录缓存。
- 莉莉丝默认纯聊天：全部操作工具和 REA 关闭，群聊历史最多 5 条；原有正式聊天档案和人设保留。
- 只支持普通桌面跟随，全屏空间覆盖保持关闭。

## 本地检查命令

```sh
bash scripts/test-macos.sh
bash scripts/test-native-macos.sh /path/to/liblilith_macos.dylib
```

可移植测试覆盖 92 组 Companion 测试命令、7 个 C# 程序，以及校验、版本隔离、加载器安装回退、后台忙碌拒绝重启等安装器测试。原生回归检查类名隔离和普通桌面策略。实际测试结果以对应发布记录与 CI 为准，模拟测试不等于实机 QQ 收发。

构建需要开发者自行准备游戏和 .NET SDK 8；玩家安装不需要 SDK。先按[加载器说明](../loader/README.md)构建自己的安装工具，再生成发布包：

```sh
python3 scripts/build-public-release.py \
  --output /path/to/NEW-output \
  --binary-dir /path/to/compiled-plugin-directory \
  --loader-dir /path/to/compiled-loader-tools \
  --secret-config /path/to/private/config.json \
  --secret-config /path/to/private/runtime.json
```

输出目录必须不存在。构建器只从允许清单复制，排除用户数据和本机证据；扫描实际配置里的凭据精确值、密钥模式及本机用户路径。检查 ZIP CRC、内部文件哈希和外部 ZIP 哈希。扫描通过不能替代代码和许可审查。

发布前还应验证依赖下载、本机补丁生成、干净目录安装与重复升级、相对文档链接、下载链接和无凭据归档。GitHub CI 运行 Ubuntu/macOS 可移植测试，不构建依赖游戏程序集的插件，也不自动上传发布物。

## 适用范围与待验证项

主要实机环境为 Apple Silicon、Rosetta 和 Steam Mac 游戏 1.1.0。Intel、较早 macOS、全新机器从安装到首次进入游戏及长期运行仍需更多验收；不要将隔离副本检查写成完整新机验收。

BepInEx be.790 内含的 CoreCLR 6.0.7 已结束支持，兼容性仍是遗留限制；不能将独立 .NET 8 安装补丁运行时当成游戏加载器运行时已升级。未完成整个第三方运行栈的完整 CVE 审计。

许可与固定版本见[第三方声明](../THIRD-PARTY-NOTICES.md)和[依赖清单](../dependencies-macos.json)。已有版权和素材声明须完整保留。
