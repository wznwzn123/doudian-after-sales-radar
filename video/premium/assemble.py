# 拼接分段渲染，找出坏帧（手机屏幕上出现大片机身背板颜色的暗块），只重画坏帧附近几帧，
# 反复检查直到没有坏帧，再输出 build/raw_fixed.mp4。修不好就以非零状态退出。
# 原因：无显卡的云端机器上渲染 3D 手机时，偶尔有一帧的图层没画完（机器越忙越常见）。
# 用法：python3 assemble.py
import glob, json, os, subprocess, sys
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
W, H, FPS, TOTAL = 1080, 1920, 60, 3600
SW, SH = 108, 192


def decode(src, small=True):
    vf = f"scale={SW}:{SH}" if small else "null"
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray" if small else "rgb24", "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.uint8).reshape((-1, SH, SW) if small else (-1, H, W, 3))


def is_bad(img, n):
    t = n / FPS
    if not (18.6 <= t < 45.3): return False
    r = img[70:170, 14:42] if t >= 41.3 else img[70:170, 30:80]  # 41.3 秒后右边有台深色手机，只看左边那台
    return (r < 22).mean() > 0.08


def ranges_for(frames):
    out = []
    for n in sorted(frames):
        a, b = max(0, n - 1), min(TOTAL - 1, n + 1)
        if out and a <= out[-1][1] + 1: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return out


# 1 拼接
chunks = sorted(glob.glob(os.path.join(B, "c.[0-9][0-9][0-9][0-9][0-9].mp4")))
with open(os.path.join(B, "parts.txt"), "w") as f:
    for c in chunks: f.write(f"file '{c}'\n")
raw = os.path.join(B, "raw.mp4")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(B, "parts.txt"), "-c", "copy", raw], check=True)
small = decode(raw)
if len(small) != TOTAL: sys.exit(f"帧数不对：{len(small)}")
bad = [n for n in range(TOTAL) if is_bad(small[n], n)]
print("坏帧", len(bad))

# 2 只重画坏帧附近，再检查重画结果，直到没有坏帧
patches = {}  # 帧号 -> (文件, 文件内序号)
todo = bad
for it in range(1, 8):
    if not todo: break
    rs = ranges_for(todo)
    d = os.path.join(B, f"patch{it}"); os.makedirs(d, exist_ok=True)
    rf = os.path.join(d, "ranges.json"); json.dump(rs, open(rf, "w"))
    subprocess.run(["node", "patch.mjs", rf, d], cwd=os.path.join(here, "remotion"), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    todo = []
    for a, b in rs:
        f = os.path.join(d, f"r_{a}_{b}.mp4"); s = decode(f)
        for k, n in enumerate(range(a, b + 1)):
            patches[n] = (f, k)
            if is_bad(s[k], n): todo.append(n)
    print(f"第 {it} 轮：重画 {sum(b - a + 1 for a, b in rs)} 帧，仍有 {len(todo)} 帧坏")
if todo: sys.exit(f"重画多轮后仍有坏帧：{todo}")

# 3 输出修好的整片
cache = {}
enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", os.path.join(B, "raw_fixed.mp4")], stdin=subprocess.PIPE)
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", raw, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
nb = W * H * 3
for n in range(TOTAL):
    fr = dec.stdout.read(nb)
    if n in patches:
        f, k = patches[n]
        if f not in cache: cache = {f: decode(f, small=False)}  # 补丁按时间顺序用，只缓存当前这一个文件
        fr = cache[f][k].tobytes()
    enc.stdin.write(fr)
enc.stdin.close(); enc.wait(); dec.wait()

# 4 最后整片再查一遍
small = decode(os.path.join(B, "raw_fixed.mp4"))
left = [n for n in range(TOTAL) if is_bad(small[n], n)]
print("修好后整片帧数", len(small), "坏帧", len(left), left[:20])
sys.exit(1 if left or len(small) != TOTAL else 0)
