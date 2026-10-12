# 售后雷达 Pro 宣传视频

## 第 3 版：1 分钟精品宣传片（推荐）
成品在 `out/`：`售后雷达_宣传片_60秒.mp4`（配乐 + 音效）、`售后雷达_宣传片_60秒_无配乐.mp4`（只有音效，发抖音时可自选音乐）、`售后雷达_宣传片_封面.jpg`。

1080×1920，60fps，约 60 秒，四幕：痛点（倒计时归零）→ 品牌登场（App 图标绘制）→ 产品功能（3D 手机 + 界面卡片浮出）→ 收尾。没有旁白，靠画面文字和配乐。

- 画面用最新版 `index.html`（Pro 6.33）录制，Supabase 换成 `dev/stage2.test.js` 的测试桩，数据在 `premium/demo-data.js`，**全部是演示数据**；痛点段的通知和倒计时是情景演绎。
- 品牌色和图标按 `dev/app-icon.html` 重建。字体：思源黑体（Noto Sans SC，SIL OFL）。
- 配乐和音效由 `premium/score.py` 用代码合成（含立体声混响、侧链），无版权问题。

重新生成：
```bash
cd video/premium
node record.js                         # 录镜头和浮出卡片截图（需要 .app-main.html / .stage2-main.js，见 record.js 顶部）
cd remotion && npm install && node render.mjs ../build/film.mp4 && cd ..
python3 score.py build && ./finish.sh
```
改文案和节奏：`premium/remotion/src/plan.json`（时间点）和 `src/Film.jsx`（各场景）。

## 第 2 版：店主痛点版（Remotion 制作，推荐）
成品在 `out/`：

| 文件 | 用途 |
|---|---|
| `售后雷达_店主痛点_40秒_完整版.mp4` / `…_15秒_完整版.mp4` | 字幕 + 配乐 + 音效都有，可以直接发 |
| `售后雷达_店主痛点_40秒_无配乐.mp4` / `…_15秒_无配乐.mp4` | 有字幕和音效、没有音乐：发抖音时在抖音里直接选热门音乐 |
| `售后雷达_店主痛点_40秒_剪映素材.mp4` / `…_15秒_剪映素材.mp4` | 无字幕、无配乐，只有音效：导入剪映后加 AI 配音和音乐 |
| `售后雷达_店主痛点_40秒.srt` / `…_15秒.srt` | 字幕文件，剪映里「文本 → 本地字幕」导入 |
| `旁白稿_剪映配音用.txt` | 每句旁白和它在视频里的时间 |
| `售后雷达_封面_痛点版.jpg` | 封面 |

1080×1920，60fps。字体是思源黑体（Noto Sans SC，SIL OFL 免费商用）；配乐和音效由 `remotion/audio.py` 用代码合成。

**录屏里全部是演示数据**（画面右上角标着「画面为演示数据」）：用的是真实的 `index.html`，但 Supabase 换成了 `dev/stage2.test.js` 里的测试桩，数据在 `remotion/demo-data.js`。开头的「通知堆成山」和「已自动同意退款」是情景演绎，不是 App 的界面。

### 只用手机：换成抖音的音乐
发抖音时上传 `…_无配乐.mp4`，在发布页「选择音乐」里挑一首，音量调低一些，别盖过音效。

### 在剪映专业版（电脑）里加 AI 配音和音乐（约 5 分钟）
1. 剪映专业版 → 开始创作 → 导入 `…_剪映素材.mp4`。
2. 文本 → 本地字幕 → 导入对应的 `.srt`（字幕会按时间自动对齐）。手机版剪映不一定能导入 SRT，所以这一步建议用电脑。
3. 选中字幕 → 朗读 → 选一个声音，勾选「应用到全部字幕」。如果哪句读得太长，把那句的朗读稍微加速。
4. 音频 → 音乐，选一首，音量调到 15～25，避免盖过配音。
5. 导出 1080p / 60fps。

### 重新生成
需要 Node 22、ffmpeg、Python 3 + numpy，以及 `/opt/pw-browsers/chromium`。

```bash
cd video/remotion
npm install
node record_shots.js                                   # 录 4 个镜头 → public/shots/*.mp4 和 src/shots.json
for v in long short; do for s in 1 0; do node render.mjs $v $s ../build/${v}_subs$s.mp4; done; done
./finish.sh                                            # 加声音，导出 out/ 里的文件
```

改文案和时间：`remotion/src/timeline.json`（场景、旁白/字幕、镜头推近时间）。改画面：`remotion/src/Video.jsx`。

Remotion 的许可：个人和 3 人以内的团队免费，人数更多的公司需要购买许可（见 remotion.dev/license）。

## 第 1 版：功能介绍版
`out/售后雷达_竖屏_9x16.mp4` 等 4 个文件，用 `record_app.js`、`render_scenes.js`、`build.sh` 生成（网页动画逐帧截图 + ffmpeg 拼接）。
