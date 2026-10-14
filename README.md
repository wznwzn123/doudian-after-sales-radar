# 售后雷达 Pro · 前端发布版（v6.39.4）

抖店商家用的**售后到期提醒和举证管理**网页工具：盯住每一单售后的截止时间，集中管理举证图片、视频和文档，跟踪退货物流。

这个文件包是从原项目当前版本导出的「**只含前端网页**」的版本：

- 已去掉 **QQ 群机器人**相关的全部页面和代码（管理后台的「QQ 机器人」、AI 聊天等）；
- 已去掉**原作者的服务器地址、密钥和联系邮箱**，换成 `your-project-ref`、`YOUR_SUPABASE_PUBLISHABLE_KEY`、`your-email@example.com` 这些占位符；
- **不包含任何服务器代码**：数据库表、数据库函数、Edge Functions（云函数）、定时任务都不在包里，也不会连接原作者的服务器。

> ⚠️ **重要：只有这个包是用不起来的。** 网页的登录、数据保存、文件上传、物流查询都依赖一个 Supabase 后端，而后端不在包里。没配置后端时，页面顶部会显示橙色提示条，登录、注册等操作会失败。适合用来参考界面和前端代码，或者在你已经有兼容后端的情况下部署。

原项目：https://github.com/wznwzn123/doudian-after-sales-radar

---

## 一、包里有什么

| 文件 | 作用 |
|---|---|
| `index.html` | 整个网页应用（界面、样式、脚本都在这一个文件里），开头有发布版说明，后端配置在脚本最前面 |
| `sw.js` | 离线缓存脚本：网络不通时也能打开页面（只在 https 下生效） |
| `manifest.webmanifest` | 「添加到主屏幕」用的应用信息（名称、图标、颜色） |
| `icons/` | 应用图标（192、512 和苹果设备用的图标） |
| `legal/用户须知.md`、`legal/用户使用协议.md` | 用户须知和用户使用协议的**模板**，运营方信息已换成占位符 |
| `README.md` | 就是这份说明 |
| `LICENSE` | 开源许可证（MIT） |

## 二、主要功能（需要接上后端才能用）

**商家端**
- 售后列表：按截止时间倒计时，快到期的排在前面；快速筛选；新建、编辑、删除售后
- 举证管理：给每一单上传图片、视频、PDF、Word、Excel、TXT（单个不超过 200MB），在线预览
- 云端资料库：常用举证材料存一次，多单重复调用
- 店铺管理：多店铺分开管理
- 处理记录：提交完成、录入举证内容、拒绝协商（3 小时倒计时）、记录仲裁，带时间线
- 物流状态：填了快递单号的售后显示物流进度（需要后端的 `kuaidi100-query` 云函数）
- 账号安全：登录记录、新设备登录邮件提醒、修改密码、换绑手机号或邮箱、退出其他设备、自助注销账号
- 到期邮件提醒开关、在线客服、导出 JSON 备份、夜间模式、可以添加到手机主屏幕

**管理后台**（管理员账号才可见，权限由后端校验）
- 总览、用户、管理员、售后、快递、店铺、资料库、举证、设备、账号、日志、设置、客服、审核（手机号注册审核）

## 三、怎么用

### 1. 只想看看界面

把整个文件夹放到任意静态网站服务器上打开 `index.html`，或者在文件夹里运行：

```bash
python3 -m http.server 8080
```

然后浏览器打开 http://localhost:8080 。能看到登录页和顶部的「还没有配置后端」提示，但不能登录。

### 2. 接上你自己的后端

前提：你已经有一个**和本网页兼容的 Supabase 项目**（见下面第四节，前端需要哪些表、函数和云函数）。

1. 用文本编辑器打开 `index.html`，**全文查找替换**：
   - `your-project-ref` → 你的 Supabase 项目编号（项目地址 `https://xxxx.supabase.co` 里的 `xxxx`）。网页开头的安全策略（Content-Security-Policy）和脚本最前面的 `SUPABASE_URL` 都会被一起换掉；
   - `YOUR_SUPABASE_PUBLISHABLE_KEY` → 你项目的 **publishable key（或 anon key）**，在 Supabase 后台「Project Settings → API Keys」里。
2. **只能填 publishable / anon key**，它本来就是给前端用的公开密钥。**secret key、service_role key、数据库密码绝对不要写进这个文件**，网页是所有人都能看到源码的。
3. 把 `your-email@example.com` 换成你的联系邮箱（登录页「联系方式」、客服说明里会显示）。
4. 修改用户须知和用户使用协议（见下面第 3 步）。
5. 部署到任意 **https** 静态托管，例如 GitHub Pages、Netlify、Vercel、Cloudflare Pages、自己的 Nginx。直接上传整个文件夹即可，不需要编译。
6. 打开网页，顶部的橙色提示条消失就说明配置生效了。

### 3. 修改协议

`legal/` 里的两份 Markdown 只是模板，内容是按原项目的实际做法写的（例如数据存在 Supabase、物流查询用快递100）。**请按你自己的实际情况修改**：运营方名称、所在地、联系邮箱、数据存储位置、第三方服务等。

网页里显示的协议在 `index.html` 的 `<template id="legal-notice">` 和 `<template id="legal-terms">` 里（是 HTML），改完 Markdown 后把对应内容同步过去；同时把 `LEGAL_VERSION` 改成新日期，`LEGAL_CHANGES` 写这次的主要变化，已登录的用户下次打开时会看到「协议已更新」提示。

### 4. 更新版本时

改了 `index.html` 后，把 `sw.js` 第一行附近的 `CACHE` 名字也改一下（例如 `after-sales-radar-6.39.5`），否则用户手机上可能一直显示旧的缓存页面。

## 四、前端依赖的后端能力（供自建后端参考）

以下名称都是从 `index.html` 里实际调用的地方整理出来的；**本包不提供它们的实现**。

- **数据表**：`after_sales_tasks`、`after_sales_events`、`evidence_files`、`evidence_library`、`shop_stores`、`tracking_records`、`support_messages`
- **数据库函数（RPC）**：`is_admin`、`my_account_status`、`my_session_status`、`security_register_device`、`note_login_device`、`my_login_alerts`、`ack_login_alerts`、`remove_my_device`、`revoke_other_sessions`、`online_verify`，以及管理后台用的 `admin_*` 系列（`admin_list_all_users`、`admin_list_all_tasks`、`admin_list_devices`、`admin_set_device_status`、`admin_set_account_ban`、`admin_approve_phone_user`、`admin_revoke_user_sessions` 等）
- **云函数（Edge Functions）**：`kuaidi100-query`（物流查询）、`login-alert-mail`（邮件提醒、换绑、修改密码）、`admin-reset-password`（管理员重置密码）、`phone-password-reset`（手机号找回密码）、`delete-account`（注销账号）
- **文件存储**：私有存储桶 `after-sales-evidence`
- **实时同步**：频道 `after-sales-live`（多设备同步）、`after-sales-online`（在线状态，私有频道）

**安全提醒**：前端隐藏按钮不是安全边界。管理员权限、封禁、数据隔离都必须在后端（数据库行级安全策略 RLS、函数内校验）实现。

## 五、已知限制

- 「提交完成」只是本系统里的记录，**不会**代替你在抖店后台操作，也没有接入抖店官方接口。
- 倒计时、物流状态只作提醒参考，请以抖店后台和快递公司的官方信息为准。
- 网页依赖 `cdn.jsdelivr.net` 加载 Supabase 的前端库，所在网络打不开这个地址时页面无法使用。

## 六、许可证

本发布包以 **MIT 许可证**开放（见 `LICENSE`）：任何人都可以免费使用、复制、修改、合并、发布、分发、再授权和销售，**唯一的条件是在副本中保留原版权声明和许可声明**。软件按「原样」提供，不附带任何担保，作者不对使用本软件造成的任何损失负责。

版权所有 © 2026 wznwzn123
