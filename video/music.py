# 合成一段轻快的背景音乐（纯代码生成，无版权问题）：C-G-Am-F 和弦铺底 + 琶音。
import sys, wave, numpy as np
SR = 44100
dur = float(sys.argv[1]) if len(sys.argv) > 1 else 40.0
out = sys.argv[2] if len(sys.argv) > 2 else "build/music.wav"
bpm = 100; beat = 60 / bpm; bar = beat * 4
n = int(SR * dur); t = np.arange(n) / SR
mix = np.zeros(n)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
chords = [[48, 55, 60, 64], [43, 50, 59, 62], [45, 52, 57, 60], [41, 48, 57, 60]]  # C G Am F
def note(start, length, midi, amp, attack=0.01, release=0.3, harm=(1, .3, .1)):
    s = int(start * SR); e = min(n, int((start + length + release) * SR))
    if s >= n: return
    tt = np.arange(e - s) / SR
    env = np.minimum(1, tt / attack) * np.where(tt < length, 1, np.exp(-(tt - length) / (release / 4)))
    w = sum(h * np.sin(2 * np.pi * hz(midi) * (k + 1) * tt) for k, h in enumerate(harm))
    mix[s:e] += amp * env * w
i = 0; start = 0.0
while start < dur:
    c = chords[i % 4]
    for m in c: note(start, bar, m, .045, attack=.4, release=1.2, harm=(1, .15))          # 铺底
    note(start, bar * .9, c[0] - 12, .09, attack=.02, release=.5, harm=(1, .4, .1))         # 低音
    arp = [c[1] + 12, c[2] + 12, c[3] + 12, c[2] + 12] * 2
    for k, m in enumerate(arp):                                                             # 八分音符琶音
        note(start + k * beat / 2, beat / 2 * .8, m, .05, attack=.005, release=.25, harm=(1, .2, .05))
    for k in range(4):                                                                       # 轻打击（滤过的噪声）
        s = int((start + k * beat) * SR); e = min(n, s + int(.06 * SR))
        if s < n: mix[s:e] += .03 * np.random.randn(e - s) * np.exp(-np.arange(e - s) / (.01 * SR))
    start += bar; i += 1
fade = np.ones(n); fi, fo = int(1.0 * SR), int(2.5 * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
mix = mix * fade; mix = mix / np.max(np.abs(mix)) * .6
pcm = (np.repeat(mix[:, None], 2, 1) * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", out, dur, "s")
