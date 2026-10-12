# 售后雷达 Pro — 给协作者（含 Claude）的固定规则

详细历史、每个版本做了什么、数据库现状都在 `HANDOFF.md`，开工前先读它。

## 每次重大更新都要同步更新《用户须知》和《用户使用协议》（用户要求，2026-10-12）

「重大更新」= `index.html` 里 `APP_VERSION` 的前两段变了（例如 6.35 → 6.36），或者改了收集 / 使用 / 共享哪些数据、谁能看到什么、限额、安全机制、账号规则。
修补版本（6.35.0 → 6.35.1）只修 bug、不改上述内容的，可以不改协议。

每次重大更新，在推 main 之前：

1. 按这一版的真实改动修改 `legal/用户须知.md` 和 `legal/用户使用协议.md`（只写系统真的做到的事，不要写做不到的承诺）；
2. 两份文件开头的版本行都改成：`版本：YYYY-MM-DD　生效日期：YYYY 年 M 月 D 日　对应系统版本：售后雷达 Pro X.Y`；
3. 运行 `python3 dev/build-legal.py`，把正文同步进 `index.html` 的 `<template id="legal-notice|legal-terms">`；
4. `index.html` 里 `LEGAL_VERSION` 改成同一个日期，`LEGAL_CHANGES` 换成这一版的「主要变化」（已登录的用户打开时会看到这个列表，同意后记进 `user_metadata.terms_version`）；
5. 跑 `dev/stage2.test.js`：其中「6.35 RULE」检查会在 `APP_VERSION` 升级但协议版本行没跟上时失败。

运营方：悠然网络科技工作室（江西省丰城市），联系邮箱 1012968575@qq.com。协议是草拟稿，不是法律意见。

## 其他固定做法

- 回复用户用繁体中文；网页界面用简体中文。
- 在 `ccr-cffb1017-oqykqt` 分支开发，发布 = 同时推到 `main`（GitHub Pages 自动部署）。
- 生产数据库的写操作由用户在 Supabase SQL Editor 执行；Claude 只做只读查询核对。新 SQL 放 `supabase/vX_Y_*.sql`，写清状态、核对查询、回滚方法，先在本地 PostgreSQL 模拟测试（`dev/*.pgtest.sql`）。
- 不要把 secret / service_role 密钥、数据库密码写进前端或仓库，也不要让用户把私密凭据发到聊天里。管理员权限必须在服务端校验。
- 不要删除现有功能，不要用模拟数据冒充真实数据。
- `sw.js` 里的 `CACHE` 必须等于 `'after-sales-radar-'+APP_VERSION`（每次改版本都要同步改，stage2「6.36 RULE」会检查），否则用户手机上会一直用旧缓存。
- 网页里 `onclick` 只能放校验过的 uuid 或数字，不能拼用户输入的文字。加新的外部服务要同时改 CSP。
- 测试：`dev/stage2.test.js`、`dev/gate.test.js`（Playwright）、`dev/*.handler.test.ts`（Deno）、`dev/*.pgtest.sql`（本地 PostgreSQL），跑法见 `HANDOFF.md`。
