# 售后雷达 Pro 5.0 云端高级版

已配置 Supabase Project URL + Publishable key。

## 已包含
- 邮箱注册/登录、跨设备云端同步
- 售后工作台、状态/风险筛选、搜索
- 买家拒绝协商 -> 待举证 -> 3小时倒计时
- 提交举证后立即停止倒计时，并持久化到云端
- 关闭浏览器后，Supabase Cron 可继续处理到期任务
- 图片、视频、PDF/DOC/TXT 云端私有 Storage
- 图片/视频预览、删除、事件时间线
- 快递号与盯单状态云端保存
- Realtime 实时同步
- JSON 备份
- PWA 手机安装
- 高级移动端 UI

## 重要边界
“提交当前举证”“3小时自动处理”在当前版本代表本系统云端状态处理，不等于抖店官方提交。要真正调用抖店提交接口，需要官方开放平台应用、商家授权和对应 API 权限。

## Supabase
如果 SQL 已经成功执行，不需要重复建表。若之前遇到 `permission denied for table after_sales_tasks`，确保 authenticated 有 SELECT/INSERT/UPDATE/DELETE 权限，并保留原有 RLS policy。
