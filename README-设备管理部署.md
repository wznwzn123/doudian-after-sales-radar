# 售后雷达 Pro 6.3 设备 / 账号封禁

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
- Supabase 安全检查还提示：数据库里有几个调试遗留的测试函数（`device_test_user`、`hello_test`、`one_param_test`、`test_device_function`、`test_security_function`），其中 `device_test_user` 匿名也能调用（只返回当前用户 ID，无数据泄露）；另外 Auth 的「泄露密码保护」未开启。均建议清理 / 开启，但不影响本功能。
