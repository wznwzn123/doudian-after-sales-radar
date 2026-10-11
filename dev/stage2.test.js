// Stage-2 logic tests: real index.html in real Chromium, Supabase client replaced by a stub with an in-memory fake DB.
// This is NOT a test against the real database.
const { chromium } = require("playwright");
const fs = require("fs");

const STUB = `
(function(){
 const listeners=[];window.__log=[];window.__calls=[];window.__writes=[];window.__removed=[];window.__rt=[];window.__removedChannels=0;
 const uid=()=>'id'+Math.random().toString(36).slice(2,10);
 function builder(table){
  const st={op:'select',filters:[],isnull:[],payload:null,single:false,maybe:false,opts:{},ret:false,cols:'*'};
  const T=()=>(window.__db[table]=window.__db[table]||[]);
  const run=async()=>{
   if(window.__latency)await new Promise(r=>setTimeout(r,window.__latency));
   if((window.__missingTables||[]).includes(table))return{data:null,error:{message:'relation "public.'+table+'" does not exist'}};
   if(st.op==='select'&&(window.__missingCols||[]).some(c=>c.startsWith(table+'.')&&String(st.cols).includes(c.split('.')[1])))return{data:null,error:{message:'column does not exist'}};
   if((st.op==='insert'||st.op==='update')&&(window.__missingCols||[]).some(c=>{const [tb,col]=c.split('.');const pl=Array.isArray(st.payload)?st.payload:[st.payload];return tb===table&&pl.some(x=>x&&col in x)}))return{data:null,error:{message:'column does not exist'}};
   const rows=T();const match=r=>st.filters.every(([k,v])=>r[k]===v)&&st.isnull.every(k=>r[k]==null);
   if(st.op==='select'){
    let out=rows.filter(match).map(r=>({...r}));
    if(st.order){const [k,o]=st.order;out.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(o&&o.ascending===false?-1:1))}
    if(st.single){return out.length===1?{data:out[0],error:null}:{data:null,error:{message:'single row expected'}}}
    if(st.maybe){return{data:out[0]||null,error:null}}
    return{data:st.opts.head?null:out,error:null,count:out.length};
   }
   if(st.op==='insert'&&table==='tracking_records'){const list=Array.isArray(st.payload)?st.payload:[st.payload];if(list.some(p=>p.last_match===null))return{data:null,error:{message:'null value in column "last_match" violates not-null constraint'}}}
   if(st.op==='insert'){const list=Array.isArray(st.payload)?st.payload:[st.payload];const ins=list.map(p=>({id:uid(),created_at:new Date().toISOString(),...p}));ins.forEach(r=>rows.push(r));window.__writes.push({table,op:'insert',payload:st.payload});return st.single?{data:ins[0],error:null}:{data:ins,error:null}}
   if(st.op==='update'&&table==='tracking_records'&&st.payload.last_match===null)return{data:null,error:{message:'null value in column "last_match" violates not-null constraint'}};
   if(st.op==='update'){const hit=rows.filter(match);hit.forEach(r=>Object.assign(r,st.payload));window.__writes.push({table,op:'update',payload:st.payload,filters:st.filters,hit:hit.length});return{data:st.ret?hit.map(r=>({...r})):null,error:null}}
   if(st.op==='delete'){const keep=rows.filter(r=>!match(r));const n=rows.length-keep.length;window.__db[table]=keep;window.__writes.push({table,op:'delete',filters:st.filters,n});return{data:null,error:null}}
   if(st.op==='upsert'){window.__writes.push({table,op:'upsert',payload:st.payload});
    // real tracking_records has no unique constraint on task_id -> Postgres rejects ON CONFLICT (task_id)
    if(table==='tracking_records'&&st.opts.onConflict==='task_id')return{data:null,error:{message:'there is no unique or exclusion constraint matching the ON CONFLICT specification'}};
    return{data:null,error:null}}
  };
  const b=new Proxy({}, {get(_,p){
   if(p==='then')return(res,rej)=>run().then(res,rej);
   return(...a)=>{switch(p){
    case 'select':if(st.op==='select'){st.opts=a[1]||{};st.cols=a[0]||'*'}else st.ret=true;break;
    case 'is':if(a[1]===null)st.isnull.push(a[0]);break;
    case 'eq':st.filters.push([a[0],a[1]]);break;
    case 'order':st.order=a;break;
    case 'single':st.single=true;break;
    case 'maybeSingle':st.maybe=true;break;
    case 'insert':st.op='insert';st.payload=a[0];break;
    case 'update':st.op='update';st.payload=a[0];break;
    case 'delete':st.op='delete';break;
    case 'upsert':st.op='upsert';st.payload=a[0];st.opts=a[1]||{};break;
   }return b}
  }});
  return b;
 }
 const sb={
  auth:{
   getSession:async()=>({data:{session:window.__noSession?null:{user:{id:'u1',email:'a@x.com'}}},error:null}),
   async signInWithPassword(c){window.__auth=(window.__auth||[]).concat([{op:'signIn',c}]);return window.__authReply||{data:{session:{user:{id:'u1',email:c.email||null,phone:c.phone?c.phone.replace('+',''):null}}},error:null}},
   async refreshSession(){window.__refreshed=(window.__refreshed||0)+1;return window.__refreshReply||{data:{session:null},error:null}},
   async updateUser(a){window.__auth=(window.__auth||[]).concat([{op:'update',a}]);return window.__updReply||{data:{user:{id:'u1'}},error:null}},
   async signUp(c){window.__auth=(window.__auth||[]).concat([{op:'signUp',c}]);if(window.__authDelay)await new Promise(r=>setTimeout(r,window.__authDelay));return window.__authReply||{data:{session:c.phone?{user:{id:'u9',phone:c.phone.replace('+','')}}:null},error:null}},
   onAuthStateChange(cb){listeners.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
   async signOut(){window.__signedOut=(window.__signedOut||0)+1;listeners.forEach(cb=>cb('SIGNED_OUT',null));return{error:null}}
  },
  async rpc(name,args){
   window.__calls.push({name,args});
   if(name==='security_register_device')return{data:{ok:true},error:null};
   if(name==='is_admin')return{data:window.__admin===true,error:null};
   if(name==='admin_list_all_users')return{data:window.__users||[],error:null};
   if(name==='note_login_device'&&!window.__noAlertFns)return{data:null,error:null};
   if(name==='my_login_alerts'&&!window.__noAlertFns)return{data:window.__loginAlerts||{ok:true,devices:[]},error:null};
   if(name==='ack_login_alerts'&&!window.__noAlertFns){window.__acked=(window.__acked||0)+1;return{data:null,error:null}}
   if(name==='my_session_status'&&!window.__noRemoveFns)return{data:{ok:true,revoked:!!window.__sessionRevoked},error:null};
   if(name==='remove_my_device'&&!window.__noRemoveFns){window.__removed2=(window.__removed2||[]).concat([args]);const d=(window.__loginAlerts&&window.__loginAlerts.devices)||[];if(window.__loginAlerts)window.__loginAlerts.devices=d.filter(x=>x.id!==args.p_id);return{data:window.__removeReply||{ok:true,sessions:1},error:null}}
   if(name==='my_account_status'&&!window.__noApprovalFns)return{data:{pending:!!window.__pending},error:null};
   if(name==='admin_list_pending_phone_users'&&!window.__noApprovalFns)return{data:window.__pendingUsers||[],error:null};
   if(name==='admin_approve_phone_user'&&!window.__noApprovalFns){window.__pendingUsers=(window.__pendingUsers||[]).filter(u=>u.id!==args.p_user_id);return{data:{ok:true,message:'已通过审核'},error:null}}
   return{data:null,error:{message:'Could not find the function public.'+name+' in the schema cache (unexpected rpc '+name+')'}};
  },
  from:(t)=>builder(t),
  functions:{async invoke(name,opts){if(name==='login-alert-mail'){window.__mailCalls=(window.__mailCalls||[]).concat([opts.body]);return typeof window.__mailReply==='function'?window.__mailReply(opts.body):{data:null,error:{message:'not stubbed'}}}window.__fn=(window.__fn||[]).concat([{name,opts}]);return typeof window.__fnReply==='function'?window.__fnReply(name,opts):{data:null,error:{message:'not stubbed'}}}},
  channel(name){window.__chans=(window.__chans||0)+1;const c={name,state:'joining',on(type,cfg,cb){window.__rt.push({name,cfg,cb,ch:c});return c},subscribe(cb){c.__cb=cb;window.__subs=(window.__subs||[]).concat([{name,ch:c,cb}]);if(window.__autoJoin!==false&&name==='after-sales-presence'){}return c},async track(p){window.__tracks=(window.__tracks||[]).concat([p])},async untrack(){},presenceState(){return c.__state||{}}};return c},
  removeChannel(c){window.__removedChannels++;c.state='closed';if(c.__cb)c.__cb('CLOSED')},
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

async function open(browser, htmlPath, { db, admin = false, users = [], dark = false, pre = null }) {
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
  await ctx.addInitScript(({ db, admin, users, dark, pre }) => {
    window.__db = db; window.__admin = admin; window.__users = users; if (pre) Object.assign(window, pre);
    try { if (dark) localStorage.setItem("sar_dark", "1"); if (pre && pre.__sarMode) localStorage.setItem("sar_mode", pre.__sarMode); } catch (e) {}
  }, { db, admin, users, dark, pre });
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

  // ---- 6.6: tracking form + manual evidence (own context so the main flow below is untouched)
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    const toastText = () => text(page, "#toast");
    const trk = (tid) => page.evaluate((t) => window.__db.tracking_records.filter((r) => r.task_id === t), tid);
    const tw = async () => (await writes(page)).filter((x) => x.table === "tracking_records");
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(200);
    check("6.6/6.9 detail: 录入举证内容 button", (await page.evaluate("[...document.querySelectorAll('#detail button')].map(b=>b.textContent)")).includes("录入举证内容"));
    // 6.9: 快递盯单 dialog removed; number + carrier live in the new-task and edit forms
    const btns = await page.evaluate("[...document.querySelectorAll('#detail button')].map(b=>b.textContent)");
    check("6.9 detail: no 快递盯单 button, no 快递监控记录 card", !btns.includes("快递盯单") && !(await text(page, "#detail")).includes("快递监控记录"), JSON.stringify(btns));
    check("6.9 detail: top card shows the logistics status", (await text(page, "#logistics_now")) === "已签收匹配");
    check("6.9 edit form: carrier select prefilled from record", (await page.inputValue("#f_carrier")) === "顺丰");
    check("6.9 home: no 盯单中 stat/chip", !(await page.evaluate("!!document.getElementById('monitoring')")) && !(await page.evaluate("[...document.querySelectorAll('.chip')].some(c=>c.textContent==='盯单中')")));
    let w, rows;
    // new task: number + carrier -> one record with carrier
    await page.evaluate("window.__writes.length=0; closeDrawer()");
    await page.evaluate("newTask()"); await page.waitForTimeout(150);
    check("6.9 new task: carrier select present, empty by default", (await page.inputValue("#tc")) === "");
    await page.fill("#to", "ORD-NEW"); await page.fill("#tt", "JT0001234567"); await page.selectOption("#tc", "极兔");
    await page.evaluate("createTask()"); await page.waitForTimeout(400);
    const nt = await page.evaluate("window.__db.after_sales_tasks.find(t=>t.order_id==='ORD-NEW')");
    rows = nt ? await trk(nt.id) : [];
    check("6.9 createTask: number + carrier -> record inserted", nt && rows.length === 1 && rows[0].tracking_no === "JT0001234567" && rows[0].carrier === "极兔" && rows[0].last_match === undefined && rows[0].user_id === "u1", JSON.stringify(rows));
    check("6.9 createTask: opened task says it will auto-query", (await text(page, "#detail .card")).includes("打开售后时会自动向快递100 查询"));
    await page.evaluate("closeDrawer(); newTask()"); await page.waitForTimeout(150);
    await page.fill("#to", "ORD-NONO"); await page.evaluate("createTask()"); await page.waitForTimeout(400);
    const nn = await page.evaluate("window.__db.after_sales_tasks.find(t=>t.order_id==='ORD-NONO')");
    check("6.9 createTask: no number -> no tracking record", nn && (await trk(nn.id)).length === 0);
    // edit form: unchanged -> untouched; set number + carrier on a task without record -> insert; change carrier -> update
    await page.evaluate("window.__writes.length=0; openTask('t2')"); await page.waitForTimeout(200);
    await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(250);
    check("6.9 saveTask: no number -> tracking_records untouched", (await tw()).length === 0);
    check("6.9 detail: no number -> no logistics line", !(await text(page, "#detail .card")).includes("物流状态"));
    await page.fill("#f_track", "YT999999999"); await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    w = await tw(); rows = await trk("t2");
    check("6.9 saveTask: new number, no carrier -> record inserted, asks for carrier", w.length === 1 && w[0].op === "insert" && rows.length === 1 && rows[0].tracking_no === "YT999999999" && rows[0].carrier === "" && (await text(page, "#detail .card")).includes("请在下方「售后信息」里选择承运商"), JSON.stringify(w));
    await page.selectOption("#f_carrier", "圆通"); await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    w = await tw(); rows = await trk("t2");
    check("6.9 saveTask: carrier change -> same record updated, no duplicate", w.length === 2 && w[1].op === "update" && rows.length === 1 && rows[0].carrier === "圆通" && rows[0].tracking_no === "YT999999999", JSON.stringify(w));
    await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    check("6.9 saveTask: nothing changed -> no tracking write", (await tw()).length === 2);
    await page.fill("#f_track", "YT888888888"); await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    rows = await trk("t2");
    check("6.9 saveTask: number change resets old status, keeps carrier", rows.length === 1 && rows[0].tracking_no === "YT888888888" && rows[0].carrier === "圆通" && rows[0].last_match === "", JSON.stringify(rows));
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(200);
    await page.selectOption("#f_carrier", "中通"); await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    check("6.9 detail: 中通 -> explains phone needed, no auto query", (await text(page, "#detail .card")).includes("中通查询需要收/寄件人手机号后四位"));
    // manual evidence: saves text + event, never changes status or submits
    await page.evaluate("window.__writes.length=0; openTask('t1')"); await page.waitForTimeout(200);
    await page.click('#detail button:text-is("录入举证内容")'); await page.waitForTimeout(150);
    check("6.6/6.9 evidence: reason prefilled", (await page.inputValue("#me_reason")) === "e1");
    await page.fill("#me_reason", ""); await page.fill("#me_extra", ""); await page.fill("#me_video", "");
    await page.click('#modalbox button:text-is("保存")'); await page.waitForTimeout(200);
    check("6.6/6.9 evidence: all empty -> rejected, no write", (await toastText()).includes("至少填写一项") && (await writes(page)).length === 0);
    await page.fill("#me_reason", "e1"); await page.click('#modalbox button:text-is("保存")'); await page.waitForTimeout(200);
    check("6.9.1 evidence: nothing changed -> not saved, explains why, no write", (await toastText()).includes("内容没有变化") && (await writes(page)).length === 0 && !(await page.evaluate("document.querySelector('#modal').classList.contains('hidden')")));
    await page.fill("#me_reason", "");
    const before = await page.evaluate("({...window.__db.after_sales_tasks.find(t=>t.id==='t1')})");
    await page.fill("#me_reason", "买家签收后申请仅退款"); await page.fill("#me_extra", "买家又说少件"); await page.fill("#me_video", "https://pan.test/v1");
    await page.click('#modalbox button:text-is("保存")'); await page.waitForTimeout(300);
    w = (await writes(page)).filter((x) => x.table === "after_sales_tasks");
    const after = await page.evaluate("window.__db.after_sales_tasks.find(t=>t.id==='t1')");
    check("6.6/6.9 evidence: text saved with stamped 补充/视频 sections", after.evidence_reason.startsWith("买家签收后申请仅退款") && /【补充 [^】]+】买家又说少件/.test(after.evidence_reason) && /【视频 [^】]+】https:\/\/pan\.test\/v1/.test(after.evidence_reason), after.evidence_reason);
    check("6.6/6.9 evidence: only evidence_reason/updated_at written (no auto-submit)", w.length === 1 && Object.keys(w[0].payload).sort().join() === "evidence_reason,updated_at", JSON.stringify(w));
    check("6.6/6.9 evidence: status/submission unchanged", after.status === before.status && after.submission_status === before.submission_status);
    check("6.6/6.9 evidence: evidence_manual event", (await page.evaluate("window.__db.after_sales_events.filter(e=>e.task_id==='t1').map(e=>e.event_type+':'+e.message)")).some((e) => e.startsWith("evidence_manual:") && e.includes("补充说明") && e.includes("视频说明")));
    check("6.6/6.9 evidence: drawer field shows saved text", (await page.inputValue("#f_evidence")) === after.evidence_reason);
    await page.click('#detail button:text-is("录入举证内容")'); await page.waitForTimeout(150);
    await page.evaluate("pickEvidence('video')");
    check("6.6/6.9 evidence: 选择视频上传 opens a video picker", (await page.evaluate("window.__clicked")).pop().accept === "video/*");
    check("6.6/6.9 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.8: auto-query 快递100 when a task is opened (Edge Function stubbed; NOT a real 快递100 call)
  {
    const db = seed();
    db.tracking_records = [
      { id: "k1", user_id: "u1", task_id: "t1", tracking_no: "YT123456789", carrier: "圆通", monitoring: true, last_match: "", updated_at: "2026-10-05T00:00:00Z", created_at: "2026-10-05T00:00:00Z" },
      { id: "k2", user_id: "u1", task_id: "t2", tracking_no: "SF123456789", carrier: "顺丰", monitoring: true, last_match: "", created_at: "2026-10-05T00:00:00Z" },
      { id: "k3", user_id: "u1", task_id: "t3", tracking_no: "YD123456789", carrier: "韵达", monitoring: true, last_match: "【签收】2026-10-09 已签收（快递100）", created_at: "2026-10-05T00:00:00Z" },
    ];
    db.after_sales_tasks[1].tracking_no = "SF123456789";
    const { ctx, page } = await open(browser, htmlPath, { db });
    const fnCalls = () => page.evaluate("(window.__fn||[]).length");
    // stub behaves like the real function: writes last_match + a tracking_queried event, answers after a delay
    await page.evaluate(() => { window.__fnReply = (name, opts) => new Promise((res) => setTimeout(() => {
      const r = window.__db.tracking_records.find((x) => x.task_id === opts.body.task_id);
      r.last_match = "【在途】2026-10-10 14:20:00 已到达上海转运中心（快递100）"; r.updated_at = new Date().toISOString();
      window.__db.after_sales_events.push({ id: "q" + Date.now(), user_id: "u1", task_id: opts.body.task_id, event_type: "tracking_queried", message: "快递100（" + r.tracking_no + "）：…", created_at: new Date().toISOString() });
      res({ data: { ok: true, state_text: "在途" }, error: null });
    }, 400)); });
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(100);
    check("6.8 auto: opening a 圆通 task queries once, without phone", (await fnCalls()) === 1 && JSON.stringify((await page.evaluate("window.__fn[0]")).opts.body) === JSON.stringify({ task_id: "t1" }));
    check("6.8 auto: shows 'querying' note meanwhile", (await text(page, "#logistics_note")).includes("正在向快递100"));
    await page.fill("#f_buyer", "正在编辑的买家");
    await page.waitForTimeout(700);
    check("6.8 auto: top card updated in place", (await text(page, "#logistics_now")).includes("已到达上海转运中心（快递100）"));
    check("6.8 auto: unsaved edits in the form are NOT wiped", (await page.inputValue("#f_buyer")) === "正在编辑的买家");
    check("6.8 auto: note cleared after success", (await text(page, "#logistics_note")) === "");
    await page.evaluate("closeDrawer(); openTask('t1')"); await page.waitForTimeout(600);
    check("6.8 auto: reopening within 30 min -> no new query", (await fnCalls()) === 1);
    await page.evaluate("closeDrawer(); openTask('t2')"); await page.waitForTimeout(300);
    check("6.8 auto: 顺丰 (needs phone) -> no auto query", (await fnCalls()) === 1);
    await page.evaluate("closeDrawer(); openTask('t3')"); await page.waitForTimeout(300);
    check("6.8 auto: already 签收 -> no auto query", (await fnCalls()) === 1);
    await page.evaluate(() => { const r = window.__db.tracking_records.find((x) => x.id === "k3"); r.last_match = "【本人签收】2026-10-09 已签收（快递100）"; });
    await page.evaluate("closeDrawer(); delete detailCache.t3; openTask('t3')"); await page.waitForTimeout(300);
    check("6.14 auto: advanced signed state (本人签收) -> no auto query", (await fnCalls()) === 1);
    await page.evaluate(() => { const r = window.__db.tracking_records.find((x) => x.id === "k3"); r.last_match = "【签收】2026-10-09 已签收（快递100）"; });
    // closing the drawer before the answer arrives: nothing re-opens
    await page.evaluate(() => { window.__db.tracking_records.find((x) => x.id === "k3").last_match = ""; window.__db.tracking_records.find((x) => x.id === "k3").carrier = "韵达"; });
    await page.evaluate("closeDrawer(); openTask('t3')"); await page.waitForTimeout(50);
    await page.evaluate("closeDrawer()"); await page.waitForTimeout(600);
    check("6.8 auto: drawer closed during query stays closed", (await fnCalls()) === 2 && (await page.evaluate("document.querySelector('#drawer').classList.contains('hidden')")));
    check("6.8 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  {
    const db = seed();
    db.tracking_records = [
      { id: "k1", user_id: "u1", task_id: "t1", tracking_no: "YT123456789", carrier: "圆通", monitoring: true, last_match: "", created_at: "2026-10-05T00:00:00Z" },
      { id: "k2", user_id: "u1", task_id: "t2", tracking_no: "ZT123456789", carrier: "申通", monitoring: true, last_match: "", created_at: "2026-10-05T00:00:00Z" },
    ];
    db.after_sales_tasks[1].tracking_no = "ZT123456789";
    const { ctx, page } = await open(browser, htmlPath, { db });
    const fnCalls = () => page.evaluate("(window.__fn||[]).length");
    const httpErr = (body) => `window.__fnReply = () => ({ data: null, error: { message: "non-2xx", context: { json: async () => (${JSON.stringify(body)}) } } })`;
    // parcel-level failure -> short note, auto stays on
    await page.evaluate(httpErr({ ok: false, code: "kuaidi100_500", message: "暂时查不到物流信息（可能还没揽收，或单号/快递公司不对）" }));
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(300);
    check("6.8 auto: parcel error -> note with reason", (await text(page, "#logistics_note")).includes("自动查询未成功：暂时查不到物流信息"));
    // not configured -> silent, and auto-query switches off for this page session
    await page.evaluate(httpErr({ ok: false, code: "not_configured", message: "快递100 还没有配置" }));
    await page.evaluate("closeDrawer(); openTask('t2')"); await page.waitForTimeout(300);
    check("6.8 auto: not configured -> no note shown", (await text(page, "#logistics_note")) === "" && (await fnCalls()) === 2);
    await page.evaluate("window.__db.after_sales_events.length=0; closeDrawer(); openTask('t1')"); await page.waitForTimeout(300);
    check("6.8 auto: after not_configured, no more auto queries this session", (await fnCalls()) === 2);

    check("6.8b no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.11: iOS style transitions
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    await page.evaluate("more()"); await page.waitForTimeout(100);
    await page.evaluate("closeModal()");
    const g = await page.evaluate(() => { const gs = [...document.querySelectorAll(".ghost")]; return { n: gs.length, ids: gs.reduce((k, x) => k + x.querySelectorAll("[id]").length + (x.id ? 1 : 0), 0), clicks: gs.reduce((k, x) => k + x.querySelectorAll("[onclick]").length, 0), pe: gs[0] && getComputedStyle(gs[0]).pointerEvents }; });
    check("6.11 closeModal: real modal hidden immediately", await page.evaluate("document.getElementById('modal').classList.contains('hidden')"));
    check("6.11 closeModal: one inert ghost plays the exit (no ids, no handlers, no pointer events)", g.n === 1 && g.ids === 0 && g.clicks === 0 && g.pe === "none", JSON.stringify(g));
    await page.waitForTimeout(500);
    check("6.11 ghost removed after the animation", (await page.evaluate("document.querySelectorAll('.ghost').length")) === 0);
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(200);
    await page.evaluate("document.querySelector('#drawer .sheet').scrollTop=400; document.getElementById('f_buyer').value='未保存的输入'");
    await page.evaluate("closeDrawer()");
    const dg = await page.evaluate(() => { const x = document.querySelector(".ghost.drawer"); return x ? { inp: [...x.querySelectorAll("input")].some((i) => i.value === "未保存的输入"), top: x.querySelector(".sheet").scrollTop } : null; });
    check("6.11 closeDrawer: ghost keeps typed values + scroll position", dg && dg.inp && dg.top > 0, JSON.stringify(dg));
    check("6.11 closeDrawer: real drawer hidden immediately", await page.evaluate("document.getElementById('drawer').classList.contains('hidden')"));
    await page.waitForTimeout(500);
    await page.evaluate("closeModal(); closeDrawer()");
    check("6.11 closing something already closed -> no ghost", (await page.evaluate("document.querySelectorAll('.ghost').length")) === 0);
    // list entrance animation only when the result set changes
    await page.evaluate("render()");
    check("6.11 list: same results re-rendered -> no entrance animation", !(await page.evaluate("document.getElementById('tasklist').classList.contains('enter')")));
    await page.click('.chip:text-is("高风险")'); await page.waitForTimeout(50);
    check("6.11 list: filter changes results -> entrance animation", await page.evaluate("document.getElementById('tasklist').classList.contains('enter')"));
    await page.click('.chip:text-is("全部")');
    check("6.11 tab bar: 5 icon buttons", (await page.evaluate("document.querySelectorAll('nav.bottom button svg').length")) === 5);
    check("6.11 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate("more()"); await page.evaluate("closeModal()");
    check("6.11 reduced motion: no ghost", (await page.evaluate("document.querySelectorAll('.ghost').length")) === 0 && (await page.evaluate("document.getElementById('modal').classList.contains('hidden')")));
    await ctx.close();
  }

  // ---- 6.12: opening a task is instant; the 3 detail queries run in parallel; cache; no overwrite before load
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    await page.evaluate("window.__latency=400");
    const t0 = Date.now();
    page.evaluate("openTask('t1')");
    await page.waitForFunction("!document.getElementById('drawer').classList.contains('hidden')");
    const shown = Date.now() - t0;
    check("6.12 open: drawer visible before any query returns", shown < 300, shown + "ms");
    check("6.12 open: placeholders while loading", (await text(page, "#files_box")).includes("加载中") && (await text(page, "#timeline_box")).includes("加载中") && (await text(page, "#sheettitle")) === "ORD1");
    await page.evaluate("saveTask()"); await page.waitForTimeout(20);
    check("6.12 save before load -> refused (cannot wipe the carrier)", (await text(page, "#toast")).includes("还在加载") && !(await page.evaluate("window.__writes.some(w=>w.table==='tracking_records')")));
    await page.evaluate("document.getElementById('f_buyer').value='加载中输入'");
    await page.waitForFunction("document.getElementById('files_box').textContent.includes('a.jpg')", null, { timeout: 3000 });
    const loaded = Date.now() - t0;
    check("6.12 open: 3 queries in parallel (~1 round trip, not 3)", loaded < 1000, loaded + "ms");
    check("6.12 open: sections filled, carrier select filled, typing kept", (await text(page, "#logistics_now")) === "已签收匹配" && (await page.inputValue("#f_carrier")) === "顺丰" && (await page.inputValue("#f_buyer")) === "加载中输入");
    await page.evaluate("closeDrawer()"); await page.waitForTimeout(100);
    const t1 = Date.now(); page.evaluate("openTask('t1')");
    await page.waitForFunction("!document.getElementById('drawer').classList.contains('hidden')");
    check("6.12 reopen: cached content shows instantly", !(await text(page, "#files_box")).includes("加载中") && (await text(page, "#files_box")).includes("a.jpg") && (await text(page, "#logistics_now")) === "已签收匹配" && Date.now() - t1 < 300);
    await page.waitForTimeout(700);
    // switching quickly: a slow answer for the previous task must not overwrite the new one
    page.evaluate("openTask('t1')"); await page.waitForTimeout(50); page.evaluate("openTask('t2')"); await page.waitForTimeout(900);
    check("6.12 fast switch: stale result ignored", (await text(page, "#sheettitle")) === "ORD2" && !(await text(page, "#files_box")).includes("a.jpg"), await text(page, "#files_box"));
    await page.evaluate("window.__latency=0");
    check("6.12 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.13: 顺丰/中通 one-off query with phone last-4 (not stored; Edge Function stubbed)
  {
    const db = seed(); db.tracking_records[0].last_match = "";
    const { ctx, page } = await open(browser, htmlPath, { db });
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(300);
    check("6.13 顺丰: phone box + 查询 button shown", !!(await page.$("#lg_phone")) && (await text(page, "#lg_query")) === "查询" && (await text(page, "#detail .card")).includes("顺丰查询需要收/寄件人手机号后四位"));
    check("6.13 顺丰: no auto query on open", !(await page.evaluate("window.__fn")));
    await page.fill("#lg_phone", "12"); await page.click("#lg_query"); await page.waitForTimeout(100);
    check("6.13 bad phone -> local error, no call", (await text(page, "#toast")).includes("4 位数字") && !(await page.evaluate("window.__fn")));
    await page.evaluate(() => { window.__fnReply = () => ({ data: null, error: { message: "non-2xx", context: { json: async () => ({ ok: false, code: "kuaidi100_408", message: "电话号码校验未通过，请核对收/寄件人手机号后四位" }) } } }); });
    await page.fill("#lg_phone", "9999"); await page.click("#lg_query"); await page.waitForTimeout(200);
    check("6.13 server error -> shown under the status, button re-enabled", (await text(page, "#logistics_note")).includes("电话号码校验未通过") && (await text(page, "#lg_query")) === "查询" && !(await page.evaluate("document.getElementById('lg_query').disabled")));
    await page.evaluate(() => { window.__fnReply = (n, o) => { const r = window.__db.tracking_records.find((x) => x.task_id === o.body.task_id); r.last_match = "【派件】2026-10-11 09:00 快递员正在派件（快递100）"; return { data: { ok: true, state_text: "派件", latest: { context: "快递员正在派件" } }, error: null }; }; });
    await page.fill("#lg_phone", "1234"); await page.click("#lg_query"); await page.waitForTimeout(300);
    const fn = await page.evaluate("window.__fn.pop()");
    check("6.13 query sends task_id + phone only", fn.name === "kuaidi100-query" && JSON.stringify(fn.opts.body) === JSON.stringify({ task_id: "t1", phone: "1234" }), JSON.stringify(fn));
    check("6.13 success -> status updated in place + toast", (await text(page, "#logistics_now")).includes("快递员正在派件") && (await text(page, "#toast")).includes("物流已更新：派件"));
    check("6.13 phone not stored anywhere", !(await page.evaluate("JSON.stringify(window.__db).includes('1234')")) && !(await page.evaluate("window.__writes.some(w=>JSON.stringify(w.payload||{}).includes('1234'))")));
    await page.evaluate("closeDrawer()"); await page.waitForTimeout(100);
    await page.evaluate("window.__db.tracking_records[0].carrier='圆通'; delete detailCache.t1; openTask('t1')"); await page.waitForTimeout(300);
    check("6.13 other carriers: no phone box", !(await page.$("#lg_phone")));
    check("6.13 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.15: auto query survives expired login / network errors; per-number limit; 立即查询 button
  {
    const db = seed();
    db.tracking_records = [
      { id: "k1", user_id: "u1", task_id: "t1", tracking_no: "YT123456789", carrier: "圆通", monitoring: true, last_match: "", created_at: "2026-10-05T00:00:00Z" },
      { id: "k2", user_id: "u1", task_id: "t2", tracking_no: "ST123456789", carrier: "申通", monitoring: true, last_match: "", created_at: "2026-10-05T00:00:00Z" },
    ];
    db.after_sales_tasks[0].tracking_no = "YT123456789"; db.after_sales_tasks[1].tracking_no = "ST123456789";
    // t1 was queried 5 min ago under its OLD number
    db.after_sales_events = [{ id: "old", user_id: "u1", task_id: "t1", event_type: "tracking_queried", message: "快递100（790384139258）：…", created_at: new Date(Date.now() - 5 * 60000).toISOString() }];
    const { ctx, page } = await open(browser, htmlPath, { db });
    const fnCalls = () => page.evaluate("(window.__fn||[]).length");
    const httpErr = (body) => `window.__fnReply = () => ({ data: null, error: { message: "non-2xx", context: { json: async () => (${JSON.stringify(body)}) } } })`;
    await page.evaluate(httpErr({ ok: false, code: "bad_session", message: "登录已失效，请重新登录" }));
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(400);
    check("6.15 number changed -> old query does not block", (await fnCalls()) === 1);
    check("6.15 expired login -> clear note, auto query NOT switched off", (await text(page, "#logistics_note")).includes("登录已过期") && !(await page.evaluate("autoQueryOff")));
    await page.evaluate(httpErr({ ok: false, code: "upstream", message: "连接快递100 失败：connection reset" }));
    await page.evaluate("closeDrawer(); openTask('t2')"); await page.waitForTimeout(400);
    check("6.15 network error -> note + retry hint, auto still on", (await fnCalls()) === 2 && (await text(page, "#logistics_note")).includes("立即查询") && !(await page.evaluate("autoQueryOff")));
    check("6.15 圆通/申通 get a 立即查询 button", (await text(page, "#lg_query")) === "↻ 立即查询" && !(await page.$("#lg_phone")));
    await page.evaluate(() => { window.__fnReply = (n, o) => { const r = window.__db.tracking_records.find((x) => x.task_id === o.body.task_id); r.last_match = "【在途】2026-10-11 10:00 已发往上海（快递100）"; return { data: { ok: true, state_text: "在途", latest: { context: "已发往上海" } }, error: null }; }; });
    await page.click("#lg_query"); await page.waitForTimeout(300);
    const fn = await page.evaluate("window.__fn.pop()");
    check("6.15 立即查询 sends task_id only (no phone)", JSON.stringify(fn.opts.body) === JSON.stringify({ task_id: "t2" }));
    check("6.15 立即查询 success -> status updated", (await text(page, "#logistics_now")).includes("已发往上海"));
    await page.evaluate(httpErr({ ok: false, code: "not_configured", message: "快递100 还没有配置" }));
    await page.evaluate("closeDrawer(); delete detailCache.t1; window.__db.after_sales_events.length=0; openTask('t1')"); await page.waitForTimeout(400);
    check("6.15 not_configured still switches auto off", await page.evaluate("autoQueryOff"));
    await page.evaluate("enterApp({user:{id:'u1',email:'a@x.com'}})"); await page.waitForTimeout(400);
    check("6.15 logging in again turns auto query back on", !(await page.evaluate("autoQueryOff")));
    check("6.15 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.16 before the SQL upgrade: amounts + chat hidden, nothing breaks
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __missingCols: ["after_sales_tasks.order_amount", "after_sales_tasks.refund_amount"], __missingTables: ["support_messages"] } });
    await page.waitForTimeout(300);
    check("6.16 pre-SQL: feature flags off", !(await page.evaluate("hasAmounts")) && !(await page.evaluate("hasSupport")));
    check("6.16 pre-SQL: no refund total on home", await page.evaluate("document.getElementById('refundline').classList.contains('hidden')"));
    await page.evaluate("newTask()"); await page.waitForTimeout(100);
    check("6.16 pre-SQL: new-task form has no amount fields", !(await page.$("#ta_order")));
    await page.fill("#to", "PRE1"); await page.evaluate("createTask()"); await page.waitForTimeout(400);
    check("6.16 pre-SQL: creating a task still works", await page.evaluate("window.__db.after_sales_tasks.some(t=>t.order_id==='PRE1')"));
    check("6.16 pre-SQL: edit form has no amount fields", !(await page.$("#f_amount")));
    await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    check("6.16 pre-SQL: saving still works (no amount keys sent)", (await text(page, "#toast")).includes("已保存到云端"));
    await page.evaluate("closeDrawer(); openSupport()"); await page.waitForTimeout(200);
    const sp = await text(page, "#modalbox");
    check("6.16 pre-SQL: 客服 shows 'not opened yet' + developer email", sp.includes("还没有开通") && sp.includes("1012968575@qq.com") && !(await page.$("#supInput")) && (await page.evaluate("document.querySelector('#modalbox a[href^=\"mailto:1012968575@qq.com\"]')!==null")));
    check("6.16 pre-SQL no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  // ---- 6.16 after the SQL upgrade: amounts
  {
    const db = seed();
    db.after_sales_tasks[0].order_amount = 199.9; db.after_sales_tasks[0].refund_amount = 50;
    db.after_sales_tasks[1].refund_amount = 20.5;
    db.support_messages = [];
    const { ctx, page } = await open(browser, htmlPath, { db });
    await page.waitForTimeout(300);
    check("6.16 amounts: flag on", await page.evaluate("hasAmounts&&hasSupport"));
    check("6.16 amounts: home refund total", (await text(page, "#refundsum")) === "¥70.50" && !(await page.evaluate("document.getElementById('refundline').classList.contains('hidden')")));
    check("6.16 amounts: list card shows both", (await text(page, "#tasklist")).includes("订单 ¥199.90 · 退款 ¥50.00") && (await text(page, "#tasklist")).includes("退款 ¥20.50"));
    await page.evaluate("openTask('t1')"); await page.waitForTimeout(300);
    const top = await text(page, "#detail .card");
    check("6.16 amounts: detail top card", top.includes("订单金额") && top.includes("¥199.90") && top.includes("¥50.00"));
    check("6.16 amounts: edit form prefilled", (await page.inputValue("#f_amount")) === "199.9" && (await page.inputValue("#f_refund")) === "50");
    await page.fill("#f_refund", "abc"); await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(200);
    check("6.16 amounts: invalid -> refused", (await text(page, "#toast")).includes("金额格式不对"));
    await page.evaluate("window.__writes.length=0");
    await page.fill("#f_refund", "￥88.8"); await page.fill("#f_amount", ""); await page.click('button:text-is("保存到云端")'); await page.waitForTimeout(300);
    const up = (await writes(page)).find((x) => x.table === "after_sales_tasks" && x.op === "update");
    check("6.16 amounts: save sends numbers, empty -> null, ¥ sign accepted", up && up.payload.refund_amount === 88.8 && up.payload.order_amount === null, JSON.stringify(up && up.payload));
    await page.evaluate("closeDrawer(); newTask()"); await page.waitForTimeout(100);
    await page.fill("#to", "AMT1"); await page.fill("#ta_order", "1,000"); await page.evaluate("createTask()"); await page.waitForTimeout(200);
    check("6.16 amounts: new task invalid -> refused, nothing inserted", (await text(page, "#toast")).includes("金额格式不对") && !(await page.evaluate("window.__db.after_sales_tasks.some(t=>t.order_id==='AMT1')")));
    await page.fill("#ta_order", "1000"); await page.fill("#ta_refund", "12.34"); await page.evaluate("createTask()"); await page.waitForTimeout(400);
    const nt = await page.evaluate("window.__db.after_sales_tasks.find(t=>t.order_id==='AMT1')");
    check("6.16 amounts: new task saved with both amounts", nt && nt.order_amount === 1000 && nt.refund_amount === 12.34, JSON.stringify(nt));
    check("6.16 amounts no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  // ---- 6.16 客服: user side + admin side
  {
    const db = seed();
    db.support_messages = [
      { id: "m1", user_id: "u1", sender: "user", body: "你好，怎么导出？", created_at: "2026-10-10T08:00:00Z", read_at: "2026-10-10T08:01:00Z" },
      { id: "m2", user_id: "u1", sender: "admin", body: "在「更多」里点导出 JSON 备份", created_at: "2026-10-10T08:05:00Z", read_at: null },
      { id: "m3", user_id: "u2", sender: "user", body: "我要退款怎么记", created_at: "2026-10-10T09:00:00Z", read_at: null },
    ];
    const { ctx, page } = await open(browser, htmlPath, { db, admin: true, users: [{ id: "u1", email: "a@x.com" }, { id: "u2", email: "8613800138000" }] });
    await page.waitForTimeout(500);
    check("6.16 客服: unread dot shown (admin reply + user letter)", !(await page.evaluate("document.getElementById('supDot').classList.contains('hidden')")));
    await page.evaluate("openSupport()"); await page.waitForTimeout(300);
    const chat = await text(page, "#supList");
    check("6.16 客服: user sees own conversation only", chat.includes("怎么导出") && chat.includes("导出 JSON 备份") && !chat.includes("我要退款"));
    check("6.16 客服: my message right, admin reply left", (await page.evaluate("document.querySelectorAll('#supList .bub.me').length")) === 1 && (await page.evaluate("document.querySelectorAll('#supList .bub.them').length")) === 1);
    check("6.16 客服: admin reply marked read", !!(await page.evaluate("window.__db.support_messages.find(m=>m.id==='m2').read_at")));
    await page.click("#supSend"); await page.waitForTimeout(100);
    check("6.16 客服: empty message refused", (await text(page, "#toast")).includes("请先输入内容"));
    await page.fill("#supInput", "  谢谢！  "); await page.click("#supSend"); await page.waitForTimeout(300);
    const ins = (await writes(page)).filter((x) => x.table === "support_messages" && x.op === "insert").pop();
    check("6.16 客服: send inserts as user into own conversation (trimmed)", ins && JSON.stringify(ins.payload) === JSON.stringify({ user_id: "u1", sender: "user", body: "谢谢！" }), JSON.stringify(ins));
    check("6.16 客服: new message shown, input cleared", (await text(page, "#supList")).includes("谢谢！") && (await page.inputValue("#supInput")) === "");
    // admin side (6.29: only when logged in through the 管理员登录 entry)
    check("6.29 normal login: no admin entry in 客服", !(await text(page, "#modalbox")).includes("查看用户来信（管理员）"));
    await page.evaluate("setMode('admin'); closeModal(); openSupport()"); await page.waitForTimeout(300);
    await page.click('#modalbox button:text-is("查看用户来信（管理员）")'); await page.waitForTimeout(500);
    const ab = await text(page, "#adminBody");
    check("6.16/6.19 admin 客服: conversations listed with name / phone (as 手机 xxx) + unread", ab.includes("a@x.com") && ab.includes("手机 13800138000") && ab.includes("1 未读"), ab.slice(0, 300));
    check("6.16 admin 客服: tab opened directly (not overwritten by 总览)", !(await text(page, "#adminBody")).includes("注册用户"));
    await page.evaluate("adminSupportThread('u2')"); await page.waitForTimeout(300);
    check("6.16 admin 客服: thread shows the user's letter, marks it read", (await text(page, "#admSupList")).includes("我要退款怎么记") && !!(await page.evaluate("window.__db.support_messages.find(m=>m.id==='m3').read_at")));
    await page.fill("#admSupInput", "在售后详情里填退款金额"); await page.click("#admSupSend"); await page.waitForTimeout(300);
    const rep = (await writes(page)).filter((x) => x.table === "support_messages" && x.op === "insert").pop();
    check("6.16 admin 客服: reply inserted as admin into that user's conversation", rep && rep.payload.sender === "admin" && rep.payload.user_id === "u2" && rep.payload.body === "在售后详情里填退款金额");
    await page.evaluate("closeModal()"); await page.waitForTimeout(5500);
    check("6.16 客服: polling stops after closing (no errors)", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  // ---- 6.16 phone number login / register
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true } });
    await page.waitForTimeout(300);
    check("6.16 phone: login field says 邮箱或手机号", (await page.getAttribute("#email", "placeholder")) === "邮箱或手机号");
    const lt = await text(page, "#login");
    check("6.17 login tips: email recommended, phone not, contact + studio", lt.includes("邮箱注册【推荐】") && lt.includes("点邮件里发亮的按钮") && lt.includes("1-3 秒") && lt.includes("手机号注册【不推荐】") && lt.includes("忘记密码只能找管理员") && lt.includes("1012968575@qq.com") && lt.includes("悠然网络科技工作室™") && !lt.includes("yrnb0611"));
    const pi = await page.evaluate(`[parseIdent("138 0013 8000"),parseIdent("+86 138-0013-8000"),parseIdent("8613800138000"),parseIdent("a@x.com"),parseIdent("+447911123456"),parseIdent(""),parseIdent("12345678901"),parseIdent("10000000000"),parseIdent("1380013800"),parseIdent("abc"),parseIdent("a@b")]`);
    const mainland = "请输入正确的中国大陆手机号（13～19 开头的 11 位数字）";
    check("6.16/6.18 phone: parseIdent (mainland segments only, bad input flagged)", JSON.stringify(pi) === JSON.stringify([{ phone: "+8613800138000" }, { phone: "+8613800138000" }, { phone: "+8613800138000" }, { email: "a@x.com" }, { bad: mainland }, null, { bad: mainland }, { bad: mainland }, { bad: mainland }, { bad: "请输入正确的邮箱或手机号" }, { bad: "邮箱格式不正确" }]), JSON.stringify(pi));
    await page.evaluate("window.__authReply={data:null,error:{message:'Phone signups are disabled'}}");
    await page.evaluate("lgView('register')");
    await page.fill("#email", "13800138000"); await page.fill("#password", "Abcdef1!"); await page.click('button:text-is("注册")'); await page.waitForTimeout(100);
    await page.fill("#password2", "Abcdef1!"); await page.click('button:text-is("注册")'); await page.waitForTimeout(200);
    check("6.16 phone: provider off -> clear Chinese message", (await text(page, "#authmsg")).includes("手机号注册/登录还没有开通"), await text(page, "#authmsg"));
    await page.evaluate("window.__authReply=null");
    await page.click('button:text-is("注册")'); await page.waitForTimeout(600);
    const su = await page.evaluate("window.__auth.filter(a=>a.op==='signUp').pop()");
    check("6.16 phone: register sends +86 phone + password (no email)", su && su.c.phone === "+8613800138000" && !su.c.email && su.c.password === "Abcdef1!", JSON.stringify(su));
    check("6.16 phone: register with session -> enters app, header shows phone", !(await page.evaluate("document.getElementById('app').classList.contains('hidden')")) && (await text(page, "#userEmail")) === "手机 13800138000");
    await ctx.close();
    const r2 = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true } });
    await r2.page.evaluate("lgView('login')");
    await r2.page.fill("#email", "138-0013-8000"); await r2.page.fill("#password", "Abcdef1!"); await r2.page.click('button:text-is("登录")'); await r2.page.waitForTimeout(600);
    const si = await r2.page.evaluate("window.__auth.filter(a=>a.op==='signIn').pop()");
    check("6.16 phone: login with phone", si && si.c.phone === "+8613800138000" && !si.c.email);
    await r2.ctx.close();
    const r3 = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true, __authReply: { data: null, error: { message: "Invalid login credentials" } } } });
    await r3.page.evaluate("lgView('login')");
    await r3.page.fill("#email", "a@x.com"); await r3.page.fill("#password", "x"); await r3.page.click('button:text-is("登录")'); await r3.page.waitForTimeout(200);
    const si3 = await r3.page.evaluate("window.__auth.filter(a=>a.op==='signIn').pop()");
    check("6.16 phone: email login unchanged + Chinese error", si3 && si3.c.email === "a@x.com" && (await text(r3.page, "#authmsg")) === "邮箱或密码不正确");
    await r3.page.fill("#email", "13800138000"); await r3.page.click('button:text-is("忘记密码？")'); await r3.page.waitForTimeout(100);
    check("6.16/6.21 phone: forgot password for phone -> ask the admin to reset (temp password) + email", (await text(r3.page, "#authmsg")).includes("管理员") && (await text(r3.page, "#authmsg")).includes("临时密码") && (await text(r3.page, "#authmsg")).includes("1012968575@qq.com"));
    check("6.16 phone no page errors", !(r3.page.__errs || []).length, JSON.stringify(r3.page.__errs));
    await r3.ctx.close();
  }


  // ---- 6.20 no double submit on 注册 / 登录
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true, __authDelay: 400 } });
    await page.evaluate("lgView('register')");
    await page.fill("#email", "13900139000"); await page.fill("#password", "Abcdef1!"); await page.click('button:text-is("注册")'); await page.waitForTimeout(50);
    await page.fill("#password2", "Abcdef1!");
    await page.evaluate("(()=>{register();register();register();return 1})()");
    check("6.20 buttons disabled while the request is running", await page.evaluate("document.getElementById('regBtn').disabled&&document.getElementById('loginBtn').disabled"));
    await page.evaluate("document.getElementById('regBtn').click(); document.getElementById('loginBtn').click()");
    await page.waitForTimeout(1200);
    check("6.20 repeated taps -> only ONE sign-up request, no login request", (await page.evaluate("(window.__auth||[]).filter(a=>a.op==='signUp').length")) === 1 && (await page.evaluate("(window.__auth||[]).filter(a=>a.op==='signIn').length")) === 0, JSON.stringify(await page.evaluate("window.__auth")));
    await page.evaluate("showLogin('')"); await page.waitForTimeout(100);
    check("6.20 buttons enabled again afterwards", !(await page.evaluate("document.getElementById('regBtn').disabled||document.getElementById('loginBtn').disabled")));
    await page.evaluate("window.__authReply={data:null,error:{message:'Invalid login credentials'}}");
    await page.evaluate("lgView('login')");
    await page.fill("#email", "a@x.com"); await page.fill("#password", "x"); await page.click("#loginBtn"); await page.waitForTimeout(700);
    check("6.20 after a failed login the buttons work again", !(await page.evaluate("document.getElementById('loginBtn').disabled")) && (await text(page, "#authmsg")) === "邮箱或密码不正确");
    check("6.20 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.21 admin resets a password (Edge Function stubbed) + change my password
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), admin: true, users: [{ id: "u1", email: "a@x.com", is_admin: true }, { id: "p1", email: "8615770572452", is_admin: false }] });
    await page.waitForTimeout(300);
    await page.evaluate("adminPanel('users')"); await page.waitForTimeout(300);
    const btns = await page.evaluate("[...document.querySelectorAll('#admList button')].map(b=>b.textContent)");
    check("6.21 users tab: 重置密码 for others, not for myself", btns.length === 1 && btns[0] === "重置密码" && (await text(page, "#admList")).includes("当前账号"), JSON.stringify(btns));
    await page.evaluate("window.__confirm=false"); await page.click('#admList button:text-is("重置密码")'); await page.waitForTimeout(150);
    check("6.21 reset asks first (with identity warning) -> cancel sends nothing", !(await page.evaluate("window.__fn")));
    await page.evaluate(() => { window.__confirm = true; window.__fnReply = (n, o) => (n === "admin-reset-password" && o.body.user_id === "p1" ? { data: { ok: true, password: "Ab3$xyzPQR7k", account: "手机 15770572452" }, error: null } : { data: null, error: { message: "wrong call" } }); });
    await page.click('#admList button:text-is("重置密码")'); await page.waitForTimeout(300);
    const fn = await page.evaluate("window.__fn.pop()");
    check("6.21 reset calls the server function with the user id only", fn.name === "admin-reset-password" && JSON.stringify(fn.opts.body) === JSON.stringify({ user_id: "p1" }));
    const shown = await text(page, "#adminBody");
    check("6.21 temp password shown once with instructions", (await text(page, "#tmpPw")) === "Ab3$xyzPQR7k" && shown.includes("手机 15770572452") && shown.includes("修改密码") && shown.includes("不会记录密码"));
    await page.evaluate(() => { window.__fnReply = () => ({ data: null, error: { message: "non-2xx", context: { json: async () => ({ ok: false, code: "forbidden", message: "没有管理员权限" }) } } }); });
    await page.evaluate("adminResetPassword('p1','手机 15770572452')"); await page.waitForTimeout(300);
    check("6.21 server refusal shown, no password", (await text(page, "#adminBody")).includes("没有管理员权限") && !(await page.$("#tmpPw")));
    // change my password
    await page.evaluate("closeModal(); openSettings()"); await page.waitForTimeout(150);
    await page.fill("#cp1", "abc"); await page.fill("#cp2", "abc"); await page.click("#cpBtn"); await page.waitForTimeout(100);
    check("6.21 change pw: weak refused locally", (await text(page, "#toast")).includes("密码不符合要求") && !(await page.evaluate("(window.__auth||[]).some(a=>a.op==='update')")));
    await page.fill("#cp1", "Newpass1!"); await page.fill("#cp2", "Newpass2!"); await page.click("#cpBtn"); await page.waitForTimeout(100);
    check("6.21 change pw: mismatch refused", (await text(page, "#toast")).includes("不一致"));
    await page.fill("#cp2", "Newpass1!"); await page.click("#cpBtn"); await page.waitForTimeout(200);
    const upd = await page.evaluate("(window.__auth||[]).filter(a=>a.op==='update').pop()");
    check("6.21 change pw: updateUser({password}) + success + fields cleared", upd && upd.a.password === "Newpass1!" && (await text(page, "#toast")).includes("密码已修改") && (await page.inputValue("#cp1")) === "");
    await page.evaluate("window.__updReply={data:null,error:{message:'New password should be different from the old password.'}}");
    await page.fill("#cp1", "Newpass1!"); await page.fill("#cp2", "Newpass1!"); await page.click("#cpBtn"); await page.waitForTimeout(200);
    check("6.21 change pw: same-as-old explained in Chinese", (await text(page, "#toast")).includes("不能和旧密码一样"));
    check("6.21 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.22 online count: no fake 0; reconnect + re-track
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    await page.waitForTimeout(300);
    const P = "window.__subs.filter(s=>s.name==='after-sales-presence').pop()";
    check("6.22 online: '…' while connecting (not 0)", (await text(page, "#online")) === "…");
    await page.evaluate(`(()=>{const s=${P};s.ch.state='joined';s.cb('SUBSCRIBED')})()`); await page.waitForTimeout(50);
    check("6.22 online: tracks itself after SUBSCRIBED", (await page.evaluate("(window.__tracks||[]).length")) === 1 && (await page.evaluate("window.__tracks[0].user_id")) === "u1");
    await page.evaluate(`(()=>{const s=${P};s.ch.__state={u1:[{user_id:'u1'}],u2:[{user_id:'u2'},{user_id:'u2'}]};window.__rt.find(r=>r.ch===s.ch&&r.cfg.event==='sync').cb()})()`);
    check("6.22 online: sync counts distinct accounts", (await text(page, "#online")) === "2");
    // phone came back from background: still joined but my presence is gone -> re-track
    await page.evaluate(`(()=>{const s=${P};s.ch.__state={u2:[{user_id:'u2'}]}})()`);
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await page.waitForTimeout(50);
    check("6.22 online: back to page + missing self -> track again", (await page.evaluate("window.__tracks.length")) === 2);
    // connection error -> '—' then reconnect after 5 s with a new channel
    const before = await page.evaluate("window.__chans");
    await page.evaluate(`(()=>{const s=${P};s.ch.state='errored';s.cb('CHANNEL_ERROR')})()`); await page.waitForTimeout(50);
    check("6.22 online: error -> '—' (not 0)", (await text(page, "#online")) === "—");
    await page.waitForTimeout(5300);
    check("6.22 online: reconnects with a new channel after 5 s", (await page.evaluate("window.__chans")) === before + 1 && (await text(page, "#online")) === "…");
    // channel not joined when the page becomes visible -> restart right away
    const b2 = await page.evaluate("window.__chans");
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await page.waitForTimeout(50);
    check("6.22 online: visible + channel not joined -> restart", (await page.evaluate("window.__chans")) === b2 + 1);
    const b3 = await page.evaluate("window.__chans");
    await page.evaluate("presenceStart()"); await page.waitForTimeout(5500);
    check("6.22 online: our own removeChannel (CLOSED) does not start a reconnect loop", (await page.evaluate("window.__chans")) === b3 + 1);
    await page.evaluate("openOnlinePanel()"); await page.waitForTimeout(200);
    check("6.22 online panel explains what 在线 means", (await text(page, "#modalbox")).includes("此刻正打开着售后雷达页面的人"));
    await page.evaluate("closeModal(); showLogin('')"); await page.waitForTimeout(5500);
    check("6.22 logout: no reconnect after leaving", (await page.evaluate("window.__chans")) === b3 + 1);
    check("6.22 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }

  // ---- 6.23 new-device login alert + login records
  {
    const devs = { ok: true, devices: [
      { device: "WEB-aaaa", current: true, name: "Android · Edge", platform: "android", first_seen: "2026-10-01T00:00:00Z", last_seen: "2026-10-11T05:00:00Z", ip: "1.161.59.62", status: "active", is_new: false },
      { device: "WEB-bbbb", current: false, name: "Windows · Chrome", platform: "android", first_seen: "2026-10-11T04:00:00Z", last_seen: "2026-10-11T04:10:00Z", ip: "8.8.8.8", status: "active", is_new: true } ] };
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __loginAlerts: devs } });
    await page.waitForTimeout(1300);
    const note = await page.evaluate("window.__calls.find(c=>c.name==='note_login_device')");
    check("6.23 after login: device label + UA recorded for this device", note && note.args.p_device_id === (await page.evaluate("getDeviceId()")) && /·/.test(note.args.p_label) && note.args.p_user_agent.length > 10, JSON.stringify(note));
    const m = await text(page, "#modalbox");
    check("6.23 new device -> alert lists ONLY the new one, with time + IP", m.includes("账号在新设备登录") && m.includes("Windows · Chrome") && m.includes("8.8.8.8") && !m.includes("1.161.59.62"), m.slice(0, 200));
    await page.click('#modalbox button:text-is("是我本人")'); await page.waitForTimeout(200);
    check("6.23 是我本人 -> acknowledged on the server, closed", (await page.evaluate("window.__acked")) === 1 && (await page.evaluate("document.getElementById('modal').classList.contains('hidden')")));
    await page.evaluate("showLoginAlert(window.__loginAlerts.devices.filter(d=>d.is_new))"); await page.waitForTimeout(100);
    await page.click('#modalbox button:text-is("不是我，马上改密码")'); await page.waitForTimeout(500);
    check("6.23 不是我 -> acknowledged + settings opened at 修改密码", (await page.evaluate("window.__acked")) === 2 && !!(await page.$("#cp1")) && (await page.evaluate("document.activeElement&&document.activeElement.id")) === "cp1");
    await page.click('button:text-is("查看登录记录")'); await page.waitForTimeout(300);
    const rec = await text(page, "#loginRecs");
    check("6.23 登录记录 lists all devices, marks 本机", rec.includes("共 2 台设备") && rec.includes("Android · Edge") && rec.includes("本机") && rec.includes("Windows · Chrome"));
    check("6.23 deviceLabel() works", /^(Android|iPhone|iPad|Windows|Mac|Linux|未知系统) · /.test(await page.evaluate("deviceLabel()")));
    check("6.23 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
    const r2 = await open(browser, htmlPath, { db: seed() });
    await r2.page.waitForTimeout(1300);
    check("6.23 no new device -> no alert", await r2.page.evaluate("document.getElementById('modal').classList.contains('hidden')"));
    await r2.ctx.close();
    const r3 = await open(browser, htmlPath, { db: seed(), pre: { __noAlertFns: true } });
    await r3.page.waitForTimeout(1300);
    check("6.23 before SQL: app opens normally, no alert", !(await r3.page.evaluate("document.getElementById('app').classList.contains('hidden')")) && (await r3.page.evaluate("document.getElementById('modal').classList.contains('hidden')")));
    await r3.page.evaluate("openLoginRecords()"); await r3.page.waitForTimeout(300);
    check("6.23 before SQL: 登录记录 explains it is not opened yet", (await text(r3.page, "#loginRecs")).includes("还没有开通"));
    check("6.23 before SQL: no page errors", !(r3.page.__errs || []).length, JSON.stringify(r3.page.__errs));
    await r3.ctx.close();
  }
  // ---- 6.24 login alert email (binding + popup for phone accounts); server side is tested in dev/login-alert-mail.handler.test.ts
  {
    const mailStub = `window.__mailState = { configured: true, email: "", pending_email: "", declined: false, phone_only: true, account_email: "" };
      window.__mailReply = (b) => { const s = window.__mailState; const ok = (x) => ({ data: Object.assign({ ok: true, status: Object.assign({}, s) }, x || {}), error: null });
        const bad = (code, message) => ({ data: null, error: { message: "non-2xx", context: { json: async () => ({ ok: false, code, message }) } } });
        if (b.action === "notify" || b.action === "status") return ok({ sent: false });
        if (b.action === "decline") { s.declined = true; return ok(); }
        if (b.action === "send_code") { s.pending_email = "m*@qq.com"; return ok({ sent_to: "m*@qq.com" }); }
        if (b.action === "verify_code") { if (b.code !== "123456") return bad("wrong_code", "验证码不对（还可以再试 4 次）"); s.email = "m*@qq.com"; s.pending_email = ""; return ok(); }
        if (b.action === "remove") { s.email = ""; return ok(); }
        return bad("bad_action", "未知操作"); };`;
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    await page.evaluate(mailStub); await page.evaluate("mailAfterEnter(false)"); await page.waitForTimeout(1300);
    const calls = await page.evaluate("window.__mailCalls"), devId = await page.evaluate("getDeviceId()");
    check("6.24 every login reports this device to the mail-alert function", calls.length >= 2 && calls.every((c) => c.action === "notify" && c.device_id === devId), JSON.stringify(calls));
    let m = await text(page, "#modalbox");
    check("6.24 phone account without email -> popup offers email binding", m.includes("绑定邮箱，开启登录提醒") && m.includes("新设备登录") && m.includes("不再提醒"), m.slice(0, 160));
    await page.click('#modalbox button:text-is("绑定邮箱")'); await page.waitForTimeout(300);
    m = await text(page, "#mailBody");
    check("6.24 bind form: email + code", !!(await page.$("#mlEmail")) && !!(await page.$("#mlCode")) && m.includes("每台新设备只提醒一次"));
    await page.fill("#mlEmail", "bad"); await page.click("#mlSend"); await page.waitForTimeout(100);
    check("6.24 bad email -> error shown inside the form, no call", (await text(page, "#mlErr")).includes("正确的邮箱") && !(await page.evaluate("window.__mailCalls.some(c=>c.action==='send_code')")));
    await page.fill("#mlEmail", "me@qq.com"); await page.click("#mlSend"); await page.waitForTimeout(200);
    check("6.24 code requested for the typed email; button counts down", (await page.evaluate("window.__mailCalls.find(c=>c.action==='send_code').email")) === "me@qq.com" && /秒后可重新获取/.test(await text(page, "#mlSend")) && (await page.evaluate("document.getElementById('mlSend').disabled")));
    await page.fill("#mlCode", "000000"); await page.click("#mlVerify"); await page.waitForTimeout(200);
    check("6.24 wrong code -> server message shown in the form, still not bound", (await text(page, "#mlErr")).includes("验证码不对") && !(await text(page, "#mailBody")).includes("已开启"));
    await page.fill("#mlCode", "123456"); await page.click("#mlVerify"); await page.waitForTimeout(200);
    m = await text(page, "#mailBody");
    check("6.24 right code -> bound, shows masked email + 换一个邮箱 / 解除绑定", m.includes("已开启") && m.includes("m*@qq.com") && m.includes("解除绑定") && m.includes("换一个邮箱"), m);
    await page.evaluate("window.__confirm = true"); await page.click('#mailBody button:text-is("解除绑定")'); await page.waitForTimeout(200);
    check("6.24 解除绑定 -> back to the bind form", !(await text(page, "#mailBody")).includes("已开启") && !!(await page.$("#mlEmail")));
    await page.evaluate("closeModal()"); await page.evaluate("openSettings()");
    check("6.24 settings has 登录邮件提醒", (await text(page, "#modalbox")).includes("登录邮件提醒"));
    await page.evaluate("closeModal()"); await page.evaluate("showMailPrompt()"); await page.click('#modalbox button:text-is("不需要，不再提醒")'); await page.waitForTimeout(200);
    check("6.24 不再提醒 -> recorded on the server", await page.evaluate("window.__mailCalls.some(c=>c.action==='decline')") && (await page.evaluate("document.getElementById('modal').classList.contains('hidden')")));
    await page.evaluate("mailAfterEnter(false)"); await page.waitForTimeout(1300);
    check("6.24 declined -> no popup next time", await page.evaluate("document.getElementById('modal').classList.contains('hidden')"));
    check("6.24 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
    const r2 = await open(browser, htmlPath, { db: seed(), pre: { __loginAlerts: { ok: true, devices: [{ device: "WEB-b", current: false, name: "Windows · Chrome", first_seen: "2026-10-11T04:00:00Z", is_new: true }] } } });
    await r2.page.evaluate(mailStub); await r2.page.evaluate("loginAlertsAfterEnter()"); await r2.page.waitForTimeout(1500);
    m = await text(r2.page, "#modalbox");
    check("6.24 new-device alert has priority; binding popup not stacked on top", m.includes("账号在新设备登录") && !m.includes("绑定邮箱，开启登录提醒"));
    await r2.ctx.close();
    for (const [name, st] of [["email account", { phone_only: false }], ["SMTP not configured", { configured: false }], ["already bound", { email: "m*@qq.com" }]]) {
      const r = await open(browser, htmlPath, { db: seed() });
      await r.page.evaluate(mailStub); await r.page.evaluate("Object.assign(window.__mailState," + JSON.stringify(st) + ")"); await r.page.evaluate("mailAfterEnter(false)"); await r.page.waitForTimeout(1300);
      check("6.24 " + name + " -> no binding popup", await r.page.evaluate("document.getElementById('modal').classList.contains('hidden')"));
      await r.ctx.close();
    }
    const r3 = await open(browser, htmlPath, { db: seed() });
    await r3.page.waitForTimeout(1300);
    check("6.24 function not deployed / SQL not run -> app opens normally, no popup", !(await r3.page.evaluate("document.getElementById('app').classList.contains('hidden')")) && (await r3.page.evaluate("document.getElementById('modal').classList.contains('hidden')")));
    await r3.page.evaluate("openMailAlert()"); await r3.page.waitForTimeout(300);
    check("6.24 settings page explains the service is unavailable", (await text(r3.page, "#mailBody")).includes("不可用"));
    check("6.24 not deployed: no page errors", !(r3.page.__errs || []).length, JSON.stringify(r3.page.__errs));
    await r3.ctx.close();
  }
  // ---- 6.25 换绑登录手机号 / 登录邮箱 (server side: dev/login-alert-mail.handler.test.ts)
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed() });
    await page.evaluate(`window.__mailReply = (b) => { window.__rb = (window.__rb || []).concat([b]);
      const ok = (x) => ({ data: Object.assign({ ok: true, status: {} }, x || {}), error: null });
      const bad = (code, message) => ({ data: null, error: { message: "non-2xx", context: { json: async () => ({ ok: false, code, message }) } } });
      if (b.action === "change_phone") return b.password === "Right#123" ? ok({ phone: "139****5678" }) : bad("wrong_password", "当前密码不对（还可以再试 4 次）");
      if (b.action === "email_change_code") return ok({ sent_to: "n****w@qq.com" });
      if (b.action === "email_change_verify") return b.code === "123456" ? ok({ email: "n****w@qq.com", alert_set: true }) : bad("wrong_code", "验证码不对（还可以再试 4 次）");
      return ok({ sent: false }); };`);
    await page.evaluate("openSettings()");
    let m = await text(page, "#modalbox");
    check("6.25 settings: 换绑手机号 / 邮箱 card", m.includes("换绑手机号 / 邮箱") && m.includes("换绑邮箱") && m.includes("当前密码"));
    await page.click('#modalbox button:text-is("换绑手机号")'); await page.waitForTimeout(200);
    check("6.25 phone form shows current account + no-SMS warning", (await text(page, "#modalbox")).includes("a@x.com") && (await text(page, "#modalbox")).includes("没有短信验证") && !!(await page.$("#rbPhone")) && !!(await page.$("#rbPw")));
    const rbCalls = () => page.evaluate("(window.__rb||[]).length");
    await page.fill("#rbPhone", "12345"); await page.fill("#rbPw", "Right#123"); await page.click("#rbGo"); await page.waitForTimeout(100);
    check("6.25 bad phone -> error in the form, no call", (await text(page, "#rbErr")).includes("手机号") && (await rbCalls()) === 0);
    await page.fill("#rbPhone", "139 1234 5678"); await page.evaluate("window.__confirm=false"); await page.click("#rbGo"); await page.waitForTimeout(100);
    check("6.25 asks to double-check the number; cancel sends nothing", (await rbCalls()) === 0);
    await page.evaluate("window.__confirm=true"); await page.fill("#rbPw", "wrong"); await page.click("#rbGo"); await page.waitForTimeout(200);
    check("6.25 wrong password -> server message in the form, form stays", (await text(page, "#rbErr")).includes("当前密码不对") && !!(await page.$("#rbPhone")));
    await page.evaluate(`window.__refreshReply = { data: { session: { user: { id: "u1", email: "a@x.com", phone: "8613912345678" } } }, error: null }`);
    await page.fill("#rbPw", "Right#123"); await page.click("#rbGo"); await page.waitForTimeout(300);
    const last = await page.evaluate("window.__rb.at(-1)");
    check("6.25 change_phone sent with +86 number + password", last.action === "change_phone" && last.phone === "+8613912345678" && last.password === "Right#123", JSON.stringify(last));
    check("6.25 after change: session refreshed, back to settings, toast", (await page.evaluate("window.__refreshed")) >= 1 && (await text(page, "#toast")).includes("13912345678") && (await text(page, "#modalbox")).includes("工作台设置"));
    await page.click('#modalbox button:text-is("换绑邮箱")'); await page.waitForTimeout(200);
    await page.fill("#rbEmail", "New@qq.com"); await page.click("#rbSend"); await page.waitForTimeout(100);
    check("6.25 email: password required before asking for a code", (await text(page, "#rbErr")).includes("当前密码") && !(await page.evaluate("window.__rb.some(c=>c.action==='email_change_code')")));
    await page.fill("#rbPw", "Right#123"); await page.click("#rbSend"); await page.waitForTimeout(200);
    const ec = await page.evaluate("window.__rb.find(c=>c.action==='email_change_code')");
    check("6.25 email: code requested for the new email with the password; countdown", ec && ec.email === "New@qq.com" && ec.password === "Right#123" && /秒后可重新获取/.test(await text(page, "#rbSend")));
    await page.fill("#rbCode", "000000"); await page.click("#rbGo"); await page.waitForTimeout(200);
    check("6.25 email: wrong code -> message in the form, not changed", (await text(page, "#rbErr")).includes("验证码不对") && !!(await page.$("#rbCode")));
    await page.evaluate(`window.__refreshReply = { data: { session: { user: { id: "u1", email: "new@qq.com" } } }, error: null }`);
    await page.fill("#rbCode", "123456"); await page.click("#rbGo"); await page.waitForTimeout(300);
    check("6.25 email changed: header shows new login email, toast mentions alert email", (await text(page, "#userEmail")).includes("new@qq.com") && (await text(page, "#toast")).includes("登录邮箱已改为") && (await text(page, "#toast")).includes("提醒"));
    // 6.26 email already used by another account: friendly box inside the form, not a long floating toast
    await page.evaluate(`window.__mailReply = () => ({ data: null, error: { message: "non-2xx", context: { json: async () => ({ ok: false, code: "taken", message: "这个邮箱已经是另一个账号的登录邮箱了（一个邮箱只能登录一个账号），请换一个。只想收提醒的话，可以在「登录邮件提醒」里绑定，提醒邮箱可以重复。" }) } } })`);
    await page.evaluate("openRebind('email')"); await page.waitForTimeout(150);
    await page.evaluate("document.getElementById('toast').classList.add('hidden')");
    await page.fill("#rbEmail", "boss@qq.com"); await page.fill("#rbPw", "Right#123"); await page.click("#rbSend"); await page.waitForTimeout(200);
    const tk = await text(page, "#rbErr"), box = await page.evaluate("(()=>{const e=document.getElementById('rbErr');const r=e.getBoundingClientRect();const m=document.getElementById('modalbox').getBoundingClientRect();return {vis:!e.classList.contains('hidden'),inside:r.left>=m.left&&r.right<=m.right}})()");
    check("6.26 taken email -> short message + hint inside the form", box.vis && box.inside && tk.includes("别的账号的登录邮箱") && tk.includes("登录邮件提醒") && !tk.includes("（一个邮箱只能登录一个账号）"), tk);
    check("6.26 taken email -> no floating toast", await page.evaluate("document.getElementById('toast').classList.contains('hidden')"));
    check("6.26 button usable again after the error", !(await page.evaluate("document.getElementById('rbSend').disabled")) && (await text(page, "#rbSend")) === "获取验证码");
    await page.evaluate("toast('这是一段很长很长的提示文字，用来检查长提示是不是会变成圆角方框而不是被挤成难看的胶囊形状')");
    const tl = await page.evaluate("(()=>{const t=document.getElementById('toast');return {long:t.classList.contains('long'),r:getComputedStyle(t).borderRadius}})()");
    check("6.26 long toast -> rounded box style", tl.long && tl.r === "18px", JSON.stringify(tl));
    await page.evaluate("toast('已保存')");
    check("6.26 short toast keeps the pill style", !(await page.evaluate("document.getElementById('toast').classList.contains('long')")));
    check("6.25 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  // ---- 6.27 删除陌生设备（server side: dev/v6_27_remove_device.pgtest.sql on a local PostgreSQL mock）
  {
    const ID_B = "20000000-0000-4000-8000-00000000000b", ID_X = "20000000-0000-4000-8000-00000000000e";
    const devs = () => ({ ok: true, devices: [
      { id: "20000000-0000-4000-8000-00000000000a", device: "WEB-aaaa", current: true, name: "Android · Edge", first_seen: "2026-10-01T00:00:00Z", last_seen: "2026-10-11T05:00:00Z", status: "active", is_new: false },
      { id: ID_B, device: "WEB-bbbb", current: false, name: "Windows · Chrome", first_seen: "2026-10-11T04:00:00Z", last_seen: "2026-10-11T04:10:00Z", ip: "8.8.8.8", status: "active", is_new: false },
      { id: ID_X, device: "WEB-xxxx", current: false, name: "x'),window.__xss=1,('\"><img src=x onerror=window.__xss=2>", first_seen: "2026-10-11T03:00:00Z", status: "active", is_new: false } ] });
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __loginAlerts: devs() } });
    await page.waitForTimeout(1200);
    const sc = await page.evaluate("window.__calls.find(c=>c.name==='my_session_status')");
    check("6.27 every app entry reports this device's login (my_session_status)", sc && sc.args.p_device_id === (await page.evaluate("getDeviceId()")), JSON.stringify(sc));
    await page.evaluate("openLoginRecords()"); await page.waitForTimeout(300);
    const btns = await page.$$eval("#loginRecs button", (b) => b.map((x) => ({ t: x.textContent, on: x.getAttribute("onclick") })));
    check("6.27 删除 button on other devices only (not 本机)", btns.filter((b) => b.t === "删除").length === 2 && btns.every((b) => b.t !== "删除" || /^removeDevice\('[0-9a-f-]{36}'\)$/.test(b.on)), JSON.stringify(btns));
    check("6.27 forged device name cannot inject script", !(await page.evaluate("window.__xss")) && (await text(page, "#loginRecs")).includes("onerror"));
    await page.evaluate("window.__confirm=false"); await page.click(`#loginRecs button[onclick="removeDevice('${ID_B}')"]`); await page.waitForTimeout(150);
    check("6.27 cancel -> nothing removed", !(await page.evaluate("window.__removed2")));
    await page.evaluate("window.__confirm=true"); await page.click(`#loginRecs button[onclick="removeDevice('${ID_B}')"]`); await page.waitForTimeout(400);
    const rm = await page.evaluate("window.__removed2");
    check("6.27 remove_my_device called with the row id + this device's id", rm && rm.length === 1 && rm[0].p_id === ID_B && rm[0].p_current_device === (await page.evaluate("getDeviceId()")), JSON.stringify(rm));
    const rec = await text(page, "#loginRecs");
    check("6.27 after removal: list refreshed + note with 修改密码", rec.includes("共 2 台") && !rec.split("按最近使用排序")[1].includes("Windows · Chrome") && rec.includes("已删除「Windows · Chrome」") && rec.includes("强制退出") && rec.includes("修改密码"), rec.slice(0, 200));
    await page.click('#loginRecs button:text-is("修改密码")'); await page.waitForTimeout(400);
    check("6.27 修改密码 -> settings at the password field", (await page.evaluate("document.activeElement&&document.activeElement.id")) === "cp1");
    await page.evaluate(`window.__removeReply = { ok: false, message: "不能删除你正在使用的这台设备" }`); await page.evaluate(`removeDevice('${ID_X}')`); await page.waitForTimeout(200);
    check("6.27 server refusal shown", (await text(page, "#toast")).includes("不能删除"));
    check("6.27 no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    // the removed device: next recheck finds its login revoked -> logged out locally, login page with the reason
    await page.evaluate("closeModal(); window.__sessionRevoked = true; window.__auth = []"); await page.evaluate("recheck()"); await page.waitForTimeout(400);
    check("6.27 removed device: recheck -> back to login with the reason", !(await page.evaluate("document.getElementById('login').classList.contains('hidden')")) && (await text(page, "#authmsg")).includes("已被账号主人") && (await text(page, "#authmsg")).includes("重新输入密码"));
    await ctx.close();
    const r2 = await open(browser, htmlPath, { db: seed(), pre: { __sessionRevoked: true } });
    await r2.page.waitForTimeout(1200);
    check("6.27 removed device opening the app -> login page, app never shown", (await r2.page.evaluate("document.getElementById('app').classList.contains('hidden')")) && (await text(r2.page, "#authmsg")).includes("强制退出") && !(await r2.page.evaluate("window.__calls.some(c=>c.name==='security_register_device')")));
    await r2.ctx.close();
    // delete straight from the new-device alert
    const a = devs(); a.devices[1].is_new = true;
    const r3 = await open(browser, htmlPath, { db: seed(), pre: { __loginAlerts: a } });
    await r3.page.waitForTimeout(1300);
    await r3.page.click(`#modalbox button[onclick="removeDevice('${ID_B}',true)"]`); await r3.page.waitForTimeout(500);
    check("6.27 alert popup: 删除 removes it, alert acknowledged, records shown", (await r3.page.evaluate("(window.__removed2||[]).length")) === 1 && (await r3.page.evaluate("window.__acked")) === 1 && (await text(r3.page, "#loginRecs")).includes("已删除"));
    check("6.27 alert popup: no page errors", !(r3.page.__errs || []).length, JSON.stringify(r3.page.__errs));
    await r3.ctx.close();
    const r4 = await open(browser, htmlPath, { db: seed(), pre: { __noRemoveFns: true, __loginAlerts: devs() } });
    await r4.page.waitForTimeout(1200);
    check("6.27 before SQL: app opens normally", !(await r4.page.evaluate("document.getElementById('app').classList.contains('hidden')")));
    await r4.page.evaluate(`removeDevice('${ID_B}')`); await r4.page.waitForTimeout(200);
    check("6.27 before SQL: delete explains it is not opened yet", (await text(r4.page, "#toast")).includes("还没有开通"));
    await r4.ctx.close();
  }
  // ---- 6.27 登录页新样式（功能不变）
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    check("6.27 login: card + particle background canvas", !!(await page.$("#login .lgcard")) && !!(await page.$("#lgbg")) && (await text(page, "#login")).includes("账号登录"));
    await page.evaluate("lgView('login')");
    await page.fill("#email", "138 0013 8000"); await page.dispatchEvent("#email", "input");
    check("6.27 login: phone shows +86 prefix", (await text(page, "#lgpre")) === "+86");
    await page.fill("#email", "a@x.com"); await page.dispatchEvent("#email", "input");
    check("6.27/6.30 login: email shows the mail icon", (await page.getAttribute("#lgpre", "data-t")) === "mail" && !!(await page.$("#lgpre svg")));
    // 6.30 automatic phone / email recognition
    await page.fill("#email", "1380013800"); await page.dispatchEvent("#email", "input");
    check("6.30 phone typed: +86 prefix + how many digits so far", (await text(page, "#lgpre")) === "+86" && (await text(page, "#lgDetect")).includes("10 / 11"));
    await page.fill("#email", "13800138000"); await page.dispatchEvent("#email", "input");
    check("6.30 full phone: shown as +86 138 0013 8000", (await text(page, "#lgDetect")).includes("+86 138 0013 8000") && !(await page.$eval("#lgSuggest", (e) => !e.classList.contains("hidden"))));
    await page.fill("#email", "12345678901"); await page.dispatchEvent("#email", "input");
    check("6.30 bad phone flagged in red", await page.$eval("#lgDetect", (e) => e.classList.contains("bad")));
    await page.fill("#email", "yoran"); await page.dispatchEvent("#email", "input");
    const sug = await page.$$eval("#lgSuggest .lgsug", (b) => b.map((x) => x.textContent));
    check("6.30 letters typed: mail icon + common domains offered", (await page.getAttribute("#lgpre", "data-t")) === "mail" && sug.includes("yoran@qq.com") && sug.includes("yoran@163.com"), JSON.stringify(sug));
    await page.fill("#email", "yoran@1"); await page.dispatchEvent("#email", "input");
    const sug2 = await page.$$eval("#lgSuggest .lgsug", (b) => b.map((x) => x.textContent));
    check("6.30 domain typed: suggestions narrowed", JSON.stringify(sug2) === JSON.stringify(["yoran@163.com", "yoran@126.com"]), JSON.stringify(sug2));
    await page.click('#lgSuggest .lgsug:text-is("yoran@163.com")');
    check("6.30 tap a suggestion: filled in, recognised, suggestions gone, focus on password", (await page.inputValue("#email")) === "yoran@163.com" && (await text(page, "#lgDetect")).includes("已识别为邮箱") && (await page.$eval("#lgSuggest", (e) => e.classList.contains("hidden"))) && (await page.evaluate("document.activeElement.id")) === "password");
    await page.fill("#email", "<img src=x onerror=window.__xss2=1>"); await page.dispatchEvent("#email", "input"); await page.waitForTimeout(100);
    check("6.30 suggestions/hint escape what was typed", !(await page.evaluate("window.__xss2")));
    await page.fill("#email", "a@x.com"); await page.dispatchEvent("#email", "input");
    await page.fill("#password", "Abcdef1!"); await page.click("#login .lgeye");
    check("6.27 login: eye shows the password", (await page.getAttribute("#password", "type")) === "text");
    await page.click("#login .lgeye");
    check("6.27 login: eye hides it again", (await page.getAttribute("#password", "type")) === "password");
    check("6.27 login: 注册说明 folded by default, still in the page", !(await page.evaluate("document.querySelector('.lgtips').open")) && (await text(page, ".lgtips")).includes("邮箱注册【推荐】"));
    const fit = await page.evaluate("(()=>{const c=document.querySelector('.lgcard').getBoundingClientRect();return c.left>=0&&c.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()");
    check("6.27 login: card fits a phone screen, no sideways scroll", fit);
    await page.press("#password", "Enter"); await page.waitForTimeout(600);
    check("6.27 login: Enter in the password field logs in", (await page.evaluate("(window.__auth||[]).some(a=>a.op==='signIn')")) || !(await page.evaluate("document.getElementById('app').classList.contains('hidden')")));
    check("6.27 login: no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
  }
  // ---- 6.29 欢迎页（账号登录 / 管理员登录）+ 独立注册页 + 管理员入口
  {
    const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length); }, sel);
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true, __admin: true } });
    await page.setViewportSize({ width: 390, height: 844 });
    const wt = await text(page, "#lgWelcome");
    check("6.29 welcome first: 账号登录 / 管理员登录 / 注册新账号, form hidden", (await vis(page, "#lgWelcome")) && !(await vis(page, "#email")) && ["欢迎使用售后雷达", "账号登录", "管理员登录", "注册新账号"].every((x) => wt.includes(x)));
    await page.click('#lgWelcome button:text-is("注册新账号")'); await page.waitForTimeout(150);
    check("6.29 register is its own page: title, confirm password, 注册 button, rules, 注册说明", (await text(page, "#lgTitle")) === "注册新账号" && (await vis(page, "#password2")) && (await vis(page, "#regBtn")) && !(await vis(page, "#loginBtn")) && (await vis(page, ".lgcard .lgtips")) && (await text(page, "#regwrap")).includes("大写字母"));
    await page.click('button:text-is("去登录")'); await page.waitForTimeout(150);
    check("6.29 register -> 去登录 goes back to the login page", (await text(page, "#lgTitle")) === "账号登录" && !(await vis(page, "#password2")) && (await vis(page, "#loginBtn")) && !(await vis(page, "#regBtn")) && (await vis(page, ".lgtoreg")));
    await page.click('.lgtoreg button'); await page.waitForTimeout(100);
    check("6.29 login -> 去注册 -> register page", (await text(page, "#lgTitle")) === "注册新账号");
    await page.click("#lgCard .lgback"); await page.waitForTimeout(150);
    check("6.29 back arrow returns to the welcome page", (await vis(page, "#lgWelcome")) && !(await vis(page, "#lgCard")));
    // admin entry with an admin account -> straight into the full-page admin console
    await page.click('#lgWelcome .lgbig.light'); await page.waitForTimeout(150);
    check("6.29 admin login page: title, badge, no 去注册", (await text(page, "#lgTitle")) === "管理员登录" && (await vis(page, ".lgadminbadge")) && !(await vis(page, ".lgtoreg")));
    await page.fill("#email", "a@x.com"); await page.fill("#password", "Abcdef1!"); await page.click("#loginBtn"); await page.waitForTimeout(1200);
    const nav = await page.$$eval("#adminApp .admnav button", (b) => b.map((x) => x.dataset.k + (x.classList.contains("on") ? "*" : "")));
    check("6.30 console: grouped nav with all 14 sections, 总览 active, title shown", nav.length === 14 && nav[0] === "overview*" && (await text(page, "#admTitle")) === "总览" && (await text(page, "#adminApp .admnav")).includes("用户与安全"), JSON.stringify(nav));
    await page.click('#adminApp .admnav button[data-k="users"]'); await page.waitForTimeout(300);
    check("6.30 console: tap a section -> highlighted + title changes", (await text(page, "#admTitle")) === "用户" && (await page.$eval('#adminApp .admnav button[data-k="users"]', (b) => b.classList.contains("on"))));
    check("6.30 console: tables carry labels for the phone card layout", await page.evaluate("[...document.querySelectorAll('#adminApp .admtable td')].every(td=>td.dataset.label)"));
    check("6.29 admin account via 管理员登录 -> full-page 管理后台", (await vis(page, "#adminApp")) && (await text(page, "#adminApp")).includes("管理后台") && !!(await page.$("#adminApp #adminBody")) && (await page.evaluate("localStorage.getItem('sar_mode')")) === "admin");
    await page.click('#adminApp button:text-is("工作台")'); await page.waitForTimeout(200);
    check("6.29 管理后台 -> 工作台; 管理 button there to come back", !(await vis(page, "#adminApp")) && (await vis(page, "#adminBtn")));
    await page.click("#adminBtn"); await page.waitForTimeout(400);
    check("6.29 管理 -> back to the full-page console", await vis(page, "#adminApp"));
    check("6.29 admin entry: no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
    await ctx.close();
    // a normal account through 管理员登录 -> refused, signed out, stays on the admin login page
    const r2 = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true, __admin: false } });
    await r2.page.evaluate("lgView('admin')");
    await r2.page.fill("#email", "a@x.com"); await r2.page.fill("#password", "Abcdef1!"); await r2.page.click("#loginBtn"); await r2.page.waitForTimeout(1200);
    check("6.29 non-admin via 管理员登录 -> refused with a clear message, app not shown", (await r2.page.evaluate("document.getElementById('app').classList.contains('hidden')")) && (await text(r2.page, "#authmsg")).includes("不是管理员") && (await text(r2.page, "#lgTitle")) === "管理员登录" && !(await vis(r2.page, "#adminApp")));
    await r2.ctx.close();
    // an admin account through the normal 账号登录 -> workbench only, no admin entries
    const r3 = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true, __admin: true } });
    await r3.page.evaluate("lgView('login')");
    await r3.page.fill("#email", "a@x.com"); await r3.page.fill("#password", "Abcdef1!"); await r3.page.click("#loginBtn"); await r3.page.waitForTimeout(1200);
    check("6.29 admin account via 账号登录 -> workbench, no 管理 button, no console", !(await r3.page.evaluate("document.getElementById('app').classList.contains('hidden')")) && !(await vis(r3.page, "#adminBtn")) && !(await vis(r3.page, "#adminApp")) && (await r3.page.evaluate("localStorage.getItem('sar_mode')")) === "user");
    await r3.ctx.close();
    // reopening the page after an admin login keeps the admin entry
    const r4 = await open(browser, htmlPath, { db: seed(), pre: { __admin: true, __sarMode: "admin" } });
    await r4.page.waitForTimeout(1000);
    check("6.29 reopen after admin login -> console again", await vis(r4.page, "#adminApp"));
    const afterLogout = await r4.page.evaluate("(()=>{logout();return localStorage.getItem('sar_mode')})()"); await r4.page.waitForTimeout(800);
    check("6.29 logout clears the admin entry", afterLogout === "user", afterLogout);
    await r4.ctx.close();
  }
  // ---- 6.18 phone accounts need admin approval (server enforces with RLS; page shows a clear message)
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), pre: { __noSession: true } });
    await page.evaluate("lgView('login')");
    await page.fill("#email", "12345678901"); await page.fill("#password", "Abcdef1!"); await page.click('button:text-is("登录")'); await page.waitForTimeout(150);
    check("6.18 bad number refused locally, no request", (await text(page, "#authmsg")).includes("中国大陆手机号") && !(await page.evaluate("window.__auth")));
    await page.evaluate("window.__pending=true");
    await page.evaluate("lgView('register')");
    await page.fill("#email", "13800138000"); await page.fill("#password", "Abcdef1!"); await page.click('button:text-is("注册")'); await page.waitForTimeout(100);
    await page.fill("#password2", "Abcdef1!"); await page.click('button:text-is("注册")'); await page.waitForTimeout(800);
    check("6.18 pending phone account: kept out of the app", await page.evaluate("document.getElementById('app').classList.contains('hidden')") && !(await page.evaluate("document.getElementById('login').classList.contains('hidden')")));
    check("6.18 pending: clear message + contact email, signed out locally", (await text(page, "#authmsg")).includes("等待管理员审核") && (await text(page, "#authmsg")).includes("1012968575@qq.com") && (await page.evaluate("window.__signedOut")) >= 1, await text(page, "#authmsg"));
    check("6.18 pending: password box cleared", (await page.inputValue("#password")) === "");
    await page.evaluate("window.__pending=false");
    await page.fill("#password", "Abcdef1!"); await page.click('button:text-is("登录")'); await page.waitForTimeout(800);
    check("6.18 after approval: same account gets in", !(await page.evaluate("document.getElementById('app').classList.contains('hidden')")));
    check("6.18 login tips mention review", (await text(page, "#login")).includes("等管理员审核通过才能使用"));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { db: seed(), admin: true, users: [{ id: "u1", email: "a@x.com" }], pre: { __pendingUsers: [{ id: "p1", phone: "8613800138000", created_at: "2026-10-10T20:00:00Z", last_sign_in_at: null }, { id: "p2", phone: "8613900139000", created_at: "2026-10-10T21:00:00Z" }] } });
    await page.waitForTimeout(300);
    await page.evaluate("adminPanel('approvals')"); await page.waitForTimeout(300);
    const ab = await text(page, "#adminBody");
    check("6.18 admin 审核: pending phone accounts listed (86 prefix trimmed) + warning", ab.includes("13800138000") && ab.includes("13900139000") && ab.includes("没有短信验证"), ab.slice(0, 200));
    await page.evaluate("window.__confirm=false"); await page.evaluate("adminApprove('p1')"); await page.waitForTimeout(150);
    check("6.18 approve asks for confirmation (cancel -> no call)", !(await page.evaluate("window.__calls.some(c=>c.name==='admin_approve_phone_user')")));
    await page.evaluate("window.__confirm=true"); await page.evaluate("adminApprove('p1')"); await page.waitForTimeout(400);
    const call = await page.evaluate("window.__calls.filter(c=>c.name==='admin_approve_phone_user').pop()");
    check("6.18 approve calls server function with the user id", call && call.args.p_user_id === "p1");
    check("6.18 approved account disappears from the list", !(await text(page, "#adminBody")).includes("13800138000") && (await text(page, "#adminBody")).includes("13900139000"));
    await page.evaluate("window.__users=[{id:'u1',email:'a@x.com',is_admin:true,task_count:2},{id:'p9',email:'8613700137000',is_admin:false,task_count:1}]");
    await page.evaluate("adminGo('users')"); await page.waitForTimeout(300);
    const ut = await text(page, "#adminBody");
    check("6.19 users tab: all users incl. phone users shown as 手机 xxx, admin marked", ut.includes("a@x.com") && ut.includes("手机 13700137000") && !ut.includes("8613700137000") && ut.includes("管理员") && ut.includes("全站共 2 个账号"), ut.slice(0, 300));
    check("6.19 acct(): email kept, +86 trimmed, foreign kept, empty -> —", JSON.stringify(await page.evaluate("[acct('a@x.com'),acct('8613800138000'),acct('447911123456'),acct(''),acct(null)]")) === JSON.stringify(["a@x.com", "手机 13800138000", "手机 +447911123456", "—", "—"]));
    check("6.18 admin tabs: 审核 present, earlier tabs kept", (await page.evaluate("ADMIN_TABS.map(t=>t[1]).join()")) === "总览,用户,管理员,售后,快递,店铺,资料库,举证,设备,账号,日志,设置,客服,审核");
    await ctx.close();
    const r2 = await open(browser, htmlPath, { db: seed(), admin: true, pre: { __noApprovalFns: true } });
    await r2.page.waitForTimeout(300);
    check("6.18 before SQL: app still opens (no pending function)", !(await r2.page.evaluate("document.getElementById('app').classList.contains('hidden')")));
    await r2.page.evaluate("adminPanel('approvals')"); await r2.page.waitForTimeout(300);
    check("6.18 before SQL: 审核 tab explains what to run", (await text(r2.page, "#adminBody")).includes("v6_18_phone_approval.sql"), await text(r2.page, "#adminBody"));
    check("6.18 no page errors", !(r2.page.__errs || []).length, JSON.stringify(r2.page.__errs));
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
  await page.click('.chip:text-is("全部")');
  check("quick: 全部 -> 3", (await count()) === "3 条");
  // ---- open task: edit form, tracking card, evidence rows
  await page.evaluate("openTask('t1')"); await page.waitForTimeout(200);
  const d = await text(page, "#detail");
  check("detail: edit form prefilled", (await page.inputValue("#f_order")) === "ORD1" && (await page.inputValue("#f_buyer")) === "张三" && (await page.inputValue("#f_track")) === "SF1" && (await page.inputValue("#f_reason")) === "r1" && (await page.inputValue("#f_evidence")) === "e1");
  check("detail: status/risk/type selects selected", (await page.inputValue("#f_status")) === "待举证" && (await page.inputValue("#f_risk")) === "高风险" && (await page.inputValue("#f_type")) === "仅退款");
  check("detail: deadline field filled (datetime-local)", /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(await page.inputValue("#f_deadline")));
  check("detail: rejection count pill", d.includes("拒绝协商 1 次"));
  check("6.7.1 detail: current logistics status in the top card", (await text(page, "#detail .card")).includes("物流状态") && (await text(page, "#logistics_now")) === "已签收匹配" && (await text(page, "#detail .card")).includes("顺丰 · 更新于"));
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
  check("more(): new entries present", ["夜间模式", "在线用户", "工作台设置", "导出 JSON 备份", "店铺中心", "云端资料库", "设备注册诊断"].every((x) => mt.includes(x)), mt);
  check("6.29 more(): normal login (even an admin account) has no 管理后台", !mt.includes("管理后台") && (await page.evaluate("document.getElementById('adminBtn').classList.contains('hidden')")));
  await page.evaluate("setMode('admin'); more()");
  check("6.29 more(): admin entry shows 管理后台", (await text(page, "#modalbox")).includes("管理后台"));
  await page.evaluate("setMode('user')");
  await page.evaluate("openSettings()");
  const st = await text(page, "#modalbox");
  check("settings: account/version/data-safety/export", st.includes("a@x.com") && st.includes("6.30.0") && st.includes("数据安全") && st.includes("导出 JSON 备份") && st.includes("每分钟"));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate("exportTasks()")]);
  const path = await dl.path(); const exp = JSON.parse(fs.readFileSync(path, "utf8"));
  check("export: JSON backup has tasks/stores/library + filename", exp.tasks.length === 3 && Array.isArray(exp.stores) && Array.isArray(exp.library) && /^after-sales-radar-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.evaluate("window.__onlineUsers=[{id:'u1'},{id:'u2'}]");
  await page.evaluate("setMode('user'); openOnlinePanel()"); await page.waitForTimeout(250);
  check("6.29 online panel: normal login shows no emails", !(await text(page, "#modalbox")).includes("old@x.com"));
  await page.evaluate("setMode('admin')");
  await page.evaluate("openOnlinePanel()"); await page.waitForTimeout(250);
  const ot = await text(page, "#modalbox");
  check("online panel: count, (我), admin sees emails + 24h active", ot.includes("2") && ot.includes("a@x.com（我）") && ot.includes("old@x.com") && ot.includes("24 小时内登录 1 人"), ot);
  await page.evaluate("setMode('user'); closeModal()");
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
