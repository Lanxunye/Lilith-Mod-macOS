# 刷 B站 · 莉莉丝只读 SDK 适配

基于 Yuuyuko-uu/dsh-bili-subagent 0.8.7，固定提交见 UPSTREAM.json。保留上游与内置 bilibili-mcp 的 MIT 署名。未加载上游 index.js、社交工具、原定时器或桌面设置依赖。

插件在莉莉丝独立 DSH profile 中提供有认证的回环读取接口，不向聊天模型注册工具。Python 环境与 B站登录凭据位于 `$DSH_HOME/bili-duty/`；凭据只在账号接口进程中使用，不返回 Companion 或进入模型资料。只读取搜索、视频简介、首分P字幕与热门评论；没有视频画面及音频理解。

Companion 用独立的原生 DSH 阅读进程安排选题、挑选和形成见闻感想。使用原生认证引用，不另填模型 API Key。摄影艺术是初始探索倾向，兴趣可以演变；资料、自己的兴趣与主人记忆分开。分析与分享仅限主人 QQ 私聊，群聊与桌面不召回。主动分享沿用既有搭话门槛。

依赖：Python 3.10+，requirements.txt；本机安装版本记录于 requirements.lock.txt。二维码登录、状态、开关、手动阅读与记录查看位于 `/ui/bili`；用 `node scripts/open-console.cjs --tab=bili` 打开认证页面。

部署需配套宿主、只读插件 readiness、独立阅读守卫及隔离测试。执行层没有评论、动态、私信、点赞、投币、收藏工具；不能用 force 参数开放它们。
