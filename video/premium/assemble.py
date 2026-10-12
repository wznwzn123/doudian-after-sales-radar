# 拼接分段渲染，检查坏帧，只重画坏帧附近几帧，反复检查直到干净，再输出 build/raw_fixed.mp4。
# 坏帧的三种样子（无显卡环境渲染 3D 手机时偶发）：屏幕上一块块黑、整片露出机身背后的灰色金属层、和前后帧对不上。
# 修不好就以非零状态退出，不让有瑕疵的成片继续往下走。
# 用法：python3 assemble.py
import glob, json, os, subprocess, sys
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
W, H, FPS, TOTAL = 1080, 1920, 60, 3600
SW, SH = 108, 192
LO, HI = int(18.6 * FPS), int(45.3 * FPS)          # 有手机的产品段
CUTS = [24.0, 29.0, 35.0, 40.0, 41.3]               # 镜头切换处，前后帧本来就对不上


def decode(src, small=True):
    vf = f"scale={SW}:{SH}" if small else "null"
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray" if small else "rgb24", "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.uint8).reshape((-1, SH, SW) if small else (-1, H, W, 3)).astype(np.float32 if small else np.uint8)


def region(a, n):
    return a[n, 70:170, 14:42] if n / FPS >= 41.3 else a[n, 70:170, 30:80]  # 41.3 秒后右边有台深色手机，只看左边那台


def find_bad(a):
    bright = np.array([(region(a, n) > 170).mean() for n in range(TOTAL)])
    bad = set()
    for n in range(LO, HI):
        r = region(a, n)
        if (r < 22).mean() > 0.06: bad.add(n)                                   # 黑块
        win = [j for j in range(n - 8, n + 9) if j != n and LO <= j < HI]
        m = np.median(bright[win])
        if m > 0.15 and bright[n] < 0.6 * m: bad.add(n)                        # 屏幕亮度突然暴跌（露出灰色背板）
        near_cut = any(abs(n / FPS - c) < 3 / FPS for c in CUTS)
        if not near_cut and 0 < n < TOTAL - 1:                                  # 和前后帧都对不上，而前后帧彼此一致
            ph = a[n, 50:185, 5:103]; pv = a[n - 1, 50:185, 5:103]; nx = a[n + 1, 50:185, 5:103]
            d = np.abs(ph - (pv + nx) / 2).mean(); base = np.abs(pv - nx).mean()
            if d > 6 and d > 4 * base: bad.add(n)
    return sorted(bad)


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
small = small.copy()
bad = find_bad(small)
print("坏帧", len(bad), bad[:40])

# 2 只重画坏帧附近；把重画结果放回去后整段重新检查，直到没有坏帧
patches = {}  # 帧号 -> (文件, 文件内序号)
todo = bad
for it in range(1, 8):
    if not todo: break
    rs = ranges_for(todo)
    d = os.path.join(B, f"patch{it}"); os.makedirs(d, exist_ok=True)
    rf = os.path.join(d, "ranges.json"); json.dump(rs, open(rf, "w"))
    subprocess.run(["node", "patch.mjs", rf, d], cwd=os.path.join(here, "remotion"), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for a, b in rs:
        f = os.path.join(d, f"r_{a}_{b}.mp4"); s = decode(f)
        if len(s) != b - a + 1: sys.exit(f"{f} 帧数不对")
        for k, n in enumerate(range(a, b + 1)):
            patches[n] = (f, k); small[n] = s[k]
    todo = find_bad(small)
    print(f"第 {it} 轮：重画 {sum(b - a + 1 for a, b in rs)} 帧，整段复查后还有 {len(todo)} 帧坏 {todo[:20]}")
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
        if f not in cache: cache = {f: decode(f, small=False)}
        fr = cache[f][k].tobytes()
    enc.stdin.write(fr)
enc.stdin.close(); enc.wait(); dec.wait()

# 4 最后整片再查一遍
final = decode(os.path.join(B, "raw_fixed.mp4"))
left = find_bad(final) if len(final) == TOTAL else ["帧数不对"]
print("修好后整片帧数", len(final), "坏帧", len(left), left[:20])
sys.exit(1 if left else 0)
