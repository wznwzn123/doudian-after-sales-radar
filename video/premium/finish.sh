#!/usr/bin/env bash
# 合成成品：Remotion 画面 + score.py 配乐/音效，响度两遍法统一到 -14 LUFS，并导出封面。
# 先跑：node record.js；cd remotion && node render.mjs ../build/film.mp4；python3 score.py build
set -euo pipefail
cd "$(dirname "$0")"
V=build/film.mp4; O=../out; mkdir -p "$O"
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
ffmpeg -y -v error -ss 15.9 -i "$V" -frames:v 1 -q:v 1 "$O/售后雷达_宣传片_封面.jpg"
ls -lh "$O"/售后雷达_宣传片_*
