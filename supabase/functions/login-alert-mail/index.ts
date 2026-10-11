// 新设备登录邮件提醒 + 绑定提醒邮箱（发 6 位验证码确认邮箱是本人的）。
// 发信用的邮箱账号和授权码在 Edge Function Secrets（SMTP_USER / SMTP_PASS，可选 SMTP_HOST / SMTP_PORT / SMTP_FROM_NAME），不在前端、不在仓库。
// 提醒邮箱存在 login_alert_emails 表（前端不能直接读写），不改 auth.users 的 email —— 所以不影响「手机号账号要审核」的判断。
// 身份：auth.getUser() 校验调用者；待审核 / 被封的账号不能绑定（用调用者自己的身份调 my_account_status / is_user_banned，在服务端判断）。
// 6.25 换绑：同一个函数里还有「换绑登录手机号 / 登录邮箱」（change_phone、email_change_code、email_change_verify），
//   都要先输入当前密码（服务端用临时会话验证后立刻注销这个临时会话）；新邮箱要收验证码；手机号没有短信验证（和注册一样），只做号段检查。
//   改账号本身的手机号/邮箱必须用 secret key 的 auth.admin.updateUserById，所以只能在服务端做。
// 部署时 verify_jwt=false（项目用新式 publishable/secret key），身份在下面自己校验。
import { createClient } from "npm:@supabase/supabase-js@2";
import { alertMail, changedMail, codeMail, fmtCN, genCode, hashCode, isEmail, maskEmail, maskPhone, normPhone, smtpConfig } from "./lib.ts";
import { sendMail } from "./mail.ts";

const DEV_EMAIL = "1012968575@qq.com";
const CODE_TTL_MS = 10 * 60 * 1000, RESEND_MS = 60 * 1000, DAY_MS = 24 * 3600 * 1000, MAX_PER_DAY = 5, MAX_TRIES = 5;
const PW_LOCK_MS = 30 * 60 * 1000, PW_MAX_FAILS = 5;
const NEW_DEVICE_MS = 15 * 60 * 1000; // 设备第一次出现 15 分钟内才算「刚登录的新设备」

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => reply(status, { ok: false, code, message, ...extra });

function envKey(jsonName: string, legacyName: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) || "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get(legacyName) || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method", "Method not allowed");

  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return fail(401, "no_session", "请先登录");
  const url = Deno.env.get("SUPABASE_URL")!;
  const pubKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const caller = createClient(url, pubKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: ue } = await caller.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (ue || !u?.user) return fail(401, "bad_session", "登录已失效，请重新登录");
  const me = u.user, uid = me.id;

  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) return fail(503, "not_configured", "服务端缺少密钥");
  const svc = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || "status");

  const got = await svc.from("login_alert_emails").select("*").eq("user_id", uid).maybeSingle();
  if (got.error) return fail(503, "not_installed", "这个功能还没有开通（管理员需要先执行数据库升级 SQL）");
  let row: any = got.data;
  const save = async (patch: Record<string, unknown>) => {
    const p = { ...patch, updated_at: new Date().toISOString() };
    const r = row ? await svc.from("login_alert_emails").update(p).eq("user_id", uid) : await svc.from("login_alert_emails").insert({ user_id: uid, ...p });
    if (r.error) throw new Error(r.error.message);
    row = { ...(row || { user_id: uid }), ...p };
  };

  const smtp = smtpConfig((k) => Deno.env.get(k));
  const status = () => ({
    configured: smtp.ok,
    email: row?.email && row?.verified_at ? maskEmail(row.email) : "",
    pending_email: row?.pending_email && row?.code_expires && Date.parse(row.code_expires) > Date.now() ? maskEmail(row.pending_email) : "",
    declined: !!row?.prompt_declined_at,
    phone_only: !me.email,
    account_email: me.email && me.email_confirmed_at ? maskEmail(me.email) : "",
    chg_email: row?.chg_email && row?.chg_code_expires && Date.parse(row.chg_code_expires) > Date.now() ? maskEmail(row.chg_email) : "",
  });
  const okStatus = (extra: Record<string, unknown> = {}) => reply(200, { ok: true, ...extra, status: status() });
  const account = me.email ? String(me.email) : "手机 " + maskPhone(me.phone);

  // 绑定 / 改邮箱前：待审核、被封的账号不行（防止陌生人注册手机号后拿这里给别人发邮件）
  const mayBind = async (): Promise<string> => {
    const st = await caller.rpc("my_account_status");
    if (!st.error && st.data?.pending) return "账号还在等待管理员审核，审核通过后才能绑定邮箱";
    const bn = await caller.rpc("is_user_banned", { p_user_id: uid });
    if (!bn.error && bn.data === true) return "账号已被封禁";
    return "";
  };

  // 验证当前密码：用临时客户端登录一次，成功后只注销这个临时会话（scope local，不影响用户正在用的会话）。30 分钟内错 5 次锁定。
  const checkPassword = async (pw: string): Promise<Response | null> => {
    const now = Date.now();
    const fails = row?.pw_fail_at && now - Date.parse(row.pw_fail_at) < PW_LOCK_MS ? Number(row.pw_fail_count || 0) : 0;
    if (fails >= PW_MAX_FAILS) return fail(429, "pw_locked", "密码错误次数太多，请 30 分钟后再试");
    if (!pw) return fail(400, "no_password", "请输入当前密码");
    const tmp = createClient(url, pubKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const cred = me.email ? { email: String(me.email), password: pw } : { phone: "+" + String(me.phone || "").replace(/^\+/, ""), password: pw };
    const r = await tmp.auth.signInWithPassword(cred as any);
    if (r.error || r.data?.user?.id !== uid) {
      if (r.error && !/invalid login credentials|invalid_credentials/i.test(String(r.error.message) + " " + String((r.error as any).code || ""))) {
        console.error("password check failed", r.error.message);
        return fail(503, "pw_check_failed", "暂时无法验证密码，请稍后再试");
      }
      await save({ pw_fail_count: fails + 1, pw_fail_at: new Date(now).toISOString() });
      return fail(400, "wrong_password", fails + 1 >= PW_MAX_FAILS ? "当前密码不对，错误次数太多，请 30 分钟后再试" : "当前密码不对（还可以再试 " + (PW_MAX_FAILS - fails - 1) + " 次）");
    }
    try { await tmp.auth.signOut({ scope: "local" }); } catch { /* 临时会话注销失败不影响结果 */ }
    if (row?.pw_fail_count) await save({ pw_fail_count: 0, pw_fail_at: null });
    return null;
  };

  // 发验证码的频率限制（绑定提醒邮箱和换绑登录邮箱共用）：60 秒一次，每天 5 次
  const sendLimit = (): Response | { count: number; window: string } => {
    const now = Date.now();
    const last = row?.last_sent_at ? Date.parse(row.last_sent_at) : 0;
    if (now - last < RESEND_MS) return fail(429, "too_fast", "验证码已经发出，请 " + Math.ceil((RESEND_MS - (now - last)) / 1000) + " 秒后再试");
    const fresh = !row?.sent_window || now - Date.parse(row.sent_window) > DAY_MS;
    const count = fresh ? 0 : Number(row.sent_count || 0);
    if (count >= MAX_PER_DAY) return fail(429, "too_many", "今天发送验证码的次数太多了，请明天再试");
    return { count, window: fresh ? new Date(now).toISOString() : row.sent_window };
  };

  // 换绑成功后：通知旧登录邮箱 + 提醒邮箱（尽力发送，失败不影响换绑），并写一条操作日志
  const afterChange = async (kind: "phone" | "email", oldEmail: string, nowLabel: string, detail: string) => {
    const lg = await svc.from("admin_operation_logs").insert({ user_id: uid, action: kind === "phone" ? "change_phone" : "change_email", detail });
    if (lg.error) console.error("change log insert failed", lg.error.message);
    if (!smtp.ok) return;
    const to = [...new Set([oldEmail, row?.verified_at ? row?.email : ""].filter(Boolean).map((x) => String(x).toLowerCase()))];
    const m = changedMail({ kind, account, now: nowLabel, at: fmtCN(new Date().toISOString()), contact: DEV_EMAIL });
    for (const t of to) {
      try { await sendMail(smtp.cfg, t, m.subject, m.text); } catch (e) { console.error("change mail failed", (e as Error).message); }
    }
  };
  const dupMsg = (msg: string, kind: string) => /already|exists|registered|duplicate|unique/i.test(msg) ? "这个" + kind + "已经被其他账号使用" : "换绑失败：" + msg;

  try {
    if (action === "status") return okStatus();

    if (action === "change_phone") {
      const phone = normPhone(body.phone);
      if (!phone) return fail(400, "bad_phone", "请输入正确的中国大陆手机号（13～19 开头的 11 位数字）");
      if (phone.slice(1) === String(me.phone || "").replace(/^\+/, "")) return fail(400, "same", "新手机号和现在的一样");
      const why = await mayBind(); if (why) return fail(403, "forbidden", why);
      const pw = await checkPassword(String(body.password || "")); if (pw) return pw;
      const up = await svc.auth.admin.updateUserById(uid, { phone, phone_confirm: true } as any);
      if (up.error) return fail(409, "update_failed", dupMsg(up.error.message, "手机号"));
      const shown = maskPhone(phone);
      await afterChange("phone", me.email ? String(me.email) : "", shown, "换绑登录手机号：" + (me.phone ? maskPhone(me.phone) : "无") + " → " + shown);
      return okStatus({ phone: shown });
    }

    if (action === "email_change_code") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!isEmail(email)) return fail(400, "bad_email", "邮箱格式不对");
      if (email === String(me.email || "").toLowerCase()) return fail(400, "same", "新邮箱和现在的一样");
      const why = await mayBind(); if (why) return fail(403, "forbidden", why);
      if (!smtp.ok) return fail(503, "smtp_missing", smtp.message);
      const lim = sendLimit(); if (lim instanceof Response) return lim;
      const pw = await checkPassword(String(body.password || "")); if (pw) return pw;
      const code = genCode(), now = Date.now();
      await save({ chg_email: email, chg_code_hash: await hashCode(uid, "login:" + code), chg_code_expires: new Date(now + CODE_TTL_MS).toISOString(), chg_tries: 0, last_sent_at: new Date(now).toISOString(), sent_count: lim.count + 1, sent_window: lim.window });
      const m = codeMail(code, "login");
      try { await sendMail(smtp.cfg, email, m.subject, m.text); } catch (e) {
        console.error("email_change mail failed", (e as Error).message);
        return fail(502, "send_failed", "验证码邮件发送失败，请检查邮箱地址，或稍后再试");
      }
      return okStatus({ sent_to: maskEmail(email) });
    }

    if (action === "email_change_verify") {
      const code = String(body.code || "").trim();
      if (!row?.chg_code_hash || !row?.chg_email) return fail(400, "no_code", "请先获取验证码");
      if (Date.parse(row.chg_code_expires) <= Date.now()) return fail(400, "expired", "验证码已过期，请重新获取");
      if (Number(row.chg_tries || 0) >= MAX_TRIES) return fail(429, "locked", "错误次数太多，请重新获取验证码");
      const why = await mayBind(); if (why) return fail(403, "forbidden", why);
      if (!/^\d{6}$/.test(code) || (await hashCode(uid, "login:" + code)) !== row.chg_code_hash) {
        const tries = Number(row.chg_tries || 0) + 1;
        await save({ chg_tries: tries });
        return fail(400, "wrong_code", tries >= MAX_TRIES ? "验证码不对，错误次数太多，请重新获取验证码" : "验证码不对（还可以再试 " + (MAX_TRIES - tries) + " 次）");
      }
      const email = String(row.chg_email), oldEmail = me.email ? String(me.email) : "";
      const up = await svc.auth.admin.updateUserById(uid, { email, email_confirm: true } as any);
      if (up.error) return fail(409, "update_failed", dupMsg(up.error.message, "邮箱"));
      // 还没有提醒邮箱的，顺便把这个已验证的新邮箱设为提醒邮箱
      const alertToo = !(row.email && row.verified_at);
      await save({ chg_email: null, chg_code_hash: null, chg_code_expires: null, chg_tries: 0, ...(alertToo ? { email, verified_at: new Date().toISOString(), prompt_declined_at: null } : {}) });
      await afterChange("email", oldEmail, maskEmail(email), "换绑登录邮箱：" + (oldEmail ? maskEmail(oldEmail) : "无") + " → " + maskEmail(email));
      return okStatus({ email: maskEmail(email), alert_set: alertToo });
    }

    if (action === "decline") {
      await save({ prompt_declined_at: new Date().toISOString() });
      return okStatus();
    }

    if (action === "remove") {
      if (row) await save({ email: null, verified_at: null, pending_email: null, code_hash: null, code_expires: null, code_tries: 0 });
      return okStatus();
    }

    if (action === "use_account_email") {
      if (!me.email || !me.email_confirmed_at) return fail(400, "no_account_email", "这个账号没有已验证的登录邮箱，请输入邮箱获取验证码");
      const why = await mayBind(); if (why) return fail(403, "forbidden", why);
      await save({ email: String(me.email).toLowerCase(), verified_at: new Date().toISOString(), pending_email: null, code_hash: null, code_expires: null, code_tries: 0, prompt_declined_at: null });
      return okStatus();
    }

    if (action === "send_code") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!isEmail(email)) return fail(400, "bad_email", "邮箱格式不对");
      const why = await mayBind(); if (why) return fail(403, "forbidden", why);
      if (!smtp.ok) return fail(503, "smtp_missing", smtp.message);
      const lim = sendLimit(); if (lim instanceof Response) return lim;
      const code = genCode(), now = Date.now();
      await save({
        pending_email: email, code_hash: await hashCode(uid, code), code_expires: new Date(now + CODE_TTL_MS).toISOString(), code_tries: 0,
        last_sent_at: new Date(now).toISOString(), sent_count: lim.count + 1, sent_window: lim.window,
      });
      const m = codeMail(code);
      try { await sendMail(smtp.cfg, email, m.subject, m.text); } catch (e) {
        console.error("send_code mail failed", (e as Error).message);
        return fail(502, "send_failed", "验证码邮件发送失败，请检查邮箱地址，或稍后再试");
      }
      return okStatus({ sent_to: maskEmail(email) });
    }

    if (action === "verify_code") {
      const code = String(body.code || "").trim();
      if (!row?.code_hash || !row?.pending_email) return fail(400, "no_code", "请先获取验证码");
      if (Date.parse(row.code_expires) <= Date.now()) return fail(400, "expired", "验证码已过期，请重新获取");
      if (Number(row.code_tries || 0) >= MAX_TRIES) return fail(429, "locked", "错误次数太多，请重新获取验证码");
      const why = await mayBind(); if (why) return fail(403, "forbidden", why);
      if (!/^\d{6}$/.test(code) || (await hashCode(uid, code)) !== row.code_hash) {
        const tries = Number(row.code_tries || 0) + 1;
        await save({ code_tries: tries });
        return fail(400, "wrong_code", tries >= MAX_TRIES ? "验证码不对，错误次数太多，请重新获取验证码" : "验证码不对（还可以再试 " + (MAX_TRIES - tries) + " 次）");
      }
      await save({ email: row.pending_email, verified_at: new Date().toISOString(), pending_email: null, code_hash: null, code_expires: null, code_tries: 0, prompt_declined_at: null });
      return okStatus();
    }

    if (action === "notify") {
      const deviceId = String(body.device_id || "").trim();
      if (!row?.email || !row?.verified_at) return okStatus({ sent: false, reason: "no_email" });
      if (!smtp.ok) return okStatus({ sent: false, reason: "smtp_missing" });
      if (deviceId.length < 8 || deviceId.length > 200) return okStatus({ sent: false, reason: "bad_device" });
      // 设备信息用调用者自己的身份从服务端函数取（只能拿到本人的设备），不信任前端传来的设备描述和时间
      const r = await caller.rpc("my_login_alerts", { p_device_id: deviceId });
      const d = !r.error && r.data?.ok ? (r.data.devices || []).find((x: any) => x.current) : null;
      if (!d) return okStatus({ sent: false, reason: "no_device" });
      const first = Date.parse(d.first_seen);
      if (!(first > Date.now() - NEW_DEVICE_MS) || !(first > Date.parse(row.verified_at))) return okStatus({ sent: false, reason: "not_new" });
      // 每台设备只发一次（主键 user_id + device_id 去重）
      const ins = await svc.from("login_alert_mails").insert({ user_id: uid, device_id: deviceId });
      if (ins.error) return okStatus({ sent: false, reason: ins.error.code === "23505" ? "already_sent" : "log_failed" });
      const m = alertMail({ account, device: d.name || d.platform || "", ip: d.ip || "", at: fmtCN(d.first_seen), contact: DEV_EMAIL });
      try { await sendMail(smtp.cfg, row.email, m.subject, m.text); } catch (e) {
        console.error("alert mail failed", (e as Error).message);
        await svc.from("login_alert_mails").delete().eq("user_id", uid).eq("device_id", deviceId);
        return okStatus({ sent: false, reason: "send_failed" });
      }
      return okStatus({ sent: true });
    }

    return fail(400, "bad_action", "未知操作");
  } catch (e) {
    console.error("login-alert-mail", action, (e as Error).message);
    return fail(500, "server", "服务暂时不可用，请稍后再试");
  }
});
