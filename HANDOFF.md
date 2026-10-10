# 售后雷达 Pro — 交接说明（给下一位开发者 / Claude Code）

## 项目
- 仓库：`wznwzn123/doudian-after-sales-radar`，主文件 `index.html`（单文件前端，GitHub Pages 发布），线上 https://wznwzn123.github.io/doudian-after-sales-radar/
- 后端：Supabase 项目 `doudian-after-sales-radar`（id `bdnazzywqqmliqyhhtig`）
- 用户是**非开发者**，只用安卓手机浏览器（Edge），没有开发者工具。凡是需要用户自己做的事（Supabase 控制台、SQL Editor、手机测试），必须**一步一步教**，并让用户回报结果。

## 用户的硬性要求（逐字保留）
- 不要用模拟数据冒充真实数据库数据。
- 不要删除现有功能。
- 不要重建整个项目。
- 不要把密钥、数据库密码或 Supabase "service_role" 密钥写进前端，也不要要求用户把这些私密凭据直接发到聊天中。
- 不要让用户重复介绍项目背景。
- 不要盲目重复创建大量 SQL 函数。先检查实际数据库函数、参数、权限和定义，再决定最稳妥的实现方式。
- 不要谎称已经修改线上项目。
- 管理员权限必须在服务端校验，不能只在前端隐藏按钮。

## 当前线上状态
- 已推送到 main 的最新版是 **Pro 6.5**（`APP_VERSION="6.5.0"`）。
- 6.2/6.3：设备检查三条入口统一走 `enterApp()`、失败即拒绝、账号封禁、设备/账号管理页。
- 6.4：管理后台补回总览、管理员管理、店铺、资料库、举证、日志、设置、搜索；修复「用户」列 `owner_email`→`email`。
- 6.5：夜间模式、导出 JSON、工作台设置、在线用户面板、快速筛选、售后详情可编辑、拒绝协商（3 小时倒计时）、快递监控记录展示、预览、分类上传、资料库删除/取消引用、店铺改名/停用/搜索、Realtime、到期兜底处理。
- 注意：我（Claude）在会话里验证线上部署时，抓取工具返回的是旧缓存，**没能亲眼确认线上已是 6.5**；GitHub Actions 的 Pages 构建显示成功。请让用户刷新后看页面标题是否为 Pro 6.5。

## 数据库状态（都已由用户在 SQL Editor 手动执行并核对）
- 7 条限制性 RLS 策略 `account_not_banned`（见 `supabase/account_ban_enforcement.sql`，含回滚）。
- 已删除 5 个调试函数（`supabase/cleanup_debug_functions.sql`）。
- `sync_after_sales_deadline()` 已固定 `search_path`（`supabase/fix_function_search_path.sql`）。
- 定时任务 `after-sales-deadline-every-minute` 每分钟调用 `process_after_sales_deadlines()` 处理到期。
- **生产库写操作在这个会话里被权限层拒绝过多次**（执行 DO 块、apply_migration）。不要绕过；把 SQL 写好，教用户自己在 SQL Editor 执行，再用只读查询核对。只读查询（`pg_policies`、`pg_proc`、`information_schema`、`get_advisors`）可以用。
- Supabase 安全检查剩下的提示是有意的或无法处理：`admin_*` 等 SECURITY DEFINER 函数「登录用户可执行」（函数内部都校验管理员）；6 张安全表「有 RLS 无策略」（即普通用户完全不可访问）；泄露密码保护需要 Pro 套餐，免费版不可开。

## 未完成的任务
### 1) 6.6：快递单号手动录入 + 手动举证录入（补丁已写好，**尚未应用、尚未测试、尚未上线**）
- 补丁脚本：`dev/patch5_tracking_manual_evidence.py`（用法：`python3 dev/patch5_tracking_manual_evidence.py index.html`，基于 6.5 的 index.html；每处替换都断言恰好匹配一次）。
- 它做的事：
  - 用表单弹窗替换原来基于 `prompt()` 的 `tracking(id)`：单号、承运商、持续盯单开关、手动记录最近物流状态（写入 `tracking_records.last_match`）。
  - **修了一个真实 bug**：旧 `tracking()` 用 `upsert(..., {onConflict:"task_id"})`，但 `tracking_records` 表**没有 task_id 的唯一约束**（只有主键和普通索引），所以会报错且错误被忽略，**从来没写出过监控记录**。新代码改成先查再改/插（`saveTrackingRecord`）。
  - 新建售后带单号时、编辑售后改单号时，同步写 `tracking_records`。
  - 新增「录入举证内容」弹窗（举证原因、补充说明带时间追加、视频说明/链接、选择视频上传），只保存，**不自动提交**；写 `evidence_manual` 事件。
- 还要做：运行补丁 → 语法检查 → 给 `dev/stage2.test.js` 补测试（保存盯单走 insert 而不是 upsert、第二次保存走 update 不重复插入、单号校验、新建带单号写记录、手动举证不改状态）并把两个测试文件里的版本断言从 `6.5.0` 改成 `6.6.0` → 跑全部测试 → 提交推送 → 更新 README。
- 不要改数据库结构也能完成这一步。

### 2) 对接快递100（用户已选择快递100）
- 方案：Supabase **Edge Function** 在服务端调用快递100，密钥放 Supabase 的 Secrets（用户在控制台里自己填，不发给开发者、不写进前端）。前端只调用自己的 Edge Function，函数内用调用者的 JWT 校验身份和任务归属，再写 `tracking_records.last_match` 并追加事件。
- 先让用户去快递100官网看开发者接口的注册要求、收费和额度（**这些我没有查到可靠信息，别替它们下结论**），确认要用之后，再一步一步教：注册、拿到 customer/key、在 Supabase 里设置 Secrets、部署函数。
- 顺丰等快递查询通常需要收件人/寄件人手机号后四位；`tracking_records` 没有这个字段，需要时再和用户商量（加列要让用户在 SQL Editor 执行）。
- 先考虑「按需查询」（用户点按钮时查一次）；订阅推送（回调）需要公开的回调函数和签名校验，复杂度更高，后做。
- 部署 Edge Function 如果要用工具写生产库/函数，可能同样被权限层拒绝；准备好函数代码和手把手的控制台操作步骤。

## 测试
- 测试用真实的 `index.html` 在 Playwright Chromium 里跑，只把 Supabase 客户端换成桩（`dev/gate.test.js` 管登录/设备/账号/管理后台；`dev/stage2.test.js` 带一个内存假数据库，管 6.5 之后的用户端功能）。**这不是对真实数据库的测试**，不能当成线上已验证。
- 运行：`NODE_PATH=<含 playwright 的 node_modules> node dev/gate.test.js <新index.html> <旧index.html>`；旧版本用 `git show 667a0d7~1:index.html > old.html`（6.1，用来复现旧漏洞，期望其中 7 项失败）。`node dev/stage2.test.js <index.html>` 期望全部通过。
- Playwright 在这台机器的位置是 `/opt/npm-tools/node_modules`，换环境需要自行安装。
- 在无头 Chromium 里，下载文件名含中文会被改成 `download`，所以导出备份的文件名用英文。

## 已知限制（别当成 bug 重复修）
- 设备封禁是软约束（设备 ID 存在 localStorage，清数据即换新 ID）；账号封禁已在数据库层强制。
- `public_key` 是前端生成的占位字符串，不是真实硬件密钥。
- 设备封禁只在前端强制，RLS 看不到设备 ID。
- 网页加载后 GitHub Pages CDN 更新有几分钟延迟；service worker 对 index.html 是网络优先。

## 提交规范
- 提交信息末尾加：
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 和 `Claude-Session: https://claude.ai/code/session_01YDrw3sQgmecTEohDLNKksP`
