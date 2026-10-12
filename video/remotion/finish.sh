#!/usr/bin/env bash
# 合成成品：画面（Remotion 渲染）+ 声音（audio.py），并导出 SRT 字幕和旁白稿。
# 先跑：node record_shots.js；node render.mjs <long|short> <1|0> ../build/<v>_subs<1|0>.mp4
set -euo pipefail
cd "$(dirname "$0")"
B=../build; O=../out
mkdir -p "$O"
for v in long short; do
  python3 audio.py $v $B >/dev/null
  title=$(python3 -c "import json;print(json.load(open('src/timeline.json'))['versions']['$v']['title'])")
  # 完整版：字幕 + 配乐 + 音效，响度统一到 -14 LUFS（抖音常用）
  ffmpeg -y -v error -i $B/${v}_subs1.mp4 -i $B/${v}_music_sfx.wav -map 0:v -map 1:a -c:v copy \
    -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart "$O/${title}_完整版.mp4"
  # 无配乐版：有字幕和音效，没有音乐。发抖音时直接在抖音里选音乐
  ffmpeg -y -v error -i $B/${v}_subs1.mp4 -i $B/${v}_sfx.wav -map 0:v -map 1:a -c:v copy \
    -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart "$O/${title}_无配乐.mp4"
  # 剪映素材：无字幕、无配乐，只保留音效，导入剪映后加 AI 配音和音乐
  ffmpeg -y -v error -i $B/${v}_subs0.mp4 -i $B/${v}_sfx.wav -map 0:v -map 1:a -c:v copy \
    -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart "$O/${title}_剪映素材.mp4"
  # SRT 字幕
  python3 - "$v" "$O/${title}.srt" <<'PY'
import json, sys
v, out = sys.argv[1], sys.argv[2]
tl = json.load(open("src/timeline.json", encoding="utf-8"))["versions"][v]
ts = lambda x: "%02d:%02d:%02d,%03d" % (x // 3600, x % 3600 // 60, int(x % 60), round(x * 1000) % 1000)
with open(out, "w", encoding="utf-8") as f:
    for i, (a, b, t) in enumerate(tl["voice"], 1): f.write(f"{i}\n{ts(a)} --> {ts(b)}\n{t}\n\n")
PY
done
# 封面：钩子画面「已自动同意退款」（无字幕版，第 2.3 秒）
ffmpeg -y -v error -ss 2.3 -i $B/long_subs0.mp4 -frames:v 1 -q:v 2 "$O/售后雷达_封面_痛点版.jpg"
# 旁白稿
python3 - "$O/旁白稿_剪映配音用.txt" <<'PY'
import json, sys
tl = json.load(open("src/timeline.json", encoding="utf-8"))
with open(sys.argv[1], "w", encoding="utf-8") as f:
    for v in ["long", "short"]:
        x = tl["versions"][v]; f.write(f"【{x['title']}】\n")
        for a, b, t in x["voice"]: f.write(f"{a:5.1f}s – {b:5.1f}s  {t}\n")
        f.write("\n")
PY
ls -lh "$O"
