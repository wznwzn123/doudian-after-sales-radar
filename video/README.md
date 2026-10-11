# 售后雷达 Pro 介绍视频

成品在 `out/`：竖屏 9:16（抖音尺寸）、横屏 16:9、GIF 预览、封面图。约 38 秒，带字幕和背景音乐。

**录屏里全部是演示数据**（画面右上角有「演示数据」标记）：用的是真实的 `index.html`，但 Supabase 换成了 `dev/stage2.test.js` 里的测试桩，不连真实数据库。提速图的数字来自 HANDOFF.md 里 Pro 6.12 的实测记录（每个请求模拟 400ms 延迟）。背景音乐由 `music.py` 用代码合成。

## 重新生成
需要 Node（带 Playwright + Chromium）、ffmpeg、Python 3 + numpy、文泉驿正黑字体。

```bash
node video/record_app.js      # 录制网页操作（CDP 截屏流）
node video/render_scenes.js   # 逐帧渲染片头、提速图、功能要点、片尾（scenes.html）
video/build.sh                # 字幕 + 转场 + 音乐，导出 out/ 里的 4 个文件
```

改文案：场景文字在 `scenes.html`，录屏字幕在 `app_subs.ass`，演示数据在 `record_app.js`。
