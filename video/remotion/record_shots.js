// 分镜头录制真实 index.html（Supabase 换成 dev/stage2.test.js 的测试桩 + demo-data.js 演示数据）。
// 每个镜头单独输出 public/shots/<name>.mp4，并把要放大的元素位置写进 src/shots.json。
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { db } = require("./demo-data");
const root = path.join(__dirname, "../..");
const src = fs.readFileSync(path.join(root, "dev/stage2.test.js"), "utf8");
const i0 = src.indexOf("const STUB = `") + 14, STUB = src.slice(i0, src.indexOf("`;", i0));
const W = 390, H = 844, DPR = 3;
const SHOTDIR = path.join(__dirname, "public/shots"), TMP = path.join(__dirname, "../build/shots");
fs.mkdirSync(SHOTDIR, { recursive: true }); fs.rmSync(TMP, { recursive: true, force: true });
const TAP_CSS = `.__tap{position:fixed;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(0,122,255,.30);border:3px solid rgba(0,122,255,.85);pointer-events:none;z-index:2147483647;animation:__tap .6s ease-out forwards}@keyframes __tap{from{transform:scale(.35);opacity:1}to{transform:scale(1.5);opacity:0}}::-webkit-scrollbar{display:none}`;

(async () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await ctx.route("**/*", (r) => { const u = r.request().url();
    if (u.startsWith("https://radar.test/")) return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (u.includes("@supabase/supabase-js")) return r.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
    return r.abort(); });
  await ctx.addInitScript((db) => { window.__db = db; window.alert = () => {};
    window.__fnReply = () => ({ data: { ok: true, state_text: "已签收" }, error: null }); }, db);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto("https://radar.test/index.html"); await page.waitForTimeout(1200);
  await page.addStyleTag({ content: TAP_CSS });
  const cdp = await ctx.newCDPSession(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const tap = async (sel) => { const el = page.locator(sel).first(); const b = await el.boundingBox();
    await page.evaluate(([x, y]) => { const d = document.createElement("div"); d.className = "__tap"; d.style.left = x + "px"; d.style.top = y + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 650); }, [b.x + b.width / 2, b.y + b.height / 2]);
    await wait(200); await el.click(); };
  const ease = `k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2`;
  const smoothWin = (y, ms) => page.evaluate(([y, ms, ease]) => new Promise((res) => { const s = scrollY, st = performance.now(), E = new Function("k", "return " + ease);
    const f = (n) => { const k = Math.min(1, (n - st) / ms); scrollTo(0, s + (y - s) * E(k)); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), [y, ms, ease]);
  const smoothEl = (sel, y, ms) => page.evaluate(([sel, y, ms, ease]) => new Promise((res) => { const el = document.querySelector(sel), s = el.scrollTop, st = performance.now(), E = new Function("k", "return " + ease);
    const f = (n) => { const k = Math.min(1, (n - st) / ms); el.scrollTop = s + (y - s) * E(k); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), [sel, y, ms, ease]);

  const meta = {};
  async function shot(name, fn) {
    const dir = path.join(TMP, name); fs.mkdirSync(dir, { recursive: true });
    const frames = []; let t0 = null;
    const on = async (f) => { const ts = f.metadata.timestamp; if (t0 === null) t0 = ts;
      const file = path.join(dir, String(frames.length).padStart(5, "0") + ".png");
      fs.writeFileSync(file, Buffer.from(f.data, "base64")); frames.push({ file, t: ts - t0 });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); };
    cdp.on("Page.screencastFrame", on);
    // 先触发一次重绘，保证第 0 帧就是起始画面
    await cdp.send("Page.startScreencast", { format: "png", maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
    await page.evaluate(() => { document.body.style.outline = "0px solid transparent"; requestAnimationFrame(() => document.body.style.outline = ""); });
    const t = Date.now(); const info = await fn(); const dur = (Date.now() - t) / 1000;
    await cdp.send("Page.stopScreencast"); cdp.off("Page.screencastFrame", on);
    let list = ""; frames.forEach((f, i) => { const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(dur, f.t + 0.05);
      list += `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`; });
    list += `file '${frames[frames.length - 1].file}'\n`; fs.writeFileSync(path.join(dir, "list.txt"), list);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", `fps=60,scale=${W * DPR}:${H * DPR}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-crf", "12", "-preset", "medium", "-t", dur.toFixed(3), path.join(SHOTDIR, name + ".mp4")]);
    meta[name] = { duration: dur, ...info }; console.log(name, frames.length, "frames", dur.toFixed(2) + "s");
  }

  // 1 首页：最紧急倒计时在跳
  await shot("home", async () => { const r = await rect("#urgent"); const card = await page.evaluate(() => { const c = document.getElementById("urgent").closest(".card"); const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }); await wait(4000); return { focus: card, urgent: r }; });
  // 2 筛出高风险
  const chipY = await page.evaluate(() => document.getElementById("quickChips").getBoundingClientRect().top + scrollY - 230);
  await shot("filter", async () => { await wait(300); await smoothWin(chipY, 1100); await wait(500);
    const chip = await rect('.chip:nth-child(3)'); await tap('.chip:text-is("高风险")'); await wait(2200);
    const list = await rect("#tasklist"); return { chip, focus: { x: list.x, y: chip.y - 10, w: list.w, h: 420 } }; });
  // 3 打开详情：物流状态
  await shot("detail", async () => { await wait(300); await tap("#tasklist article.card"); await wait(2600);
    const card = await page.evaluate(() => { const c = document.getElementById("logistics_box").closest(".card"); const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const lg = await rect("#logistics_box"); return { focus: card, logistics: lg }; });
  // 4 举证材料
  const filesTop = await page.evaluate(() => { const sh = document.querySelector("#drawer .sheet"), c = document.getElementById("files_box").closest(".card"); return c.getBoundingClientRect().top - sh.getBoundingClientRect().top + sh.scrollTop - 150; });
  await shot("evidence", async () => { await wait(300); await smoothEl("#drawer .sheet", filesTop, 1300); await wait(2400);
    const card = await page.evaluate(() => { const c = document.getElementById("files_box").closest(".card"); const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }); return { focus: card }; });
  fs.mkdirSync(path.join(__dirname, "src"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "src/shots.json"), JSON.stringify({ width: W, height: H, dpr: DPR, shots: meta }, null, 1));
  await browser.close();
})();
