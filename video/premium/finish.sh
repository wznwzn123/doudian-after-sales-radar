#!/usr/bin/env bash
# 合成成品：Remotion 画面 + score.py 配乐/音效，整体增益到约 -15 LUFS，并导出封面。
# 先跑：node record.js；cd remotion && ./render_chunks.sh（见 README）；python3 score.py build
set -euo pipefail
cd "$(dirname "$0")"
O=../out; mkdir -p "$O"
# 1 拼接分段渲染（remotion/render_chunks.sh 输出的 c.*.mp4），找出并重画坏帧 → raw_fixed.mp4
[ build/raw_fixed.mp4 -nt build/d.00000.mp4 ] || python3 assemble.py  # 已经修好就不重做
# 2 成片编码（不加动态模糊和颗粒：帧混合在快速运动处会出现重影，颗粒在平台二次压缩后会变成闪烁的色块）
ffmpeg -y -v error -i build/raw_fixed.mp4 -vf "format=yuv420p" \
  -c:v libx264 -preset slow -crf 16 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 -r 60 build/film.mp4
V=build/film.mp4
# 整体增益到约 -15 LUFS（不压缩动态，峰值不超过 -1 dBFS）；无配乐版用同一个增益
GAIN=$(ffmpeg -hide_banner -i build/mix.wav -af ebur128=peak=sample -f null - 2>&1 | python3 -c "
import re,sys;s=sys.stdin.read();i=float(re.findall(r'I:\s+(-?[\d.]+) LUFS',s)[-1]);p=float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS',s)[-1]);print(round(min(-15-i,-1-p),2))")
echo "audio gain ${GAIN} dB"
ffmpeg -y -v error -i build/mix.wav -af "volume=${GAIN}dB" -ar 48000 build/mix_norm.wav
ffmpeg -y -v error -i build/sfx.wav -af "volume=${GAIN}dB" -ar 48000 build/sfx_norm.wav
ffmpeg -y -v error -i "$V" -i build/mix_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$O/售后雷达_宣传片_60秒.mp4"
ffmpeg -y -v error -i "$V" -i build/sfx_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$O/售后雷达_宣传片_60秒_无配乐.mp4"
ffmpeg -y -v error -ss 15.9 -i build/raw_fixed.mp4 -frames:v 1 -q:v 1 "$O/售后雷达_宣传片_封面.jpg"
# 网页预览用的小文件（720p / 60fps）
ffmpeg -y -v error -i "$O/售后雷达_宣传片_60秒.mp4" -vf "scale=720:-2:flags=lanczos" -c:v libx264 -preset slow -crf 21 -maxrate 1.7M -bufsize 3.4M -c:a aac -b:a 128k -movflags +faststart build/web_60s.mp4
ls -lh "$O"/售后雷达_宣传片_*
