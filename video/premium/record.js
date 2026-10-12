// 用最新版 index.html（先 git show origin/main:index.html > .app-main.html，git show origin/main:dev/stage2.test.js > .stage2-main.js）+ 测试桩录制宣传片镜头。画面全是 demo-data.js 的演示数据。
// 输出：public/shots/<name>.mp4（1170×2532，60fps）、public/crops/<name>.png（浮出卡片用的高清截图）、src/shots.json（元素位置）
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { db } = require("./demo-data");
const src = fs.readFileSync(path.join(__dirname, ".stage2-main.js"), "utf8");
const i0 = src.indexOf("const STUB = `") + 14, STUB = src.slice(i0, src.indexOf("`;", i0));
const W = 390, H = 844, DPR = 3;
const R = path.join(__dirname, "remotion");
const SHOT = path.join(R, "public/shots"), CROP = path.join(R, "public/crops"), TMP = path.join(__dirname, "build/shots");
for (const d of [SHOT, CROP, path.join(R, "src")]) fs.mkdirSync(d, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });
const TAP_CSS = `.__tap{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(80,110,255,.28);border:3px solid rgba(90,120,255,.9);pointer-events:none;z-index:2147483647;animation:__tap .6s ease-out forwards}@keyframes __tap{from{transform:scale(.35);opacity:1}to{transform:scale(1.5);opacity:0}}::-webkit-scrollbar{display:none}`;

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
  await page.goto("https://radar.test/index.html"); await page.waitForTimeout(1500);
  await page.addStyleTag({ content: TAP_CSS });
  const cdp = await ctx.newCDPSession(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const rectOf = (sel, closest) => page.evaluate(([s, c]) => { let e = document.querySelector(s); if (!e) return null; if (c) e = e.closest(c); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, [sel, closest || null]);
  const crop = async (name, sel, closest) => { const h = await page.evaluateHandle(([s, c]) => { let e = document.querySelector(s); return c ? e.closest(c) : e; }, [sel, closest || null]);
    await h.asElement().screenshot({ path: path.join(CROP, name + ".png") }); const r = await rectOf(sel, closest); return r; };
  const tap = async (sel) => { const el = page.locator(sel).first(); const b = await el.boundingBox();
    await page.evaluate(([x, y]) => { const d = document.createElement("div"); d.className = "__tap"; d.style.left = x + "px"; d.style.top = y + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 650); }, [b.x + b.width / 2, b.y + b.height / 2]);
    await wait(200); await el.click(); };
  const ease = `k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2`;
  const smoothWin = (y, ms) => page.evaluate(([y, ms, ease]) => new Promise((res) => { const s = scrollY, st = performance.now(), E = new Function("k", "return " + ease);
    const f = (n) => { const k = Math.min(1, (n - st) / ms); scrollTo(0, s + (y - s) * E(k)); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), [y, ms, ease]);
  const smoothEl = (sel, y, ms) => page.evaluate(([sel, y, ms, ease]) => new Promise((res) => { const el = document.querySelector(sel), s = el.scrollTop, st = performance.now(), E = new Function("k", "return " + ease);
    const f = (n) => { const k = Math.min(1, (n - st) / ms); el.scrollTop = s + (y - s) * E(k); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), [sel, y, ms, ease]);
  const sheetTop = (sel, closest, pad) => page.evaluate(([s, c, pad]) => { const sh = document.querySelector("#drawer .sheet"); let e = document.querySelector(s); if (c) e = e.closest(c); return e.getBoundingClientRect().top - sh.getBoundingClientRect().top + sh.scrollTop - pad; }, [sel, closest, pad]);

  const meta = {};
  async function shot(name, fn) {
    const dir = path.join(TMP, name); fs.mkdirSync(dir, { recursive: true });
    const frames = []; let t0 = null;
    const on = async (f) => { const ts = f.metadata.timestamp; if (t0 === null) t0 = ts;
      const file = path.join(dir, String(frames.length).padStart(5, "0") + ".png");
      fs.writeFileSync(file, Buffer.from(f.data, "base64")); frames.push({ file, t: ts - t0 });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); };
    cdp.on("Page.screencastFrame", on);
    await cdp.send("Page.startScreencast", { format: "png", maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
    await page.evaluate(() => { document.body.style.outline = "0px solid transparent"; requestAnimationFrame(() => document.body.style.outline = ""); });
    const t = Date.now(); const info = (await fn()) || {}; const dur = (Date.now() - t) / 1000;
    await cdp.send("Page.stopScreencast"); cdp.off("Page.screencastFrame", on);
    let list = ""; frames.forEach((f, i) => { const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(dur, f.t + 0.05);
      list += `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`; });
    list += `file '${frames[frames.length - 1].file}'\n`; fs.writeFileSync(path.join(dir, "list.txt"), list);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", `fps=60,scale=${W * DPR}:${H * DPR}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-crf", "10", "-preset", "slow", "-t", dur.toFixed(3), path.join(SHOT, name + ".mp4")]);
    meta[name] = { duration: dur, ...info }; console.log(name, frames.length, "frames", dur.toFixed(2) + "s");
  }

  // 1 首页
  const urgent = await crop("urgent", "#urgent", ".card");
  const stats = await crop("stats", "section.stat4");
  await shot("home", async () => { await wait(5000); return { focus: urgent, stats }; });
  // 2 筛选高风险
  const chipY = await page.evaluate(() => document.getElementById("quickChips").getBoundingClientRect().top + scrollY - 230);
  await shot("filter", async () => { await wait(300); await smoothWin(chipY, 1100); await wait(500);
    await tap('.chip:text-is("高风险")'); await wait(2400);
    const list = await rectOf("#tasklist"); const chips = await rectOf("#quickChips");
    return { focus: { x: list.x, y: chips.y - 8, w: list.w, h: 430 }, tapAt: 1.9 }; });
  const taskCard = await crop("taskcard", "#tasklist article.card");
  // 3 详情：物流
  await shot("detail", async () => { await wait(300); await tap("#tasklist article.card"); await wait(3000);
    const card = await rectOf("#logistics_box", ".card"); return { focus: card, tapAt: 0.3 }; });
  const logistics = await crop("logistics", "#logistics_box", ".card");
  // 4 举证材料
  const filesTop = await sheetTop("#files_box", ".card", 140);
  await shot("evidence", async () => { await wait(300); await smoothEl("#drawer .sheet", filesTop, 1300); await wait(2600);
    return { focus: await rectOf("#files_box", ".card") }; });
  const files = await crop("files", "#files_box", ".card");
  const fileRows = [];
  for (let i = 0; i < 3; i++) { const r = await page.evaluate((i) => { const e = document.querySelectorAll("#files_box .file")[i]; if (!e) return null; e.id = "__file" + i; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, i);
    if (r) { await page.locator("#__file" + i).screenshot({ path: path.join(CROP, "file" + i + ".png") }); fileRows.push(r); } }
  // 5 时间线
  const tlTop = await sheetTop("#timeline_box", ".card", 160);
  await shot("timeline", async () => { await wait(200); await smoothEl("#drawer .sheet", tlTop, 1200); await wait(2200);
    return { focus: await rectOf("#timeline_box", ".card") }; });
  const timeline = await crop("timeline", "#timeline_box", ".card");
  // 6 店铺
  await page.evaluate("closeDrawer()"); await wait(700);
  await page.evaluate("setQuick('')"); await wait(300); await page.evaluate(() => scrollTo(0, 0)); await wait(400);
  await shot("stores", async () => { await wait(300); await tap('nav.bottom button:nth-child(2)'); await wait(3000);
    const box = await page.evaluate(() => { const e = document.getElementById("storeList"); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    return { focus: box, tapAt: 0.3 }; });
  await page.evaluate("closeModal()"); await wait(800);
  // 7 夜间模式
  await page.evaluate("toggleTheme()"); await wait(800);
  const urgentDark = await crop("urgent_dark", "#urgent", ".card");
  await shot("dark", async () => { await wait(4200); return { focus: urgentDark }; });
  fs.writeFileSync(path.join(R, "src/shots.json"), JSON.stringify({ width: W, height: H, dpr: DPR, shots: meta,
    crops: { urgent, stats, taskcard: taskCard, logistics, files, fileRows, timeline, urgent_dark: urgentDark } }, null, 1));
  await browser.close();
})();
