#!/usr/bin/env bash
# 不用模拟显卡（SwiftShader），直接用 CPU 合成和光栅化：3D 手机层多时不会丢图块
exec /opt/pw-browsers/chromium "$@" --disable-gpu --disable-gpu-compositing --disable-software-rasterizer --run-all-compositor-stages-before-draw --disable-checker-imaging
