# 售后雷达 Pro 6.5 设备 / 账号封禁 + 功能恢复

## 6.4 / 6.5：恢复早期版本的功能（没有删除任何现有功能）

**6.4 管理后台**：总览（注册用户 / 全部售后 / 高风险 / 盯单中 / 证据文件 / 已完成）、用户、管理员（按邮箱添加 / 移除，不能移除自己）、售后、快递、店铺、资料库、举证、设备、账号、日志、设置、退出后台；列表都有搜索。修复了「售后」「快递」页用户列显示「—」的问题（接口返回的字段是 `email`，之前读成了 `owner_email`）。管理员的添加 / 移除在数据库函数里校验权限。

**6.5 用户端**：夜间模式（记在本机浏览器）、导出 JSON 备份、工作台设置、在线用户面板（管理员额外能看到邮箱和 24 小时内登录的人）、快速筛选、售后详情可编辑（订单 / 买家 / 快递 / 类型 / 状态 / 风险 / 截止时间 / 原因 / 举证理由）、拒绝协商（记录次数并启动 3 小时倒计时）、快递监控记录（最近匹配）、证据图片 / 视频预览、图片 / 视频 / 文档分别上传、资料库删除与取消引用、店铺搜索 / 改名 / 停用、实时同步、到期兜底处理。

注意点：
- 到期处理本来就由数据库定时任务 `after-sales-deadline-every-minute` 每分钟执行；前端的兜底只处理「到期 90 秒后仍是待处理」的任务，并用条件更新避免和服务端重复处理。
- 删除资料库文件时，如果某个售后仍在引用同一个存储文件，文件会保留；移除举证材料同理。
- 导出备份的文件名是英文 `after-sales-radar-backup-日期.json`，避免部分浏览器把中文文件名改掉。

## 清理调试函数（已执行，2026-10-10）

`supabase/cleanup_debug_functions.sql`：删除了 5 个调试遗留的测试函数（手动在 SQL Editor 执行，已用只读查询确认不存在）。执行前已确认它们没有被触发器、其他函数、RLS 策略或前端引用。

## 这一版做了什么

**登录流程（修复 6.1 的真实漏洞）**

6.1 里只有「点登录按钮」这一条路径做了设备检查，另外两条路径直接放行：

- 刷新页面：`init()` 发现本地有登录状态就直接进应用，不查设备。
- 登录事件：`SIGNED_IN` 事件里直接 `show()`，被封设备会短暂进入应用，签出后界面还停在应用里。

现在三条路径统一走 `enterApp()`：先调用 `security_register_device`，通过才显示应用；被封、被拒、网络/RPC 异常一律不放行。进入应用后每 2 分钟、切回页面、网络恢复时会复查，被封后最迟约 2 分钟被踢回登录页。被封设备退出时用 `signOut({scope:"local"})`，不会把同账号的其他正常设备一起踢下线。登录页的提示会区分「此设备」和「此账号」已被禁止登录。

**管理员后台**

- 「设备」：邮箱、设备名称、设备 ID、平台、App 版本、状态、创建时间、最后在线、封禁时间、封禁原因、操作人；可搜索、封禁（必须填原因、二次确认）、解封；当前设备不可封。
- 「账号」：所有注册账号及封禁状态；可封禁（必须填原因、二次确认）、解封；不能封自己，不能封其他管理员。账号被封后，该账号在所有设备上都无法登录。

## 数据库（Supabase）状态

以下函数**已经存在于你的数据库**，不需要再执行 `supabase/device_admin.sql`（它只是这些函数的源码备份，与线上定义一致）：

`admin_list_devices` · `admin_set_device_status` · `admin_list_account_bans` · `admin_set_account_ban` · `security_register_device`（内部已检查账号封禁和设备封禁）

已核对：这些函数都在内部校验管理员，匿名用户不可执行；`security_devices`、`security_user_bans`、`security_events`、`admin_operation_logs` 开启了 RLS 且没有任何直接权限，登录用户无法直接读写。

**数据库层加固（已执行，2026-10-10）**：`supabase/account_ban_enforcement.sql`。

账号封禁不只在登录检查里被拦：被封账号绕过前端、直接调用接口，在数据库层面也读写不了业务数据。做法是给 6 张业务表（`after_sales_tasks`、`after_sales_events`、`evidence_files`、`evidence_library`、`shop_stores`、`tracking_records`）和证据存储桶 `after-sales-evidence` 加了名为 `account_not_banned` 的「限制性策略」。它只会拒绝被封账号，未被封的用户不受影响。这 7 条策略是在 Supabase SQL Editor 里手动执行的，已用 `pg_policies` 核对。

一键撤销（任何异常时在 SQL Editor 里分别执行）：

```sql
drop policy account_not_banned on public.after_sales_tasks;
drop policy account_not_banned on public.after_sales_events;
drop policy account_not_banned on public.evidence_files;
drop policy account_not_banned on public.evidence_library;
drop policy account_not_banned on public.shop_stores;
drop policy account_not_banned on public.tracking_records;
drop policy account_not_banned_evidence on storage.objects;
```

注意：这些策略对「被封账号绕过前端」的行为做了数据库层强制，但**设备封禁**仍只在前端强制（数据库看不到设备 ID），见下面的已知限制。

## 测试步骤（手机上做）

见对话里的分步教程，核心流程：

1. 管理员登录 -> 更多 -> 管理后台 -> 设备：本机标注「本机」且没有封禁按钮。
2. 用一个普通测试账号登录一次，产生真实的 `WEB-…` 设备记录。
3. 管理员在「设备」页封禁它（先试不填原因，应被拒绝）。
4. 被封浏览器刷新页面、重新登录：都应回到登录页并提示「此设备已被禁止登录」，且全程看不到应用界面。
5. 管理员解封，被封浏览器可以重新登录。
6. 管理员在「账号」页封禁该账号，该账号在任何设备上都无法登录，提示「此账号已被禁止登录」；解封后恢复。

注意：之前被封的 `WEBTEST-…` 是「设备注册诊断」按钮生成的 ID，不是登录用的 `WEB-…`，那次封禁没有测到真实登录流程。

## 已知限制

- 网页端的设备 ID 存在浏览器 `localStorage`，清除浏览器数据后会生成新的设备 ID，所以**设备封禁是软约束**。要强约束请用「账号封禁」。
- `public_key` 目前是前端生成的占位字符串，不是真实硬件密钥，也不是真正的设备证明。
- 设备封禁只在前端（`enterApp`）强制执行；数据表的 RLS 不看设备状态。账号封禁已在数据库层强制，见上面「数据库层加固」。
- 「不能封自己当前设备」依赖前端传来的 `current_device_id`，作用是防误操作，不是安全边界；没有传这个值时，数据库会拒绝封禁管理员名下的任何设备。
- 后台「用户」页调用的 `admin_list_users` 只返回管理员账号；要看全部账号请用「账号」页。
- Auth 的「泄露密码保护」未开启：它需要 Supabase Pro 套餐，免费版无法开启（已尝试，提示 Pro 以上才可用）。
- Supabase 安全检查对 `admin_*` 等 SECURITY DEFINER 函数的「登录用户可执行」提示是有意为之：这些函数在内部校验管理员身份，匿名用户不可执行。
