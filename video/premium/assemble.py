# 用“两次渲染逐帧比对”找坏帧并修好，输出 build/raw_fixed.mp4。
# 背景：无显卡的云端机器上，Chromium 偶尔会漏画某个图层的一块（手机、卡片、背景都可能），而且是随机的；
# 正常画面每次渲染都一模一样。所以：
#   1. 整片渲染两次（c.*.mp4 和 d.*.mp4），逐帧比对；
#   2. 两次不一样的帧，再单独重画，直到某个版本和之前任一版本一致（两票一致就是正确画面）；
#   3. 用一致的版本拼成整片。
# 用法：python3 assemble.py
import glob, json, os, subprocess, sys
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
W, H, FPS, TOTAL = 1080, 1920, 60, 3600
SW, SH = 216, 384          # 比对用的小图（够细，能看出一小块缺失）
CELL = 12                  # 分块比对：任一块平均差超过 THR 就算不一致
THR = 6.0


def concat(prefix, out):
    lst = os.path.join(B, f"{prefix}_parts.txt")
    with open(lst, "w") as f:
        for c in sorted(glob.glob(os.path.join(B, f"{prefix}.[0-9][0-9][0-9][0-9][0-9].mp4"))): f.write(f"file '{c}'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out], check=True)


def decode(src, small=True):
    vf = f"scale={SW}:{SH}" if small else "null"
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray" if small else "rgb24", "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.uint8).reshape((-1, SH, SW) if small else (-1, H, W, 3)).astype(np.float32 if small else np.uint8)


def differ(x, y):
    d = np.abs(x - y).reshape(SH // CELL, CELL, SW // CELL, CELL).mean(axis=(1, 3))
    return d.max() > THR


def ranges_for(frames):
    out = []
    for n in sorted(frames):
        if out and n <= out[-1][1] + 2: out[-1][1] = n
        else: out.append([n, n])
    return out


A, D = os.path.join(B, "raw.mp4"), os.path.join(B, "raw2.mp4")
concat("c", A); concat("d", D)
a, d = decode(A), decode(D)
if len(a) != TOTAL or len(d) != TOTAL: sys.exit(f"帧数不对：{len(a)} / {len(d)}")
cand = [n for n in range(TOTAL) if differ(a[n], d[n])]
print("两次渲染不一致的帧", len(cand), cand[:60])

# 每个不一致的帧收集多个版本，直到有两个版本一致
versions = {n: [("A", n, a[n]), ("D", n, d[n])] for n in cand}
chosen = {}  # 帧号 -> ("A"|"D"|补丁文件, 序号)
todo = list(cand)
for it in range(1, 9):
    if not todo: break
    rs = ranges_for(todo)
    pd = os.path.join(B, f"vote{it}"); os.makedirs(pd, exist_ok=True)
    rf = os.path.join(pd, "ranges.json"); json.dump(rs, open(rf, "w"))
    subprocess.run(["node", "patch.mjs", rf, pd], cwd=os.path.join(here, "remotion"), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    nxt = []
    for r0, r1 in rs:
        f = os.path.join(pd, f"r_{r0}_{r1}.mp4"); s = decode(f)
        if len(s) != r1 - r0 + 1: sys.exit(f"{f} 帧数不对")
        for k, n in enumerate(range(r0, r1 + 1)):
            if n not in versions or n in chosen: continue
            new = (f, k, s[k])
            match = next((v for v in versions[n] if not differ(v[2], new[2])), None)
            if match: chosen[n] = (match[0], match[1])
            else: versions[n].append(new); nxt.append(n)
    todo = nxt
    print(f"第 {it} 轮投票：还有 {len(todo)} 帧没有两个一致的版本")
if todo: sys.exit(f"多轮后仍无法确定：{todo}")

# 输出：默认用第一次渲染（A），投票结果是别的版本的帧换掉
patch = {n: v for n, v in chosen.items() if v[0] != "A"}
print("需要替换的帧", len(patch))
cache = {}
enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", os.path.join(B, "raw_fixed.mp4")], stdin=subprocess.PIPE)
dA = subprocess.Popen(["ffmpeg", "-v", "error", "-i", A, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
dD = subprocess.Popen(["ffmpeg", "-v", "error", "-i", D, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
nb = W * H * 3
for n in range(TOTAL):
    fa = dA.stdout.read(nb); fd = dD.stdout.read(nb)
    if n in patch:
        src, k = patch[n]
        if src == "D": fa = fd
        else:
            if src not in cache: cache = {src: decode(src, small=False)}
            fa = cache[src][k].tobytes()
    enc.stdin.write(fa)
enc.stdin.close(); enc.wait(); dA.wait(); dD.wait()
fin = decode(os.path.join(B, "raw_fixed.mp4"))
print("整片帧数", len(fin))
sys.exit(0 if len(fin) == TOTAL else 1)
