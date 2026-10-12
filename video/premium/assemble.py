# 拼接分段渲染并检查坏帧（手机屏幕上出现大片机身背板颜色的暗块）。
# 有坏帧就列出帧号并以非零状态退出，不让有瑕疵的成片继续往下走。
# 用法：python3 assemble.py
import glob, os, subprocess, sys
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
chunks = sorted(glob.glob(os.path.join(B, "c.[0-9][0-9][0-9][0-9][0-9].mp4")))
with open(os.path.join(B, "parts.txt"), "w") as f:
    for c in chunks: f.write(f"file '{c}'\n")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(B, "parts.txt"), "-c", "copy", os.path.join(B, "raw.mp4")], check=True)

SW, SH, FPS = 108, 192, 60
p = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(B, "raw.mp4"), "-vf", f"scale={SW}:{SH}", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True)
a = np.frombuffer(p.stdout, np.uint8).reshape(-1, SH, SW).astype(float)
print("帧数", len(a))
if len(a) != 3600: sys.exit("帧数不对")
bad = []
for n in range(int(18.6 * FPS), int(45.3 * FPS)):
    t = n / FPS
    # 41.3 秒后右边多了一台深色手机，只看左边那台
    region = a[n, 70:170, 14:42] if t >= 41.3 else a[n, 70:170, 30:80]
    if (region < 22).mean() > 0.08: bad.append(n)
print("坏帧", len(bad), bad[:50])
sys.exit(1 if bad else 0)
