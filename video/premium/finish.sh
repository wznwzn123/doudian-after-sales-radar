#!/usr/bin/env bash
# 合成成品：Remotion 画面 + score.py 配乐/音效，响度两遍法统一到 -14 LUFS，并导出封面。
# 先跑：node record.js；cd remotion && 渲染 part1/part2（见 README）；python3 score.py build
set -euo pipefail
cd "$(dirname "$0")"
O=../out; mkdir -p "$O"
# 1 拼接两段渲染
printf "file '%s'\nfile '%s'\n" "$PWD/build/part1.mp4" "$PWD/build/part2.mp4" > build/parts.txt
ffmpeg -y -v error -f concat -safe 0 -i build/parts.txt -c copy build/raw.mp4
# 2 后期：快速运动处做帧混合（动态模糊，时间段同 Film.jsx 的 BLUR_WINDOWS）+ 胶片颗粒
EN=$(python3 -c "import re;s=open('remotion/src/Film.jsx',encoding='utf-8').read();w=eval(re.search(r'BLUR_WINDOWS = (\[.*?\]);',s).group(1));print('+'.join(f'between(t,{a},{b})' for a,b in w))")
ffmpeg -y -v error -i build/raw.mp4 -vf "tmix=frames=3:weights='1 2 1':enable='$EN',noise=alls=6:allf=t+u,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 -r 60 build/film.mp4
V=build/film.mp4
norm() { # $1 输入 wav，$2 输出 wav，$3 目标 LUFS
  local j; j=$(ffmpeg -hide_banner -i "$1" -af loudnorm=I=$3:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
  local ii tp lra th off
  ii=$(echo "$j" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset'])")
  read -r ii tp lra th off <<<"$ii"
  ffmpeg -y -v error -i "$1" -af "loudnorm=I=$3:TP=-1.5:LRA=11:measured_I=$ii:measured_TP=$tp:measured_LRA=$lra:measured_thresh=$th:offset=$off:linear=true" -ar 48000 "$2"
}
norm build/mix.wav build/mix_norm.wav -14
norm build/sfx.wav build/sfx_norm.wav -20
ffmpeg -y -v error -i "$V" -i build/mix_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$O/售后雷达_宣传片_60秒.mp4"
ffmpeg -y -v error -i "$V" -i build/sfx_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$O/售后雷达_宣传片_60秒_无配乐.mp4"
ffmpeg -y -v error -ss 15.9 -i build/raw.mp4 -frames:v 1 -q:v 1 "$O/售后雷达_宣传片_封面.jpg"
# 网页预览用的小文件（720p / 30fps）
ffmpeg -y -v error -i "$O/售后雷达_宣传片_60秒.mp4" -vf "scale=720:-2,fps=30" -c:v libx264 -preset slow -crf 26 -maxrate 1.6M -bufsize 3.2M -c:a aac -b:a 128k -movflags +faststart build/web_60s.mp4
ls -lh "$O"/售后雷达_宣传片_*
