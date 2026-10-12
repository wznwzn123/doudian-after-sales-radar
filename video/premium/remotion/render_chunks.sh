#!/usr/bin/env bash
# 分段渲染：把帧范围切成小段并行渲染，每段超时就重跑（长时间渲染偶尔会有浏览器分页卡住）
# 用法：./render_chunks.sh <起始帧> <结束帧> <每段帧数> <并行数> <输出前缀>
set -u
cd "$(dirname "$0")"
A=$1; Z=$2; STEP=$3; PAR=$4; PRE=$5
run() {
  local a=$1 b=$2 out="$PRE.$(printf %05d $1).mp4"
  for try in 1 2 3; do
    [ -s "$out" ] && return 0
    CONC=1 timeout 1200 node render.mjs "$out.tmp.mp4" "" "$a-$b" > "$out.log" 2>&1 && mv "$out.tmp.mp4" "$out" && echo "ok $a-$b" && return 0
    echo "retry $a-$b ($try)"; pkill -f "render.mjs $out.tmp.mp4" 2>/dev/null
  done
  echo "FAILED $a-$b"
}
export -f run; export PRE
for ((s=A; s<=Z; s+=STEP)); do e=$((s+STEP-1)); [ $e -gt $Z ] && e=$Z; echo "$s $e"; done | xargs -P "$PAR" -n 2 bash -c 'run "$0" "$1"'
