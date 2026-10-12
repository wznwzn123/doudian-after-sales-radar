#!/usr/bin/env bash
# 给 Remotion 用的 Chromium 包装：每帧截图前先把所有图块画完（3D 手机层多时，不加会出现黑块）
exec /opt/pw-browsers/chromium --run-all-compositor-stages-before-draw --disable-checker-imaging --force-gpu-mem-available-mb=4096 "$@"
