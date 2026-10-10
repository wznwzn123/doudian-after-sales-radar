// Stage-2 logic tests: real index.html in real Chromium, Supabase client replaced by a stub with an in-memory fake DB.
// This is NOT a test against the real database.
const { chromium } = require("playwright");
const fs = require("fs");

const STUB = `
(function(){
 const listeners=[];window.__log=[];window.__calls=[];window.__writes=[];window.__removed=[];window.__rt=[];window.__removedChannels=0;
 const uid=()=>'id'+Math.random().toString(36).slice(2,10);
 function builder(table){
  const st={op:'select',filters:[],payload:null,single:false,maybe:false,opts:{},ret:false};
  const T=()=>(window.__db[table]=window.__db[table]||[]);
  const run=async()=>{
   const rows=T();const match=r=>st.filters.every(([k,v])=>r[k]===v);
   if(st.op==='select'){
    let out=rows.filter(match).map(r=>({...r}));
    if(st.order){const [k,o]=st.order;out.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(o&&o.ascending===false?-1:1))}
    if(st.single){return out.length===1?{data:out[0],error:null}:{data:null,error:{message:'single row expected'}}}
    if(st.maybe){return{data:out[0]||null,error:null}}
    return{data:st.opts.head?null:out,error:null,count:out.length};
   }
   if(st.op==='insert'){const list=Array.isArray(st.payload)?st.payload:[st.payload];const ins=list.map(p=>({id:uid(),created_at:new Date().toISOString(),...p}));ins.forEach(r=>rows.push(r));window.__writes.push({table,op:'insert',payload:st.payload});return st.single?{data:ins[0],error:null}:{data:ins,error:null}}
   if(st.op==='update'){const hit=rows.filter(match);hit.forEach(r=>Object.assign(r,st.payload));window.__writes.push({table,op:'update',payload:st.payload,filters:st.filters,hit:hit.length});return{data:st.ret?hit.map(r=>({...r})):null,error:null}}
   if(st.op==='delete'){const keep=rows.filter(r=>!match(r));const n=rows.length-keep.length;window.__db[table]=keep;window.__writes.push({table,op:'delete',filters:st.filters,n});return{data:null,error:null}}
   if(st.op==='upsert'){window.__writes.push({table,op:'upsert',payload:st.payload});return{data:null,error:null}}
  };
  const b=new Proxy({}, {get(_,p){
   if(p==='then')return(res,rej)=>run().then(res,rej);
   return(...a)=>{switch(p){
    case 'select':if(st.op==='select'){st.opts=a[1]||{}}else st.ret=true;break;
    case 'eq':st.filters.push([a[0],a[1]]);break;
    case 'order':st.order=a;break;
    case 'single':st.single=true;break;
    case 'maybeSingle':st.maybe=true;break;
    case 'insert':st.op='insert';st.payload=a[0];break;
    case 'update':st.op='update';st.payload=a[0];break;
    case 'delete':st.op='delete';break;
    case 'upsert':st.op='upsert';st.payload=a[0];break;
   }return b}
  }});
  return b;
 }
 const sb={
  auth:{
   getSession:async()=>({data:{session:{user:{id:'u1',email:'a@x.com'}}},error:null}),
   onAuthStateChange(cb){listeners.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
   async signOut(){listeners.forEach(cb=>cb('SIGNED_OUT',null));return{error:null}}
  },
  async rpc(name,args){
   window.__calls.push({name,args});
   if(name==='security_register_device')return{data:{ok:true},error:null};
   if(name==='is_admin')return{data:window.__admin===true,error:null};
   if(name==='admin_list_all_users')return{data:window.__users||[],error:null};
   return{data:null,error:{message:'unexpected rpc '+name}};
  },
  from:(t)=>builder(t),
  channel(name){const c={name,on(type,cfg,cb){window.__rt.push({name,cfg,cb});return c},subscribe(){return c},async track(){},async untrack(){},presenceState(){return{}}};return c},
  removeChannel(c){window.__removedChannels++},
  storage:{from:()=>({
   async upload(){return{error:null}},
   async remove(p){window.__removed.push(...p);return{error:null}},
   async createSignedUrl(p){return{data:{signedUrl:'https://files.test/'+p},error:null}}
  })}
 };
 window.supabase={createClient:()=>sb};
})();`;

const OBSERVER = `
window.__prompt='';window.__confirm=true;window.__clicked=[];
window.prompt=()=>window.__prompt;window.confirm=()=>window.__confirm;window.alert=()=>{};
HTMLInputElement.prototype.click=function(){window.__clicked.push({type:this.type,accept:this.accept})};
`;

async function open(browser, htmlPath, { db, admin = false, users = [], dark = false }) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("https://radar.test/")) {
      if (u.endsWith("manifest.webmanifest")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    }
    if (u.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ db, admin, users, dark }) => {
    window.__db = db; window.__admin = admin; window.__users = users;
    try { if (dark) localStorage.setItem("sar_dark", "1"); } catch (e) {}
  }, { db, admin, users, dark });
  await ctx.addInitScript(OBSERVER);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => (page.__errs = (page.__errs || []).concat(e.message)));
  await page.goto("https://radar.test/index.html");
  await page.waitForTimeout(600);
  return { ctx, page };
}
const results = [];
const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail });
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent || "", sel);
const writes = (p, f) => p.evaluate(() => window.__writes);
const iso = (ms) => new Date(Date.now() + ms).toISOString();

function seed() {
  return {
    shop_stores: [
      { id: "s1", user_id: "u1", name: "店A", platform: "抖店", status: "active", created_at: "2026-10-01T00:00:00Z" },
      { id: "s2", user_id: "u1", name: "店B", platform: "抖店", status: "disabled", created_at: "2026-10-02T00:00:00Z" },
    ],
    after_sales_tasks: [
      { id: "t1", user_id: "u1", store_id: "s1", order_id: "ORD1", buyer_name: "张三", tracking_no: "SF1", status: "待举证", submission_status: "pending", risk: "高风险", deadline: iso(30 * 60000), deadline_at: iso(30 * 60000), monitoring: true, rejection_count: 1, after_sales_type: "仅退款", reason: "r1", evidence_reason: "e1", created_at: "2026-10-01T00:00:00Z" },
      { id: "t2", user_id: "u1", store_id: "s1", order_id: "ORD2", buyer_name: "李四", status: "仲裁中", submission_status: "pending", risk: "普通", created_at: "2026-10-02T00:00:00Z" },
      { id: "t3", user_id: "u1", store_id: "s2", order_id: "ORD3", buyer_name: "王五", status: "已完成", submission_status: "submitted_manual", risk: "普通", updated_at: new Date().toISOString(), created_at: "2026-10-03T00:00:00Z" },
    ],
    evidence_files: [
      { id: "f1", user_id: "u1", task_id: "t1", file_name: "a.jpg", mime_type: "image/jpeg", storage_path: "u1/tasks/t1/a.jpg", library_id: null, created_at: "2026-10-01T00:00:00Z" },
      { id: "f2", user_id: "u1", task_id: "t1", file_name: "lib.pdf", mime_type: "application/pdf", storage_path: "u1/library/lib.pdf", library_id: "l1", created_at: "2026-10-01T00:00:01Z" },
      { id: "f3", user_id: "u1", task_id: "t3", file_name: "shared.mp4", mime_type: "video/mp4", storage_path: "u1/shared.mp4", library_id: null, created_at: "2026-10-01T00:00:02Z" },
      { id: "f4", user_id: "u1", task_id: "t2", file_name: "shared.mp4", mime_type: "video/mp4", storage_path: "u1/shared.mp4", library_id: null, created_at: "2026-10-01T00:00:03Z" },
    ],
    evidence_library: [
      { id: "l1", user_id: "u1", file_name: "lib.pdf", mime_type: "application/pdf", storage_path: "u1/library/lib.pdf", usage_count: 1, created_at: "2026-10-01T00:00:00Z" },
      { id: "l2", user_id: "u1", file_name: "own.png", mime_type: "image/png", storage_path: "u1/library/own.png", usage_count: 0, created_at: "2026-10-01T00:00:01Z" },
    ],
    tracking_records: [{ id: "k1", user_id: "u1", task_id: "t1", tracking_no: "SF1", carrier: "顺丰", monitoring: true, last_match: "已签收匹配", updated_at: "2026-10-05T00:00:00Z" }],
    after_sales_events: [],
  };
}

async function run(browser, htmlPath) {
  // ---- theme
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    check("theme: starts light", !(await page.evaluate("document.documentElement.classList.contains('dark')")));
    await page.evaluate("toggleTheme()");
    check("theme: toggle -> dark + stored", (await page.evaluate("document.documentElement.classList.contains('dark')")) && (await page.evaluate("localStorage.getItem('sar_dark')")) === "1");
    await page.evaluate("toggleTheme()");
    check("theme: toggle back -> light + stored 0", !(await page.evaluate("document.documentElement.classList.contains('dark')")) && (await page.evaluate("localStorage.getItem('sar_dark')")) === "0");
    await ctx.close();
    const r2 = await open(browser, htmlPath, { db: seed(), dark: true });
    check("theme: restored from localStorage on load", await r2.page.evaluate("document.documentElement.classList.contains('dark')"));
    await r2.ctx.close();
  }
  const { ctx, page } = await open(browser, htmlPath, { db: seed(), admin: true, users: [
    { id: "u1", email: "a@x.com", last_sign_in_at: new Date().toISOString() },
    { id: "u2", email: "old@x.com", last_sign_in_at: "2026-01-01T00:00:00Z" }] });
  const count = () => text(page, "#taskcount");
  check("list: 3 tasks loaded from fake DB", (await count()) === "3 条", await count());
  // ---- quick filters
  await page.click('.chip:text-is("高风险")');
  check("quick: 高风险 -> 1", (await count()) === "1 条", await count());
  await page.click('.chip:text-is("高风险")');
  check("quick: click again clears", (await count()) === "3 条");
  await page.click('.chip:text-is("1小时内到期")');
  check("quick: 1小时内到期 -> only t1", (await count()) === "1 条" && (await text(page, "#tasklist")).includes("ORD1"));
  await page.click('.chip:text-is("仲裁中")');
  check("quick: 仲裁中 -> ORD2", (await text(page, "#tasklist")).includes("ORD2") && (await count()) === "1 条");
  await page.click('.chip:text-is("今日完成")');
  check("quick: 今日完成 -> ORD3", (await text(page, "#tasklist")).includes("ORD3") && (await count()) === "1 条");
  await page.click('.chip:text-is("盯单中")');
  check("quick: 盯单中 -> ORD1", (await text(page, "#tasklist")).includes("ORD1") && (await count()) === "1 条");
  await page.click('.chip:text-is("全部")');
  check("quick: 全部 -> 3", (await count()) === "3 条");
  // ---- open task: edit form, tracking card, evidence rows
  await page.evaluate("openTask('t1')"); await page.waitForTimeout(200);
  const d = await text(page, "#detail");
  check("detail: edit form prefilled", (await page.inputValue("#f_order")) === "ORD1" && (await page.inputValue("#f_buyer")) === "张三" && (await page.inputValue("#f_track")) === "SF1" && (await page.inputValue("#f_reason")) === "r1" && (await page.inputValue("#f_evidence")) === "e1");
  check("detail: status/risk/type selects selected", (await page.inputValue("#f_status")) === "待举证" && (await page.inputValue("#f_risk")) === "高风险" && (await page.inputValue("#f_type")) === "仅退款");
  check("detail: deadline field filled (datetime-local)", /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(await page.inputValue("#f_deadline")));
  check("detail: rejection count pill", d.includes("拒绝协商 1 次"));
  check("detail: 快递监控记录 with last_match", d.includes("快递监控记录") && d.includes("已签收匹配") && d.includes("顺丰"), d.slice(0, 200));
  const btns = await page.evaluate("[...document.querySelectorAll('#detail .file button')].map(b=>b.textContent)");
  check("detail: image has 预览; library-linked shows 取消引用", btns.includes("预览") && btns.includes("取消引用") && btns.includes("移除"), JSON.stringify(btns));
  // ---- saveTask
  await page.fill("#f_buyer", "张三改"); await page.fill("#f_reason", "新原因"); await page.selectOption("#f_status", "已完成");
  await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(250);
  let w = await writes(page);
  const up = w.find((x) => x.table === "after_sales_tasks" && x.op === "update" && x.payload.buyer_name === "张三改");
  check("saveTask: patch has edited fields", up && up.payload.reason === "新原因" && up.payload.status === "已完成" && up.payload.order_id === "ORD1", JSON.stringify(up));
  check("saveTask: 已完成 on pending -> submitted_manual, deadline_at synced", up && up.payload.submission_status === "submitted_manual" && up.payload.deadline === up.payload.deadline_at);
  check("saveTask: writes task_saved event", w.some((x) => x.table === "after_sales_events" && x.payload.event_type === "task_saved"));
  // ---- rejectNegotiation
  await page.evaluate("window.__confirm=false"); const n0 = (await writes(page)).length;
  await page.evaluate("rejectNegotiation('t1')"); await page.waitForTimeout(150);
  check("reject: cancelled confirm -> no write", (await writes(page)).length === n0);
  await page.evaluate("window.__confirm=true");
  await page.evaluate("rejectNegotiation('t1')"); await page.waitForTimeout(300);
  w = await writes(page);
  const rj = w.filter((x) => x.table === "after_sales_tasks" && x.payload && x.payload.negotiation_status === "rejected").pop();
  const delta = rj ? new Date(rj.payload.deadline) - Date.now() : 0;
  check("reject: 待举证 + 高风险 + pending + count 2", rj && rj.payload.status === "待举证" && rj.payload.risk === "高风险" && rj.payload.submission_status === "pending" && rj.payload.rejection_count === 2, JSON.stringify(rj));
  check("reject: deadline ~ +3h and deadline_at equal", rj && delta > 10700000 && delta < 10810000 && rj.payload.deadline === rj.payload.deadline_at, String(delta));
  check("reject: event rejected_negotiation logged", w.some((x) => x.table === "after_sales_events" && x.payload.event_type === "rejected_negotiation"));
  // ---- pickers
  await page.evaluate("pickEvidence('image')"); await page.evaluate("pickEvidence('video')"); await page.evaluate("pickEvidence('file')");
  const clicked = await page.evaluate("window.__clicked");
  check("pickers: image/video/file accept types", clicked.length === 3 && clicked[0].accept === "image/*" && clicked[1].accept === "video/*" && clicked[2].accept.includes(".pdf"), JSON.stringify(clicked));
  // ---- removeEvidence storage guards
  await page.evaluate("window.__removed.length=0");
  await page.evaluate("removeEvidence('f2')"); await page.waitForTimeout(200);
  check("removeEvidence: library-linked -> storage untouched", (await page.evaluate("window.__removed")).length === 0);
  await page.evaluate("removeEvidence('f1')"); await page.waitForTimeout(200);
  check("removeEvidence: own unshared file -> storage removed", (await page.evaluate("window.__removed")).includes("u1/tasks/t1/a.jpg"));
  await page.evaluate("window.__removed.length=0");
  await page.evaluate("removeEvidence('f3')"); await page.waitForTimeout(200);
  check("removeEvidence: file still referenced elsewhere -> storage kept", (await page.evaluate("window.__removed")).length === 0, JSON.stringify(await page.evaluate("window.__removed")));
  await page.evaluate("closeDrawer()");
  // ---- stores
  await page.evaluate("openStore()"); await page.waitForTimeout(200);
  let s = await text(page, "#storeList");
  check("stores: list with task counts + status", s.includes("店A") && s.includes("售后 2 条") && s.includes("已停用") && s.includes("共 2 家"), s);
  await page.fill("#storeQ", "店B"); await page.waitForTimeout(80);
  s = await text(page, "#storeList");
  check("stores: search", s.includes("店B") && !s.includes("店A") && s.includes("显示 1 家"));
  await page.fill("#storeQ", ""); await page.evaluate("window.__prompt='店A新名'");
  await page.evaluate("editStore('s1')"); await page.waitForTimeout(250);
  w = await writes(page);
  check("stores: rename writes name", w.some((x) => x.table === "shop_stores" && x.payload.name === "店A新名"));
  check("stores: renamed store shows in list", (await text(page, "#storeList")).includes("店A新名"));
  await page.evaluate("window.__confirm=false"); const nw = (await writes(page)).length;
  await page.evaluate("toggleStore('s1','disabled')"); await page.waitForTimeout(100);
  check("stores: disable asks confirm (cancel -> no write)", (await writes(page)).length === nw);
  await page.evaluate("window.__confirm=true");
  await page.evaluate("toggleStore('s1','disabled')"); await page.waitForTimeout(250);
  check("stores: disable confirmed writes status", (await writes(page)).some((x) => x.table === "shop_stores" && x.payload.status === "disabled"));
  await page.evaluate("toggleStore('s2','active')"); await page.waitForTimeout(200);
  check("stores: enable needs no confirm", (await writes(page)).some((x) => x.table === "shop_stores" && x.payload.status === "active"));
  // ---- library
  await page.evaluate("openLibrary()"); await page.waitForTimeout(250);
  let lb = await page.evaluate("[...document.querySelectorAll('#modalbox .file button')].map(b=>b.textContent)");
  check("library: 删除 + 预览(image) buttons present", lb.includes("删除") && lb.includes("预览"), JSON.stringify(lb));
  check("library: image/video/doc pickers present", (await text(page, "#modalbox")).includes("图片") && (await text(page, "#modalbox")).includes("视频") && (await text(page, "#modalbox")).includes("文档"));
  await page.evaluate("window.__removed.length=0; window.__confirm=false");
  await page.evaluate("deleteLibrary('l2')"); await page.waitForTimeout(150);
  check("library delete: cancel -> nothing deleted", (await page.evaluate("window.__db.evidence_library.length")) === 2);
  await page.evaluate("window.__confirm=true");
  await page.evaluate("deleteLibrary('l2')"); await page.waitForTimeout(300);
  check("library delete: unreferenced -> row + storage removed", (await page.evaluate("window.__db.evidence_library.length")) === 1 && (await page.evaluate("window.__removed")).includes("u1/library/own.png"));
  await page.evaluate("window.__removed.length=0");
  await page.evaluate("db=window.__db; window.__db.evidence_files.push({id:'f9',user_id:'u1',task_id:'t2',file_name:'lib.pdf',storage_path:'u1/library/lib.pdf',library_id:'l1'})");
  await page.evaluate("deleteLibrary('l1')"); await page.waitForTimeout(300);
  check("library delete: still referenced by a task -> storage KEPT", (await page.evaluate("window.__db.evidence_library.length")) === 0 && (await page.evaluate("window.__removed")).length === 0, JSON.stringify(await page.evaluate("window.__removed")));
  await page.evaluate("pickLibrary('video')");
  check("library picker: video accept", (await page.evaluate("window.__clicked")).pop().accept === "video/*");
  // ---- preview
  await page.evaluate("previewInline('f4','e')"); await page.waitForTimeout(200);
  check("preview: video element with signed URL", await page.evaluate("!!document.querySelector('#modalbox video.preview[src^=\"https://files.test/\"]')"));
  await page.evaluate("previewInline('f1','e')").catch(() => {});
  // ---- more menu / settings / export / online
  await page.evaluate("more()");
  const mt = await text(page, "#modalbox");
  check("more(): new entries present", ["夜间模式", "在线用户", "工作台设置", "导出 JSON 备份", "店铺中心", "云端资料库", "设备注册诊断", "管理后台"].every((x) => mt.includes(x)), mt);
  await page.evaluate("openSettings()");
  const st = await text(page, "#modalbox");
  check("settings: account/version/data-safety/export", st.includes("a@x.com") && st.includes("6.5.0") && st.includes("数据安全") && st.includes("导出 JSON 备份") && st.includes("每分钟"));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate("exportTasks()")]);
  const path = await dl.path(); const exp = JSON.parse(fs.readFileSync(path, "utf8"));
  check("export: JSON backup has tasks/stores/library + filename", exp.tasks.length === 3 && Array.isArray(exp.stores) && Array.isArray(exp.library) && /^after-sales-radar-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.evaluate("window.__onlineUsers=[{id:'u1'},{id:'u2'}]");
  await page.evaluate("openOnlinePanel()"); await page.waitForTimeout(250);
  const ot = await text(page, "#modalbox");
  check("online panel: count, (我), admin sees emails + 24h active", ot.includes("2") && ot.includes("a@x.com（我）") && ot.includes("old@x.com") && ot.includes("24 小时内登录 1 人"), ot);
  // ---- realtime
  const rt = await page.evaluate("window.__rt.map(r=>r.cfg.table+'|'+r.cfg.filter)");
  check("realtime: subscribed to tasks + evidence_files filtered by user", rt.includes("after_sales_tasks|user_id=eq.u1") && rt.includes("evidence_files|user_id=eq.u1"), JSON.stringify(rt));
  await page.evaluate("window.__db.after_sales_tasks.push({id:'t9',user_id:'u1',order_id:'LIVE9',status:'待处理',submission_status:'pending',risk:'普通',created_at:'2026-10-09T00:00:00Z'})");
  await page.evaluate("window.__rt.find(r=>r.cfg.table==='after_sales_tasks').cb({})"); await page.waitForTimeout(900);
  check("realtime: change event refreshes the list", (await text(page, "#tasklist")).includes("LIVE9"));
  // ---- expiry fallback
  await page.evaluate(() => {
    const now = Date.now();
    window.__db.after_sales_events.length = 0; window.__writes.length = 0;
    window.__db.after_sales_tasks.length = 0;
    window.__db.after_sales_tasks.push(
      { id: "x1", user_id: "u1", order_id: "EXP-EVID", status: "待举证", submission_status: "pending", risk: "普通", deadline: new Date(now - 200000).toISOString(), created_at: "2026-10-01T00:00:00Z" },
      { id: "x2", user_id: "u1", order_id: "EXP-NONE", status: "待举证", submission_status: "pending", risk: "普通", deadline: new Date(now - 200000).toISOString(), created_at: "2026-10-01T00:00:01Z" },
      { id: "x3", user_id: "u1", order_id: "JUST-EXPIRED", status: "待举证", submission_status: "pending", risk: "普通", deadline: new Date(now - 30000).toISOString(), created_at: "2026-10-01T00:00:02Z" },
      { id: "x4", user_id: "u1", order_id: "ALREADY", status: "已完成", submission_status: "submitted_manual", risk: "普通", deadline: new Date(now - 300000).toISOString(), created_at: "2026-10-01T00:00:03Z" });
    window.__db.evidence_files.length = 0;
    window.__db.evidence_files.push({ id: "xe", user_id: "u1", task_id: "x1", file_name: "p.jpg", storage_path: "p" });
  });
  await page.evaluate("refresh()"); await page.waitForTimeout(250);
  await page.evaluate("checkExpired()"); await page.waitForTimeout(500);
  const T = await page.evaluate("Object.fromEntries(window.__db.after_sales_tasks.map(t=>[t.id,t.status+'|'+t.submission_status]))");
  check("expiry: with evidence -> 已完成/submitted_auto_local", T.x1 === "已完成|submitted_auto_local", JSON.stringify(T));
  check("expiry: without evidence -> failed_no_evidence", T.x2 === "待举证|failed_no_evidence", JSON.stringify(T));
  check("expiry: expired <90s ago is left to the server cron", T.x3 === "待举证|pending", JSON.stringify(T));
  check("expiry: finished task untouched", T.x4 === "已完成|submitted_manual");
  const evs = await page.evaluate("window.__db.after_sales_events.map(e=>e.task_id+':'+e.event_type)");
  check("expiry: exactly one event per processed task", evs.length === 2 && evs.includes("x1:deadline_auto_processed") && evs.includes("x2:deadline_failed_no_evidence"), JSON.stringify(evs));
  // server already processed (cron) between refresh and our update -> no duplicate event
  await page.evaluate(() => { window.__db.after_sales_events.length = 0; window.__db.after_sales_tasks.push({ id: "x5", user_id: "u1", order_id: "RACE", status: "待举证", submission_status: "pending", deadline: new Date(Date.now() - 200000).toISOString(), created_at: "2026-10-01T00:00:09Z" }); });
  await page.evaluate("refresh()"); await page.waitForTimeout(250);
  await page.evaluate("window.__db.after_sales_tasks.find(t=>t.id==='x5').submission_status='failed_no_evidence'");
  await page.evaluate("processExpired(tasks.find(t=>t.id==='x5'))"); await page.waitForTimeout(300);
  check("expiry: server got there first -> no duplicate event", (await page.evaluate("window.__db.after_sales_events.length")) === 0);
  // ---- logout cleanup
  const rc0 = await page.evaluate("window.__removedChannels");
  await page.evaluate("showLogin('x')");
  check("showLogin: removes realtime channel + stops expiry timer", (await page.evaluate("window.__removedChannels")) > rc0 && (await page.evaluate("rt===null")));
  check("no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await run(browser, process.argv[2]);
  await browser.close();
  let bad = 0;
  for (const r of results) { console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "   <- " + r.detail}`); if (!r.ok) bad++; }
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
