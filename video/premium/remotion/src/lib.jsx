import React, { useContext, useEffect, useState } from "react";
import { AbsoluteFill, Freeze, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, interpolateColors, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import shotsMeta from "./shots.json";

export const W = 1080, H = 1920;
// 品牌色：取自 App 图标（dev/app-icon.html）
export const B = { violet: "#6a4dff", blue: "#2f6bff", cyan: "#00c2d8", pink: "#ff5fb4", navy: "#140b4d", ink: "#05051a", red: "#ff3b5c", mist: "rgba(236,238,255,.66)", faint: "rgba(236,238,255,.38)" };
export const GRAD = "linear-gradient(100deg,#9d8bff 0%,#5f97ff 45%,#2fdcef 100%)";
export const GRAD_RED = "linear-gradient(100deg,#ff8aa8 0%,#ff3b5c 55%,#ff7a45 100%)";
export const FONT = "NotoSC, sans-serif";
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// ---------- 缓动 ----------
export const E = {
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  outBack: (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};
export const prog = (t, a, b, ease = (x) => x) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
// 场景放在 Sequence 里时帧号是相对的；ShiftCtx 记着该 Sequence 的起始帧，useT() 统一返回绝对秒数
export const ShiftCtx = React.createContext(0);
export const useT = () => { const f = useCurrentFrame(), { fps } = useVideoConfig(), from = useContext(ShiftCtx); return (from + f) / fps; };
// 关键帧插值：keys = [[t, {k:v}], ...]，段间用 inOutCubic
export const keyframes = (t, keys) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, a] = keys[i], [tb, b] = keys[i + 1];
    if (t <= tb) { const p = E.inOutCubic((t - ta) / (tb - ta)); const o = {}; for (const k in b) o[k] = (a[k] ?? b[k]) + ((b[k]) - (a[k] ?? b[k])) * p; return o; }
  }
  return keys[keys.length - 1][1];
};

// ---------- 字体 ----------
export const fontCss = [300, 400, 500, 700, 900].map((w) => `@font-face{font-family:NotoSC;font-weight:${w};src:url(${staticFile(`fonts/noto-sans-sc-${w}.woff2`)}) format("woff2")}`).join("");
export const useFonts = () => {
  const [h] = useState(() => delayRender("fonts"));
  useEffect(() => { Promise.all([300, 400, 500, 700, 900].map((w) => document.fonts.load(`${w} 40px NotoSC`, "售后雷达0123"))).then(() => continueRender(h), () => continueRender(h)); }, [h]);
};

// ---------- 逐字动画标题 ----------
// grad: [起, 止) 字符下标用渐变色；at/out：入场/出场秒数（绝对时间，t 由父级传入）
export const Kinetic = ({ t, text, at, out = 1e9, size = 96, weight = 900, color = "#fff", grad, gradCss = GRAD, stagger = 0.032, dur = 0.75, spacing = 0, style }) => {
  const chars = [...text];
  return (
    <div style={{ fontFamily: FONT, fontSize: size, fontWeight: weight, color, lineHeight: 1.18, letterSpacing: spacing, whiteSpace: "pre", ...style }}>
      {chars.map((c, i) => {
        const p = prog(t, at + i * stagger, at + i * stagger + dur, E.outExpo);
        const q = prog(t, out + i * stagger * 0.5, out + i * stagger * 0.5 + 0.45, E.inCubic);
        const g = grad && i >= grad[0] && i < grad[1];
        const n = grad ? grad[1] - grad[0] : 1;
        return (
          <span key={i} style={{ display: "inline-block", opacity: p * (1 - q), transform: `translateY(${(1 - p) * 0.55 - q * 0.35}em) scale(${1 + (1 - p) * 0.06})`, filter: (1 - p) * 14 + q * 10 > 0.3 ? `blur(${(1 - p) * 14 + q * 10}px)` : undefined,
            ...(g ? { backgroundImage: gradCss, backgroundSize: `${n}em 100%`, backgroundPosition: `${-(i - grad[0])}em 0`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : {}) }}>{c === " " ? " " : c}</span>
        );
      })}
    </div>
  );
};
// 场景标题：小标签 + 1~2 行大字
export const Title = ({ t, kicker, lines, at, out, top = 170, size = 92, align = "center" }) => {
  const k = prog(t, at - 0.1, at + 0.5, E.outCubic), kq = prog(t, out, out + 0.4, E.inCubic);
  return (
    <div style={{ position: "absolute", top, left: 60, right: 60, textAlign: align, display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", gap: 10 }}>
      {kicker && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: FONT, fontSize: 30, fontWeight: 700, letterSpacing: 8, color: "#7fe7f5", opacity: k * (1 - kq), transform: `translateY(${(1 - k) * 16}px)`, marginBottom: 8 }}>
          <span style={{ width: 46 * k, height: 2, background: "linear-gradient(90deg,transparent,#7fe7f5)" }} />{kicker}<span style={{ width: 46 * k, height: 2, background: "linear-gradient(90deg,#7fe7f5,transparent)" }} />
        </div>
      )}
      {lines.map((l, i) => <Kinetic key={i} t={t} text={l.text} grad={l.grad} gradCss={l.gradCss} at={at + 0.12 + i * 0.22} out={out} size={l.size || size} weight={l.weight || 900} />)}
    </div>
  );
};

// ---------- 背景 ----------
const ORBS = [
  { x: 0.18, y: 0.22, r: 900, sx: 0.31, sy: 0.23 },
  { x: 0.86, y: 0.40, r: 1000, sx: 0.21, sy: 0.29 },
  { x: 0.30, y: 0.86, r: 1100, sx: 0.17, sy: 0.19 },
  { x: 0.75, y: 0.92, r: 800, sx: 0.27, sy: 0.33 },
];
// 各幕的光晕颜色（[时间, [4 个颜色], 强度]）
const ORB_KEYS = [
  [0, ["#1a0b2e", "#2a0820", "#0b0b2a", "#1d0a1e"], 0.0],
  [3.5, ["#3a1460", "#5a0f33", "#151a5a", "#3c0b28"], 0.55],
  [9.4, ["#5b1030", "#8a0f2c", "#2a0b3a", "#6a1024"], 0.85],
  [11.2, ["#1a0b2e", "#2a0820", "#0b0b2a", "#1d0a1e"], 0.0],
  [13.0, ["#4a33d9", "#1f4fd8", "#0090a8", "#c0398c"], 0.85],
  [18.0, ["#3b2bb8", "#1d47c9", "#00849a", "#9e2f78"], 0.75],
  [45.0, ["#3b2bb8", "#1d47c9", "#00849a", "#9e2f78"], 0.75],
  [50.0, ["#5a44ff", "#2a62ff", "#00b0c8", "#d0469c"], 1.0],
  [60.0, ["#4a38e0", "#2556e8", "#00a0b8", "#b83e8c"], 0.9],
];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => { const x = hex(a), y = hex(b); return x.map((v, i) => Math.round(v + (y[i] - v) * p)); };
export const Background = ({ t }) => {
  let i = 0; while (i < ORB_KEYS.length - 2 && t > ORB_KEYS[i + 1][0]) i++;
  const [ta, ca, ia] = ORB_KEYS[i], [tb, cb, ib] = ORB_KEYS[i + 1];
  const p = E.inOutSine(Math.min(1, Math.max(0, (t - ta) / (tb - ta))));
  const inten = (ia + (ib - ia) * p) * 0.95;
  return (
    <AbsoluteFill style={{ background: B.ink, overflow: "hidden" }}>
      {ORBS.map((o, k) => {
        const [r, g, b] = mix(ca[k], cb[k], p);
        const x = o.x * W + Math.sin(t * o.sx + k) * 140, y = o.y * H + Math.cos(t * o.sy + k * 2) * 160;
        return <div key={k} style={{ position: "absolute", left: x - o.r, top: y - o.r, width: o.r * 2, height: o.r * 2, borderRadius: "50%", opacity: inten,
          background: `radial-gradient(closest-side, rgba(${r},${g},${b},.95) 0%, rgba(${r},${g},${b},.55) 35%, rgba(${r},${g},${b},.18) 65%, rgba(${r},${g},${b},0) 100%)` }} />;
      })}
      {/* 中央压暗一点，让文字和手机更跳 */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 45% at 50% 50%, rgba(5,5,26,.35), rgba(5,5,26,0))" }} />
    </AbsoluteFill>
  );
};
// 漂浮的光点（景深：远处小而暗）
const DOTS = new Array(70).fill(0).map((_, i) => ({ x: random("dx" + i) * W, y: random("dy" + i) * H, z: random("dz" + i), tw: random("dt" + i) * 6.28 }));
export const Particles = ({ t, opacity = 1 }) => (
  <AbsoluteFill style={{ opacity }}>
    {DOTS.map((d, i) => {
      const s = 1.5 + d.z * 4.5, y = ((d.y - t * (12 + d.z * 40)) % H + H) % H, a = (0.15 + d.z * 0.55) * (0.6 + 0.4 * Math.sin(t * 2 + d.tw));
      return <div key={i} style={{ position: "absolute", left: d.x + Math.sin(t * 0.4 + d.tw) * 20, top: y, width: s, height: s, borderRadius: "50%", background: "#cfe0ff", opacity: a, boxShadow: `0 0 ${s * 3}px rgba(160,190,255,.8)` }} />;
    })}
  </AbsoluteFill>
);
// 暗角（胶片颗粒在后期用 ffmpeg 加，浏览器里算太慢）
export const Finish = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse 75% 60% at 50% 48%, transparent 55%, rgba(0,0,0,.55) 100%)" }} />
);
export const Flash = ({ t, at, color = "#fff", peak = 0.85, decay = 0.35 }) => {
  const a = t < at ? 0 : peak * Math.exp(-(t - at) / (decay / 3));
  return a > 0.003 ? <AbsoluteFill style={{ background: color, opacity: a }} /> : null;
};

// ---------- App 图标（按 dev/app-icon.html 重建，可做动画） ----------
// ring：圆环绘制进度 0~1；blip、dot：两个白点出现进度；tile：底板出现进度；sweep：高光扫过位置 0~1
export const AppIcon = ({ size, ring = 1, blip = 1, dot = 1, tile = 1, sweep = -1, glow = 1 }) => {
  const s = size / 512;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 112 * s, overflow: "hidden", opacity: tile, transform: `scale(${0.75 + 0.25 * tile})`,
        boxShadow: `0 ${40 * s}px ${120 * s}px rgba(80,70,255,${0.55 * glow * tile}), 0 0 ${200 * s}px rgba(0,194,216,${0.35 * glow * tile}), inset 0 0 0 ${2 * s}px rgba(255,255,255,.22)`,
        background: "radial-gradient(260px 260px at 430px 70px,rgba(255,95,180,.75),rgba(255,95,180,0)),radial-gradient(300px 300px at 60px 470px,rgba(20,11,77,.55),rgba(20,11,77,0)),radial-gradient(330px 330px at 170px 40px,rgba(255,255,255,.28),rgba(255,255,255,0)),linear-gradient(135deg,#6a4dff 0%,#2f6bff 50%,#00c2d8 100%)", backgroundSize: `${size}px ${size}px` }}>
        {sweep >= 0 && sweep <= 1 && <div style={{ position: "absolute", top: -size * 0.2, bottom: -size * 0.2, width: size * 0.35, left: -size * 0.5 + sweep * size * 1.6, transform: "rotate(18deg)", background: "linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)" }} />}
      </div>
      {/* 圆环：锥形渐变 + 环形遮罩，再叠一个按进度展开的锥形遮罩 */}
      <div style={{ position: "absolute", left: 91 * s, top: 91 * s, width: 330 * s, height: 330 * s, borderRadius: "50%",
        background: "conic-gradient(from 160deg,rgba(255,255,255,.16) 0deg,rgba(255,255,255,.42) 150deg,#fff 250deg,rgba(255,255,255,.16) 250deg)",
        WebkitMaskImage: `radial-gradient(closest-side,transparent 81.6%,#000 82.2%), conic-gradient(from 160deg, #000 ${ring * 360}deg, transparent ${ring * 360}deg)`,
        maskImage: `radial-gradient(closest-side,transparent 81.6%,#000 82.2%), conic-gradient(from 160deg, #000 ${ring * 360}deg, transparent ${ring * 360}deg)`,
        WebkitMaskComposite: "source-in", maskComposite: "intersect" }} />
      <svg style={{ position: "absolute", inset: 0 }} width={size} height={size} viewBox="0 0 512 512">
        <defs><radialGradient id="ig" cx="371" cy="160" r="70" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset=".35" stopColor="#fff" stopOpacity=".25" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient></defs>
        <circle cx="256" cy="256" r={74 * dot} fill="#fff" fillOpacity=".1" />
        <circle cx="370.9" cy="159.6" r={70 * blip} fill="url(#ig)" />
        <circle cx="370.9" cy="159.6" r={24 * E.outBack(Math.min(1, blip))} fill="#fff" />
        <circle cx="256" cy="256" r={30 * E.outBack(Math.min(1, dot))} fill="#fff" />
      </svg>
    </div>
  );
};

// ---------- 3D 手机 ----------
export const SCREEN = { w: shotsMeta.width * shotsMeta.dpr, h: shotsMeta.height * shotsMeta.dpr, dpr: shotsMeta.dpr };
export const K = 0.47, BEZEL = 17, SB = 150;
export const PW = SCREEN.w * K + BEZEL * 2, PH = (SCREEN.h + SB) * K + BEZEL * 2;
const RAD = 96;
// 页面坐标（CSS px）→ 手机内坐标
export const toPhone = (r) => ({ left: BEZEL + r.x * SCREEN.dpr * K, top: BEZEL + SB * K + r.y * SCREEN.dpr * K, w: r.w * SCREEN.dpr * K, h: r.h * SCREEN.dpr * K });

const StatusBar = ({ dark }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: SB * K, background: dark ? "#000" : "#F7F7F9", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 46px 0", fontFamily: FONT, fontWeight: 700, fontSize: 26, color: dark ? "#fff" : "#000" }}>
    <span>9:41</span>
    <div style={{ position: "absolute", left: "50%", top: 16, width: 156, height: 44, marginLeft: -78, borderRadius: 22, background: "#000" }} />
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>{[8, 12, 16, 20].map((h) => <i key={h} style={{ width: 5, height: h, background: dark ? "#fff" : "#000", borderRadius: 1.5 }} />)}</span>
      <span style={{ width: 40, height: 20, border: `2.5px solid ${dark ? "#fff" : "#000"}`, borderRadius: 6, padding: 2, boxSizing: "border-box" }}><i style={{ display: "block", width: "80%", height: "100%", background: dark ? "#fff" : "#000", borderRadius: 2 }} /></span>
    </span>
  </div>
);
// 某个镜头视频：超出时长后定格在最后一帧
const ShotVideo = ({ name, skip = 0 }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const vf = Math.floor((shotsMeta.shots[name].duration - skip) * fps) - 2;
  const v = <OffthreadVideo src={staticFile(`shots/${name}.mp4`)} startFrom={Math.round(skip * fps)} muted style={{ width: "100%", height: "100%", display: "block" }} />;
  return f >= vf ? <Freeze frame={vf}>{v}</Freeze> : v;
};
// pose: {x, y, rx, ry, rz, s, o}；shots: [{name, start, end}]（相对本组件所在 Sequence 的秒数）；pops: [{img, rect, p, z, dx, dy, radius}]
export const Phone = ({ pose, shots, pops = [], dim = 0, dark = false, cx = W / 2, cy = H / 2 + 210, glowColor = "rgba(106,77,255,.55)" }) => {
  const { fps } = useVideoConfig();
  const t0 = useContext(ShiftCtx) / fps;
  const { x = 0, y = 0, rx = 0, ry = 0, rz = 0, s = 1, o = 1 } = pose;
  const glare = 0.5 + ry / 60 + rx / 90;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {/* 背后光晕与地面阴影（2D） */}
      <div style={{ position: "absolute", left: cx + x - 520 * s, top: cy + y - 700 * s, width: 1040 * s, height: 1400 * s, borderRadius: "50%", background: `radial-gradient(closest-side, ${glowColor}, transparent)`, opacity: 0.9 }} />
      <div style={{ position: "absolute", left: cx + x - 300 * s, top: cy + y + PH * s * 0.5 - 30 * s, width: 600 * s, height: 90 * s, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,.55), transparent)", filter: `blur(${10 * s}px)` }} />
      <AbsoluteFill style={{ perspective: 2600, perspectiveOrigin: `${cx}px ${cy - 200}px` }}>
        <div style={{ position: "absolute", left: cx - PW / 2, top: cy - PH / 2, width: PW, height: PH, transformStyle: "preserve-3d", transform: `translate3d(${x}px,${y}px,0) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})` }}>
          {/* 机身厚度：叠几层金属边 */}
          {[...Array(9)].map((_, i) => (
            <div key={i} style={{ position: "absolute", inset: 0, borderRadius: RAD, transform: `translateZ(${-2 - i * 2.2}px)`, background: i === 8 ? "#0b0c10" : `linear-gradient(${120 + ry * 2}deg, #5d6272 0%, #23252d 35%, #15161b 60%, #7b8194 100%)` }} />
          ))}
          <div style={{ position: "absolute", inset: 0, borderRadius: RAD, padding: 4, background: `linear-gradient(${135 + ry * 3}deg, #9aa0b4 0%, #3a3d48 22%, #1a1b21 50%, #4a4e5c 78%, #b9bfd2 100%)`, boxShadow: "0 0 0 1px rgba(255,255,255,.08)" }}>
            <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: RAD - 4, background: "#050507", padding: BEZEL - 4 }}>
              <div style={{ position: "relative", width: SCREEN.w * K, height: (SCREEN.h + SB) * K, borderRadius: RAD - BEZEL, overflow: "hidden", background: dark ? "#000" : "#f2f2f7" }}>
                <StatusBar dark={dark} />
                <div style={{ position: "absolute", left: 0, top: SB * K, width: SCREEN.w * K, height: SCREEN.h * K, overflow: "hidden" }}>
                  {shots.map((sh) => (
                    <Sequence key={sh.name + sh.start} from={Math.round((sh.start - t0) * fps)} durationInFrames={Math.max(1, Math.round((sh.end - sh.start) * fps))} layout="none">
                      <ShotVideo name={sh.name} skip={sh.skip} />
                    </Sequence>
                  ))}
                </div>
                <div style={{ position: "absolute", inset: 0, background: "#05051a", opacity: dim * 0.5 }} />
                {/* 玻璃反光 */}
                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(115deg, rgba(255,255,255,0) ${glare * 100 - 22}%, rgba(255,255,255,.10) ${glare * 100 - 8}%, rgba(255,255,255,0) ${glare * 100 + 6}%)` }} />
              </div>
            </div>
          </div>
          {/* 侧键 */}
          <div style={{ position: "absolute", left: -5, top: 300, width: 6, height: 110, borderRadius: 3, background: "linear-gradient(90deg,#6b7080,#2b2e37)", transform: "translateZ(-8px)" }} />
          <div style={{ position: "absolute", right: -5, top: 360, width: 6, height: 170, borderRadius: 3, background: "linear-gradient(90deg,#2b2e37,#6b7080)", transform: "translateZ(-8px)" }} />
          {/* 浮出的界面卡片 */}
          {pops.map((pp, i) => {
            if (pp.p <= 0.001) return null;
            const r = toPhone(pp.rect), p = pp.p;
            const dx = ((PW / 2 - (r.left + r.w / 2)) * 0.35 + (pp.dx || 0)) * p, dy = (pp.dy || -20) * p;
            return (
              <div key={i} style={{ position: "absolute", left: r.left, top: r.top, width: r.w, height: r.h, borderRadius: (pp.radius ?? 22) * SCREEN.dpr * K, overflow: "hidden",
                transform: `translate3d(${dx}px,${dy}px,${(pp.z || 160) * p}px) rotateY(${-ry * 0.55 * p}deg) rotateX(${-rx * 0.55 * p}deg) scale(${1 + (pp.scale ?? 0.16) * p})`,
                boxShadow: `0 ${50 * p}px ${110 * p}px rgba(0,0,0,${0.55 * p}), 0 0 ${70 * p}px ${pp.glow || "rgba(106,77,255,.75)"}`, opacity: Math.min(1, p * 3) }}>
                <Img src={staticFile(`crops/${pp.img}.png`)} style={{ width: "100%", height: "100%", display: "block" }} />
                <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", boxShadow: `inset 0 0 0 ${2.5 * p}px rgba(255,255,255,.55)` }} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
// 浮出进度：at 开始升起，until 开始落回
export const popP = (t, at, until) => Math.min(prog(t, at, at + 0.7, E.outBack), 1 - prog(t, until, until + 0.5, E.inOutCubic));

// ---------- 线性图标（24 网格） ----------
const ICONS = {
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5M12 2.5V5" /></>,
  truck: <><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7" /><circle cx="6.5" cy="17.5" r="1.8" /><circle cx="16.5" cy="17.5" r="1.8" /></>,
  alert: <><path d="M12 3.5 21.5 20h-19z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  cloud: <><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 9z" /><path d="M12 16v-5.5M9.6 12.8 12 10.4l2.4 2.4" /></>,
  store: <><path d="M4 9.5 5.6 4h12.8L20 9.5" /><path d="M4 9.5h16v1a3 3 0 0 1-5.3 1.9 3 3 0 0 1-5.4 0A3 3 0 0 1 4 10.5z" /><path d="M5 13v7h14v-7M10 20v-4h4v4" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
};
export const Icon = ({ name, size = 44, stroke = "#fff", width = 1.9 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
);
