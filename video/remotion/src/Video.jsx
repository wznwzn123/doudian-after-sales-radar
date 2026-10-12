import React, { useEffect, useState } from "react";
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import timeline from "./timeline.json";
import shotsMeta from "./shots.json";

const C = { blue: "#0A84FF", blueDeep: "#0050C8", red: "#FF3B30", green: "#30C759", ink: "#0B1220", muted: "#5B6475", night: "#0B1220", night2: "#151F35", paper: "#EEF2F8", yellow: "#FFD60A" };
const ACCENT = { red: C.red, blue: C.blue, green: C.green };
const FONT = "NotoSC, sans-serif";
const FX = timeline.fx;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// ---------- 字体 ----------
const fontCss = [400, 500, 700, 900].map((w) => `@font-face{font-family:NotoSC;font-weight:${w};src:url(${staticFile(`fonts/noto-sans-sc-${w}.woff2`)}) format("woff2")}`).join("");
const useFonts = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all([400, 500, 700, 900].map((w) => document.fonts.load(`${w} 40px NotoSC`, "售后雷达"))).then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
};

// ---------- 通用 ----------
const useSpring = (delaySec, cfg = {}) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  return spring({ frame: f - delaySec * fps, fps, config: { damping: 14, stiffness: 140, mass: 0.8, ...cfg } });
};
const Logo = ({ size, glow = true }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.26, background: "linear-gradient(160deg,#4DA3FF,#0A64E6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: size * 0.54, boxShadow: glow ? `0 ${size * 0.12}px ${size * 0.35}px rgba(10,100,230,.45), inset 0 2px 0 rgba(255,255,255,.35)` : "none" }}>雷</div>
);
// 每个场景的入场转场（盖在上一场景上）
const Enter = ({ kind, children }) => {
  const f = useCurrentFrame(), { fps, width, height } = useVideoConfig();
  const d = FX.overlap * fps;
  if (kind === "circle") {
    const r = interpolate(f, [0, d], [0, Math.hypot(width, height) / 2 + 20], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) });
    return <AbsoluteFill style={{ clipPath: `circle(${r}px at 50% 50%)` }}>{children}</AbsoluteFill>;
  }
  if (kind === "up") {
    const y = interpolate(f, [0, d], [height, 0], { ...clamp, easing: Easing.bezier(0.7, 0, 0.2, 1) });
    return <AbsoluteFill style={{ transform: `translateY(${y}px)`, boxShadow: "0 -40px 80px rgba(0,0,0,.25)" }}>{children}</AbsoluteFill>;
  }
  return <AbsoluteFill>{children}</AbsoluteFill>;
};

// ---------- 1 钩子：倒计时归零 → 自动退款 ----------
const Hook = ({ fast }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const t = f / fps, tick = FX.hookTick[fast ? "fast" : "normal"], n = FX.hookFrom;
  const left = Math.max(0, n - Math.floor(t / tick));
  const zeroAt = n * tick, hit = t >= zeroAt;
  const title = useSpring(0.05, { damping: 12 });
  const stamp = useSpring(zeroAt + 0.08, { damping: 9, stiffness: 220 });
  const shake = hit ? Math.sin(t * 90) * interpolate(t, [zeroAt, zeroAt + 0.35], [18, 0], clamp) : 0;
  const pulse = 1 + 0.05 * Math.max(0, 1 - ((t % tick) / tick) * 3) * (hit ? 0 : 1);
  const money = interpolate(t, [zeroAt + 0.25, zeroAt + 1.2], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 52%, #3A0D12 0%, ${C.night} 62%)`, fontFamily: FONT, color: "#fff", alignItems: "center" }}>
      <div style={{ position: "absolute", top: 300, fontSize: 40, fontWeight: 700, letterSpacing: 6, color: "rgba(255,255,255,.55)", opacity: title }}>抖店商家 · 售后处理</div>
      <div style={{ position: "absolute", top: 380, fontSize: 124, fontWeight: 900, letterSpacing: 2, transform: `scale(${interpolate(title, [0, 1], [1.3, 1])})`, opacity: title }}>
        售后又<span style={{ color: C.red }}>超时</span>了？
      </div>
      <div style={{ position: "absolute", top: 760, transform: `translateX(${shake}px) scale(${pulse})`, textAlign: "center" }}>
        <div style={{ fontSize: 38, color: "rgba(255,255,255,.6)", fontWeight: 500, marginBottom: 10 }}>举证剩余时间</div>
        <div style={{ fontSize: 190, fontWeight: 900, color: hit ? "#7a2a2f" : C.red, fontVariantNumeric: "tabular-nums", textShadow: hit ? "none" : "0 0 60px rgba(255,59,48,.6)", letterSpacing: 4 }}>00:00:0{left}</div>
      </div>
      {hit && (
        <div style={{ position: "absolute", top: 830, transform: `rotate(-8deg) scale(${interpolate(stamp, [0, 1], [2.4, 1])})`, opacity: Math.min(1, stamp * 2), border: `10px solid ${C.red}`, borderRadius: 26, padding: "18px 44px", color: C.red, fontSize: 92, fontWeight: 900, background: "rgba(11,18,32,.88)", letterSpacing: 4 }}>
          已自动同意退款
        </div>
      )}
      {hit && (
        <div style={{ position: "absolute", top: 1180, fontSize: 84, fontWeight: 900, color: "#fff", opacity: money, transform: `translateY(${interpolate(money, [0, 1], [40, 0])}px)` }}>
          <span style={{ color: C.red }}>−¥129.00</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- 2 痛点：通知堆成山 ----------
const CARDS = [
  { ico: "退", col: C.red, store: "家居馆", msg: "买家申请仅退款 ¥129", time: "刚刚" },
  { ico: "协", col: "#FF9500", store: "数码店", msg: "买家拒绝协商，剩 1 小时 58 分", time: "2 分钟前" },
  { ico: "证", col: C.red, store: "家居馆", msg: "举证截止：今天 21:00", time: "5 分钟前" },
  { ico: "退", col: "#FF9500", store: "数码店", msg: "买家申请退货退款 ¥399", time: "8 分钟前" },
  { ico: "问", col: C.blue, store: "家居馆", msg: "快递到哪了？买家第 3 次催问", time: "12 分钟前" },
  { ico: "图", col: "#AF52DE", store: "相册", msg: "签收截图在哪？共 2,317 张照片", time: "" },
];
const POS = [[-40, 0, -4], [50, 170, 3], [-20, 340, -2.5], [60, 510, 4], [-50, 680, -3], [20, 850, 2]];
const Pain = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const t = f / fps;
  const head = useSpring(0.15);
  const jitter = t > FX.painFirst + FX.painGap * CARDS.length + 0.3 ? 1 : 0;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${C.night} 0%, ${C.night2} 100%)`, fontFamily: FONT, color: "#fff", alignItems: "center" }}>
      <div style={{ position: "absolute", top: 210, textAlign: "center", opacity: head, transform: `translateY(${interpolate(head, [0, 1], [40, 0])}px)` }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: "rgba(255,255,255,.6)" }}>几家店 · 几十单售后</div>
        <div style={{ fontSize: 104, fontWeight: 900, marginTop: 14 }}>全靠<span style={{ color: C.yellow }}>脑子记</span></div>
      </div>
      <div style={{ position: "absolute", top: 560, left: 0, right: 0 }}>
        {CARDS.map((c, i) => {
          const s = spring({ frame: f - (FX.painFirst + FX.painGap * i) * fps, fps, config: { damping: 13, stiffness: 160, mass: 0.7 } });
          const [x, y, r] = POS[i];
          const jx = jitter ? Math.sin(t * 40 + i * 2) * 4 : 0;
          return (
            <div key={i} style={{ position: "absolute", left: 90 + x + jx, top: y, width: 900, transform: `translateY(${interpolate(s, [0, 1], [-260, 0])}px) rotate(${r * s}deg) scale(${interpolate(s, [0, 1], [1.15, 1])})`, opacity: Math.min(1, s * 1.6),
              background: "rgba(255,255,255,.96)", color: C.ink, borderRadius: 40, padding: "30px 34px", display: "flex", gap: 26, alignItems: "center", boxShadow: "0 30px 60px rgba(0,0,0,.45)" }}>
              <div style={{ flex: "0 0 92px", height: 92, borderRadius: 24, background: c.col, color: "#fff", fontSize: 50, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.ico}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, color: C.muted, fontWeight: 500 }}><span>{c.store}</span><span>{c.time}</span></div>
                <div style={{ fontSize: 42, fontWeight: 700, marginTop: 6 }}>{c.msg}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- 3 揭晓：售后雷达 ----------
const Reveal = ({ fast }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const t = f / fps, k = fast ? 0.6 : 1;
  const logo = useSpring(0.25 * k, { damping: 10, stiffness: 160 });
  const name = useSpring(0.55 * k);
  const sub = useSpring(0.85 * k);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, #2E95FF 0%, ${C.blue} 35%, ${C.blueDeep} 100%)`, fontFamily: FONT, color: "#fff", alignItems: "center", justifyContent: "center" }}>
      {[0, 1, 2].map((i) => {
        const p = ((t + i * 0.6) % 1.8) / 1.8;
        return <div key={i} style={{ position: "absolute", top: 820 - 160, width: 320, height: 320, borderRadius: "50%", border: "4px solid rgba(255,255,255,.7)", transform: `scale(${0.6 + p * 2.6})`, opacity: (1 - p) * 0.6 * logo }} />;
      })}
      <div style={{ position: "absolute", top: 820 - 130, transform: `scale(${logo}) rotate(${interpolate(logo, [0, 1], [-25, 0])}deg)` }}><Logo size={260} /></div>
      <div style={{ position: "absolute", top: 1080, fontSize: 40, fontWeight: 500, opacity: name * 0.85, letterSpacing: 8 }}>试试</div>
      <div style={{ position: "absolute", top: 1140, fontSize: 132, fontWeight: 900, opacity: name, transform: `translateY(${interpolate(name, [0, 1], [50, 0])}px)`, letterSpacing: 4 }}>售后雷达 <span style={{ fontWeight: 500, opacity: 0.85 }}>Pro</span></div>
      <div style={{ position: "absolute", top: 1330, fontSize: 44, fontWeight: 500, opacity: sub * 0.9 }}>抖店售后 · 一个页面管到底</div>
    </AbsoluteFill>
  );
};

// ---------- 4 产品演示：手机 + 镜头推近 ----------
const StatusBar = () => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 150 * 0.45, background: "#F7F7F9", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 44px 0", fontFamily: FONT, fontWeight: 700, fontSize: 26, color: "#000" }}>
    <span>9:41</span>
    <div style={{ position: "absolute", left: "50%", top: 14, width: 150, height: 42, marginLeft: -75, borderRadius: 21, background: "#000" }} />
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>{[8, 12, 16, 20].map((h) => <i key={h} style={{ width: 5, height: h, background: "#000", borderRadius: 1.5 }} />)}</span>
      <span style={{ width: 40, height: 20, border: "2.5px solid #000", borderRadius: 6, padding: 2, boxSizing: "border-box" }}><i style={{ display: "block", width: "80%", height: "100%", background: "#000", borderRadius: 2 }} /></span>
    </span>
  </div>
);
const SCREEN = { w: shotsMeta.width * shotsMeta.dpr, h: shotsMeta.height * shotsMeta.dpr, dpr: shotsMeta.dpr };
const K = 0.45, BEZEL = 20, SB = 150; // SB：状态栏高度（屏幕像素）
const PW = SCREEN.w * K + BEZEL * 2, PH = (SCREEN.h + SB) * K + BEZEL * 2;
const PX = (1080 - PW) / 2, PY = 590;
const TARGET = { x: 540, y: 1130 };
const ShotVideo = ({ s, len }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const skip = Math.round((s.skip || 0) * fps);
  const vf = Math.floor((shotsMeta.shots[s.shot].duration - (s.skip || 0)) * fps) - 2;
  const v = <OffthreadVideo src={staticFile(`shots/${s.shot}.mp4`)} startFrom={skip} muted style={{ width: "100%", height: "100%" }} />;
  return f >= vf ? <Freeze frame={vf}>{v}</Freeze> : v;
};
const Demo = ({ shots, blockStart }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const t = f / fps + blockStart;
  const idx = Math.max(0, shots.findIndex((s) => t >= s.start && t < s.end));
  const s = shots[idx], lt = t - s.start, len = s.end - s.start;
  const m = shotsMeta.shots[s.shot], fo = m.focus;
  const zin = spring({ frame: (lt - s.zoomAt) * fps, fps, config: { damping: 18, stiffness: 70, mass: 1 } });
  const last = idx === shots.length - 1;
  const zout = last ? 0 : interpolate(lt, [len - 0.4, len], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const p = Math.max(0, zin * (1 - zout));
  // 焦点（画面坐标）
  const fx = PX + BEZEL + (fo.x + fo.w / 2) * SCREEN.dpr * K, fy = PY + BEZEL + SB * K + (fo.y + fo.h / 2) * SCREEN.dpr * K;
  const z = 1 + (s.zoom - 1) * p;
  const float = Math.sin(t * 1.3) * 6;
  const enterP = interpolate(lt, [0, 0.35], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const hiP = interpolate(lt, [s.zoomAt + 0.5, s.zoomAt + 0.9], [0, 1], clamp) * (1 - zout);
  const acc = ACCENT[s.accent];
  const capIn = spring({ frame: lt * fps - 4, fps, config: { damping: 15, stiffness: 150 } });
  const capOut = last ? 0 : interpolate(lt, [len - 0.25, len], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", left: -260 + Math.sin(t * 0.5) * 60, top: 300, background: "radial-gradient(circle, rgba(10,132,255,.22), transparent 70%)" }} />
      <div style={{ position: "absolute", width: 800, height: 800, borderRadius: "50%", left: 520 + Math.cos(t * 0.4) * 60, top: 1100, background: `radial-gradient(circle, ${acc}33, transparent 70%)` }} />
      {/* 手机 */}
      <AbsoluteFill style={{ transformOrigin: `${fx}px ${fy}px`, transform: `translate(${(TARGET.x - fx) * p}px, ${(TARGET.y - fy) * p + float * (1 - p)}px) scale(${z})` }}>
        <div style={{ position: "absolute", left: PX, top: PY, width: PW, height: PH, borderRadius: 86, background: "#0d0f14", boxShadow: "0 60px 120px rgba(11,18,32,.35), 0 0 0 3px #2a2e38 inset" }}>
          <div style={{ position: "absolute", left: BEZEL, top: BEZEL, width: SCREEN.w * K, height: (SCREEN.h + SB) * K, borderRadius: 66, overflow: "hidden", background: "#f2f2f7" }}>
            <StatusBar />
            <div style={{ position: "absolute", left: 0, top: SB * K, width: SCREEN.w * K, height: SCREEN.h * K, overflow: "hidden" }}>
            {shots.map((sh, i) => (
              <Sequence key={sh.shot} from={Math.round((sh.start - blockStart) * fps)} durationInFrames={Math.round((sh.end - sh.start) * fps)} layout="none">
                <ShotVideo s={sh} />
              </Sequence>
            ))}
            </div>
            {/* 切镜头时的轻微闪白 */}
            <AbsoluteFill style={{ background: "#fff", opacity: idx > 0 ? interpolate(lt, [0, 0.18], [0.6, 0], clamp) : 0 }} />
            {/* 焦点框 */}
            <div style={{ position: "absolute", left: (fo.x - 4) * SCREEN.dpr * K, top: SB * K + (fo.y - 4) * SCREEN.dpr * K, width: (fo.w + 8) * SCREEN.dpr * K, height: (fo.h + 8) * SCREEN.dpr * K, borderRadius: 40 * K * 2, border: `${5 / z}px solid ${acc}`, boxShadow: `0 0 0 ${2000}px rgba(11,18,32,${0.28 * hiP})`, opacity: hiP }} />
          </div>
        </div>
      </AbsoluteFill>
      {/* 顶部渐隐，保证标题可读 */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 620, background: `linear-gradient(180deg, ${C.paper} 0%, ${C.paper} 62%, rgba(238,242,248,0) 100%)` }} />
      <div style={{ position: "absolute", top: 210, left: 0, right: 0, textAlign: "center", opacity: capIn * (1 - capOut), transform: `translateY(${interpolate(capIn, [0, 1], [50, 0]) - capOut * 30}px)` }}>
        <div style={{ display: "inline-block", fontSize: 44, fontWeight: 700, color: "#fff", background: acc, padding: "8px 28px", borderRadius: 999 }}>{s.kicker}</div>
        <div style={{ fontSize: 128, fontWeight: 900, color: C.ink, marginTop: 22, letterSpacing: 4 }}>{s.head}</div>
      </div>
      <div style={{ position: "absolute", right: 40, top: 60, fontSize: 32, fontWeight: 700, color: C.muted, background: "rgba(255,255,255,.75)", padding: "8px 20px", borderRadius: 999, opacity: enterP }}>画面为演示数据</div>
    </AbsoluteFill>
  );
};

// ---------- 5 收尾 ----------
const Cta = ({ fast }) => {
  const k = fast ? 0.55 : 1;
  const a = useSpring(0.15 * k), b = useSpring(0.45 * k), logo = useSpring(0.9 * k, { damping: 11 }), url = useSpring(1.3 * k);
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const shine = interpolate((f / fps) % 3, [0, 1.2], [-300, 1400], clamp);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${C.blue} 0%, ${C.blueDeep} 100%)`, fontFamily: FONT, color: "#fff", alignItems: "center" }}>
      <div style={{ position: "absolute", top: 330, fontSize: 128, fontWeight: 900, opacity: a, transform: `translateY(${interpolate(a, [0, 1], [60, 0])}px)` }}>超时之前</div>
      <div style={{ position: "absolute", top: 500, fontSize: 128, fontWeight: 900, color: C.yellow, opacity: b, transform: `translateY(${interpolate(b, [0, 1], [60, 0])}px)` }}>它先提醒你</div>
      <div style={{ position: "absolute", top: 860, transform: `scale(${logo})`, display: "flex", alignItems: "center", gap: 36 }}>
        <Logo size={170} />
        <div><div style={{ fontSize: 84, fontWeight: 900 }}>售后雷达 Pro</div><div style={{ fontSize: 40, opacity: 0.85, marginTop: 6 }}>手机浏览器打开就能用</div></div>
      </div>
      <div style={{ position: "absolute", top: 1180, fontSize: 34, fontWeight: 500, background: "rgba(255,255,255,.16)", padding: "20px 40px", borderRadius: 999, opacity: url, overflow: "hidden" }}>
        wznwzn123.github.io/doudian-after-sales-radar
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 160, left: shine, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent)", transform: "skewX(-20deg)" }} />
      </div>
      <div style={{ position: "absolute", bottom: 56, fontSize: 28, opacity: 0.75 * url }}>悠然网络科技工作室™</div>
    </AbsoluteFill>
  );
};

// ---------- 字幕 ----------
const Subs = ({ voice }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const t = f / fps;
  const cur = voice.find(([a, b]) => t >= a && t < b);
  if (!cur) return null;
  const [a, b, text] = cur;
  const o = Math.min(interpolate(t, [a, a + 0.12], [0, 1], clamp), interpolate(t, [b - 0.12, b], [1, 0], clamp));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 150, fontFamily: FONT }}>
      <div style={{ maxWidth: 980, textAlign: "center", textWrap: "balance", fontSize: 48, lineHeight: 1.4, fontWeight: 700, color: "#fff", background: "rgba(11,18,32,.78)", padding: "16px 34px", borderRadius: 24, opacity: o }}>{text}</div>
    </AbsoluteFill>
  );
};

// ---------- 总装 ----------
export const Promo = ({ version, subs }) => {
  useFonts();
  const { fps } = useVideoConfig();
  const v = timeline.versions[version];
  const ov = FX.overlap;
  const blocks = [];
  v.scenes.forEach((s) => {
    const prev = blocks[blocks.length - 1];
    if (s.type === "shot" && prev && prev.type === "demo") { prev.shots.push(s); prev.end = s.end; }
    else if (s.type === "shot") blocks.push({ type: "demo", start: s.start, end: s.end, shots: [s] });
    else blocks.push(s);
  });
  const enterKind = { hook: "none", pain: "up", reveal: "circle", demo: "up", cta: "circle" };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <style>{fontCss}</style>
      {blocks.map((b, i) => {
        const from = Math.round((i === 0 ? b.start : b.start - ov) * fps);
        const to = Math.round(b.end * fps);
        const off = i === 0 ? 0 : ov;
        return (
          <Sequence key={i} from={from} durationInFrames={to - from}>
            <Enter kind={i === 0 ? "none" : enterKind[b.type]}>
              {/* 内容比转场晚 off 秒开始计时，保证转场结束时动画从头开始 */}
              <Sequence from={0} layout="none">
                <Inner b={b} off={off} />
              </Sequence>
            </Enter>
          </Sequence>
        );
      })}
      {subs && <Subs voice={v.voice} />}
    </AbsoluteFill>
  );
};
const Inner = ({ b, off }) => {
  const { fps } = useVideoConfig();
  const shift = Math.round(off * fps);
  // 内容时间 = 场景开始时为 0；转场期间为负，统一钳到 0（转场时显示首帧）
  const f = useCurrentFrame();
  const content = b.type === "hook" ? <Hook fast={b.fast} /> : b.type === "pain" ? <Pain /> : b.type === "reveal" ? <Reveal fast={b.fast} /> : b.type === "cta" ? <Cta fast={b.fast} /> : <Demo shots={b.shots} blockStart={b.start} />;
  return f < shift ? <Freeze frame={0}>{content}</Freeze> : <Sequence from={shift} layout="none">{content}</Sequence>;
};
