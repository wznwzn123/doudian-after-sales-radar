// Logic tests for the device gate + admin device UI.
// Real Chromium loads the real index.html; only the Supabase client is replaced by a controllable stub.
// This is NOT a test against the real database.
const { chromium } = require("playwright");
const fs = require("fs");

const STUB = `
(function(){
 const listeners=[];window.__log=[];window.__calls=[];
 const mk=()=>{const q=new Proxy(function(){},{get:(t,p)=>p==='then'?(res)=>res({data:[],error:null}):(...a)=>q,apply:()=>q});return q};
 const sb={
  auth:{
   getSession:async()=>({data:{session:window.__existing?{user:{id:'u1',email:'a@x.com'}}:null},error:null}),
   onAuthStateChange(cb){listeners.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
   async signInWithPassword(){const s={user:{id:'u1',email:'a@x.com'}};window.__existing=true;window.__log.push('signIn');listeners.forEach(cb=>cb('SIGNED_IN',s));return{data:{session:s},error:null}},
   async signOut(o){window.__log.push('signOut:'+JSON.stringify(o||{}));window.__existing=false;listeners.forEach(cb=>cb('SIGNED_OUT',null));return{error:null}},
   async resetPasswordForEmail(){return{error:null}},async signUp(){return{error:null}},async updateUser(){return{error:null}}
  },
  async rpc(name,args){
   window.__log.push('rpc:'+name);window.__calls.push({name,args});
   const m=window.__mode;
   if(name==='security_register_device'){
    switch(m.device){
     case 'ok':return{data:{ok:true},error:null};
     case 'blocked':return{data:{ok:false,blocked:true,scope:'设备',reason:'设备已被限制访问'},error:null};
     case 'denied':return{data:{ok:false,reason:'账号已停用'},error:null};
     case 'acctblocked':return{data:{ok:false,blocked:true,scope:'账号',reason:'账号已被限制访问'},error:null};
     case 'error':return{data:null,error:{message:'network down'}};
     case 'throw':throw new Error('boom');
     case 'empty':return{data:null,error:null};
    }
   }
   if(name==='is_admin')return{data:m.admin===true,error:null};
   if(name==='admin_list_devices')return m.listError?{data:null,error:{message:m.listError}}:{data:m.devices||[],error:null};
   if(name==='admin_set_device_status')return m.setStatus||{data:{ok:true},error:null};
   if(name==='admin_list_all_users')return m.usersError?{data:null,error:{message:m.usersError}}:{data:m.users||[],error:null};
   if(name==='admin_list_account_bans')return{data:m.bans||[],error:null};
   if(name==='admin_set_account_ban')return m.setBan||{data:{ok:true},error:null};
   if(m.rpcErr&&m.rpcErr[name])return{data:null,error:{message:m.rpcErr[name]}};
   if(m.rows&&name in m.rows)return{data:m.rows[name],error:null};
   if(name==='admin_add_user_by_email'||name==='admin_remove_user')return m.adminOp||{data:{ok:true,message:'操作成功'},error:null};
   return{data:null,error:{message:'unexpected rpc '+name}};
  },
  from:()=>mk(),
  channel(){const c={on(){return c},subscribe(){return c},async track(){},async untrack(){}};return c},
  removeChannel(){},
  storage:{from:()=>({})}
 };
 window.supabase={createClient:()=>sb};
})();`;

const OBSERVER = `
window.__appEverShown=false;
new MutationObserver(()=>{const a=document.getElementById('app');if(a&&!a.classList.contains('hidden'))window.__appEverShown=true})
 .observe(document,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
window.__prompt='';window.__confirm=true;
window.prompt=()=>window.__prompt;window.confirm=()=>window.__confirm;window.alert=()=>{};
`;

async function open(browser, htmlPath, { mode, existing = false, clock = false }) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const ctx = await browser.newContext();
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("https://radar.test/")) {
      if (u.endsWith("manifest.webmanifest")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    }
    if (u.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
    return route.abort();
  });
  await ctx.addInitScript(({ mode, existing }) => { window.__mode = mode; window.__existing = existing; }, { mode, existing });
  await ctx.addInitScript(OBSERVER);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => (page.__errs = (page.__errs || []).concat(e.message)));
  if (clock) await page.clock.install();
  await page.goto("https://radar.test/index.html");
  await settle(page);
  return { ctx, page };
}
async function settle(page) {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(40);
    const busy = await page.evaluate("typeof gateBusy==='undefined'?false:gateBusy");
    if (!busy && i > 3) break;
  }
  await page.waitForTimeout(80);
}
const appShown = (p) => p.evaluate("!document.getElementById('app').classList.contains('hidden')");
const loginShown = (p) => p.evaluate("!document.getElementById('login').classList.contains('hidden')");
const everShown = (p) => p.evaluate("window.__appEverShown");
const log = (p) => p.evaluate("window.__log");
const calls = (p, n) => p.evaluate((n) => window.__calls.filter((c) => c.name === n), n);
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent || "", sel);

async function doLogin(page) {
  await page.fill("#email", "a@x.com");
  await page.fill("#password", "Passw0rd!x");
  await page.click("#login .primary");
  await settle(page);
}

const results = [];
function check(group, name, cond, detail = "") {
  results.push({ group, name, ok: !!cond, detail });
}

async function gateScenarios(browser, htmlPath, tag) {
  const g = tag;
  // 1. fresh login with a good device
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" } });
    await doLogin(page);
    check(g, "login + good device -> app opens", await appShown(page));
    check(g, "login: register RPC called once (no double check)", (await calls(page, "security_register_device")).length === 1,
      "calls=" + (await calls(page, "security_register_device")).length);
    await ctx.close();
  }
  // 2. fresh login with a BLOCKED device: app must never become visible
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "blocked" } });
    await doLogin(page);
    check(g, "login + blocked device -> app NEVER shown (SIGNED_IN race)", (await everShown(page)) === false, "appEverShown=" + (await everShown(page)));
    check(g, "login + blocked device -> back on login screen with reason", (await loginShown(page)) && (await text(page, "#authmsg")).includes("禁止登录"), await text(page, "#authmsg"));
    await ctx.close();
  }
  // 3. page refresh with an existing session on a BLOCKED device
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "blocked" }, existing: true });
    check(g, "refresh with stored session + blocked device -> app NEVER shown", (await everShown(page)) === false, "appEverShown=" + (await everShown(page)));
    await ctx.close();
  }
  // 4. refresh with an existing session on a good device
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true });
    check(g, "refresh with stored session + good device -> app opens", await appShown(page));
    await ctx.close();
  }
  // 5. fail-closed on RPC errors (refresh path)
  for (const m of ["error", "throw", "empty", "denied"]) {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: m }, existing: true });
    check(g, `refresh + device check "${m}" -> NOT let in`, (await everShown(page)) === false, "appEverShown=" + (await everShown(page)));
    await ctx.close();
  }
}

async function newOnlyScenarios(browser, htmlPath) {
  const g = "NEW";
  // signOut scope + no admin/data calls when denied
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "blocked", admin: true }, existing: true });
    const l = await log(page);
    check(g, "blocked: signOut uses scope:local (does not kick other devices)", l.some((x) => x === 'signOut:{"scope":"local"}'), JSON.stringify(l));
    check(g, "blocked: no is_admin / data loading happened", !l.includes("rpc:is_admin"), JSON.stringify(l));
    await ctx.close();
  }
  // error message wording
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "error" }, existing: true });
    check(g, "RPC error shows 设备安全检查失败", (await text(page, "#authmsg")).includes("设备安全检查失败"), await text(page, "#authmsg"));
    await ctx.close();
  }
  // periodic / event driven recheck kicks a device blocked while the app is open
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true });
    await page.evaluate("window.__mode.device='blocked'");
    await page.evaluate("recheck()");
    await settle(page);
    check(g, "recheck(): device blocked mid-session -> kicked to login, data cleared",
      !(await appShown(page)) && (await loginShown(page)) && (await page.evaluate("tasks.length===0&&document.getElementById('tasklist').innerHTML===''")));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true });
    await page.evaluate("window.__mode.device='blocked'");
    await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    await settle(page);
    check(g, "visibilitychange triggers recheck -> kicked", !(await appShown(page)));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true, clock: true });
    await page.evaluate("window.__mode.device='blocked'");
    await page.clock.fastForward(121000);
    await settle(page);
    check(g, "120s interval recheck -> kicked", !(await appShown(page)));
    await ctx.close();
  }
  // transient errors must not kick a running session, but warn after 3 in a row
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true });
    await page.evaluate("window.__mode.device='error'");
    for (let i = 0; i < 3; i++) { await page.evaluate("recheck()"); await settle(page); }
    check(g, "3 transient network errors -> stays in app + warns", (await appShown(page)) && (await text(page, "#toast")).includes("连续失败"), await text(page, "#toast"));
    await page.evaluate("window.__mode.device='ok'");
    await page.evaluate("recheck()"); await settle(page);
    check(g, "recovers after network returns (counter reset)", (await appShown(page)) && (await page.evaluate("gateFails===0")));
    await ctx.close();
  }
  // remote sign-out while app open
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true });
    await page.evaluate("window.__existing=false");
    await page.evaluate("sb.auth.signOut({scope:'local'})");
    await settle(page);
    check(g, "session revoked elsewhere -> returns to login", !(await appShown(page)) && (await loginShown(page)));
    await ctx.close();
  }
  // re-login after being denied works (state reset)
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "blocked" } });
    await doLogin(page);
    await page.evaluate("window.__mode.device='ok'");
    await doLogin(page);
    check(g, "unblocked device can log in again", await appShown(page));
    await ctx.close();
  }
}

async function adminScenarios(browser, htmlPath) {
  const g = "ADMIN";
  const mkDevices = (cur) => [
    { id: "d-cur", user_id: "u1", owner_email: "admin@x.com", device_name: "我的手机", device_id: cur, platform: "android", app_version: "6.2.0", status: "active", created_at: "2026-10-01T00:00:00Z", last_seen_at: "2026-10-09T01:00:00Z", blocked_at: null, blocked_reason: null, blocked_by: null },
    { id: "d-bad", user_id: "u2", owner_email: "bad@x.com", device_name: "<img src=x onerror=window.__xss=1>", device_id: "WEB-bad", platform: "android", app_version: "6.1.0", status: "blocked", created_at: "2026-10-02T00:00:00Z", last_seen_at: "2026-10-08T01:00:00Z", blocked_at: "2026-10-08T02:00:00Z", blocked_reason: "盗号", blocked_by: "11111111-2222-3333-4444-555555555555" },
    { id: "d-ok", user_id: "u3", owner_email: "ok@x.com", device_name: "平板", device_id: "WEB-ok", platform: "android", app_version: "6.2.0", status: "active", created_at: "2026-10-03T00:00:00Z", last_seen_at: null, blocked_at: null, blocked_reason: null, blocked_by: null },
  ];
  async function openAdmin(extra = {}) {
    const o = await open(browser, htmlPath, { mode: { device: "ok", admin: true, ...extra }, existing: true });
    const cur = await o.page.evaluate("getDeviceId()");
    await o.page.evaluate((d) => { window.__mode.devices = d; }, mkDevices(cur));
    await o.page.evaluate("adminPanel()");
    await settle(o.page);
    await o.page.click(`#modalbox button:text-is("设备")`);
    await settle(o.page);
    return { ...o, cur };
  }
  // render
  {
    const { ctx, page } = await openAdmin();
    const html = await page.evaluate("document.getElementById('devList').innerHTML");
    const t = await text(page, "#devList");
    check(g, "list shows email / name / id / platform / version / times / reason", ["bad@x.com", "WEB-bad", "android", "v6.1.0", "盗号", "最后在线", "封禁于"].every((s) => t.includes(s)), t.slice(0, 120));
    check(g, "current device has no block button", t.includes("当前设备，不可封禁") && (html.match(/adminSetDevice\(0,/g) || []).length === 0);
    check(g, "blocked device offers 解除封禁; active offers 封禁", html.includes("adminSetDevice(1,'unblock')") && html.includes("adminSetDevice(2,'block')"));
    check(g, "blocked_by (admin UUID prefix) displayed", t.includes("11111111"));
    check(g, "device_name is HTML-escaped (no XSS)", (await page.evaluate("!window.__xss && !document.querySelector('#devList img')")));
    check(g, "count line", t.includes("共 3 台设备，已封禁 1 台"), t.slice(0, 60));
    await ctx.close();
  }
  // block flow
  {
    const { ctx, page, cur } = await openAdmin();
    await page.evaluate("window.__prompt=''");
    await page.evaluate("adminSetDevice(2,'block')"); await settle(page);
    check(g, "block without reason -> no RPC, toast", (await calls(page, "admin_set_device_status")).length === 0 && (await text(page, "#toast")).includes("封禁原因"), await text(page, "#toast"));
    await page.evaluate("window.__prompt='  恶意刷单  '");
    await page.evaluate("window.__confirm=false");
    await page.evaluate("adminSetDevice(2,'block')"); await settle(page);
    check(g, "reason given but confirm declined -> no RPC", (await calls(page, "admin_set_device_status")).length === 0);
    await page.evaluate("window.__confirm=true");
    const before = (await calls(page, "admin_list_devices")).length;
    await page.evaluate("adminSetDevice(2,'block')"); await settle(page);
    const c = await calls(page, "admin_set_device_status");
    check(g, "block -> RPC payload correct (id, action, trimmed reason, current device)", c.length === 1 && c[0].args.payload.id === "d-ok" && c[0].args.payload.action === "block" && c[0].args.payload.reason === "恶意刷单" && c[0].args.payload.current_device_id === cur, JSON.stringify(c));
    check(g, "list refreshed after action + success toast", (await calls(page, "admin_list_devices")).length === before + 1 && (await text(page, "#toast")).includes("已封禁"));
    await ctx.close();
  }
  // unblock flow
  {
    const { ctx, page } = await openAdmin();
    await page.evaluate("adminSetDevice(1,'unblock')"); await settle(page);
    const c = await calls(page, "admin_set_device_status");
    check(g, "unblock -> RPC payload action=unblock for the blocked row", c.length === 1 && c[0].args.payload.id === "d-bad" && c[0].args.payload.action === "unblock", JSON.stringify(c));
    await ctx.close();
  }
  // can't block own current device (even by calling the function directly)
  {
    const { ctx, page } = await openAdmin();
    await page.evaluate("window.__prompt='测试'");
    await page.evaluate("adminSetDevice(0,'block')"); await settle(page);
    check(g, "blocking own current device is refused client-side, no RPC", (await calls(page, "admin_set_device_status")).length === 0 && (await text(page, "#toast")).includes("不能封禁当前正在使用的设备"));
    await ctx.close();
  }
  // server error surfaces
  {
    const { ctx, page } = await openAdmin({ setStatus: { data: null, error: { message: "forbidden" } } });
    await page.evaluate("window.__prompt='测试'");
    await page.evaluate("adminSetDevice(2,'block')"); await settle(page);
    check(g, "server error shown to admin", (await text(page, "#toast")).includes("操作失败：forbidden"), await text(page, "#toast"));
    await ctx.close();
  }
  // non-admin
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok", admin: false }, existing: true });
    await page.evaluate("adminDevices()"); await settle(page);
    check(g, "non-admin: adminDevices() refused, no RPC", (await calls(page, "admin_list_devices")).length === 0 && (await text(page, "#toast")).includes("没有管理员权限"));
    check(g, "non-admin: 管理 button hidden", await page.evaluate("document.getElementById('adminBtn').classList.contains('hidden')"));
    await ctx.close();
  }
  // list RPC error (e.g. SQL not applied yet)
  {
    const o = await open(browser, htmlPath, { mode: { device: "ok", admin: true, listError: "Could not find the function public.admin_list_devices" }, existing: true });
    await o.page.evaluate("adminPanel()"); await settle(o.page);
    await o.page.click(`#modalbox button:text-is("设备")`); await settle(o.page);
    check(g, "list RPC error (SQL not applied yet) is shown, no crash", (await text(o.page, "#adminBody")).includes("admin_list_devices") && !(o.page.__errs || []).length, await text(o.page, "#adminBody"));
    await o.ctx.close();
  }
}


async function accountScenarios(browser, htmlPath) {
  const g = "ACCOUNT";
  const users = [
    { id: "u1", email: "admin@x.com", created_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-10-09T00:00:00Z", task_count: 2, is_admin: true },
    { id: "u2", email: "<b id=xss2>bad</b>@x.com", created_at: "2026-10-02T00:00:00Z", last_sign_in_at: "2026-10-08T00:00:00Z", task_count: 5, is_admin: false },
    { id: "u3", email: "ok@x.com", created_at: "2026-10-03T00:00:00Z", last_sign_in_at: null, task_count: 0, is_admin: false },
    { id: "u4", email: "banned@x.com", created_at: "2026-10-04T00:00:00Z", last_sign_in_at: null, task_count: 1, is_admin: false },
  ];
  const bans = [{ user_id: "u4", owner_email: "banned@x.com", reason: "刷单", blocked_at: "2026-10-08T02:00:00Z", expires_at: null, blocked_by: "11111111-2222-3333-4444-555555555555" }];
  async function openAcc(extra = {}) {
    const o = await open(browser, htmlPath, { mode: { device: "ok", admin: true, users, bans, ...extra }, existing: true });
    await o.page.evaluate("adminPanel()"); await settle(o.page);
    await o.page.click(`#modalbox button:text-is("账号")`); await settle(o.page);
    return o;
  }
  {
    const { ctx, page } = await openAcc();
    const html = await page.evaluate("document.getElementById('accList').innerHTML");
    const t = await text(page, "#accList");
    check(g, "list: email / 注册 / 最后登录 / 售后数 / ban reason shown", ["ok@x.com", "banned@x.com", "刷单", "售后 5 条", "封禁于", "共 4 个账号，已封禁 1 个"].every((x) => t.includes(x)), t.slice(0, 140));
    check(g, "self (current admin) has no block button", t.includes("当前账号，不可封禁"));
    check(g, "banned account offers 解除封禁; normal offers 封禁账号", html.includes("adminSetAccount(3,'unblock')") && html.includes("adminSetAccount(1,'block')") && html.includes("adminSetAccount(2,'block')"));
    check(g, "email is HTML-escaped (no XSS)", await page.evaluate("!document.getElementById('xss2')"));
    await ctx.close();
  }
  {
    const { ctx, page } = await openAcc();
    await page.evaluate("window.__prompt=''"); await page.evaluate("adminSetAccount(1,'block')"); await settle(page);
    check(g, "block without reason -> no RPC", (await calls(page, "admin_set_account_ban")).length === 0 && (await text(page, "#toast")).includes("封禁原因"));
    await page.evaluate("window.__prompt=' 恶意刷单 '"); await page.evaluate("window.__confirm=false"); await page.evaluate("adminSetAccount(1,'block')"); await settle(page);
    check(g, "reason given but confirm declined -> no RPC", (await calls(page, "admin_set_account_ban")).length === 0);
    await page.evaluate("window.__confirm=true");
    const before = (await calls(page, "admin_list_all_users")).length;
    await page.evaluate("adminSetAccount(1,'block')"); await settle(page);
    const c = await calls(page, "admin_set_account_ban");
    check(g, "block -> RPC payload {user_id, action, trimmed reason}", c.length === 1 && c[0].args.payload.user_id === "u2" && c[0].args.payload.action === "block" && c[0].args.payload.reason === "恶意刷单", JSON.stringify(c));
    check(g, "list refreshed + toast", (await calls(page, "admin_list_all_users")).length === before + 1 && (await text(page, "#toast")).includes("账号已封禁"));
    await page.evaluate("adminSetAccount(3,'unblock')"); await settle(page);
    const c2 = await calls(page, "admin_set_account_ban");
    check(g, "unblock -> RPC payload action=unblock for u4", c2.length === 2 && c2[1].args.payload.user_id === "u4" && c2[1].args.payload.action === "unblock", JSON.stringify(c2[1]));
    await ctx.close();
  }
  {
    const { ctx, page } = await openAcc();
    await page.evaluate("window.__prompt='测试'");
    await page.evaluate("adminSetAccount(0,'block')"); await settle(page);
    check(g, "blocking own account refused client-side", (await calls(page, "admin_set_account_ban")).length === 0 && (await text(page, "#toast")).includes("不能封禁当前登录的账号"));
    await ctx.close();
  }
  {
    const { ctx, page } = await openAcc({ setBan: { data: null, error: { message: "cannot block an admin account" } } });
    await page.evaluate("window.__prompt='测试'");
    await page.evaluate("adminSetAccount(2,'block')"); await settle(page);
    check(g, "server error shown", (await text(page, "#toast")).includes("操作失败：cannot block an admin account"), await text(page, "#toast"));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok", admin: false }, existing: true });
    await page.evaluate("adminAccounts()"); await settle(page);
    check(g, "non-admin: adminAccounts() refused, no RPC", (await calls(page, "admin_list_all_users")).length === 0 && (await text(page, "#toast")).includes("没有管理员权限"));
    await ctx.close();
  }
  {
    const o = await open(browser, htmlPath, { mode: { device: "ok", admin: true, usersError: "没有管理员权限" }, existing: true });
    await o.page.evaluate("adminPanel()"); await settle(o.page);
    await o.page.click(`#modalbox button:text-is("账号")`); await settle(o.page);
    check(g, "list RPC error shown, no crash", (await text(o.page, "#adminBody")).includes("没有管理员权限") && !(o.page.__errs || []).length);
    await o.ctx.close();
  }
  // login / refresh with a banned ACCOUNT
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "acctblocked" } });
    await doLogin(page);
    check(g, "banned account login: app never shown", (await everShown(page)) === false);
    check(g, "banned account login: message says 账号 (not 设备)", (await text(page, "#authmsg")).includes("此账号已被禁止登录"), await text(page, "#authmsg"));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "acctblocked" }, existing: true });
    check(g, "banned account + stored session (refresh): app never shown", (await everShown(page)) === false);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok" }, existing: true });
    await page.evaluate("window.__mode.device='acctblocked'");
    await page.evaluate("recheck()"); await settle(page);
    check(g, "account banned while app open -> kicked to login with 账号 message", !(await appShown(page)) && (await text(page, "#authmsg")).includes("此账号已被禁止登录"), await text(page, "#authmsg"));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "blocked" } });
    await doLogin(page);
    check(g, "device block message still says 设备", (await text(page, "#authmsg")).includes("此设备已被禁止登录"), await text(page, "#authmsg"));
    await ctx.close();
  }
}

async function restoreScenarios(browser, htmlPath) {
  const g = "RESTORE";
  const rows = {
    admin_list_all_users: [{ id: "u1", email: "a@x.com", is_admin: true, task_count: 2 }, { id: "u2", email: "b@x.com", is_admin: false, task_count: 0 }],
    admin_list_all_tasks: [
      { id: "t1", order_id: "ORD111", store_name: "店A", email: "b@x.com", status: "已完成", risk: "高风险", tracking_no: "SF001", created_at: "2026-10-01T00:00:00Z" },
      { id: "t2", order_id: "ORD222", store_name: "店B", email: "c@x.com", status: "待举证", risk: "普通", tracking_no: "YT002", created_at: "2026-10-02T00:00:00Z" }],
    admin_list_all_evidence: [{ id: "e1", file_name: "pic.jpg", email: "b@x.com", mime_type: "image/jpeg", size_bytes: 2048, created_at: "2026-10-01T00:00:00Z" }],
    admin_list_tracking: [{ id: "k1", tracking_no: "SF001", email: "b@x.com", order_id: "ORD111", monitoring: true }, { id: "k2", tracking_no: "YT002", email: "c@x.com", order_id: "ORD222", monitoring: false }],
    admin_list_users: [{ id: "u1", email: "a@x.com", task_count: 2 }, { id: "u3", email: "boss@x.com", task_count: 0 }],
    admin_list_all_stores: [{ store_id: "s1", owner_email: "b@x.com", store_name: "店A", platform: "抖店", status: "active", task_count: 3 }],
    admin_list_library: [{ id: "l1", file_name: "合同.pdf", email: "b@x.com", store_name: "店A", platform: "通用", usage_count: 2 }],
    admin_list_logs: [{ id: "g1", user_id: "u1", email: "a@x.com", action: "device_block", detail: "WEB-1 / 測試", created_at: "2026-10-03T00:00:00Z" }],
  };
  const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok", admin: true, rows, users: rows.admin_list_all_users }, existing: true });
  await page.evaluate("adminPanel()"); await settle(page);
  const body = () => text(page, "#adminBody");
  const tab = async (k) => { await page.evaluate((k) => adminGo(k), k); await settle(page); };
  const b0 = await body();
  check(g, "overview: 6 stat cards with real numbers", ["注册用户", "全部售后", "高风险", "盯单中", "证据文件", "已完成"].every((x) => b0.includes(x)) && /注册用户\s*2/.test(b0) && /全部售后\s*2/.test(b0) && /盯单中\s*1/.test(b0) && /高风险\s*1/.test(b0), b0);
  const tabs = (await text(page, "#modalbox")) ;
  check(g, "all 12 admin tabs present", ["总览", "用户", "管理员", "售后", "快递", "店铺", "资料库", "举证", "设备", "账号", "日志", "设置", "退出后台"].every((x) => tabs.includes(x)), tabs.slice(0, 80));
  await tab("tasks");
  let b = await body();
  check(g, "tasks tab: user email shown (owner_email bug fixed)", b.includes("b@x.com") && b.includes("c@x.com") && b.includes("店A") && b.includes("SF001"), b);
  await page.fill("#admQ", "ORD222"); await page.waitForTimeout(50);
  b = await text(page, "#admList");
  check(g, "tasks search filters rows", b.includes("ORD222") && !b.includes("ORD111") && b.includes("匹配 1"), b);
  await page.fill("#admQ", "不存在"); await page.waitForTimeout(50);
  check(g, "tasks search no match -> notice", (await text(page, "#admList")).includes("没有匹配"));
  await tab("tracking"); b = await body();
  check(g, "tracking tab: email + 是/否 shown", b.includes("b@x.com") && b.includes("是") && b.includes("否"), b);
  await tab("stores"); b = await body();
  check(g, "stores tab uses owner_email/store_name", b.includes("店A") && b.includes("b@x.com") && b.includes("抖店"), b);
  await tab("library"); b = await body();
  check(g, "library tab", b.includes("合同.pdf") && b.includes("b@x.com") && b.includes("2 次"), b);
  await tab("evidence"); b = await body();
  check(g, "evidence tab: size formatted", b.includes("pic.jpg") && b.includes("2 KB") && b.includes("image/jpeg"), b);
  await tab("logs"); b = await body();
  check(g, "logs tab", b.includes("device_block") && b.includes("測試") && b.includes("a@x.com"), b);
  await tab("settings"); b = await body();
  check(g, "settings tab shows version + 3h", b.includes("6.7.1") && b.includes("3 小时"), b);
  await tab("users"); b = await body();
  check(g, "users tab keeps working", b.includes("a@x.com") && b.includes("boss@x.com"), b);
  // admins tab
  await tab("admins"); b = await body();
  const btns = await page.evaluate("[...document.querySelectorAll('#admList button')].map(x=>x.textContent)");
  check(g, "admins tab: self has NO remove button, other admin does", btns.length === 1 && btns[0] === "移除" && b.includes("当前账号"), JSON.stringify(btns));
  await page.fill("#admNewEmail", "new@x.com"); await page.click('button:text-is("添加")'); await settle(page);
  let c = await calls(page, "admin_add_user_by_email");
  check(g, "add admin sends {p_email}", c.length === 1 && c[0].args.p_email === "new@x.com", JSON.stringify(c));
  await page.click('#admList button:text-is("移除")'); await settle(page);
  c = await calls(page, "admin_remove_user");
  check(g, "remove admin sends {p_user_id}", c.length === 1 && c[0].args.p_user_id === "u3", JSON.stringify(c));
  const nBefore = (await calls(page, "admin_remove_user")).length;
  await page.evaluate("adminRemoveUser('u1')");
  check(g, "cannot remove self (no RPC sent)", (await calls(page, "admin_remove_user")).length === nBefore);
  await page.evaluate("window.__confirm=false");
  await page.click('#admList button:text-is("移除")'); await settle(page);
  check(g, "remove admin cancelled by confirm -> no RPC", (await calls(page, "admin_remove_user")).length === nBefore);
  await page.evaluate("window.__confirm=true");
  // server returns ok:false -> must show message, not crash
  await page.evaluate("window.__mode.adminOp={data:{ok:false,message:'找不到该注册账号'},error:null}");
  await page.fill("#admNewEmail", "nobody@x.com"); await page.click('button:text-is("添加")'); await settle(page);
  check(g, "add admin: server ok:false message surfaced", (await text(page, "#toast")).includes("找不到") || (await page.evaluate("document.body.innerText")).includes("找不到该注册账号"));
  // exit
  await page.evaluate("exitAdmin()");
  check(g, "退出后台 closes the panel", await page.evaluate("document.getElementById('modal').classList.contains('hidden')"));
  check(g, "no page errors", !(page.__errs || []).length, JSON.stringify(page.__errs));
  await ctx.close();
  // RPC error shown, not crash
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok", admin: true, rows, rpcErr: { admin_list_logs: "没有管理员权限" } }, existing: true });
    await page.evaluate("adminPanel()"); await settle(page);
    await page.evaluate("adminGo('logs')"); await settle(page);
    check(g, "RPC error is displayed in panel", (await text(page, "#adminBody")).includes("没有管理员权限"));
    await ctx.close();
  }
  // non-admin: no panel, no admin RPC
  {
    const { ctx, page } = await open(browser, htmlPath, { mode: { device: "ok", admin: false, rows }, existing: true });
    await page.evaluate("isAdmin=false;adminGo('logs')"); await settle(page);
    const names = (await page.evaluate("window.__calls.map(c=>c.name)")).filter((n) => n.startsWith("admin_"));
    check(g, "non-admin: adminGo does nothing, zero admin RPCs", names.length === 0, JSON.stringify(names));
    check(g, "non-admin: 管理后台 button hidden", await page.evaluate("document.getElementById('adminBtn').classList.contains('hidden')"));
    await ctx.close();
  }
}

(async () => {
  const [newHtml, origHtml] = process.argv.slice(2);
  const browser = await chromium.launch();
  await gateScenarios(browser, origHtml, "ORIGINAL");
  await gateScenarios(browser, newHtml, "NEW");
  await newOnlyScenarios(browser, newHtml);
  await adminScenarios(browser, newHtml);
  await accountScenarios(browser, newHtml);
  await restoreScenarios(browser, newHtml);
  await browser.close();

  let bad = 0;
  for (const grp of ["ORIGINAL", "NEW", "ADMIN", "ACCOUNT", "RESTORE"]) {
    console.log(`\n== ${grp} ==`);
    for (const r of results.filter((x) => x.group === grp)) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "   <- " + r.detail}`);
      if (grp !== "ORIGINAL" && !r.ok) bad++;
    }
  }
  const origBugs = results.filter((r) => r.group === "ORIGINAL" && !r.ok).length;
  console.log(`\nORIGINAL index.html: ${origBugs} check(s) failed (bugs reproduced)`);
  console.log(`NEW index.html: ${bad} failure(s)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
