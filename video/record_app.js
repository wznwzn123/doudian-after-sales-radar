// 用真实 index.html + 测试桩（dev/stage2.test.js 里的假 Supabase）录制操作画面。
// 画面里全部是演示数据，不是真实数据库数据。
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "dev/stage2.test.js"), "utf8");
const i0 = src.indexOf("const STUB = `") + 14, STUB = src.slice(i0, src.indexOf("`;", i0));
const OUT = path.join(__dirname, "build/app_frames"); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const min = 60000, iso = (ms) => new Date(Date.now() + ms).toISOString(), ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const db = {
  shop_stores: [
    { id: "s1", user_id: "u1", name: "演示店铺·家居馆", platform: "抖店", status: "active", created_at: ago(30) },
    { id: "s2", user_id: "u1", name: "演示店铺·数码店", platform: "抖店", status: "active", created_at: ago(29) },
  ],
  after_sales_tasks: [
    { id: "t1", user_id: "u1", store_id: "s1", order_id: "DEMO-6930012", buyer_name: "王**", tracking_no: "YT7712345678", status: "待举证", submission_status: "pending", risk: "高风险", deadline: iso(42 * min), deadline_at: iso(42 * min), rejection_count: 1, after_sales_type: "仅退款", reason: "买家称未收到货", order_amount: 129, refund_amount: 129, created_at: ago(1) },
    { id: "t2", user_id: "u1", store_id: "s2", order_id: "DEMO-6930025", buyer_name: "李**", tracking_no: "JT0098765432", status: "协商中", submission_status: "pending", risk: "高风险", deadline: iso(118 * min), deadline_at: iso(118 * min), after_sales_type: "退货退款", reason: "商品与描述不符", order_amount: 399, refund_amount: 399, created_at: ago(1) },
    { id: "t3", user_id: "u1", store_id: "s1", order_id: "DEMO-6930031", buyer_name: "张**", tracking_no: "YD4455667788", status: "待处理", submission_status: "pending", risk: "普通", deadline: iso(165 * min), deadline_at: iso(165 * min), after_sales_type: "退货退款", order_amount: 59.9, refund_amount: 59.9, created_at: ago(2) },
    { id: "t4", user_id: "u1", store_id: "s2", order_id: "DEMO-6930047", buyer_name: "赵**", tracking_no: "ST3322110099", status: "仲裁中", submission_status: "pending", risk: "普通", after_sales_type: "仅退款", order_amount: 88, refund_amount: 30, created_at: ago(3) },
    { id: "t5", user_id: "u1", store_id: "s1", order_id: "DEMO-6930052", buyer_name: "陈**", status: "已完成", submission_status: "submitted_manual", risk: "普通", updated_at: new Date().toISOString(), order_amount: 45, refund_amount: 0, created_at: ago(4) },
  ],
  evidence_files: [
    { id: "f1", user_id: "u1", task_id: "t1", file_name: "发货视频.mp4", mime_type: "video/mp4", storage_path: "u1/tasks/t1/a.mp4", created_at: ago(1) },
    { id: "f2", user_id: "u1", task_id: "t1", file_name: "签收截图.jpg", mime_type: "image/jpeg", storage_path: "u1/tasks/t1/b.jpg", created_at: ago(1) },
  ],
  evidence_library: [{ id: "l1", user_id: "u1", file_name: "质检报告.pdf", mime_type: "application/pdf", storage_path: "u1/library/q.pdf", usage_count: 3, created_at: ago(9) }],
  tracking_records: [
    { id: "k1", user_id: "u1", task_id: "t1", tracking_no: "YT7712345678", carrier: "圆通", last_match: "已签收：快件已由本人签收", updated_at: iso(-20 * min) },
    { id: "k2", user_id: "u1", task_id: "t2", tracking_no: "JT0098765432", carrier: "极兔", last_match: "派件中：快递员正在派送", updated_at: iso(-35 * min) },
  ],
  after_sales_events: [
    { id: "e1", user_id: "u1", task_id: "t1", event_type: "created", message: "新建售后", created_at: ago(1) },
    { id: "e2", user_id: "u1", task_id: "t1", event_type: "tracking_queried", message: "快递100 查询：已签收", created_at: iso(-20 * min) },
  ],
};

const TAP_CSS = `.__tap{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(0,122,255,.35);border:2px solid rgba(0,122,255,.8);pointer-events:none;z-index:2147483647;animation:__tap .55s ease-out forwards}@keyframes __tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.4);opacity:0}}`;

(async () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 1080 / 390, isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await ctx.route("**/*", (r) => { const u = r.request().url();
    if (u.startsWith("https://radar.test/")) return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (u.includes("@supabase/supabase-js")) return r.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
    return r.abort(); });
  await ctx.addInitScript((db) => { window.__db = db; window.alert = () => {};
    // 快递100 查询也用桩：返回成功，界面显示上面 tracking_records 里的演示物流状态
    window.__fnReply = () => ({ data: { ok: true, state_text: "已签收" }, error: null }); }, db);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto("https://radar.test/index.html");
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: TAP_CSS + "::-webkit-scrollbar{display:none}" });

  const cdp = await ctx.newCDPSession(page);
  const frames = []; let t0 = null;
  cdp.on("Page.screencastFrame", async (f) => {
    const ts = f.metadata.timestamp; if (t0 === null) t0 = ts;
    const file = path.join(OUT, String(frames.length).padStart(5, "0") + ".jpg");
    fs.writeFileSync(file, Buffer.from(f.data, "base64")); frames.push({ file, t: ts - t0 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  const wait = (ms) => page.waitForTimeout(ms);
  const tap = async (sel) => { const el = page.locator(sel).first(); const b = await el.boundingBox();
    await page.evaluate(([x, y]) => { const d = document.createElement("div"); d.className = "__tap"; d.style.left = x + "px"; d.style.top = y + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 600); }, [b.x + b.width / 2, b.y + b.height / 2]);
    await wait(180); await el.click(); };
  const smooth = async (y, ms) => { await page.evaluate(([y, ms]) => new Promise((res) => { const s = scrollY, st = performance.now();
      const f = (n) => { const k = Math.min(1, (n - st) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, s + (y - s) * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), [y, ms]); };

  // 0–3s 首页
  await wait(2600);
  // 向下滑到筛选和售后列表
  const chipY = await page.evaluate(() => document.getElementById("quickChips").getBoundingClientRect().top + scrollY - 200);
  await smooth(chipY, 1400); await wait(1400);
  // 点「高风险」快捷筛选
  await tap('.chip:text-is("高风险")'); await wait(1700);
  // 打开第一条
  await tap("#tasklist article.card"); await wait(3000);
  await page.evaluate(() => document.querySelector("#drawer .sheet").scrollBy({ top: 260, behavior: "smooth" })); await wait(1800);
  await page.evaluate("closeDrawer()"); await wait(900);
  await tap('.chip:text-is("全部")'); await wait(700);
  // 夜间模式
  await page.evaluate("toggleTheme()"); await smooth(0, 1200); await wait(2200);
  await cdp.send("Page.stopScreencast");
  await wait(300);
  const end = frames.length ? frames[frames.length - 1].t + 0.5 : 0;
  let list = "";
  frames.forEach((f, i) => { const next = i + 1 < frames.length ? frames[i + 1].t : end; list += `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`; });
  list += `file '${frames[frames.length - 1].file}'\n`;
  fs.writeFileSync(path.join(__dirname, "build/app_frames.txt"), list);
  console.log("frames", frames.length, "seconds", end.toFixed(2));
  await browser.close();
})();
