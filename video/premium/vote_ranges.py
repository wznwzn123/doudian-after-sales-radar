# 只重做部分片段时用：把指定帧段的两遍渲染（前缀 ra / rb）逐帧比对、投票修好，
# 另可指定单独几帧（用旧的两遍整片 raw.mp4 / raw2.mp4 投票），
# 再替换进已经修好的整片 build/raw_fixed.mp4（原文件先备份成 raw_fixed_prev.mp4）。
# 比对和投票的做法同 assemble.py：随机坏帧两遍不会一样，正常画面两遍一模一样。
# 用法：python3 vote_ranges.py 200-519 1050-2759 108 134 ...
import glob, json, os, shutil, subprocess, sys
import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(here, "build")
W, H, FPS, TOTAL = 1080, 1920, 60, 3600
SW, SH, CELL, THR = 216, 384, 8, 3.0
segs = [tuple(map(int, s.split("-"))) for s in sys.argv[1:] if "-" in s]
EXTRA = sorted(int(s) for s in sys.argv[1:] if "-" not in s)


def log(*a): print(*a, flush=True)


def decode(src, small=True):
    vf = f"scale={SW}:{SH}" if small else "null"
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray" if small else "rgb24", "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.uint8).reshape((-1, SH, SW) if small else (-1, H, W, 3)).astype(np.float32 if small else np.uint8)


def differ(x, y):
    return np.abs(x - y).reshape(SH // CELL, CELL, SW // CELL, CELL).mean(axis=(1, 3)).max() > THR


def patch_render(ranges, outdir):
    """重画指定帧段；偶尔会卡死，所以限时 10 分钟，超时就杀掉浏览器重来。"""
    rf = os.path.join(outdir, "ranges.json"); json.dump(ranges, open(rf, "w"))
    for attempt in range(3):
        p = subprocess.Popen(["node", "patch.mjs", rf, outdir], cwd=os.path.join(here, "remotion"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            if p.wait(timeout=600) == 0: return
        except subprocess.TimeoutExpired:
            p.kill(); log("  重画超时，重试")
        subprocess.run(["pkill", "-9", "-x", "chrome"]); subprocess.run(["pkill", "-9", "-x", "chromium"])
    sys.exit("重画多次失败")


def vote(versions, tag):
    """versions: 帧号 -> [(文件, 序号, 小图), ...]。重画到有两个版本一致为止。返回 帧号 -> (文件, 序号)。"""
    chosen, todo = {}, sorted(versions)
    for it in range(1, 9):
        if not todo: break
        rs = []
        for n in todo:
            if rs and n <= rs[-1][1] + 2: rs[-1][1] = n
            else: rs.append([n, n])
        pd = os.path.join(B, f"vote_{tag}_{it}"); os.makedirs(pd, exist_ok=True)
        patch_render(rs, pd)
        nxt = []
        for r0, r1 in rs:
            f = os.path.join(pd, f"r_{r0}_{r1}.mp4"); s = decode(f)
            for k, n in enumerate(range(r0, r1 + 1)):
                if n not in versions or n in chosen: continue
                match = next((v for v in versions[n] if not differ(v[2], s[k])), None)
                if match: chosen[n] = (match[0], match[1])
                else: versions[n].append((f, k, s[k])); nxt.append(n)
        todo = nxt
        log(f"  {tag} 第 {it} 轮投票：还有 {len(todo)} 帧没有两个一致的版本")
    if todo: sys.exit(f"{tag} 多轮后仍无法确定：{todo}")
    return chosen


def seg_file(prefix, a, b):
    files = [f for f in sorted(glob.glob(os.path.join(B, f"{prefix}.[0-9][0-9][0-9][0-9][0-9].mp4"))) if a <= int(f.split(".")[-2]) <= b]
    lst = os.path.join(B, f"{prefix}_{a}.txt")
    with open(lst, "w") as f:
        for x in files: f.write(f"file '{x}'\n")
    out = os.path.join(B, f"{prefix}_{a}_{b}.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out], check=True)
    return out


source = {}  # 帧号 -> (文件, 文件内序号)；没列出的帧沿用旧整片
for a, b in segs:
    fa, fb = seg_file("ra", a, b), seg_file("rb", a, b)
    sa, sb = decode(fa), decode(fb)
    if len(sa) != b - a + 1 or len(sb) != b - a + 1: sys.exit(f"{a}-{b} 帧数不对：{len(sa)} / {len(sb)}")
    for n in range(a, b + 1): source[n] = (fa, n - a)
    cand = [a + i for i in range(len(sa)) if differ(sa[i], sb[i])]
    log(f"{a}-{b}：两遍不一致 {len(cand)} 帧")
    source.update(vote({n: [(fa, n - a, sa[n - a]), (fb, n - a, sb[n - a])] for n in cand}, f"seg{a}"))

if EXTRA:
    A, D = os.path.join(B, "raw.mp4"), os.path.join(B, "raw2.mp4")
    sa, sd = decode(A), decode(D)
    cand = [n for n in EXTRA if differ(sa[n], sd[n])]
    log(f"单独帧：{len(EXTRA)} 帧里两遍不一致 {len(cand)} 帧")
    source.update(vote({n: [(A, n, sa[n]), (D, n, sd[n])] for n in cand}, "extra"))

# 输出：顺序读旧整片和各段两遍渲染（不整段载入内存）；补丁和旧整片里的单帧单独取
base = os.path.join(B, "raw_fixed.mp4"); prev = os.path.join(B, "raw_fixed_prev.mp4")
shutil.copyfile(base, prev)
nb = W * H * 3
def reader(src): return subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
def single(src, k):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", f"select=eq(n\\,{k})", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
    return p.stdout
enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", base], stdin=subprocess.PIPE)
dec, seg_readers, cache = reader(prev), {}, {}
for n in range(TOTAL):
    fr = dec.stdout.read(nb)
    seg = next(((a, b) for a, b in segs if a <= n <= b), None)
    if seg:
        if n == seg[0]: seg_readers = {p: reader(os.path.join(B, f"{p}_{seg[0]}_{seg[1]}.mp4")) for p in ("ra", "rb")}
        fra, frb = seg_readers["ra"].stdout.read(nb), seg_readers["rb"].stdout.read(nb)
    if n in source:
        f, k = source[n]
        if seg and f.endswith(f"ra_{seg[0]}_{seg[1]}.mp4"): fr = fra
        elif seg and f.endswith(f"rb_{seg[0]}_{seg[1]}.mp4"): fr = frb
        elif f.endswith("/raw.mp4") or f.endswith("/raw2.mp4"): fr = single(f, k)
        else:
            if f not in cache: cache = {f: decode(f, small=False)}  # 补丁文件很小，只缓存当前一个
            fr = cache[f][k].tobytes()
    enc.stdin.write(fr)
enc.stdin.close(); enc.wait(); dec.wait()
log("整片帧数", len(decode(base)))
