import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, random } from "remotion";
import plan from "./plan.json";
import shotsMeta from "./shots.json";
import { W, H, B, GRAD, GRAD_RED, FONT, E, prog, useT, ShiftCtx, keyframes, fontCss, useFonts, Kinetic, Title, Background, Particles, Finish, Flash, AppIcon, Phone, popP, Icon } from "./lib";

const S = plan.scenes, CR = shotsMeta.crops;
const fadeIO = (t, a, b, inD = 0.4, outD = 0.45) => Math.min(prog(t, a, a + inD, E.outCubic), 1 - prog(t, b, b + outD, E.inCubic));

// ================= 第一幕：痛点 =================
const Intro = () => {
  const t = useT();
  const line = prog(t, 0.15, 1.2, E.outExpo);
  const out = prog(t, 3.45, 4.2, E.inCubic);
  const secs = 3 * 3600 - 1 - Math.max(0, Math.floor((t - 0.5) / 0.5));
  const hh = String(Math.floor(secs / 3600)).padStart(2, "0"), mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${1 + out * 0.18})`, filter: `blur(${out * 16}px)`, opacity: 1 - out }}>
      <div style={{ position: "absolute", top: 1000, width: 900 * line, height: 2, background: "linear-gradient(90deg,transparent,rgba(255,120,150,.9),transparent)", boxShadow: "0 0 24px rgba(255,80,120,.9)", opacity: 1 - prog(t, 2.6, 3.4) }} />
      <div style={{ position: "absolute", top: 640, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <Kinetic t={t} text="每一单售后" at={0.7} size={118} />
        <Kinetic t={t} text="都在倒计时" at={1.45} size={118} grad={[2, 5]} gradCss={GRAD_RED} />
      </div>
      <div style={{ position: "absolute", top: 1060, fontFamily: FONT, fontWeight: 500, fontSize: 46, letterSpacing: 6, color: "rgba(255,170,190,.85)", fontVariantNumeric: "tabular-nums", opacity: prog(t, 2.0, 2.6, E.outCubic) }}>
        剩余 {hh}:{mm}:{ss}
      </div>
    </AbsoluteFill>
  );
};

const NOTES = [
  ["退", "家居馆", "买家申请仅退款 ¥129", "刚刚", "#ff3b5c,#ff7a45"],
  ["协", "数码店", "买家拒绝协商 · 剩 1:58:00", "2 分钟前", "#ff9f0a,#ff6a3d"],
  ["证", "家居馆", "举证截止 今天 21:00", "5 分钟前", "#ff3b5c,#c2185b"],
  ["退", "美妆铺", "买家申请退货退款 ¥399", "8 分钟前", "#ff9f0a,#ff3b5c"],
  ["问", "数码店", "快递到哪了？买家第 3 次催问", "12 分钟前", "#6a4dff,#2f6bff"],
  ["仲", "家居馆", "平台介入仲裁 · 请补充材料", "20 分钟前", "#ff5fb4,#6a4dff"],
  ["图", "相册", "签收截图在哪？共 2,317 张", "", "#8e5cff,#ff5fb4"],
  ["退", "美妆铺", "买家申请仅退款 ¥76", "刚刚", "#ff3b5c,#ff7a45"],
  ["协", "家居馆", "买家拒绝协商 · 剩 0:42:10", "1 分钟前", "#ff9f0a,#ff6a3d"],
  ["证", "数码店", "举证截止 明天 09:00", "30 分钟前", "#ff3b5c,#c2185b"],
  ["问", "美妆铺", "买家：怎么还没退款？", "3 分钟前", "#6a4dff,#2f6bff"],
  ["退", "数码店", "买家申请仅退款 ¥88", "刚刚", "#ff3b5c,#ff7a45"],
  ["证", "美妆铺", "举证截止 今天 23:30", "6 分钟前", "#ff3b5c,#c2185b"],
  ["协", "美妆铺", "买家拒绝协商 · 剩 2:31:05", "9 分钟前", "#ff9f0a,#ff6a3d"],
];
const CARDS = [...Array(22)].map((_, i) => ({ n: NOTES[(i * 5) % NOTES.length], x: (random("cx" + i) - 0.5) * 1500, y: (random("cy" + i) - 0.5) * 2000 + 160, z0: -2250 - i * 190 + random("cz" + i) * 120, ry: (random("cr" + i) - 0.5) * 30, rz: (random("cq" + i) - 0.5) * 10 }));
const Chaos = () => {
  const t = useT();
  const lt = t - S.chaos[0];
  const out = prog(t, 7.7, 8.15, E.inCubic);
  const v = 900 + 600 * prog(t, 7.2, 8.2, E.inCubic);
  return (
    <AbsoluteFill style={{ opacity: Math.min(prog(t, 3.75, 4.2), 1 - out) }}>
      <AbsoluteFill style={{ perspective: 1000, perspectiveOrigin: "50% 52%" }}>
        {CARDS.map((c, i) => {
          const z = c.z0 + (lt + 1.1) * v;
          if (z > 700) return null;
          const a = Math.min(prog(z, -4200, -3000), 1 - prog(z, 250, 650));
          const blur = Math.min(10, Math.abs(z + 200) / 180);
          const [ico, store, msg, time, cols] = c.n;
          return (
            <div key={i} style={{ position: "absolute", left: W / 2 - 330 + c.x, top: H / 2 - 70 + c.y, width: 660, opacity: a, filter: blur > 0.6 ? `blur(${blur}px)` : undefined,
              transform: `translateZ(${z}px) rotateY(${c.ry}deg) rotateZ(${c.rz}deg)`, background: "rgba(22,16,46,.82)", border: "1.5px solid rgba(255,255,255,.14)", borderRadius: 36, padding: "26px 30px", display: "flex", gap: 24, alignItems: "center",
              boxShadow: "0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.12)", fontFamily: FONT }}>
              <div style={{ flex: "0 0 80px", height: 80, borderRadius: 24, background: `linear-gradient(135deg,${cols})`, color: "#fff", fontSize: 40, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{ico}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: B.mist }}><span>{store}</span><span>{time}</span></div>
                <div style={{ fontSize: 36, fontWeight: 700, color: "#fff", marginTop: 4, whiteSpace: "nowrap" }}>{msg}</div>
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,5,26,.92) 0%, rgba(5,5,26,.55) 22%, rgba(5,5,26,0) 36%)" }} />
      <Title t={t} lines={[{ text: "店越多，单越多" }, { text: "越容易漏掉一单", grad: [3, 5], gradCss: GRAD_RED }]} at={4.2} out={7.55} top={190} size={100} />
    </AbsoluteFill>
  );
};

const Zero = () => {
  const t = useT();
  const ticks = [...plan.cues.countdown, plan.cues.impact];
  const n = t < ticks[1] ? 3 : t < ticks[2] ? 2 : t < ticks[3] ? 1 : 0;
  const last = ticks[3 - n];
  const punch = 1 + 0.09 * Math.exp(-(t - last) / 0.09);
  const hit = t >= plan.cues.impact, dt = t - plan.cues.impact;
  const shake = hit ? Math.sin(dt * 95) * 26 * Math.exp(-dt / 0.22) : 0;
  const ab = 5 + 16 * Math.exp(-(t - last) / 0.08) + (hit ? 20 * Math.exp(-dt / 0.25) : 0);
  const fade = 1 - prog(t, 11.1, 11.75, E.inOutCubic);
  const digits = `00:00:0${n}`;
  const digit = (color, dx, blend) => (
    <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", transform: `translateX(${dx}px)`, color, mixBlendMode: blend, fontFamily: FONT, fontWeight: 900, fontSize: 210, letterSpacing: 6, fontVariantNumeric: "tabular-nums" }}>{digits}</div>
  );
  return (
    <AbsoluteFill style={{ opacity: Math.min(prog(t, 7.95, 8.2), fade), transform: `translate(${shake}px, ${shake * 0.4}px)` }}>
      <div style={{ position: "absolute", top: 610, left: 0, right: 0, textAlign: "center", fontFamily: FONT, fontSize: 38, fontWeight: 500, letterSpacing: 10, color: B.mist, opacity: prog(t, 8.0, 8.4) }}>举证剩余时间</div>
      <div style={{ position: "absolute", top: 690, left: 0, right: 0, height: 260, transform: `scale(${punch})` }}>
        {digit("rgba(255,40,80,.9)", -ab, "screen")}
        {digit("rgba(0,220,255,.75)", ab, "screen")}
        {digit(hit ? "#ff4d6a" : "#fff", 0, "normal")}
      </div>
      {hit && [0, 1].map((k) => { const p = prog(dt, k * 0.12, 1.1 + k * 0.12, E.outCubic); return <div key={k} style={{ position: "absolute", left: W / 2 - 300, top: 820 - 300, width: 600, height: 600, borderRadius: "50%", border: `${6 - k * 2}px solid rgba(255,70,100,${0.8 * (1 - p)})`, transform: `scale(${0.3 + p * 2.6})`, boxShadow: `0 0 60px rgba(255,59,92,${0.6 * (1 - p)})` }} />; })}
      <div style={{ position: "absolute", top: 1070, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <Kinetic t={t} text="错过一次" at={9.8} size={88} />
        <Kinetic t={t} text="就是一次退款" at={10.15} size={88} grad={[4, 6]} gradCss={GRAD_RED} />
      </div>
      <Flash t={t} at={plan.cues.impact} color="#ff2d55" peak={0.55} decay={0.6} />
    </AbsoluteFill>
  );
};

// ================= 第二幕：品牌登场 =================
const Brand = () => {
  const t = useT();
  const cy = 760;
  const sweepO = Math.min(prog(t, 12.0, 12.6), 1 - prog(t, 14.0, 14.9));
  const up = prog(t, 13.8, 14.7, E.outExpo);
  const out = prog(t, 17.55, 18.05, E.inCubic);
  const push = 1 + 0.05 * prog(t, 13.5, 18, E.inOutSine);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${push + out * 0.3})`, filter: `blur(${out * 18}px)` }}>
      {[0, 1, 2, 3].map((k) => { const p = prog(t, 12.05 + k * 0.12, 12.9 + k * 0.12, E.outExpo); const r = 200 + k * 130; return <div key={k} style={{ position: "absolute", left: W / 2 - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: "50%", border: "1.5px solid rgba(170,185,255,.22)", transform: `scale(${0.4 + 0.6 * p})`, opacity: p * (1 - 0.6 * up) }} />; })}
      <div style={{ position: "absolute", left: W / 2 - 600, top: cy - 600, width: 1200, height: 1200, borderRadius: "50%", opacity: sweepO, transform: `rotate(${(t - 12) * 160}deg)`,
        background: "conic-gradient(from 0deg, rgba(120,140,255,0) 0deg, rgba(120,140,255,0) 290deg, rgba(150,170,255,.38) 358deg, rgba(220,230,255,.7) 360deg)", WebkitMaskImage: "radial-gradient(closest-side, #000 55%, transparent 100%)", maskImage: "radial-gradient(closest-side, #000 55%, transparent 100%)" }} />
      <div style={{ position: "absolute", left: W / 2 - 210, top: cy - 210 - up * 70, transform: `perspective(1600px) rotateY(${(1 - prog(t, 13.4, 15.2, E.outCubic)) * -18 + Math.sin(t * 0.9) * 4}deg) rotateX(${Math.cos(t * 0.8) * 3}deg)` }}>
        <AppIcon size={420} ring={prog(t, 12.45, 13.45, E.inOutCubic)} dot={prog(t, 13.2, 13.55)} blip={prog(t, 13.45, 13.85)} tile={prog(t, 13.55, 14.3, E.outExpo)} sweep={prog(t, 16.15, 16.95)} />
      </div>
      <div style={{ position: "absolute", top: 1010, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
          <Kinetic t={t} text="售后雷达" at={14.0} size={164} stagger={0.07} dur={0.9} spacing={8} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 54, padding: "4px 22px", borderRadius: 999, color: "#fff", background: GRAD, opacity: prog(t, 14.6, 15.0), transform: `translateY(${(1 - prog(t, 14.6, 15.1, E.outBack)) * 30}px) scale(${0.7 + 0.3 * prog(t, 14.6, 15.1, E.outBack)})` }}>Pro</div>
        </div>
        <Kinetic t={t} text="让每一单售后，尽在掌握" at={15.0} size={50} weight={300} spacing={8} color="rgba(236,238,255,.82)" stagger={0.045} />
      </div>
    </AbsoluteFill>
  );
};

// ================= 第三幕：产品 =================
const POSE = [
  [18.0, { x: 0, y: 1500, rx: 42, ry: -34, rz: 10, s: 0.92, o: 1 }],
  [19.3, { x: 0, y: 40, rx: 10, ry: -16, rz: 2, s: 1, o: 1 }],
  [23.75, { x: 0, y: 20, rx: 8, ry: -11, rz: 1.5, s: 1, o: 1 }],
  [24.45, { x: 0, y: 40, rx: 8, ry: 15, rz: -2, s: 1, o: 1 }],
  [28.75, { x: 0, y: 20, rx: 6, ry: 10, rz: -1.5, s: 1, o: 1 }],
  [29.45, { x: 0, y: 70, rx: 4, ry: -9, rz: 1, s: 1.05, o: 1 }],
  [34.75, { x: 0, y: 50, rx: 3, ry: -5, rz: 0.5, s: 1.05, o: 1 }],
  [35.45, { x: 0, y: 40, rx: 7, ry: 13, rz: -1, s: 1, o: 1 }],
  [39.75, { x: 0, y: 20, rx: 5, ry: 9, rz: -1, s: 1, o: 1 }],
  [40.55, { x: -175, y: 70, rx: 6, ry: 17, rz: -2, s: 0.86, o: 1 }],
  [44.8, { x: -190, y: 60, rx: 5, ry: 14, rz: -1.5, s: 0.86, o: 1 }],
  [45.45, { x: -260, y: -700, rx: 30, ry: 30, rz: -6, s: 0.7, o: 0 }],
];
const DARK_POSE = [
  [41.3, { x: 760, y: 160, rx: 10, ry: -40, rz: 6, s: 0.88, o: 1 }],
  [42.35, { x: 205, y: 120, rx: 6, ry: -15, rz: 1.5, s: 0.9, o: 1 }],
  [44.8, { x: 195, y: 110, rx: 5, ry: -11, rz: 1, s: 0.9, o: 1 }],
  [45.45, { x: 300, y: -620, rx: 30, ry: -30, rz: 6, s: 0.72, o: 0 }],
];
const MAIN_SHOTS = [
  { name: "home", start: 18.0, end: 24.0 },
  { name: "filter", start: 24.0, end: 29.0 },
  { name: "detail", start: 29.0, end: 35.0 },
  { name: "evidence", start: 35.0, end: 40.0 },
  { name: "stores", start: 40.0, end: 45.6 },
];
const Product = () => {
  const t = useT();
  const pops = [
    { img: "urgent", rect: CR.urgent, p: popP(t, 20.4, 23.15), z: 190 },
    { img: "taskcard", rect: CR.taskcard, p: popP(t, 26.6, 28.4), z: 190, glow: "rgba(255,59,92,.7)" },
    { img: "logistics", rect: CR.logistics, p: popP(t, 30.9, 34.2), z: 200, scale: 0.14, glow: "rgba(0,194,216,.8)" },
    ...[0, 1, 2].map((i) => ({ img: "file" + i, rect: CR.fileRows[i], p: popP(t, 36.8 + i * 0.3, 39.1 + i * 0.08), z: 150 + i * 45, dx: (i - 1) * 18, dy: -30 - i * 10, radius: 16, scale: 0.2 })),
  ];
  const dim = Math.max(...pops.map((p) => p.p)) * 0.95;
  const showDark = t >= 41.25;
  return (
    <AbsoluteFill>
      <Phone pose={keyframes(t, POSE)} shots={MAIN_SHOTS} pops={pops} dim={dim} />
      {showDark && (
        <Phone pose={keyframes(t, DARK_POSE)} dark shots={[{ name: "dark", start: 41.3, end: 45.6 }]} glowColor="rgba(255,95,180,.45)"
          pops={[{ img: "urgent_dark", rect: CR.urgent_dark, p: popP(t, 42.6, 44.5), z: 170, glow: "rgba(255,95,180,.7)" }]} dim={popP(t, 42.6, 44.5) * 0.9} />
      )}
      {/* 顶部压暗，保证标题可读 */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 640, background: "linear-gradient(180deg, rgba(5,5,26,.9) 0%, rgba(5,5,26,.6) 55%, rgba(5,5,26,0) 100%)" }} />
      <Title t={t} kicker="首页" lines={[{ text: "最急的那一单" }, { text: "永远在最上面", grad: [3, 6] }]} at={18.45} out={23.55} />
      <Title t={t} kicker="高风险筛选" lines={[{ text: "高风险售后" }, { text: "一键筛出来", grad: [0, 2] }]} at={24.3} out={28.55} />
      <Title t={t} kicker="快递100 物流查询" lines={[{ text: "签收没签收" }, { text: "点开就知道", grad: [0, 2] }]} at={29.3} out={34.55} />
      <Title t={t} kicker="举证材料" lines={[{ text: "视频、截图、资料" }, { text: "全都存在云端", grad: [4, 6] }]} at={35.3} out={39.55} />
      <Title t={t} kicker="多店铺 · 夜间模式" lines={[{ text: "几家店一起管", grad: [0, 2] }, { text: "深夜也不刺眼" }]} at={40.35} out={44.6} />
      <div style={{ position: "absolute", right: 40, top: 56, fontFamily: FONT, fontSize: 26, fontWeight: 500, color: B.faint, border: "1px solid rgba(255,255,255,.16)", padding: "6px 18px", borderRadius: 999, opacity: fadeIO(t, 18.6, 44.7) }}>画面为演示数据</div>
    </AbsoluteFill>
  );
};

// 功能总览（便当格）
const TILES = [
  { x: 0, y: 0, w: 960, h: 300, icon: "timer", title: "3 小时倒计时", desc: "拒绝协商后开始计时，最急的排最前", c: "#ff5f7e,#ff9f0a", live: true },
  { x: 0, y: 322, w: 469, h: 270, icon: "truck", title: "快递100 查物流", desc: "点开售后自动查询", c: "#2f6bff,#00c2d8" },
  { x: 491, y: 322, w: 469, h: 270, icon: "alert", title: "高风险一键筛", desc: "要紧的单先处理", c: "#ff3b5c,#ff5fb4" },
  { x: 0, y: 614, w: 469, h: 270, icon: "cloud", title: "举证材料上云", desc: "换手机也不会丢", c: "#00c2d8,#34d399" },
  { x: 491, y: 614, w: 469, h: 270, icon: "store", title: "多店铺管理", desc: "一个页面全看到", c: "#6a4dff,#2f6bff" },
  { x: 0, y: 906, w: 960, h: 200, icon: "shield", title: "新设备登录提醒", desc: "陌生设备登录你的账号，邮件第一时间通知", c: "#8e5cff,#ff5fb4" },
];
const Bento = () => {
  const t = useT();
  const out = prog(t, 49.55, 50.05, E.inCubic);
  const secs = 3 * 3600 - 19 - Math.floor(Math.max(0, t - 45.6));
  const clock = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60].map((v) => String(v).padStart(2, "0")).join(":");
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.15})`, filter: `blur(${out * 14}px)` }}>
      <Title t={t} kicker="全部功能" lines={[{ text: "该盯的" }, { text: "它都替你盯着", grad: [4, 6] }]} at={45.25} out={99} top={150} size={96} />
      <div style={{ position: "absolute", left: 60, top: 500, width: 960, height: 1106 }}>
        {TILES.map((tl, i) => {
          const p = prog(t, 45.55 + i * 0.11, 46.35 + i * 0.11, E.outExpo);
          const sheen = (t - 48.3) * 2600 - 300 - (tl.x + tl.y * 0.6);
          return (
            <div key={i} style={{ position: "absolute", left: tl.x, top: tl.y, width: tl.w, height: tl.h, perspective: 1400 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: 44, overflow: "hidden", opacity: p, transform: `translateY(${(1 - p) * 90}px) rotateX(${(1 - p) * 55}deg)`, transformOrigin: "50% 100%",
                background: "linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.035))", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.13), inset 0 1.5px 0 rgba(255,255,255,.22), 0 30px 60px rgba(0,0,0,.35)", fontFamily: FONT, padding: tl.h > 220 ? "34px 36px" : "30px 36px", display: "flex", flexDirection: tl.w > 900 ? "row" : "column", alignItems: tl.w > 900 ? "center" : "flex-start", gap: tl.w > 900 ? 30 : 0 }}>
                <div style={{ flex: "none", width: 92, height: 92, borderRadius: 28, background: `linear-gradient(135deg,${tl.c})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 12px 30px ${tl.c.split(",")[0]}55` }}><Icon name={tl.icon} size={50} /></div>
                <div style={{ flex: 1, marginTop: tl.w > 900 ? 0 : 26 }}>
                  <div style={{ fontSize: 44, fontWeight: 900, color: "#fff" }}>{tl.title}</div>
                  <div style={{ fontSize: 28, fontWeight: 400, color: B.mist, marginTop: 8 }}>{tl.desc}</div>
                </div>
                {tl.live && <div style={{ fontSize: 66, fontWeight: 900, fontVariantNumeric: "tabular-nums", backgroundImage: "linear-gradient(100deg,#ffb1c1,#ff5f7e)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", letterSpacing: 2, position: "absolute", right: 40, bottom: 34 }}>{clock}</div>}
                <div style={{ position: "absolute", top: -100, bottom: -100, width: 220, left: sheen, transform: "rotate(20deg)", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent)" }} />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ================= 第四幕：收尾 =================
const Promise_ = () => {
  const t = useT();
  const out = prog(t, 54.6, 55.05, E.inCubic);
  return (
    <AbsoluteFill style={{ opacity: Math.min(prog(t, 49.9, 50.2), 1 - out), filter: `blur(${out * 16}px)` }}>
      {[...Array(6)].map((_, k) => { const ph = ((t - 50) * 0.42 + k / 6) % 1; return <div key={k} style={{ position: "absolute", left: W / 2 - 400, top: 940 - 400, width: 800, height: 800, borderRadius: "50%", border: "2px solid rgba(150,170,255,.5)", transform: `scale(${0.15 + ph * 2.3})`, opacity: (1 - ph) * 0.55 * prog(t, 50, 50.8) }} />; })}
      <div style={{ position: "absolute", left: W / 2 - 700, top: 940 - 700, width: 1400, height: 1400, borderRadius: "50%", transform: `rotate(${(t - 50) * 70}deg)`, background: "conic-gradient(from 0deg, rgba(120,140,255,0) 0deg, rgba(120,140,255,0) 300deg, rgba(140,170,255,.22) 359deg, rgba(220,230,255,.5) 360deg)", WebkitMaskImage: "radial-gradient(closest-side, #000 50%, transparent 100%)", maskImage: "radial-gradient(closest-side, #000 50%, transparent 100%)" }} />
      <div style={{ position: "absolute", top: 940, left: -200, right: -200, height: 3, background: "linear-gradient(90deg, transparent, #fff, transparent)", opacity: Math.exp(-(t - 50) / 0.25) * prog(t, 49.95, 50.02), boxShadow: "0 0 40px #9db0ff" }} />
      <div style={{ position: "absolute", top: 640, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <Kinetic t={t} text="超时之前" at={50.15} size={156} stagger={0.06} />
        <Kinetic t={t} text="它先提醒你" at={50.65} size={156} stagger={0.06} grad={[0, 5]} />
        <div style={{ height: 30 }} />
        <Kinetic t={t} text="让每一单售后，都在掌控之中" at={52.3} size={46} weight={300} spacing={6} color="rgba(236,238,255,.8)" stagger={0.04} />
      </div>
    </AbsoluteFill>
  );
};
const End = () => {
  const t = useT();
  const fade = 1 - prog(t, 59.25, 59.95, E.inOutCubic);
  const ic = prog(t, 55.05, 55.9, E.outBack);
  return (
    <AbsoluteFill style={{ opacity: Math.min(prog(t, 54.95, 55.3), fade), alignItems: "center" }}>
      <div style={{ position: "absolute", top: 500, transform: `perspective(1500px) rotateY(${Math.sin(t * 0.8) * 8}deg) rotateX(${Math.cos(t * 0.7) * 4}deg) scale(${0.6 + 0.4 * ic})`, opacity: Math.min(1, ic * 1.5) }}>
        <AppIcon size={300} sweep={prog(t, 56.0, 56.8)} />
      </div>
      <div style={{ position: "absolute", top: 880, display: "flex", alignItems: "baseline", gap: 20 }}>
        <Kinetic t={t} text="售后雷达" at={55.45} size={136} stagger={0.06} spacing={6} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 46, padding: "2px 20px", borderRadius: 999, color: "#fff", background: GRAD, opacity: prog(t, 55.9, 56.2) }}>Pro</div>
      </div>
      <div style={{ position: "absolute", top: 1068 }}><Kinetic t={t} text="手机浏览器打开即用" at={56.1} size={46} weight={400} spacing={6} color="rgba(236,238,255,.85)" stagger={0.035} /></div>
      <div style={{ position: "absolute", top: 1180, fontFamily: FONT, fontSize: 30, fontWeight: 500, color: "#fff", padding: "16px 34px", borderRadius: 999, background: "rgba(255,255,255,.08)", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.18)", opacity: prog(t, 56.6, 57.1), transform: `translateY(${(1 - prog(t, 56.6, 57.2, E.outCubic)) * 20}px)`, letterSpacing: 1 }}>
        wznwzn123.github.io/doudian-after-sales-radar
      </div>
      <div style={{ position: "absolute", top: 1440, fontFamily: FONT, fontSize: 28, color: B.faint, letterSpacing: 4, opacity: prog(t, 57.2, 57.8) }}>悠然网络科技工作室™</div>
      <div style={{ position: "absolute", top: 1494, fontFamily: FONT, fontSize: 22, color: "rgba(236,238,255,.28)", letterSpacing: 2, opacity: prog(t, 57.4, 58.0) }}>画面为演示数据 · 部分情景为演绎</div>
    </AbsoluteFill>
  );
};

// ================= 总装 =================
// 动态模糊在后期按这些时间段做帧混合（见 finish.sh）
export const BLUR_WINDOWS = [[9.45, 9.95], [17.9, 19.45], [23.7, 24.55], [28.7, 29.55], [34.7, 35.55], [39.7, 40.7], [41.25, 42.5], [44.8, 45.6]];
const SCENES = [[Intro, "intro"], [Chaos, "chaos"], [Zero, "zero"], [Brand, "brand"], [Product, "home", S.stores[1] + 0.6], [Bento, "bento"], [Promise_, "promise"], [End, "end"]];
const Content = () => {
  const { fps } = useVideoConfig();
  const t = useT(), frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: B.ink, overflow: "hidden" }}>
      <Background t={t} />
      <Particles t={t} opacity={0.35 + 0.65 * prog(t, 12, 14)} />
      {SCENES.map(([C, key, endOverride]) => {
        const a = S[key][0], b = endOverride ?? S[key][1];
        const from = Math.max(0, Math.round((a - 0.5) * fps)), to = Math.min(plan.duration * fps, Math.round((b + 0.6) * fps));
        return <Sequence key={key} from={from} durationInFrames={to - from}><Shift from={from}><C /></Shift></Sequence>;
      })}
      <Flash t={t} at={plan.cues.drop} peak={0.7} decay={0.5} />
      <Flash t={t} at={plan.cues.drop2} peak={0.6} decay={0.5} />
      <Finish />
    </AbsoluteFill>
  );
};
// 让场景内部的 useT() 拿到绝对时间：Sequence 内帧号是相对的，这里把偏移加回去
const Shift = ({ from, children }) => <ShiftCtx.Provider value={from}>{children}</ShiftCtx.Provider>;
export const Film = () => {
  useFonts();
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill>
      <style>{fontCss}</style>
      <Content />
    </AbsoluteFill>
  );
};
