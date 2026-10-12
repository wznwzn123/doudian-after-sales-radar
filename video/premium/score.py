# 宣传片配乐与音效（全部用代码合成，无版权问题），时间点取自 remotion/src/plan.json。
# 用法：python3 score.py <输出目录>
# 输出：music.wav（只有音乐）、sfx.wav（只有音效）、mix.wav（音乐+音效）。48 kHz 立体声。
import json, os, sys, wave
import numpy as np

SR = 48000
here = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(here, "remotion/src/plan.json"), encoding="utf-8"))
C = P["cues"]
DUR = P["duration"]
N = int(DUR * SR) + SR * 4  # 多留 4 秒给混响尾巴，最后再截断
outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "build")
rng = np.random.default_rng(20261012)
BEAT = 60 / P["bpm"]; BAR = BEAT * 4
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def track(): return np.zeros((2, N))


def put(buf, t, x, pan=0.0, gain=1.0):
    """把单声道或立体声片段放到 t 秒处；pan -1..1 等功率声像。"""
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.vstack([x * np.cos(a), x * np.sin(a)])
    s = int(round(t * SR))
    if s < 0: x = x[:, -s:]; s = 0
    e = min(N, s + x.shape[1])
    if e > s: buf[:, s:e] += gain * x[:, :e - s]


def env(n, a=0.005, d=0.1, s=0.7, r=0.2, hold=None):
    t = np.arange(n) / SR
    hold = hold if hold is not None else n / SR - r
    e = np.where(t < a, t / max(a, 1e-5), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-5), s))
    return e * np.exp(-np.maximum(t - hold, 0) / max(r / 5, 1e-5))


def fft_filter(x, lo=0, hi=None, tilt=0.0):
    """频域滤波：带通 + 倾斜（每倍频程 tilt dB）。"""
    n = x.shape[-1]; X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo: g *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi: g *= 1 / (1 + (f / hi) ** 4)
    if tilt: g *= (np.maximum(f, 20) / 1000) ** (tilt / 6.02)
    return np.fft.irfft(X * g, n)


def noise(n, lo=0, hi=None): return fft_filter(rng.standard_normal(n), lo, hi)


def saw(midi, dur, cutoff=3000, voices=5, detune=0.12, spread=0.8, a=0.4, r=0.8, s=1.0, d=0.2):
    """多音色锯齿（超级锯齿）：加法合成，按截止频率衰减谐波，立体声展开。"""
    n = int((dur + r) * SR); t = np.arange(n) / SR; out = np.zeros((2, n))
    for v in range(voices):
        cents = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2) * detune * 100 if voices > 1 else 0
        f = hz(midi) * 2 ** (cents / 1200); ph = rng.random() * 6.283
        K = int(min(48, max(1, cutoff * 2.2 // f)))
        w = sum((1 / k) / (1 + (k * f / cutoff) ** 2) * np.sin(2 * np.pi * k * f * t + ph * k) for k in range(1, K + 1))
        pan = ((v / max(1, voices - 1)) * 2 - 1) * spread if voices > 1 else 0
        an = (pan + 1) * np.pi / 4
        out[0] += w * np.cos(an); out[1] += w * np.sin(an)
    return out / voices * env(n, a, d, s, r, hold=dur)


def ks_pluck(midi, dur, bright=4000, decay=0.996):
    """Karplus-Strong 拨弦。"""
    f = hz(midi); Pp = max(2, int(round(SR / f))); n = int(dur * SR)
    buf = np.zeros(n + Pp + 1)
    buf[:Pp] = fft_filter(rng.uniform(-1, 1, Pp * 8), 0, bright)[:Pp]
    for st in range(Pp, n, Pp):
        L = min(Pp, n - st)
        buf[st:st + L] = decay * 0.5 * (buf[st - Pp:st - Pp + L] + buf[st - Pp - 1:st - Pp - 1 + L] if st - Pp - 1 >= 0 else buf[st - Pp:st - Pp + L] * 2)
    x = buf[:n]; x *= np.minimum(1, (n - np.arange(n)) / (0.02 * SR))
    return x / (np.max(np.abs(x)) + 1e-9)


def bell(midi, dur=2.5, ratio=3.5, index=3.0):
    """FM 钟声。"""
    n = int(dur * SR); t = np.arange(n) / SR; fc = hz(midi)
    I = index * np.exp(-t / 0.35)
    x = np.sin(2 * np.pi * fc * t + I * np.sin(2 * np.pi * fc * ratio * t)) * np.exp(-t / (dur / 4))
    return x * np.minimum(1, t / 0.002)


def sine_sweep(f0, f1, dur, tau):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# ---------- 鼓 ----------
def kick(punch=1.0):
    n = int(0.45 * SR); t = np.arange(n) / SR
    body = sine_sweep(160, 46, 0.45, 0.035) * np.exp(-t / 0.16)
    click = noise(n, 1500, 8000) * np.exp(-t / 0.004)
    return 0.95 * body + 0.18 * punch * click

def clap():
    n = int(0.5 * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for k, d in enumerate([0, 0.011, 0.022, 0.034]):
        s = int(d * SR); m = n - s
        x[s:] += noise(m, 900, 5000) * np.exp(-np.arange(m) / SR / (0.012 if k < 3 else 0.09))
    return 0.6 * x

def hat(open_=False):
    n = int((0.35 if open_ else 0.06) * SR); t = np.arange(n) / SR
    return noise(n, 7000, 16000) * np.exp(-t / (0.11 if open_ else 0.014))

def snare():
    n = int(0.3 * SR); t = np.arange(n) / SR
    return 0.5 * noise(n, 1200, 9000) * np.exp(-t / 0.07) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)

def tick():
    n = int(0.06 * SR); t = np.arange(n) / SR
    return (0.6 * np.sin(2 * np.pi * 2600 * t) + 0.35 * np.sin(2 * np.pi * 4150 * t)) * np.exp(-t / 0.007) + 0.1 * noise(n, 3000, 12000) * np.exp(-t / 0.003)


# ---------- 音效 ----------
def whoosh(dur=0.7):
    n = int(dur * SR); t = np.arange(n) / SR; sh = np.sin(np.pi * t / dur) ** 2
    lo = noise(n, 250, 2500) * sh; hi = noise(n, 2500, 11000) * np.sin(np.pi * np.clip(t / dur * 1.25 - 0.2, 0, 1)) ** 3
    x = 0.5 * lo + 0.3 * hi
    pan = np.linspace(-0.8, 0.8, n); a = (pan + 1) * np.pi / 4
    return np.vstack([x * np.cos(a), x * np.sin(a)])

def riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR; p = t / dur
    bands = [(300, 1200), (900, 3000), (2500, 7000), (6000, 14000)]
    x = np.zeros(n)
    for i, (lo, hi) in enumerate(bands):
        w = np.clip(1 - np.abs(p * (len(bands) - 1) - i), 0, 1)
        x += noise(n, lo, hi) * w
    f = 180 * 2 ** (p * 3.5)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
    return (0.35 * x + 0.12 * tone) * p ** 2

def impact():
    n = int(3.0 * SR); t = np.arange(n) / SR
    boom = sine_sweep(110, 32, 3.0, 0.25) * np.exp(-t / 0.9)
    burst = noise(n, 60, 6000) * np.exp(-t / 0.08)
    crack = noise(n, 2000, 12000) * np.exp(-t / 0.015)
    return 1.0 * boom + 0.45 * burst + 0.25 * crack

def pop(p=0):
    n = int(0.22 * SR); t = np.arange(n) / SR
    f = 520 * 2 ** (p / 12) * (1 + 0.9 * (1 - np.exp(-t / 0.03)))
    return 0.5 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.06) * np.minimum(1, t / 0.003) + 0.08 * noise(n, 2000, 9000) * np.exp(-t / 0.004)

def tap():
    n = int(0.08 * SR); t = np.arange(n) / SR
    return 0.45 * np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.009) + 0.2 * noise(n, 2500, 9000) * np.exp(-t / 0.004)


# ---------- 效果 ----------
def reverb(x, rt=2.4, mix=1.0, pre=0.02, damp=6000):
    """立体声卷积混响：指数衰减噪声脉冲响应。"""
    n_ir = int(rt * SR); t = np.arange(n_ir) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n_ir) * np.exp(-t * 6.9 / rt)
        ir = fft_filter(ir, 120, damp)
        ir = np.concatenate([np.zeros(int(pre * SR)), ir]); ir /= np.sqrt(np.sum(ir ** 2))
        L = x.shape[1] + len(ir); nfft = 1 << (L - 1).bit_length()
        y = np.fft.irfft(np.fft.rfft(x[ch], nfft) * np.fft.rfft(ir, nfft), nfft)[:x.shape[1]]
        out[ch] = y
    return out * mix

def pingpong(x, delay, fb=0.45, n=5, damp=5000):
    """乒乓延迟：回声左右交替，逐次变暗。"""
    y = x.mean(0); out = np.zeros_like(x); d = int(delay * SR)
    for k in range(1, n + 1):
        y = fft_filter(y, 200, damp) * fb
        out[k % 2, d * k:] += y[:N - d * k]
    return out

def duck(times, depth=0.6, rel=0.16):
    """侧链压缩：每个底鼓处把音量压下去再放开。"""
    g = np.ones(N); t = np.arange(N) / SR
    for k in times:
        s = int(k * SR); e = min(N, s + int(rel * 5 * SR))
        if s < N: g[s:e] = np.minimum(g[s:e], 1 - depth * np.exp(-(t[s:e] - k) / rel))
    return g


# ================= 编曲 =================
drums, bass, pads, plucks, bells_, fxm = track(), track(), track(), track(), track(), track()
sfx = track()

# ---------- 第一幕（0–12）：紧张 ----------
imp = C["impact"]
# 低频持续音 D（D1 正弦 + D2 柔和锯齿），9.5 秒处切断
dr = saw(38, imp + 0.05, cutoff=420, voices=3, detune=0.06, a=2.5, r=0.08) * 0.5
sub = np.sin(2 * np.pi * hz(26) * np.arange(int((imp + 0.05) * SR)) / SR) * env(int((imp + 0.05) * SR), 3.0, 0.1, 1, 0.05)
put(pads, 0, dr, gain=0.32); put(bass, 0, sub, gain=0.16)
# 八分音符脉冲，从 2 秒开始，截止频率逐渐打开
t = 2.0
while t < imp - 0.01:
    cut = 280 + 1400 * ((t - 2.0) / (imp - 2.0)) ** 1.6
    put(pads, t, saw(50, BEAT / 2 * 0.55, cutoff=cut, voices=2, detune=0.05, a=0.004, d=0.08, s=0.4, r=0.05).mean(0), gain=0.2 * min(1, (t - 2.0) / 1.5) * (0.6 + 0.4 * (t - 2.0) / (imp - 2.0)))
    t += BEAT / 2
# 心跳（4 秒起，每小节两下）
t = 4.0
while t < imp - 0.2:
    for d, g in [(0, 0.8), (0.17, 0.55)]: put(drums, t + d, kick(0.2), gain=g * (0.45 + 0.3 * (t - 4.0) / (imp - 4.0)))
    t += BAR / 2
# 不协和的高音长音（小二度）
put(pads, 4.0, saw(69, imp - 4.0, cutoff=2500, voices=3, a=3.0, r=0.05), gain=0.06)
put(pads, 4.5, saw(70, imp - 4.5, cutoff=2500, voices=3, a=3.0, r=0.05), gain=0.045)
# 时钟滴答（左右交替）与倒计时
for i, tk in enumerate(C["ticks"]): put(sfx, tk, tick(), pan=-0.35 if i % 2 else 0.35, gain=0.55)
for i, tk in enumerate(C["countdown"]):
    put(sfx, tk, tick(), gain=0.9); put(sfx, tk, bell(81 - i * 2, 0.6, 2.0, 1.5), gain=0.12)
put(fxm, 6.0, riser(imp - 6.0), gain=0.8)
# 重击 + 余震
put(sfx, imp, impact(), gain=1.3)
put(bass, imp + 0.7, (np.sin(2 * np.pi * hz(26) * np.arange(int(2 * SR)) / SR) * env(int(2 * SR), 0.05, 0.1, 1, 1.2, 0.8)), gain=0.12)
put(drums, 10.4, kick(0.1), gain=0.45); put(drums, 10.57, kick(0.1), gain=0.3)
# 反向混响上扬，接品牌
rs0, rs1 = C["reverseSwell"]
chord = track()
for m, pn in zip([50, 57, 64, 66, 73], [-0.5, 0.4, -0.2, 0.3, 0]): put(chord, 0, bell(m + 12, 2.5, 1.0, 1.2), pan=pn, gain=0.4)
wet = reverb(chord[:, :int(4 * SR)] if chord.shape[1] > 4 * SR else chord, rt=3.0)
seg = wet[:, :int((rs1 - rs0) * SR)][:, ::-1] * np.linspace(0, 1, int((rs1 - rs0) * SR)) ** 2
put(fxm, rs0, seg / (np.max(np.abs(seg)) + 1e-9), gain=0.28)

# ---------- 第二幕（12–18）：品牌 ----------
b0 = P["scenes"]["brand"][0]
DMAJ9 = [50, 57, 64, 66, 73]
for m in DMAJ9: put(pads, b0, saw(m, 5.6, cutoff=1800, voices=5, detune=0.1, a=1.2, r=0.4), gain=0.06)
put(bass, b0, (np.sin(2 * np.pi * hz(38) * np.arange(int(6 * SR)) / SR) * env(int(6 * SR), 1.0, 0.1, 1, 0.3, 5.7)), gain=0.12)
sparkle = [74, 76, 78, 81, 83, 86, 88, 90, 93]
t = b0 + 0.25
while t < C["buildUp"][0]:
    put(bells_, t, bell(sparkle[int(rng.random() * len(sparkle))], 1.6, 3.5, 1.5), pan=rng.uniform(-0.8, 0.8), gain=0.05 + 0.03 * rng.random())
    t += BEAT / 2
for i, m in enumerate([74, 78, 81, 86, 90]): put(bells_, C["logoChime"] + i * 0.07, bell(m, 3.0, 3.5, 2.0), pan=-0.4 + i * 0.2, gain=0.13)
put(sfx, b0, whoosh(1.2), gain=0.4)
# 起势：军鼓滚奏加速 + 噪声上扬 + 一拍静默
bu0, bu1 = C["buildUp"]
t = bu0; k = 0
while t < bu1 - 0.01:
    step = BEAT / 2 if t < bu0 + 1.0 else BEAT / 4 if t < bu0 + 1.5 else BEAT / 8
    put(drums, t, snare(), gain=0.15 + 0.4 * (t - bu0) / (bu1 - bu0), pan=rng.uniform(-0.2, 0.2))
    t += step
put(fxm, bu0, riser(bu1 - bu0), gain=0.9)

# ---------- 第三幕 + 第四幕（18–55）：主节奏 ----------
d0 = C["drop"]
PROG = [  # (低音, 和弦音)
    (43, [62, 66, 67, 71]),  # Gmaj7
    (45, [64, 66, 69, 73]),  # A6
    (42, [61, 64, 66, 69]),  # F#m7
    (47, [62, 66, 69, 71]),  # Bm7
]
kicks = []
end_groove = P["scenes"]["end"][0]
b2_0, b2_1 = C["build2"]
bar_i = 0; t = d0
while t < end_groove - 0.01:
    bass_m, ch = PROG[bar_i % 4]
    finale = t >= C["drop2"]
    building = b2_0 <= t < b2_1 + 0.1
    # 铺底和弦（每小节）
    for m, pn in zip(ch, [-0.6, -0.2, 0.2, 0.6]):
        put(pads, t, saw(m, BAR * 0.98, cutoff=2600 if finale else 1700, voices=5 if finale else 4, detune=0.11, a=0.08, d=0.3, s=0.8, r=0.35), pan=pn * 0.3, gain=0.05 if finale else 0.04)
    # 贝斯：八分音符，根音与八度交替
    for j in range(8):
        tb = t + j * BEAT / 2
        if building and tb >= b2_1 - 0.01: break
        m = bass_m - 12 + (12 if j % 2 else 0)
        nb = int(BEAT / 2 * 0.92 * SR)
        body = np.sin(2 * np.pi * hz(bass_m - 12) * np.arange(nb) / SR) * env(nb, 0.005, 0.1, 0.8, 0.05)
        put(bass, tb, ks_pluck(m, nb / SR, bright=1200, decay=0.993)[:nb] * 0.6 + body * 0.7, gain=0.32)
    # 拨弦琶音（十六分音符，带延迟）
    arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12]
    for j, m in enumerate(arp):
        tb = t + j * BEAT / 2
        if building and tb >= b2_1 - 0.01: break
        put(plucks, tb, ks_pluck(m, 0.6, bright=5200, decay=0.995), pan=-0.3 if j % 2 else 0.3, gain=0.12)
    # 鼓
    for j in range(4):
        tb = t + j * BEAT
        if building and tb >= b2_0 + 1.0: break
        put(drums, tb, kick(1.0), gain=1.0 if finale else 0.9); kicks.append(tb)
        if j % 2 == 1: put(drums, tb, clap(), gain=0.55 if finale else 0.45)
        put(drums, tb + BEAT / 2, hat(open_=bar_i >= 4), pan=0.25, gain=0.12 if bar_i >= 4 else 0.0)
    for j in range(16):
        tb = t + j * BEAT / 4
        if building and tb >= b2_0 + 1.0: break
        vel = 0.1 if j % 4 == 0 else 0.055 if j % 2 == 0 else 0.035
        put(drums, tb + (0.012 if j % 2 else 0), hat(), pan=-0.3, gain=vel * (1.2 if finale else 1.0))
    # 功能总览开始加钟声对位
    if t >= P["scenes"]["bento"][0] - 0.01 and not building:
        for j, m in enumerate([ch[3] + 24, ch[2] + 24, ch[1] + 24, ch[2] + 24]):
            put(bells_, t + j * BEAT, bell(m, 1.5, 3.5, 1.2), pan=-0.5 + j * 0.33, gain=0.045)
    # 收尾段的主旋律
    if finale:
        LEAD = {0: [(0, 71, 1), (1, 69, 1), (2, 66, 1.5), (3.5, 69, 0.5)], 1: [(0, 69, 1), (1, 66, 1), (2, 64, 2)],
                2: [(0, 66, 1), (1, 64, 1), (2, 61, 1.5), (3.5, 64, 0.5)], 3: [(0, 66, 1.5), (1.5, 69, 0.5), (2, 71, 2)]}
        for (bt, m, ln) in LEAD[bar_i % 4]:
            put(plucks, t + bt * BEAT, ks_pluck(m + 12, ln * BEAT + 0.4, bright=6500, decay=0.997), gain=0.22)
            put(bells_, t + bt * BEAT, bell(m + 12, ln * BEAT + 1.0, 2.0, 1.0), gain=0.05)
    t += BAR; bar_i += 1
# 第二次起势
t = b2_0 + 1.0
while t < b2_1 - 0.01:
    step = BEAT / 4 if t < b2_0 + 1.5 else BEAT / 8
    put(drums, t, snare(), gain=0.2 + 0.35 * (t - b2_0) / (b2_1 - b2_0)); t += step
put(fxm, b2_0, riser(b2_1 - b2_0), gain=0.85)
put(sfx, C["drop2"], impact(), gain=0.55)
put(drums, d0, kick(1.0), gain=0.6); put(sfx, d0, impact(), gain=0.35)

# ---------- 结尾（55–60）：长和弦 ----------
e0 = P["scenes"]["end"][0]
for m, pn in zip([38, 50, 57, 64, 66, 69, 73], [0, -0.3, 0.3, -0.5, 0.5, -0.2, 0.2]):
    put(pads, e0, saw(m, 3.6, cutoff=2200, voices=5, detune=0.1, a=0.05, d=0.8, s=0.7, r=1.6), pan=pn * 0.4, gain=0.05 if m > 40 else 0.12)
put(drums, e0, kick(0.6), gain=0.6)
for i, m in enumerate([74, 78, 81, 86]): put(bells_, C["finalChime"] + i * 0.11, bell(m, 3.5, 3.5, 2.2), pan=-0.3 + i * 0.2, gain=0.12)

# ---------- 转场音效 ----------
for w in C["whoosh"]: put(sfx, w - 0.35, whoosh(0.7), gain=0.5)
put(sfx, d0 - 0.25, whoosh(0.5), gain=0.35)
for i, p_ in enumerate(C["pops"]): put(sfx, p_ + 0.05, pop(i % 4 * 2), pan=rng.uniform(-0.3, 0.3), gain=0.55)
for tp in C["taps"]: put(sfx, tp + 0.2, tap(), gain=0.6)

# ================= 混音 =================
g = duck(kicks, 0.55, 0.14)
pads *= g; bass *= (1 - 0.3 * (1 - g))
music = drums * 1.0 + bass * 1.0 + pads * 1.0 + plucks * 1.0 + bells_ * 1.0 + fxm * 1.0
send = pads * 0.5 + plucks * 0.6 + bells_ * 1.0 + drums * 0.12 + fxm * 0.3
music += reverb(send, rt=2.6, damp=7000) * 0.55
music += pingpong(plucks, BEAT * 0.75, fb=0.35, n=4) * 0.5
sfx_mix = sfx + reverb(sfx, rt=1.8, damp=8000) * 0.3

def master(x, peak=0.9):
    x = x[:, :int(DUR * SR)].copy()
    x = fft_filter(x, 28, 18000)
    fo = int(0.8 * SR); x[:, -fo:] *= np.linspace(1, 0, fo) ** 2
    x = x / (np.max(np.abs(x)) + 1e-9) * 1.4
    x = np.tanh(x) / np.tanh(1.4)  # 软削波，让鼓更紧
    return x / (np.max(np.abs(x)) + 1e-9) * peak

def write(name, x):
    pcm = (np.clip(x, -1, 1).T * 32767).astype(np.int16)
    with wave.open(os.path.join(outdir, name), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print("wrote", name)

os.makedirs(outdir, exist_ok=True)
m_only, s_only = music, sfx_mix
write("mix.wav", master(m_only * 0.85 + s_only * 0.9))
write("music.wav", master(m_only))
write("sfx.wav", master(s_only, 0.5))
