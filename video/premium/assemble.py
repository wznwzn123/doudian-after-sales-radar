# 拼装成片并修补坏帧：
#   1. 按帧号从 raw.mp4（整片）和 pa.*.mp4（产品段重渲染）里取帧
#   2. 在产品段里找“突然变黑”的坏帧（某个区域比前后几帧的中位数暗很多）
#   3. 用 renderStill 单独重画坏帧（最多 3 次），直到通过检查
#   4. 输出整片（只有画面），后期的动态模糊和颗粒由 finish.sh 加
# 用法：python3 assemble.py
import glob, json, os, subprocess, sys
import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
W, H, FPS, TOTAL = 1080, 1920, 60, 3600
PA_FROM, PA_TO = 1050, 2759          # 产品段重渲染的帧范围（含）
CHECK_FROM, CHECK_TO = 1050, 2759    # 检查坏帧的范围
SW, SH = 108, 192                    # 检查用的小图尺寸
GX, GY = 6, 8                        # 分格
THR = 28                             # 某格比滚动中位数暗这么多就算坏帧


def decoder(src, size=None, gray=False, concat=False):
    vf = [f"scale={size[0]}:{size[1]}"] if size else []
    args = ["ffmpeg", "-v", "error"] + (["-f", "concat", "-safe", "0"] if concat else []) + ["-i", src]
    if vf: args += ["-vf", ",".join(vf)]
    args += ["-f", "rawvideo", "-pix_fmt", "gray" if gray else "rgb24", "-"]
    return subprocess.Popen(args, stdout=subprocess.PIPE, bufsize=10 ** 8)


def frames(p, n_bytes):
    while True:
        b = p.stdout.read(n_bytes)
        if len(b) < n_bytes: return
        yield b


pa_list = os.path.join(B, "pa_list.txt")
with open(pa_list, "w") as f:
    for c in sorted(glob.glob(os.path.join(B, "pa.[0-9][0-9][0-9][0-9][0-9].mp4"))): f.write(f"file '{c}'\n")


def sequence(size=None, gray=False):
    """按帧号产出整片的帧（字节串）。"""
    ch = 1 if gray else 3
    nb = (size[0] * size[1] if size else W * H) * ch
    raw = frames(decoder(os.path.join(B, "raw.mp4"), size, gray), nb)
    pa = frames(decoder(pa_list, size, gray, concat=True), nb)
    for n in range(TOTAL):
        r = next(raw)
        yield n, (next(pa) if PA_FROM <= n <= PA_TO else r)


def cells(img):
    a = img.reshape(GY, SH // GY, GX, SW // GX).mean(axis=(1, 3))
    return a.ravel()


def find_bad(vals, lo, hi):
    bad = []
    for i in range(lo, hi + 1):
        win = [j for j in range(i - 6, i + 7) if j != i and 0 <= j < len(vals)]
        med = np.median(vals[win], axis=0)
        if np.max(med - vals[i]) > THR: bad.append(i)
    return bad


# ---------- 1 检测 ----------
small = np.zeros((TOTAL, GX * GY))
for n, b in sequence((SW, SH), gray=True):
    small[n] = cells(np.frombuffer(b, np.uint8).reshape(SH, SW).astype(float))
bad = find_bad(small, CHECK_FROM, CHECK_TO)
print("坏帧", len(bad), bad[:40], "..." if len(bad) > 40 else "")

# ---------- 2 重画坏帧 ----------
patch_dir = os.path.join(B, "patch"); os.makedirs(patch_dir, exist_ok=True)
patched = {}
todo = list(bad)
for attempt in range(3):
    if not todo: break
    need = [n for n in todo if not os.path.exists(os.path.join(patch_dir, f"{n}.{attempt}.png"))]
    if need:
        subprocess.run(["node", "stills.mjs", os.path.join(patch_dir, "{n}." + str(attempt) + ".png"), ",".join(map(str, need))], cwd=os.path.join(here, "remotion"), check=True)
    still_bad = []
    for n in todo:
        img = Image.open(os.path.join(patch_dir, f"{n}.{attempt}.png")).convert("RGB")
        g = np.asarray(img.convert("L").resize((SW, SH), Image.BILINEAR), float)
        v = cells(g)
        win = [j for j in range(n - 6, n + 7) if j != n and j not in bad]
        med = np.median(small[win], axis=0)
        if np.max(med - v) > THR: still_bad.append(n)
        else: patched[n] = os.path.join(patch_dir, f"{n}.{attempt}.png")
    print(f"第 {attempt + 1} 次重画：{len(todo) - len(still_bad)} 帧修好，{len(still_bad)} 帧仍有问题")
    todo = still_bad
if todo: print("警告：这些帧重画 3 次仍不通过：", todo)
json.dump({"bad": bad, "patched": sorted(patched), "unfixed": todo}, open(os.path.join(B, "patch_report.json"), "w"))

# ---------- 3 输出整片 ----------
enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", os.path.join(B, "assembled.mp4")], stdin=subprocess.PIPE)
for n, b in sequence():
    if n in patched: b = np.asarray(Image.open(patched[n]).convert("RGB"), np.uint8).tobytes()
    enc.stdin.write(b)
enc.stdin.close(); enc.wait()
print("wrote assembled.mp4")
