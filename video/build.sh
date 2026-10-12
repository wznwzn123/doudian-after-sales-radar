#!/usr/bin/env bash
# 把各场景拼成成片：转场 + 字幕 + 背景音乐，再导出横屏版、GIF 预览和封面。
# 先跑：node record_app.js（录屏）和 node render_scenes.js（动画场景）。
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build out
X=0.5   # 转场时长（秒）
# 录屏帧序列 → 30fps 视频 + 字幕
ffmpeg -y -v error -f concat -safe 0 -i build/app_frames.txt \
  -vf "fps=30,scale=1080:1920:flags=lanczos,setsar=1,subtitles=app_subs.ass,format=yuv420p" \
  -c:v libx264 -crf 18 -preset medium build/scene_app_sub.mp4
d() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
D1=$(d build/scene_intro.mp4); D2=$(d build/scene_app_sub.mp4); D3=$(d build/scene_speed.mp4); D4=$(d build/scene_features.mp4); D5=$(d build/scene_outro.mp4)
O1=$(echo "$D1-$X" | bc); O2=$(echo "$O1+$D2-$X" | bc); O3=$(echo "$O2+$D3-$X" | bc); O4=$(echo "$O3+$D4-$X" | bc)
TOTAL=$(echo "$O4+$D5" | bc)
python3 music.py "$TOTAL" build/music.wav
ffmpeg -y -v error -i build/scene_intro.mp4 -i build/scene_app_sub.mp4 -i build/scene_speed.mp4 -i build/scene_features.mp4 -i build/scene_outro.mp4 -i build/music.wav \
  -filter_complex "[0:v]settb=1/30,setsar=1[a];[1:v]settb=1/30,setsar=1[b];[2:v]settb=1/30,setsar=1[c];[3:v]settb=1/30,setsar=1[e];[4:v]settb=1/30,setsar=1[f];\
[a][b]xfade=transition=slideleft:duration=$X:offset=$O1[ab];\
[ab][c]xfade=transition=smoothup:duration=$X:offset=$O2[abc];\
[abc][e]xfade=transition=fade:duration=$X:offset=$O3[abce];\
[abce][f]xfade=transition=circleopen:duration=$X:offset=$O4,format=yuv420p[v]" \
  -map "[v]" -map 5:a -c:v libx264 -crf 20 -preset slow -profile:v high -c:a aac -b:a 160k -movflags +faststart -shortest \
  out/售后雷达_竖屏_9x16.mp4
# 横屏 16:9：模糊放大的画面做背景，原画居中
ffmpeg -y -v error -i out/售后雷达_竖屏_9x16.mp4 -filter_complex \
  "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:2,eq=brightness=-0.08[bg];[0:v]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]" \
  -map "[v]" -map 0:a -c:v libx264 -crf 21 -preset medium -c:a copy -movflags +faststart out/售后雷达_横屏_16x9.mp4
# GIF 预览（录屏片段，360 宽，12fps）
ffmpeg -y -v error -ss 3.6 -t 11 -i out/售后雷达_竖屏_9x16.mp4 -vf "fps=12,scale=360:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" out/售后雷达_预览.gif
# 封面（片头最后一帧）
ffmpeg -y -v error -ss 3.4 -i out/售后雷达_竖屏_9x16.mp4 -frames:v 1 -q:v 2 out/售后雷达_封面.jpg
echo "total ${TOTAL}s"; ls -lh out
