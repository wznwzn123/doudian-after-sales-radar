# 售后雷达 Pro 5.0 云端完整版

## 目录
- `index.html`：手机网页版
- `supabase/schema.sql`：数据库、RLS、私有文件桶
- `supabase/functions/process-deadlines/index.ts`：服务器端到期任务处理

## 1. 创建 Supabase 项目
进入 Supabase 控制台创建项目。

## 2. 执行数据库
打开 SQL Editor，把 `supabase/schema.sql` 全部执行。

## 3. 配置前端
打开 `index.html` 顶部：

const CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY"
};

替换成你的 Project URL 和 Publishable key。
不要把 Service Role Key 放进 index.html。

## 4. 上传
把 `index.html` 放到 GitHub Pages / 其他静态网站托管。

## 5. 使用
注册账号 -> 登录 -> 新建售后 -> 填写信息 -> 上传举证材料 -> 保存。

视频/图片会上传到私有 Storage。
换手机后使用同一个账号登录即可重新加载。

## 6. 3小时任务
网页会保存绝对 deadline。
页面打开时会实时倒计时，并在过期时检查。
如果要做到“浏览器完全退出后也由服务器处理”，部署 Edge Function：
supabase/functions/process-deadlines/index.ts

然后使用 Supabase Cron 或其他服务器定时器每分钟调用：
POST /functions/v1/process-deadlines
Authorization: Bearer <CRON_SECRET>

CRON_SECRET、SUPABASE_SERVICE_ROLE_KEY 只能放服务器环境变量。

## 7. 重要边界
这个版本的“提交”是你自己云端系统的提交状态。
在没有接通抖店官方 API/授权之前，不能宣称已经把举证提交到了抖店。

## 8. iPhone / Android
使用标准 HTML file input：
- 视频：video/*
- 图片：image/*
- 文件：PDF/DOC/DOCX/TXT

建议视频使用 MP4(H.264/AAC)。
单文件前端限制为 500MB；实际可用容量还取决于你的云存储套餐和网络。


# 手机使用 / PWA 安装

部署到 HTTPS 的 GitHub Pages 后，Android Chrome/Edge 或 iPhone Safari 打开网页即可。
浏览器菜单中选择“添加到主屏幕/添加到主屏幕”，安装后会像 App 一样打开。

PWA 文件：
- `manifest.webmanifest`
- `sw.js`
- `icons/icon-192.png`
- `icons/icon-512.png`

# 云端 3 小时后台任务

推荐直接使用 Supabase Cron + PostgreSQL 函数。
在 SQL Editor 执行更新后的 `supabase/schema.sql` 后，到：
Integrations → Cron
确认 `after-sales-deadline-every-minute` 为 Active。

它每分钟检查一次到期的“待举证”任务。
因此即使手机锁屏、退出网页或关闭浏览器，任务仍由 Supabase 云端执行。

注意：
“自动完成本地处理”不等于“已提交抖店仲裁”。真正向抖店提交必须接入官方 API、商家授权及对应的举证接口。
