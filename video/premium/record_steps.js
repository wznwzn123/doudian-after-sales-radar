// 逐帧录制手机画面（替代 record.js 的“有变化才截图”）：
// 页面的时钟（Date / 定时器 / requestAnimationFrame）用 Playwright clock 接管，CSS 动画每帧暂停后按帧号定位，
// 每推进 1/60 秒截一张，保证滚动和弹出动画是稳定的 60fps。
// 先：git show origin/main:index.html > .app-main.html；git show origin/main:dev/stage2.test.js > .stage2-main.js
// 输出：remotion/public/shots/<name>.mp4、remotion/public/crops/<name>.png、remotion/src/shots.json
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const { db } = require("./demo-data");
const src = fs.readFileSync(path.join(__dirname, ".stage2-main.js"), "utf8");
const i0 = src.indexOf("const STUB = `") + 14, STUB = src.slice(i0, src.indexOf("`;", i0));
const W = 390, H = 844, DPR = 3, FPS = 60, DT = 1000 / FPS;
const R = path.join(__dirname, "remotion");
const SHOT = path.join(R, "public/shots"), CROP = path.join(R, "public/crops");
for (const d of [SHOT, CROP]) fs.mkdirSync(d, { recursive: true });
const TAP_CSS = `.__tap{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(80,110,255,.28);border:3px solid rgba(90,120,255,.9);pointer-events:none;z-index:2147483647;animation:__tap .6s ease-out forwards}@keyframes __tap{from{transform:scale(.35);opacity:1}to{transform:scale(1.5);opacity:0}}::-webkit-scrollbar{display:none}`;
// 页面里用的小工具：平滑滚动（rAF + performance.now，都被假时钟控制）、点击波纹、CSS 动画按帧定位
const HELPERS = `
window.__ease = (k) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
window.__scroll = (sel, y, ms) => { const el = sel ? document.querySelector(sel) : null; const get = () => el ? el.scrollTop : scrollY;
  const set = (v) => el ? (el.scrollTop = v) : scrollTo(0, v); const s = get(), st = performance.now();
  const f = (n) => { const k = Math.min(1, (n - st) / ms); set(s + (y - s) * __ease(k)); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
window.__ripple = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); const d = document.createElement("div"); d.className = "__tap";
  d.style.left = (b.x + b.width / 2) + "px"; d.style.top = (b.y + b.height / 2) + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 650); };
window.__anims = new Map();
// 新镜头开始前：把已有动画都放到结尾，清空记录（无限循环的动画 finish 会报错，跳过）
window.__reset = () => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) {} } __anims = new Map(); };
window.__seek = (frame, dt) => { for (const a of document.getAnimations()) { let r = __anims.get(a);
  if (!r) { r = { f0: frame, base: a.currentTime || 0 }; __anims.set(a, r); a.pause(); }
  a.currentTime = r.base + (frame - r.f0) * dt; } };
`;

(async () => {
  const html = fs.readFileSync(path.join(__dirname, ".app-main.html"), "utf8").replace(/ integrity="[^"]*"/g, "");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, bypassCSP: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await ctx.route("**/*", (r) => { const u = r.request().url();
    if (u.startsWith("https://radar.test/")) return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (u.includes("@supabase/supabase-js")) return r.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
    return r.abort(); });
  await ctx.addInitScript((db) => { window.__db = db; window.alert = () => {};
    window.__fnReply = () => ({ data: { ok: true, state_text: "已签收" }, error: null }); }, db);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.clock.install({ time: new Date() });
  await page.goto("https://radar.test/index.html"); await page.waitForTimeout(1500);
  await page.addStyleTag({ content: TAP_CSS }); await page.evaluate(HELPERS);
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 200));
  const cdp = await ctx.newCDPSession(page);
  // clip 用的是文档坐标，要加上当前滚动位置（getBoundingClientRect 给的是视口坐标）
  const shotPng = async (clip) => { if (clip) { const s = await page.evaluate(() => [scrollX, scrollY]); clip = { ...clip, x: clip.x + s[0], y: clip.y + s[1] }; }
    return Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: DPR } } : {}) })).data, "base64"); };
  const step = async (ms) => { await page.clock.runFor(ms); };
  const settle = async (ms) => { await page.evaluate(() => __reset()); for (let f = 0; f * DT < ms; f++) { await step(DT); await page.evaluate(([f, dt]) => __seek(f, dt), [f, DT]); } await page.evaluate(() => __reset()); };
  const rectOf = (sel, closest) => page.evaluate(([s, c]) => { let e = document.querySelector(s); if (!e) return null; if (c) e = e.closest(c); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, [sel, closest || null]);
  const crop = async (name, sel, closest) => { const r = await rectOf(sel, closest); fs.writeFileSync(path.join(CROP, name + ".png"), await shotPng({ x: r.x, y: r.y, width: r.w, height: r.h })); return r; };
  const sheetTop = (sel, closest, pad) => page.evaluate(([s, c, pad]) => { const sh = document.querySelector("#drawer .sheet"); let e = document.querySelector(s); if (c) e = e.closest(c); return e.getBoundingClientRect().top - sh.getBoundingClientRect().top + sh.scrollTop - pad; }, [sel, closest, pad]);
  // 一个镜头：dur 秒，actions = [[时间, 页面里执行的代码], ...]
  const meta = {};
  async function shot(name, dur, actions = [], after) {
    const out = path.join(SHOT, name + ".mp4");
    const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-vf", `scale=${W * DPR}:${H * DPR},format=yuv420p`, "-c:v", "libx264", "-crf", "10", "-preset", "slow", out], { stdio: ["pipe", "inherit", "inherit"] });
    await page.evaluate(() => __reset());
    const n = Math.round(dur * FPS); const todo = [...actions].sort((a, b) => a[0] - b[0]);
    for (let f = 0; f < n; f++) {
      const t = f / FPS;
      while (todo.length && todo[0][0] <= t + 1e-6) await page.evaluate(todo.shift()[1]);
      await page.evaluate(([f, dt]) => __seek(f, dt), [f, DT]);
      const buf = await shotPng();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      await step(DT);
    }
    ff.stdin.end(); await new Promise((r) => ff.on("close", r));
    meta[name] = { duration: n / FPS, ...((after && (await after())) || {}) };
    console.log(name, n, "frames");
  }

  // 1 首页
  const urgent = await crop("urgent", "#urgent", ".card");
  await crop("stats", "section.stat4");
  await shot("home", 5.0, [], async () => ({ focus: urgent }));
  // 2 筛出高风险（0.3 秒开始滚动 1.1 秒；1.9 秒点“高风险”，0.2 秒后生效）
  const chipY = await page.evaluate(() => document.getElementById("quickChips").getBoundingClientRect().top + scrollY - 230);
  await shot("filter", 4.6, [
    [0.3, `__scroll(null, ${chipY}, 1100)`],
    [1.9, `__ripple('#quickChips .chip:nth-child(3)')`],
    [2.1, `[...document.querySelectorAll('#quickChips .chip')].find(c => c.textContent === '高风险').click()`],
  ], async () => { const list = await rectOf("#tasklist"), chips = await rectOf("#quickChips"); return { focus: { x: list.x, y: chips.y - 8, w: list.w, h: 430 }, tapAt: 1.9 }; });
  const taskcard = await crop("taskcard", "#tasklist article.card");
  // 3 打开详情
  await shot("detail", 3.6, [[0.3, `__ripple('#tasklist article.card')`], [0.5, `document.querySelector('#tasklist article.card').click()`]],
    async () => ({ focus: await rectOf("#logistics_box", ".card"), tapAt: 0.3 }));
  const logistics = await crop("logistics", "#logistics_box", ".card");
  // 4 举证材料（0.3 秒开始滚动 1.3 秒）
  const filesTop = await sheetTop("#files_box", ".card", 140);
  await shot("evidence", 4.2, [[0.3, `__scroll('#drawer .sheet', ${filesTop}, 1300)`]], async () => ({ focus: await rectOf("#files_box", ".card") }));
  const files = await crop("files", "#files_box", ".card");
  const fileRows = [];
  for (let i = 0; i < 3; i++) { const r = await page.evaluate((i) => { const e = document.querySelectorAll("#files_box .file")[i]; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, i);
    if (r) { fs.writeFileSync(path.join(CROP, "file" + i + ".png"), await shotPng({ x: r.x, y: r.y, width: r.w, height: r.h })); fileRows.push(r); } }
  const timeline = await crop("timeline", "#timeline_box", ".card");
  // 5 店铺
  await page.evaluate("closeDrawer()"); await settle(800);
  await page.evaluate("setQuick('')"); await settle(400);
  await page.evaluate(() => scrollTo(0, 0)); await settle(300);
  await shot("stores", 3.6, [[0.3, `__ripple('nav.bottom button:nth-child(2)')`], [0.5, `document.querySelector('nav.bottom button:nth-child(2)').click()`]],
    async () => ({ focus: await rectOf("#storeList"), tapAt: 0.3 }));
  await page.evaluate("closeModal()"); await settle(800);
  // 6 夜间模式
  await page.evaluate("toggleTheme()"); await settle(800);
  const urgentDark = await crop("urgent_dark", "#urgent", ".card");
  await shot("dark", 4.2, [], async () => ({ focus: urgentDark }));
  fs.writeFileSync(path.join(R, "src/shots.json"), JSON.stringify({ width: W, height: H, dpr: DPR, shots: meta,
    crops: { urgent, stats: null, taskcard, logistics, files, fileRows, timeline, urgent_dark: urgentDark } }, null, 1));
  await browser.close();
})();
