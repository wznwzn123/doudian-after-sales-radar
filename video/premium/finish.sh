#!/usr/bin/env bash
# 合成成品：Remotion 画面 + score.py 配乐/音效，响度两遍法统一到 -14 LUFS，并导出封面。
# 先跑：node record.js；cd remotion && ./render_chunks.sh（见 README）；python3 score.py build
set -euo pipefail
cd "$(dirname "$0")"
O=../out; mkdir -p "$O"
# 1 拼接分段渲染（part1 = 0–29.98 秒；p2.*.mp4 = 后半段的 6 小段）
{ echo "file '$PWD/build/part1.mp4'"; for f in "$PWD"/build/p2.[0-9][0-9][0-9][0-9][0-9].mp4; do echo "file '$f'"; done; } > build/parts.txt
[ -s build/raw.mp4 ] || ffmpeg -y -v error -f concat -safe 0 -i build/parts.txt -c copy build/raw.mp4
# 1.5 换上产品段的重渲染（pa.*.mp4），找出并重画坏帧 → assembled.mp4
python3 assemble.py
# 2 后期：快速运动处做帧混合（动态模糊，时间段同 Film.jsx 的 BLUR_WINDOWS）+ 胶片颗粒
EN=$(python3 -c "import re;s=open('remotion/src/Film.jsx',encoding='utf-8').read();w=eval(re.search(r'BLUR_WINDOWS = (\[.*?\]);',s).group(1));print('+'.join(f'between(t,{a},{b})' for a,b in w))")
ffmpeg -y -v error -i build/assembled.mp4 -vf "tmix=frames=3:weights='1 2 1':enable='$EN',noise=alls=6:allf=t+u,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 -r 60 build/film.mp4
V=build/film.mp4
# 整体增益到约 -15 LUFS（不压缩动态，峰值不超过 -1 dBFS）；无配乐版用同一个增益
GAIN=$(ffmpeg -hide_banner -i build/mix.wav -af ebur128=peak=sample -f null - 2>&1 | python3 -c "
import re,sys;s=sys.stdin.read();i=float(re.findall(r'I:\s+(-?[\d.]+) LUFS',s)[-1]);p=float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS',s)[-1]);print(round(min(-15-i,-1-p),2))")
echo "audio gain ${GAIN} dB"
ffmpeg -y -v error -i build/mix.wav -af "volume=${GAIN}dB" -ar 48000 build/mix_norm.wav
ffmpeg -y -v error -i build/sfx.wav -af "volume=${GAIN}dB" -ar 48000 build/sfx_norm.wav
ffmpeg -y -v error -i "$V" -i build/mix_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$O/售后雷达_宣传片_60秒.mp4"
ffmpeg -y -v error -i "$V" -i build/sfx_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$O/售后雷达_宣传片_60秒_无配乐.mp4"
ffmpeg -y -v error -ss 15.9 -i build/assembled.mp4 -frames:v 1 -q:v 1 "$O/售后雷达_宣传片_封面.jpg"
# 网页预览用的小文件（720p / 30fps）
ffmpeg -y -v error -i "$O/售后雷达_宣传片_60秒.mp4" -vf "scale=720:-2,fps=30" -c:v libx264 -preset slow -crf 26 -maxrate 1.6M -bufsize 3.2M -c:a aac -b:a 128k -movflags +faststart build/web_60s.mp4
ls -lh "$O"/售后雷达_宣传片_*
