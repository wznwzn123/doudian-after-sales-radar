// 新设备登录邮件提醒 + 绑定提醒邮箱（发 6 位验证码确认邮箱是本人的）。
// 发信用的邮箱账号和授权码在 Edge Function Secrets（SMTP_USER / SMTP_PASS，可选 SMTP_HOST / SMTP_PORT / SMTP_FROM_NAME），不在前端、不在仓库。
// 提醒邮箱存在 login_alert_emails 表（前端不能直接读写），不改 auth.users 的 email —— 所以不影响「手机号账号要审核」的判断。
// 身份：auth.getUser() 校验调用者；待审核 / 被封的账号不能绑定（用调用者自己的身份调 my_account_status / is_user_banned，在服务端判断）。
// 部署时 verify_jwt=false（项目用新式 publishable/secret key），身份在下面自己校验。
import { createClient } from "npm:@supabase/supabase-js@2";
import { alertMail, codeMail, fmtCN, genCode, hashCode, isEmail, maskEmail, maskPhone, smtpConfig } from "./lib.ts";
import { sendMail } from "./mail.ts";

const DEV_EMAIL = "1012968575@qq.com";
const CODE_TTL_MS = 10 * 60 * 1000, RESEND_MS = 60 * 1000, DAY_MS = 24 * 3600 * 1000, MAX_PER_DAY = 5, MAX_TRIES = 5;
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
  const caller = createClient(url, envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
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
  if (got.error) return fail(503, "not_installed", "邮件提醒功能还没有开通（管理员需要先执行数据库升级 SQL）");
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

  try {
    if (action === "status") return okStatus();

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
      const now = Date.now();
      const last = row?.last_sent_at ? Date.parse(row.last_sent_at) : 0;
      if (now - last < RESEND_MS) return fail(429, "too_fast", "验证码已经发出，请 " + Math.ceil((RESEND_MS - (now - last)) / 1000) + " 秒后再试");
      const fresh = !row?.sent_window || now - Date.parse(row.sent_window) > DAY_MS;
      const count = fresh ? 0 : Number(row.sent_count || 0);
      if (count >= MAX_PER_DAY) return fail(429, "too_many", "今天发送验证码的次数太多了，请明天再试");
      const code = genCode();
      await save({
        pending_email: email, code_hash: await hashCode(uid, code), code_expires: new Date(now + CODE_TTL_MS).toISOString(), code_tries: 0,
        last_sent_at: new Date(now).toISOString(), sent_count: count + 1, sent_window: fresh ? new Date(now).toISOString() : row.sent_window,
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
