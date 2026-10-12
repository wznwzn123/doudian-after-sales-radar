// 手机号注册的账号自助找回密码：如果这个账号绑定并验证过「提醒邮箱」，把 6 位验证码发到提醒邮箱，输对后设置新密码。
// 不需要登录就能调用，所以：
//   * 不暴露「这个手机号有没有注册 / 有没有绑邮箱」—— 发验证码一律回同一句话，验证失败一律回「验证码不对或已过期」；
//   * 限次（服务端 take_quota，按打码后的 IP / 手机号哈希 / 全站计数）：同一 IP 每小时 10 次，同一手机号每天 5 次，全站每天 300 次；
//     验证码 10 分钟有效、错 5 次作废；同一账号 60 秒内只发一次、每天最多 5 次（和绑定邮箱共用计数）；
//   * 重置成功后作废这个账号的所有登录（service_revoke_all_sessions），写操作日志，并邮件通知提醒邮箱。
// 需要 v6_37 SQL 第 3 段（auth_user_by_phone、service_revoke_all_sessions、login_alert_emails.rst_*）。部署时 verify_jwt=false。
import { createClient } from "npm:@supabase/supabase-js@2";
import { fmtCN, genCode, hashCode, maskEmail, maskPhone, normPhone, passwordMail, smtpConfig, strongPassword } from "./lib.ts";
import { sendMail } from "./mail.ts";

const DEV_EMAIL = "1012968575@qq.com";
const CODE_TTL_MS = 10 * 60 * 1000, RESEND_MS = 60 * 1000, DAY_MS = 24 * 3600 * 1000, MAX_PER_DAY = 5, MAX_TRIES = 5;
const ALL = "00000000-0000-0000-0000-000000000000";
const SENT_MSG = "如果这个手机号已经注册，并且绑定了提醒邮箱，验证码已经发到那个邮箱（10 分钟内有效）。收不到的话，请联系管理员重置密码：" + DEV_EMAIL;
const BAD_CODE = "验证码不对或已过期，请重新获取";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const fail = (status: number, code: string, message: string) => reply(status, { ok: false, code, message });

function envKey(jsonName: string, legacyName: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) || "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get(legacyName) || "";
}
async function h(x: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("radar-reset:" + x));
  return Array.from(new Uint8Array(b)).slice(0, 12).map((v) => v.toString(16).padStart(2, "0")).join("");
}
const resetCodeMail = (code: string) => ({
  subject: "【售后雷达】重置密码的验证码：" + code,
  text: "你好！\n\n你正在用手机号找回售后雷达的登录密码，验证码是：\n\n    " + code + "\n\n10 分钟内有效。如果不是你本人操作，请忽略这封邮件，你的密码不会改变；也建议你登录后修改密码。\n\n— 售后雷达",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method", "Method not allowed");
  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) return fail(503, "not_configured", "服务暂时不可用");
  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || "");
  const phone = normPhone(body.phone);
  if (!phone) return fail(400, "bad_phone", "请输入正确的中国大陆手机号（13～19 开头的 11 位数字）");
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  // 限次：计数函数出错时拒绝（这个接口不需要登录，宁可暂时不能用）
  const take = async (bucket: string, limit: number, seconds: number): Promise<boolean> => {
    const r = await svc.rpc("take_quota", { p_user: ALL, p_bucket: bucket, p_limit: limit, p_window_seconds: seconds });
    if (r.error) { console.error("reset quota failed", r.error.message); return false; }
    return r.data === true;
  };

  try {
    if (action === "send") {
      if (!(await take("pr_ip:" + await h(ip), 10, 3600)) || !(await take("pr_phone:" + await h(phone), 5, 86400)) || !(await take("pr_all", 300, 86400))) return fail(429, "too_many", "请求太频繁了，请稍后再试");
      const smtp = smtpConfig((k) => Deno.env.get(k));
      const u = await svc.rpc("auth_user_by_phone", { p_phone: phone });
      const uid = !u.error && typeof u.data === "string" ? u.data : "";
      if (u.error) console.error("auth_user_by_phone failed", u.error.message);
      if (uid && smtp.ok) {
        const got = await svc.from("login_alert_emails").select("*").eq("user_id", uid).maybeSingle();
        const row: any = got.data;
        const now = Date.now();
        const last = row?.last_sent_at ? Date.parse(row.last_sent_at) : 0;
        const fresh = !row?.sent_window || now - Date.parse(row.sent_window) > DAY_MS;
        const count = fresh ? 0 : Number(row?.sent_count || 0);
        if (row?.email && row?.verified_at && now - last >= RESEND_MS && count < MAX_PER_DAY) {
          const code = genCode();
          const up = await svc.from("login_alert_emails").update({ rst_code_hash: await hashCode(uid, "reset:" + code), rst_code_expires: new Date(now + CODE_TTL_MS).toISOString(), rst_tries: 0, last_sent_at: new Date(now).toISOString(), sent_count: count + 1, sent_window: fresh ? new Date(now).toISOString() : row.sent_window, updated_at: new Date(now).toISOString() }).eq("user_id", uid);
          if (up.error) console.error("reset code save failed", up.error.message);
          else {
            const m = resetCodeMail(code);
            try { await sendMail(smtp.cfg, row.email, m.subject, m.text); } catch (e) { console.error("reset code mail failed", (e as Error).message); }
          }
        }
      }
      return reply(200, { ok: true, message: SENT_MSG });
    }

    if (action === "reset") {
      const np = String(body.new_password || "");
      if (!strongPassword(np)) return fail(400, "weak", "新密码不符合要求：至少 8 位，包含大写、小写、数字和特殊字符");
      if (!(await take("pr_try_ip:" + await h(ip), 20, 3600))) return fail(429, "too_many", "请求太频繁了，请稍后再试");
      const code = String(body.code || "").trim();
      const u = await svc.rpc("auth_user_by_phone", { p_phone: phone });
      const uid = !u.error && typeof u.data === "string" ? u.data : "";
      if (!uid) return fail(400, "bad_code", BAD_CODE);
      const got = await svc.from("login_alert_emails").select("*").eq("user_id", uid).maybeSingle();
      const row: any = got.data;
      if (!row?.rst_code_hash || !row?.rst_code_expires || Date.parse(row.rst_code_expires) <= Date.now() || Number(row.rst_tries || 0) >= MAX_TRIES) return fail(400, "bad_code", BAD_CODE);
      if (!/^\d{6}$/.test(code) || (await hashCode(uid, "reset:" + code)) !== row.rst_code_hash) {
        const tries = Number(row.rst_tries || 0) + 1;
        await svc.from("login_alert_emails").update(tries >= MAX_TRIES ? { rst_tries: tries, rst_code_hash: null, rst_code_expires: null } : { rst_tries: tries }).eq("user_id", uid);
        return fail(400, "bad_code", tries >= MAX_TRIES ? "验证码错误次数太多，已作废，请重新获取" : BAD_CODE);
      }
      const up = await svc.auth.admin.updateUserById(uid, { password: np } as any);
      if (up.error) { console.error("reset password update failed", up.error.message); return fail(500, "update_failed", "重置失败，请稍后再试"); }
      await svc.from("login_alert_emails").update({ rst_code_hash: null, rst_code_expires: null, rst_tries: 0, pw_fail_count: 0, pw_fail_at: null, updated_at: new Date().toISOString() }).eq("user_id", uid);
      const rv = await svc.rpc("service_revoke_all_sessions", { p_user: uid });
      if (rv.error) console.error("revoke after reset failed", rv.error.message);
      const lg = await svc.from("admin_operation_logs").insert({ user_id: uid, action: "reset_password_self", detail: "用手机号 + 提醒邮箱验证码重置了密码（" + maskPhone(phone) + "），所有设备已退出" });
      if (lg.error) console.error("reset log failed", lg.error.message);
      const smtp = smtpConfig((k) => Deno.env.get(k));
      if (smtp.ok && row.email) {
        const m = passwordMail({ account: "手机 " + maskPhone(phone), at: fmtCN(new Date().toISOString()), contact: DEV_EMAIL });
        try { await sendMail(smtp.cfg, row.email, m.subject, m.text); } catch (e) { console.error("reset notice mail failed", (e as Error).message); }
      }
      return reply(200, { ok: true, message: "密码已重置，所有设备上的旧登录都已退出。请用新密码登录。", email: row.email ? maskEmail(row.email) : "" });
    }

    return fail(400, "bad_action", "未知操作");
  } catch (e) {
    console.error("phone-password-reset", action, (e as Error).message);
    return fail(500, "server", "服务暂时不可用，请稍后再试");
  }
});
