# 投票之后的补漏：找出“闪一下”的帧（和前后帧都对不上、前后帧彼此一致），单独重画，
# 重画后不再闪才换上。两遍渲染恰好在同一位置坏成类似样子时，投票会漏掉这种帧。
# 用法：python3 fix_outliers.py 1050 2760   （检查的帧范围；结果写回 build/raw_fixed.mp4）
import json, os, shutil, subprocess, sys
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
W, H, FPS, TOTAL = 1080, 1920, 60, 3600
SW, SH, C = 216, 384, 12
LO, HI = int(sys.argv[1]), int(sys.argv[2])


def log(*a): print(*a, flush=True)


def decode(src, small=True):
    vf = f"scale={SW}:{SH}" if small else "null"
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray" if small else "rgb24", "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.uint8).reshape((-1, SH, SW) if small else (-1, H, W, 3)).astype(np.float32 if small else np.uint8)


def cells(x): return x.reshape(SH // C, C, SW // C, C).mean(axis=(1, 3))


def spike(prev, cur, nxt):
    """当前帧有若干块和前一帧差很多，而下一帧又回到前一帧的样子 → 闪了一下。返回闪的块数。"""
    j = np.abs(cells(cur) - cells(prev)); back = np.abs(cells(nxt) - cells(prev))
    return int(((j > 40) & (back < 8)).sum())


base = os.path.join(B, "raw_fixed.mp4")
a = decode(base)
bad = [n for n in range(max(1, LO), min(HI, TOTAL - 2)) if spike(a[n - 1], a[n], a[n + 1]) >= 3]
log("闪一下的帧", len(bad), bad)
if not bad: sys.exit(0)

fixed = {}
todo = bad
for it in range(1, 5):
    if not todo: break
    pd = os.path.join(B, f"outlier_{it}"); os.makedirs(pd, exist_ok=True)
    rf = os.path.join(pd, "ranges.json"); json.dump([[n, n] for n in todo], open(rf, "w"))
    p = subprocess.Popen(["node", "patch.mjs", rf, pd], cwd=os.path.join(here, "remotion"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try: p.wait(timeout=900)
    except subprocess.TimeoutExpired:
        p.kill(); subprocess.run(["pkill", "-9", "-x", "chrome"]); log("重画超时，重试"); continue
    nxt = []
    for n in todo:
        f = os.path.join(pd, f"r_{n}_{n}.mp4"); s = decode(f)[0]
        if spike(a[n - 1], s, a[n + 1]) < 3: fixed[n] = f
        elif np.abs(cells(s) - cells(a[n])).max() < 4: log(f"  {n} 重画结果和原来一样，是正常的快速运动，不替换")
        else: nxt.append(n)
    todo = nxt
    log(f"第 {it} 轮：还有 {len(todo)} 帧在闪")
if todo: sys.exit(f"仍在闪：{todo}")

prev = os.path.join(B, "raw_fixed_prev2.mp4"); shutil.copyfile(base, prev)
enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", base], stdin=subprocess.PIPE)
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", prev, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
nb = W * H * 3
for n in range(TOTAL):
    fr = dec.stdout.read(nb)
    if n in fixed: fr = decode(fixed[n], small=False)[0].tobytes()
    enc.stdin.write(fr)
enc.stdin.close(); enc.wait(); dec.wait()
log("替换", len(fixed), "帧；整片帧数", len(decode(base)))
