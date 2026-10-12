# 按 src/timeline.json 合成配乐和音效（纯代码生成，无版权问题）。
# 用法：python3 audio.py <long|short> <输出目录>
# 输出：<version>_music_sfx.wav（配乐+音效）、<version>_sfx.wav（只有音效，给剪映配音/换音乐用）
import json, sys, wave, os
import numpy as np

SR = 44100
here = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(here, "src/timeline.json"), encoding="utf-8"))
version = sys.argv[1] if len(sys.argv) > 1 else "long"
outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "../build")
V = TL["versions"][version]; FX = TL["fx"]
scenes = V["scenes"]; total = scenes[-1]["end"]
N = int(total * SR) + SR
rng = np.random.default_rng(7)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)


def env_adsr(n, a, d, s, r, length):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-4), s))
    return e * np.where(t < length, 1, np.exp(-(t - length) / max(r / 5, 1e-4)))


def tone(midi, length, amp, harm=(1,), a=.005, d=.1, s=.7, r=.2, detune=0.0):
    n = int((length + r) * SR); t = np.arange(n) / SR; f = hz(midi)
    w = sum(h * np.sin(2 * np.pi * f * (k + 1) * t) for k, h in enumerate(harm))
    if detune: w = w + sum(h * np.sin(2 * np.pi * f * (1 + detune) * (k + 1) * t) for k, h in enumerate(harm))
    return amp * w * env_adsr(n, a, d, s, r, length)


def band_noise(n, lo, hi):
    spec = np.fft.rfft(rng.standard_normal(n)); fr = np.fft.rfftfreq(n, 1 / SR)
    spec[(fr < lo) | (fr > hi)] = 0
    x = np.fft.irfft(spec, n); return x / (np.max(np.abs(x)) + 1e-9)


def add(buf, start, x):
    s = int(start * SR)
    if s >= len(buf) or s + len(x) <= 0: return
    if s < 0: x = x[-s:]; s = 0
    e = min(len(buf), s + len(x)); buf[s:e] += x[:e - s]


# ---------------- 音效 ----------------
def sfx_whoosh(dur=.45):
    n = int(dur * SR); t = np.arange(n) / SR
    x = band_noise(n, 300, 6000) * np.sin(np.pi * t / dur) ** 2
    # 简单的“扫频”：前后两段不同频带交叉
    y = band_noise(n, 1500, 9000) * np.sin(np.pi * np.clip(t / dur * 1.3 - .3, 0, 1)) ** 2
    return .35 * x + .2 * y

def sfx_tick():
    n = int(.05 * SR); t = np.arange(n) / SR
    return .5 * np.sin(2 * np.pi * 2400 * t) * np.exp(-t / .006) + .25 * band_noise(n, 3000, 9000) * np.exp(-t / .004)

def sfx_stamp():
    n = int(.7 * SR); t = np.arange(n) / SR
    f = 120 * np.exp(-t / .12) + 45
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .18)
    return .9 * boom + .5 * band_noise(n, 80, 2500) * np.exp(-t / .04)

def sfx_pop(pitch=0):
    n = int(.16 * SR); t = np.arange(n) / SR
    f = 700 * 2 ** (pitch / 12) * (1 + 1.2 * np.exp(-t / .02))
    return .35 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .045)

def sfx_tap():
    n = int(.08 * SR); t = np.arange(n) / SR
    return .4 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t / .01) + .2 * band_noise(n, 2000, 8000) * np.exp(-t / .005)

def sfx_shimmer():
    out = np.zeros(int(1.4 * SR))
    for i, m in enumerate([84, 88, 91, 96, 100]):
        add(out, i * .06, tone(m, .05, .09, harm=(1, .2), a=.002, d=.05, s=.5, r=.9))
    return out

def sfx_chime():
    out = np.zeros(int(2.5 * SR))
    for i, m in enumerate([72, 76, 79, 84]):
        add(out, i * .09, tone(m, .2, .12, harm=(1, .35, .1), a=.003, d=.2, s=.4, r=1.8))
    return out

def sfx_riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = band_noise(n, 400, 10000) * (t / dur) ** 2.2
    f = 200 + 1400 * (t / dur) ** 2
    return .22 * x + .06 * np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 2


sfx = np.zeros(N)
blocks = []
for s in scenes:
    if s["type"] == "shot" and blocks and blocks[-1]["type"] == "demo": blocks[-1]["end"] = s["end"]
    else: blocks.append({"type": "demo" if s["type"] == "shot" else s["type"], "start": s["start"], "end": s["end"], "fast": s.get("fast")})
ov = FX["overlap"]
for i, b in enumerate(blocks[1:], 1):
    if b["type"] != "reveal": add(sfx, b["start"] - ov - .05, sfx_whoosh(.5))
shot_starts = {}
for s in scenes:
    t0 = s["start"]
    if s["type"] == "hook":
        tick = FX["hookTick"]["fast" if s.get("fast") else "normal"]
        for k in range(FX["hookFrom"]):
            add(sfx, t0 + k * tick, sfx_tick())
        add(sfx, t0 + FX["hookFrom"] * tick + .06, sfx_stamp())
    if s["type"] == "pain":
        for k in range(6): add(sfx, t0 + FX["painFirst"] + FX["painGap"] * k + .05, sfx_pop(k % 3 * 2))
    if s["type"] == "reveal":
        add(sfx, t0 - 1.0, sfx_riser(1.0))
        add(sfx, t0 + (0.15 if s.get("fast") else .25), sfx_shimmer())
    if s["type"] == "shot":
        if s["shot"] != scenes[[x["type"] for x in scenes].index("shot")]["shot"]:
            add(sfx, t0 - .02, .6 * sfx_whoosh(.3))
        tap = FX["taps"].get(s["shot"])
        if tap is not None and tap >= s.get("skip", 0): add(sfx, t0 + tap - s.get("skip", 0) + .2, sfx_tap())
    if s["type"] == "cta":
        add(sfx, t0 + .1, sfx_chime())

# ---------------- 配乐 ----------------
music = np.zeros(N)
reveal = next((s["start"] for s in scenes if s["type"] == "reveal"), 0)
# A 段：紧张（A 小调低音脉冲 + 心跳鼓）
bpmA = 120; bA = 60 / bpmA
t = 0.0; k = 0
while t < reveal - .05:
    add(music, t, tone(33, bA / 2 * .7, .16, harm=(1, .5, .33, .2), a=.003, d=.08, s=.5, r=.05))
    if k % 2 == 0:
        n = int(.25 * SR); tt = np.arange(n) / SR
        add(music, t, .5 * np.sin(2 * np.pi * np.cumsum(60 * np.exp(-tt / .05) + 45) / SR) * np.exp(-tt / .12))
    if k % 4 == 2: add(music, t, .05 * band_noise(int(.05 * SR), 6000, 12000) * np.exp(-np.arange(int(.05 * SR)) / SR / .01))
    t += bA / 2; k += 1
# 不和谐的高音长音铺底
add(music, 0, tone(69, reveal - .3, .025, harm=(1, .3), a=1.0, d=.1, s=1, r=.3, detune=.006))
add(music, 0, tone(70, reveal - .3, .015, harm=(1,), a=2.0, d=.1, s=1, r=.3))
# B 段：明快（C-G-Am-F，112 bpm）
bpm = 112; beat = 60 / bpm; bar = beat * 4
chords = [[48, 55, 60, 64], [43, 50, 59, 62], [45, 52, 57, 60], [41, 48, 57, 60]]
t = reveal; i = 0
end_music = total - .2
while t < end_music:
    c = chords[i % 4]; last_bar = t + bar >= end_music
    for m in c[1:]: add(music, t, tone(m + 12, bar * .95, .028, harm=(1, .25), a=.25, d=.2, s=.8, r=1.0, detune=.004))
    add(music, t, tone(c[0] - 12, bar * .45, .14, harm=(1, .45, .15), a=.01, d=.2, s=.6, r=.15))
    add(music, t + bar * .5, tone(c[0] - 12, bar * .4, .12, harm=(1, .45, .15), a=.01, d=.2, s=.6, r=.15))
    arp = [c[1] + 12, c[2] + 12, c[3] + 12, c[2] + 24, c[3] + 12, c[2] + 12, c[1] + 12, c[2] + 12]
    for j, m in enumerate(arp):
        if t + j * beat / 2 < end_music:
            add(music, t + j * beat / 2, tone(m, beat / 2 * .6, .045, harm=(1, .3, .08), a=.003, d=.12, s=.3, r=.25))
    for j in range(4):
        tb = t + j * beat
        if tb >= end_music: break
        n = int(.3 * SR); tt = np.arange(n) / SR
        add(music, tb, .45 * np.sin(2 * np.pi * np.cumsum(110 * np.exp(-tt / .03) + 48) / SR) * np.exp(-tt / .14))
        if j % 2 == 1: add(music, tb, .12 * band_noise(int(.18 * SR), 900, 7000) * np.exp(-np.arange(int(.18 * SR)) / SR / .045))
        nh = int(.04 * SR); add(music, tb + beat / 2, .045 * band_noise(nh, 7000, 14000) * np.exp(-np.arange(nh) / SR / .008))
    t += bar; i += 1
# 结尾和弦
add(music, end_music - 1.6, tone(60, 1.2, .04, harm=(1, .3), a=.05, d=.2, s=.7, r=1.2) + 0)
fade = np.ones(N); fo = int(1.2 * SR); e = int(total * SR)
fade[e - fo:e] = np.linspace(1, 0, fo); fade[e:] = 0; fade[:int(.05 * SR)] = np.linspace(0, 1, int(.05 * SR))
music *= fade


def write(path, x, peak_to=0.89):
    x = x[:int(total * SR)]
    peak = np.max(np.abs(x)) + 1e-9; x = x / peak * peak_to  # 0.89 ≈ -1 dBFS
    x = np.tanh(x * 1.1) / np.tanh(1.1)
    pcm = (np.repeat(x[:, None], 2, 1) * 32767 * .95).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print("wrote", path)


os.makedirs(outdir, exist_ok=True)
write(os.path.join(outdir, f"{version}_music_sfx.wav"), .75 * music + .9 * sfx)
write(os.path.join(outdir, f"{version}_sfx.wav"), sfx, 0.5)  # 约 -6 dBFS，给配音留空间
