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
- 已推送到 main 的最新版是 **Pro 6.31**（`APP_VERSION="6.31.0"`）。6.8：点开售后时自动向快递100 查一次（见下）。
- **6.10 界面整理**（用户嫌按钮杂乱、界面重叠）：顶栏只留「在线 / 管理 / ☰ 更多」（夜间模式、退出账号一直在「更多」里）；首页「设备注册诊断」只在「更多」里；统计压成一张倒计时卡 + 一排 4 个数字；筛选三个下拉框一行、快捷筛选横向滑动；详情 4 个主按钮 2×2，上传按钮移进「举证材料」卡片，删除放到最底；时间线显示中文事件名（`EVENT_LABELS`）。**重叠的根因**：详情页顶部标题栏半透明（浅色 `#ffffffed`、深色 `#172033ed`），滚动时下面内容透出来，现已改为不透明。没有删除任何功能。
- **6.11 iOS 风格 + 过渡动画**（用户要求）：整张样式表换成 iOS 26 风格（系统色、分组背景、圆角卡片、胶囊按钮、填充式输入框、毛玻璃顶栏和悬浮标签栏、SVG 图标），所有 class 名不变。弹窗是底部弹出卡片、详情从右侧推入；**关闭动画**用 `ghostOut()`：真实元素立即加 `hidden`（状态和逻辑都不变），复制一个去掉 id/事件、`pointer-events:none` 的副本播放退出动画，约 380ms 后删除。遮罩只动画 `background-color`，卡片本身始终不透明（之前用整体 opacity 淡入时，滑动中途会透出下面页面，看起来像重叠）。列表入场动画只在结果集合变化时播放（`listEnter`）。`prefers-reduced-motion` 时全部关闭。
- **6.12 打开售后提速**（用户反馈要等一两秒）：数据库没问题（行数很少、`task_id` 都有索引，项目在 ap-southeast-1）。原因是 `openTask` 依次 await 3 个请求后才显示。现在先用内存里的任务立刻渲染（材料/时间线显示「加载中…」），3 个请求 `Promise.all` 并行，回来后只填 `#logistics_box/#files_box/#timeline_box` 和未改动过的 `#f_carrier`；`detailCache` 缓存每条售后，再次打开秒开；`openSeq` 丢弃快速切换时的过期结果；加载完成前 `saveTask` 拒绝保存（否则可能用空承运商覆盖）。模拟每个请求 400ms：页面出现 1212ms→62ms，全部加载 1266ms→409ms。测试桩支持 `window.__latency`。
- **6.13**：用户第一次实测用的是中通单号（查不了）。按用户选择：顺丰/中通在详情顶部「物流状态」下出现「手机后四位 + 查询」（`phoneQueryBox`/`queryWithPhone`），只随这次请求发给 Edge Function，不保存；其他承运商仍是打开时自动查。用户要求**回复用繁体中文**，网页保持简体。快递100 Secrets 用户说已填好，但截至此时还没有一次真实查询成功的记录（Edge Function v2 已加 `.trim()`）。用户实测返回「快递100 还没有配置」：只有这一个项目、Vault 为空，说明 Secret 名称不对或没保存。v3：`findSecret` 容忍名称大小写/前后空格；读不到时在错误里列出名称相近的 Secret（只给名称，不给值），让用户自己核对。
- **快递100 已真实可用**（2026-10-10 20:22 UTC，中通单号 + 手机后四位查询成功，函数返回 200，`tracking_records.last_match` 写入真实轨迹）。用户最初没有 customer；后来**在聊天里贴出了快递100 的 customer/key/secret/userid**，已提醒不要再发、建议在快递100 后台重置 key；这些值没有写进仓库或任何文件。第一次结果显示「【未知状态】」：`resultv2=4` 时 `state` 会是细分码（例如 206），v5（Edge Function 版本号 5，中间的 v4 不是本会话部署的）优先用轨迹里的 `status` 中文名，再按官方细分码表查。前端 6.14：本人签收/代签/已销单等细分终态也不再自动查询。
- **6.15 + Edge Function v6**（用户反馈圆通、申通查不了）：日志显示 20:28 用户登录过期（函数收到的不是用户 JWT，`bad_jwt`），前端把 `bad_session` 当成「本次页面不再自动查」，重新登录后也没重置，之后新建的圆通/申通完全没发请求；另外 30 分钟限制按售后算，同一售后改了单号也被拦。修复：只有 not_configured/503/601 才关自动查询，`enterApp` 重置；事件消息带「（单号）」，函数和前端都按单号限频；所有可查承运商都有「↻ 立即查询」；函数调快递100 网络异常重试一次并 `console.error` 原因（不含密钥）。
- **6.16 客服 + 金额 + 手机号注册**（用户选择：网页内聊天、显示用户登录邮箱作为开发者邮箱、订单金额+退款金额、手机号+密码不发验证码）。数据库改动在 `supabase/v6_16_amount_support_phone.sql`（**用户已于 2026-10-10 21:00 UTC 在 SQL Editor 执行**；只读核对：两个金额列 + 非负约束、support_messages 开 RLS、5 条策略、authenticated 只有 SELECT/INSERT + UPDATE(read_at)、admin_list_all_users 已改；get_advisors 没有新增告警）：`after_sales_tasks.order_amount/refund_amount`、`support_messages` 表（RLS：本人读自己会话、管理员用 `is_admin()` 读全部；用户只能以 user 发到自己会话、管理员只能以 admin 回复；只能更新 read_at；被封账号拒绝）、`admin_list_all_users` 的 email 列改为 coalesce(email, phone)。前端用 `detectFeatures()` 探测列/表是否存在，未执行 SQL 前金额和聊天自动隐藏，不会因写不存在的列导致保存失败。聊天用打开时每 5 秒刷新（**supabase_realtime 发布里没有任何表**，6.5 的 Realtime 订阅其实收不到事件，这个没修）。手机号登录：`parseIdent()`，需要用户在 Supabase → Authentication → Providers 打开 Phone 并关闭手机确认；手机账号不能自助找回密码，提示联系开发者邮箱。
- **6.17**：开发者联系邮箱改为用户指定的 1012968575@qq.com（`DEV_EMAIL` 和手机号找回密码提示）；登录页加了用户给的注册说明（邮箱注册推荐 / 手机号注册不推荐）和「悠然网络科技工作室™」署名。
- **6.18 手机号注册审核**（用户选择「管理员审核 + 号段检查」）：Supabase 后台开 Phone 时**强制要求填 Twilio**，方案是填明显的占位值（AC000…/MG000…）并关闭 phone confirmations，因此注册不会发短信。没有短信就无法验证号码归属，所以 `supabase/v6_18_phone_approval.sql`（用户已于 2026-10-10 分 3 段执行，只读核对 1/4/7；一次贴整段在手机 SQL Editor 里报过语法错误，SQL 本身用 libpg_query 解析没问题，是粘贴导致；**手机上的 SQL 要拆小段给用户**）加了：`phone_account_approvals` 表、`is_account_pending()`、`my_account_status()`、`admin_list_pending_phone_users()`、`admin_approve_phone_user()`，以及 6 张业务表 + 证据桶上的限制性策略 `account_not_pending`（客服表不加）。前端：`parseIdent` 只收 13–19 号段的大陆手机号；进入系统前调 `my_account_status`，待审核就退出并提示；管理后台新增「审核」页。**顺序很重要：先执行 SQL，再在后台打开 Phone。** 补丁 `v6_18b_fix_function_grants.sql` 已执行（只读核对：4 个函数 anon 不可执行、authenticated 可执行）。
- **6.19 管理后台账号显示**：①「用户」页原来调的是 `admin_list_users`（只返回管理员！），改成 `admin_list_all_users`，并标出管理员；②售后/快递/店铺/资料库/举证/日志/账号/设备/管理员这 9 个列表函数只读 `u.email`，手机号用户显示「—」。`supabase/v6_19_admin_phone_labels.sql`（用户已于 2026-10-11 分 3 段执行，updated=9；只读核对 9 个函数仍是 security definer、search_path 不变、都含管理员校验）只把 `u.email::text` 换成 `coalesce(nullif(u.email::text,''),u.phone::text)`，已用只读查询逐个对比线上 prosrc，除这一处外完全相同。前端统一用 `acct()` 显示（86 开头的 13 位显示为「手机 1xxxxxxxxxx」）。
- **手机号注册 + 审核已在线上走通**（只读核对 auth 日志和数据库）：2026-10-10 21:31:36 手机号注册 → 21:32 两次登录被拦（待审核）→ 21:33:12 管理员审核通过 → 21:34:01 登录成功；该账号已建 1 个店铺、1 条售后。注册那一秒服务端收到两次 /signup（一次 200、一次 500 users_phone_key 重复），是连点导致；**6.20** 给「登录」「注册」加了 `authBusy`，请求进行中按钮禁用、不重复发送。Supabase Phone 设置里填的是 Twilio 占位值、phone confirmations 已关。
- **6.21 找回密码（手机号用户）**：Edge Function `admin-reset-password`（v1 已部署，`verify_jwt=false`）：调用者 JWT → `auth.getUser()` → `rpc('is_admin')` 服务端确认管理员 → 用自动注入的 `SUPABASE_SECRET_KEYS`（或旧的 service_role）`auth.admin.updateUserById` 设 12 位临时密码（必含大小写/数字/符号、去掉易混字符），只返回给管理员；不能重置自己；写 `admin_operation_logs`（action=reset_password，不记录密码）。线上冒烟：未登录/假 token/publishable key 都是 401。前端：「管理 → 用户」每行「重置密码」（先弹窗提醒核对身份），「工作台设置」新增「修改密码」（`auth.updateUser`）。测试：`dev/admin-reset.handler.test.ts`（7 项，fake 里加了 rpc/auth.admin/secret 绕过 RLS）。已知：重置不会踢掉对方已登录的会话。
- **6.22 在线人数常显示 0**：realtime_logs 没有错误/拒绝，服务端正常；原因在手机端：锁屏/切后台时浏览器断开 WebSocket，回来后频道可能没重新加入或没重新 `track`，连自己都不算；另外 HTML 初始值就是 0，连接没建好时看起来像「没人在线」。修复：连接中显示「…」、出错显示「—」并 5 秒后重建频道；回到页面 / 网络恢复 / 每 45 秒 `presenceCheck()`：频道不是 joined 就重建，joined 但自己不在 presenceState 里就重新 track；`presenceStart` 先把 `presence` 置空再 removeChannel，避免自己关频道触发的 CLOSED 引起重连循环；退出登录时清掉定时器。在线面板说明「在线 = 此刻打开着页面的账号」。
- **6.23 新设备登录提醒**（用户选择：系统内提醒、只在新设备登录时）：`supabase/v6_23_login_alerts.sql`（已执行，见下）新增 `login_alert_acks` 表、`note_login_device()`（本人给自己的设备补型号/UA/IP，用 `request_ip()`）、`my_login_alerts(p_device_id)`（返回本人设备，first_seen 晚于上次确认且不是本机的标 is_new；第一次调用只建基准）、`ack_login_alerts()`；**没改** `security_register_device`。前端：进入系统后 `loginAlertsAfterEnter()`，有新设备弹窗「是我本人 / 不是我，马上改密码」；工作台设置加「登录记录」。注意：设备 ID 存在 localStorage，清浏览器数据会被当成新设备（已知限制）。
- **6.23 SQL 已全部执行**（2026-10-11：先执行第 1 段，后来补执行第 2 段；只读核对 1 / 3 / 3，`note_login_device` / `ack_login_alerts` / `my_login_alerts` 都是 anon 不可执行、authenticated 可执行）。新设备弹窗和登录记录已可用。
- **6.24 新设备登录邮件提醒**（用户问「会发邮件提醒吗」：之前不会，只有系统内提醒；用户要求手机号用户弹窗问是否绑定邮箱作为辅助验证，别人登录时发邮件）。
  - Supabase 自带邮件只能发给项目团队成员的邮箱，所以**不用 Supabase Auth 的邮件**，而是 Edge Function `login-alert-mail`（v1 已部署，`verify_jwt=false`）自己用 SMTP 发信：nodemailer，**只能 465 端口**（Supabase 禁止 25/587），发信邮箱账号/授权码放在 Edge Function Secrets：`SMTP_USER`、`SMTP_PASS`（必填），`SMTP_HOST`（qq.com/foxmail.com/163.com/126.com 自动推断）、`SMTP_FROM_NAME`（默认「售后雷达」）。用户已于 2026-10-11 配置 `SMTP_USER` / `SMTP_PASS`（QQ 邮箱授权码，只在 Secrets 里），线上已真实发出验证码并绑定了提醒邮箱；没配置时前端不弹窗，设置页说明「发信邮箱还没有配置好」。
  - 提醒邮箱存在新表 `login_alert_emails`（**不改 auth.users.email**，所以手机号审核 `is_account_pending()` 不受影响，不能借绑邮箱绕过审核）；`login_alert_mails(user_id, device_id)` 主键去重，每台设备只发一次。两张表前端读写不了，只有函数的 secret key 能读写。SQL：`supabase/v6_24_login_alert_email.sql`（**用户已于 2026-10-11 执行**，只读核对 2 / 3 / 2 / 6）。
  - 函数动作：`status`、`send_code`（6 位码只存 SHA-256 哈希、10 分钟有效、60 秒一次、每天 5 次、错 5 次作废；待审核/被封账号拒绝——防止陌生人注册手机号后拿来给别人发邮件）、`verify_code`、`use_account_email`（邮箱注册的用户可一键用已验证的登录邮箱开启）、`remove`、`decline`（不再弹窗）、`notify`（前端每次进入系统调用；用调用者身份调 `my_login_alerts` 拿本机设备，`first_seen` 在 15 分钟内且晚于绑定时间才算新设备）。
  - 前端：`loginAlertsAfterEnter()` 之后 `mailAfterEnter()`；手机号账号、发信已配置、没绑定、没点过「不再提醒」时弹「绑定邮箱，开启登录提醒？」（有新设备弹窗时不叠加）；工作台设置加「登录邮件提醒」（`openMailAlert`）。
  - **线上已验证（2026-10-11 只读核对）**：2 个账号绑定了提醒邮箱（11:48 UTC），`login_alert_mails` 有 1 条（11:51 UTC 新设备提醒邮件已发出），用户确认「可以了」。换绑登录邮箱/手机号还没有成功执行过：11:54 UTC 撞了已被占用的邮箱（500）；v4 上线后 11:59 UTC 又试了 2 次，auth 日志是 /token 200（验证密码）→ GET /admin/users 200（查重）→ /logout 204，之后没有 PUT，说明被查重拦下（邮箱属于别的账号），账号没被改；`admin_operation_logs` 里还没有 change_email / change_phone，auth.users 里还没有同时有邮箱和手机号的账号。注意：验证密码用的临时登录会刷新 `last_sign_in_at`，管理后台「最后登录」会显示这个时间。
  - **限制（已告诉用户）**：提醒由新设备上的网页触发（和设备注册一样），懂技术的人绕过网页直接调接口就不会触发；依赖 v6_23 第 2 段（`my_login_alerts`）。
  - **顺带发现并修复 6.21 的问题**：本项目 public 下新表默认不给 service_role 读写权限（只有 TRUNCATE/REFERENCES/TRIGGER），`admin_operation_logs` 也没有 insert，所以 6.21「重置密码」的审计记录**一直没写进去**（库里 0 条 reset_password，而 auth 日志有 2 次重置）。v6_24 SQL 补了 `grant insert on admin_operation_logs to service_role`；`admin-reset-password` 已重新部署为 v2，写日志失败会打到函数日志（不影响重置）。
- **6.25 换绑登录手机号 / 登录邮箱**（用户要求「支持邮箱和手机号换绑」）：工作台设置 →「换绑手机号 / 邮箱」。都在 Edge Function `login-alert-mail`（v4 已部署）里做，因为改账号本身的手机号/邮箱要 secret key 的 `auth.admin.updateUserById`。
  - 都要**当前密码**：服务端用 publishable key 建临时客户端 `signInWithPassword` 验证，成功后 `signOut({scope:"local"})` 只注销这个临时会话；30 分钟内错 5 次锁定（`pw_fail_count/pw_fail_at`）；认证服务本身出错（如限流）不算输错。待审核/被封账号拒绝。
  - 换绑手机号：号段检查（13～19 开头 11 位），`phone_confirm: true`；**没有短信验证**（和注册一样，前端会让用户再核对一次号码）。
  - 换绑/绑定登录邮箱：先密码，再发 6 位码到**新邮箱**（`chg_*` 列，和提醒邮箱的码分开、共用每天 5 次的发送额度），验证后 `email_confirm: true`。手机号用户绑定后手机号和邮箱都能登录；如果还没有提醒邮箱，顺便设为提醒邮箱。需要 SMTP 已配置。
  - 被别人占用的手机号/邮箱 → 「已经被其他账号使用」。**线上踩过**（2026-10-11 11:54 UTC）：GoTrue 撞唯一约束 `users_email_partial_key` 时只回 500「Error updating user」，前端显示成「换绑失败：Error updating user」。v4 起换绑前先用 `auth.admin.listUsers` 查重（发验证码前就拦下，不浪费额度），并把「Error updating user」也映射成「已经被其他账号使用」。提醒邮箱（login_alert_emails）不要求唯一，同一个邮箱可以给多个账号当提醒邮箱。成功后通知旧登录邮箱和提醒邮箱，并在 `admin_operation_logs` 写 `change_phone` / `change_email`（user_id = 本人，管理后台「日志」可见）。
  - 手机号用户绑定登录邮箱后 `is_account_pending()` 会因为 email 不再为空而返回 false —— 只有已审核的账号能换绑（函数里先查 `my_account_status`），所以不会被用来绕过审核。
  - 需要的 6 个新列已并进 `supabase/v6_24_login_alert_email.sql`（已执行，见上）。
- **6.26 提示样式**（用户反馈「已被其他账号占用」的提示弹出来难看）：原因是底部 toast 是胶囊形（border-radius 999px），长文字被挤成多行胶囊、还压在底部弹窗上。改成：①「登录邮件提醒」和「换绑」表单里的错误改为显示在表单下方的红色小框（`formErr(id, r)` / `formOk(id)`，`#mlErr` / `#rbErr`），`code=taken` 时前端换成简短文案 + 一行灰色说明（不依赖服务端文案）；② 全局 `toast()` 超过 24 字自动加 `.long`（圆角方框、左对齐，显示时间随长度延长到最多 6 秒），短提示保持胶囊样式。只改了样式和提示位置，没有改任何业务逻辑。
- **6.27 用户自己删除陌生设备 + 强制退出**（用户要求：在登录记录里删除陌生设备，删除后那台设备强制退出、重新验证账号）。SQL：`supabase/v6_27_remove_device.sql`（**用户已于 2026-10-11 执行**，只读核对 3 / 3 / 8，8 条 RESTRICTIVE 策略都在；当时 device_sessions 还是 0 行——要等有人打开 6.27+ 的页面才开始记录）。**线上已验证**（2026-10-11 ~12:48 UTC，用户确认「删除设备后被踢回登录页」）：只读核对 device_sessions 3 行、revoked_devices 2 条、revoked_sessions 1 条且该 session 已不在 auth.sessions（服务端作废成功）、admin_operation_logs 有 2 条 remove_device（其中一条「强制退出 1 个登录」）、新设备邮件提醒共发出 2 封。
  - 设备 ↔ 登录的对应：前端每次进入系统、每 2 分钟复查、切回前台时调 `my_session_status(本机设备ID)`，把 JWT 里的 `session_id` 记进 `device_sessions`；返回 revoked=true 时前端 `denyAccess(KICKED_MSG)`（scope local 退出、回登录页说明原因），而且在 `deviceCheck()` **之前**调用，免得被删的设备又被重新注册。
  - `remove_my_device(行id, 本机设备ID)`：只能删自己的、不能删正在用的；写 `revoked_devices`（之后这台设备上**在此之前建立**的登录一律作废，包括没上报过的旧登录，等它第一次上报时作废）、已知 session 记进 `revoked_sessions` 并 **delete from auth.sessions**（refresh_tokens 级联删除 = 服务端作废，无法续期）；删除 `security_devices` 行（**被管理员封禁的设备保留行**，不能借此解封）；写 `admin_operation_logs`（remove_device）。
  - 服务端强制：限制性 RLS `session_not_revoked`（同 account_not_banned 的 8 处：7 张业务表 + support_messages + storage 证据桶），访问令牌还没过期也读写不了。`my_login_alerts` 只多返回 `id`。
  - 对方重新输入密码 = 新 session，不受影响，并被当成新设备（账号主人会再收到系统内 + 邮件提醒）——所以前端删除时提示「同时修改密码」，删除后给「修改密码」按钮。
  - 前端：登录记录每台非本机设备有「删除」；新设备提醒弹窗里也能直接删。设备名来自设备端（可伪造），onclick 里只放校验过的 uuid，名字从内存列表查（有 XSS 测试）。
  - SQL 用本机 PostgreSQL 16 + 仿 Supabase 的 mock 实测过（`dev/supabase-mock.pg.sql` + `dev/v6_27_remove_device.pgtest.sql`，24 项）：用 postgres 用户 initdb 到 /tmp（socket 路径不能太长），先跑 mock，再跑 v6_27，再跑 pgtest。
- **6.27 登录页重新设计**（用户给了两张参考图：照片背景 + 毛玻璃登录卡 + 微信扫码；白色粒子波浪 + 欢迎回来）：浅色径向渐变 + canvas 粒子波浪（深色模式自动变暗；登录页隐藏或切到后台时不绘制；减少动态效果时只画静态），毛玻璃卡片「账号密码登录」，账号框前缀（手机号 +86 / 邮箱 @ / 默认人像）、密码显示切换、回车登录、黑色主按钮、「还没有账号？注册」，注册说明折叠在卡片下方。**没做微信扫码**（项目没有微信开放平台登录，不做假的）。所有 id（email/password/password2/regwrap/authmsg/loginBtn/regBtn）和按钮文字不变，登录/注册/找回密码逻辑没动。
- **6.28 新图标**（用户嫌原来蓝底「雷」字难看、要时髦有新时代感）：极光渐层底（紫 #6a4dff → 蓝 #2f6bff → 青 #00c2d8，右上粉色光晕）+ 白色雷达扫描环（连续 conic 渐层光带 + 发光光点 + 中心点）。页面里的 `.logo`（顶栏、登录页两处）是 CSS 渐层底 + 内联 SVG（轨道和光点）+ `.logo::before` 的 conic-gradient 光带（用 mask 裁成环，避免分段画法的细缝）；App 图标 `icons/icon-512.png`、`icon-192.png`、新增 `apple-touch-icon.png`，源文件 `dev/app-icon.html`（Playwright 截图生成）；favicon 用 icon-192.png；manifest 增加 maskable。中间试过一版黑色雷达，没有上线。
- 9fce451 误提交了一个 8MB 的 pglast .whl 到仓库根目录，已在 796e9a4 删除（没有改写历史）。
- **6.29 欢迎页 + 独立注册页 + 管理员入口**（用户：登录页整体优化含文字；点注册没有单独页面、回不去登录；登录前加一个选「登录 / 管理员登录」的界面，所有超级管理员操作都移到管理员入口里）。
  - `#login[data-view]`：welcome（大图标、「欢迎使用售后雷达」、黑色「账号登录」、白色「管理员登录」、「还没有账号？注册新账号」）→ 卡片 login / register / admin 共用一张（同一组 #email/#password/#password2），`lgView(v)` 切换；卡片左上返回键回欢迎页；注册页有确认密码、密码规则、「已有账号？去登录」、折叠的注册说明；登录页「忘记密码？」「还没有账号？去注册」。#regBtn 现在是注册页的大按钮（`register()` 不在注册页时只切到注册页）。
  - 入口模式 `appMode`（localStorage `sar_mode`）：账号登录 = user，**看不到任何管理入口**（顶栏「管理」、更多菜单「管理后台」、客服里「查看用户来信」、在线名单邮箱、客服未读里的用户来信都按 `adminUI()` = isAdmin && admin 模式）；管理员登录 = admin，登录后 `checkAdmin()` 确认 is_admin 后**整页管理后台** `#adminApp`（顶部「工作台」「退出登录」；切到工作台后顶栏「管理」可回来）；不是管理员 → `denyAccess` 退回管理员登录页并提示。重开页面保持入口；`logout()` 把模式清回 user。**只是界面入口**：所有 admin_* 函数仍在服务端校验管理员，`adminPanel()` 等函数本身仍检查 isAdmin。
  - 测试：stage2 新增 6.29 一组（305/305），gate 的 doLogin 先 `lgView("login")`（旧版本没有这个函数时跳过）。Playwright 的 `:text-is` 匹配不到「svg + span」结构的按钮，测试里用 class 选择器。
- **6.30 账号框自动识别 + 管理后台排版**（用户：+86 要能自动匹配邮箱或手机号；管理员登录里面杂乱不规整）。
  - `lgPrefix()`：纯数字（可带空格/横线/+86）→ 前缀「+86」+ 竖线，下面 `#lgDetect` 显示「已识别为手机号 +86 138 0013 8000」或「已输入 n / 11 位」，号段不对标红；有字母或 @ → 邮箱图标，`#lgSuggest` 给常用后缀（qq/163/126/gmail/foxmail/outlook/sina，按已输入的域名过滤），点一下填入并跳到密码。只是显示辅助，登录/注册仍走 `parseIdent()`。
  - 整页管理后台：左侧分组导航（概览 / 用户与安全 / 业务数据 / 系统，带图标，当前项高亮），右侧标题 + 白色内容卡；手机上导航变成一排可横滑的胶囊，顶部保留「工作台 / 退出」。总览是大数字卡；`renderAdminList` 的表格加 `data-label`，手机上每条记录变成一张「标签：值」卡片，电脑上是圆角表格（表头吸顶、悬停高亮）。14 个分区和功能都没变。注意：手机布局里 `.admside` 要 `align-self:stretch`，否则会被横滑导航撑宽，按钮跑出屏幕（踩过）。
- **6.31 用户须知 + 用户使用协议**（用户要求拟两份协议，登录/注册必须同意，协议能点开看）。正文在 `legal/用户须知.md`、`legal/用户使用协议.md`，按系统真实情况写（不是抖店官方、无抖店接口、「已完成」不代替平台操作；手机号注册无短信验证要审核、忘记密码找管理员；登录记录/新设备提醒/删除设备；**管理员可查看全站数据**；数据在 Supabase **新加坡（ap-southeast-1）**；快递100 收单号和手机后四位不保存；邮件经运营方邮箱发送；联系 1012968575@qq.com）。**是草拟稿，不是法律意见**，已建议用户正式使用前请专业人士审阅（尤其个人信息出境）。**运营主体已按用户确认改为正式名称「悠然网络科技工作室」（不带 ™），注册地江西省丰城市，争议由丰城市有管辖权的法院管辖**；登录页底部署名仍保留用户最初要求的「悠然网络科技工作室™」。改协议：编辑 `legal/*.md` 后运行 `python3 dev/build-legal.py` 同步到 index.html。
  - 页面：协议正文以 `<template id="legal-notice|legal-terms">` 嵌在 index.html（由 md 生成，改协议两处一起改并更新 `LEGAL_VERSION`）。登录 / 注册 / 管理员登录卡片都有「我已阅读并同意《用户须知》和《用户使用协议》」，**默认不勾选**，没勾 `login()` / `register()` 直接拒绝（提示 + 抖动），回车也一样；点书名号打开阅读弹窗（两份可切换），在登录页打开时底部有「我已阅读并同意」一键勾选。欢迎页底部、工作台设置也能随时查看。注册时把 `terms_version`、`terms_agreed_at` 写进用户 metadata（signUp options.data）；登录不额外写库。
- **6.9（用户明确要求删除）**：去掉了用户端的「快递盯单」按钮和弹窗（含手动记录物流状态、手动「用快递100查询」、顺丰/中通手机号输入）、「快递监控记录」卡片、首页「盯单中」统计和快速筛选。详情页只保留顶部「物流状态」。承运商改在「新建售后」和详情「售后信息」表单里选（`#tc` / `#f_carrier`），保存时同步 `tracking_records`；改单号会清空旧的物流状态。管理后台里的「盯单」列和统计**没动**。顺丰、中通目前**查不了**（不保存手机号是用户的决定，手动查询入口随弹窗一起删了）。
- 用户真正想要的是「抖店来了新售后，自动匹配对应的快递单号」。这需要抖店开放平台的应用和店铺授权，项目里**没有**任何抖店接口，现在做不了；已如实告诉用户，**不要做假的自动匹配**。快递100 的「智能单号识别」（根据单号自动判断快递公司）是另一个产品，官方文档还没核实，等用户有快递100 账号后再评估。6.7 是用户自己合并 PR #1 上线的；6.7.1 在售后详情顶部卡片直接显示当前物流状态（`tracking_records.last_match`）。
- 用户已在手机上确认 6.6 的快递盯单正常（数据库里看到了 `tracking_records` 的写入和 `tracking_updated` 事件）。「录入举证内容」弹窗已在线上验证保存链路：2026-10-10 19:23 UTC 数据库里有 `evidence_manual` 事件、售后 `updated_at` 同步更新、状态未变。之后用户又测了补充说明：数据库里有 1 条售后带【补充 时间】、事件「手动录入举证：补充说明」（19:27 UTC）。**6.6 全部线上验证完成。**6.9.1 起内容没变化时不保存、不记事件，并提示原因。
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
### 1) 6.6：快递单号手动录入 + 手动举证录入 —— **已完成**：补丁已应用、测试通过、已推送 main（以下保留作记录）
- 应用时修了补丁里的一个问题：`tracking_records.last_match` 实际是 `NOT NULL DEFAULT ''`，原补丁留空时写 `null` 会被数据库拒绝，已改为写空字符串。`dev/stage2.test.js` 的假数据库现在模拟了这条约束，以及 `upsert(onConflict:"task_id")` 在真实表上会报错。
- 补丁脚本：`dev/patch5_tracking_manual_evidence.py`（用法：`python3 dev/patch5_tracking_manual_evidence.py index.html`，基于 6.5 的 index.html；每处替换都断言恰好匹配一次）。
- 它做的事：
  - 用表单弹窗替换原来基于 `prompt()` 的 `tracking(id)`：单号、承运商、持续盯单开关、手动记录最近物流状态（写入 `tracking_records.last_match`）。
  - **修了一个真实 bug**：旧 `tracking()` 用 `upsert(..., {onConflict:"task_id"})`，但 `tracking_records` 表**没有 task_id 的唯一约束**（只有主键和普通索引），所以会报错且错误被忽略，**从来没写出过监控记录**。新代码改成先查再改/插（`saveTrackingRecord`）。
  - 新建售后带单号时、编辑售后改单号时，同步写 `tracking_records`。
  - 新增「录入举证内容」弹窗（举证原因、补充说明带时间追加、视频说明/链接、选择视频上传），只保存，**不自动提交**；写 `evidence_manual` 事件。
- 还要做：运行补丁 → 语法检查 → 给 `dev/stage2.test.js` 补测试（保存盯单走 insert 而不是 upsert、第二次保存走 update 不重复插入、单号校验、新建带单号写记录、手动举证不改状态）并把两个测试文件里的版本断言从 `6.5.0` 改成 `6.6.0` → 跑全部测试 → 提交推送 → 更新 README。
- 不要改数据库结构也能完成这一步。

### 2) 对接快递100（用户已选择快递100）—— **进行中**，详见 `README-快递100.md`
- 已完成：Edge Function `kuaidi100-query`（`supabase/functions/kuaidi100-query/`）已通过 MCP 部署（v1，`verify_jwt=false`，函数内 `auth.getUser()` 校验；数据库读写用调用者 JWT + publishable key，受 RLS；不用 service_role）。线上冒烟：OPTIONS 200、未登录 401、假 token 401。
- 已完成：前端 6.7（快递弹窗里的手机号后四位 + 「用快递100查询物流」按钮）和测试；用户已合并到 main（PR #1），所以按钮已上线，Secrets 填好之前点按钮会提示「快递100 还没有配置」。
- 等用户：注册快递100 企业版、拿到 customer/key、在 Supabase → Edge Functions → Secrets 填 `KUAIDI100_CUSTOMER`、`KUAIDI100_KEY`。填好后让用户用一个真实单号在手机上测。
- 用户决定：①要「点开就自动查」（接受消耗额度）；②**不保存**手机号后四位，顺丰/中通只能手动查。6.8 已实现：`autoQueryLogistics()`，同一售后 30 分钟内最多一次（看时间线里最近的 `tracking_queried`），已签收/退签/拒签不再查，「其他」/顺丰/中通跳过；只就地更新 `#logistics_box` 和 `#tracking_card`，不重绘详情（避免冲掉正在编辑的表单）；未配置或账号类错误时本次页面会话内不再自动查。
- 以下是最初的方案说明：
- 方案：Supabase **Edge Function** 在服务端调用快递100，密钥放 Supabase 的 Secrets（用户在控制台里自己填，不发给开发者、不写进前端）。前端只调用自己的 Edge Function，函数内用调用者的 JWT 校验身份和任务归属，再写 `tracking_records.last_match` 并追加事件。
- 先让用户去快递100官网看开发者接口的注册要求、收费和额度（**这些我没有查到可靠信息，别替它们下结论**），确认要用之后，再一步一步教：注册、拿到 customer/key、在 Supabase 里设置 Secrets、部署函数。
- 顺丰等快递查询通常需要收件人/寄件人手机号后四位；`tracking_records` 没有这个字段，需要时再和用户商量（加列要让用户在 SQL Editor 执行）。
- 先考虑「按需查询」（用户点按钮时查一次）；订阅推送（回调）需要公开的回调函数和签名校验，复杂度更高，后做。
- 部署 Edge Function 如果要用工具写生产库/函数，可能同样被权限层拒绝；准备好函数代码和手把手的控制台操作步骤。

## 测试
- 测试用真实的 `index.html` 在 Playwright Chromium 里跑，只把 Supabase 客户端换成桩（`dev/gate.test.js` 管登录/设备/账号/管理后台；`dev/stage2.test.js` 带一个内存假数据库，管 6.5 之后的用户端功能）。**这不是对真实数据库的测试**，不能当成线上已验证。
- 数据库 SQL 的本地实测：`dev/supabase-mock.pg.sql` + `dev/v6_27_remove_device.pgtest.sql`（见 6.27）。
- Edge Function 测试（Deno + 假 Supabase/假 nodemailer，`dev/kuaidi100-fakes/`）：`dev/kuaidi100.handler.test.ts`、`dev/admin-reset.handler.test.ts`、`dev/login-alert-mail.handler.test.ts`，命令同下。
- 快递100：`node dev/kuaidi100.test.mjs`；`deno test --no-lock --config dev/kuaidi100-fakes/deno.json --allow-env --allow-read dev/kuaidi100.handler.test.ts`（Deno 可用 `npm i deno` 装到临时目录，`DENO_CERT` 指向代理 CA）。
- 运行：`NODE_PATH=<含 playwright 的 node_modules> node dev/gate.test.js <新index.html> <旧index.html>`；旧版本用 `git show 667a0d7~1:index.html > old.html`（6.1，用来复现旧漏洞，期望其中 7 项失败）。`node dev/stage2.test.js <index.html>` 期望全部通过。
- Playwright 的位置因环境而异（见过 `/opt/npm-tools/node_modules` 和 `/opt/node-tools/node_modules`），换环境需要自行查找或安装。
- 在无头 Chromium 里，下载文件名含中文会被改成 `download`，所以导出备份的文件名用英文。

## 已知限制（别当成 bug 重复修）
- 设备封禁是软约束（设备 ID 存在 localStorage，清数据即换新 ID）；账号封禁已在数据库层强制。
- `public_key` 是前端生成的占位字符串，不是真实硬件密钥。
- 设备封禁只在前端强制，RLS 看不到设备 ID。
- 网页加载后 GitHub Pages CDN 更新有几分钟延迟；service worker 对 index.html 是网络优先。

## 提交规范
- 提交信息末尾按当前会话给出的署名规范加 Co-Authored-By / Claude-Session 等行。
