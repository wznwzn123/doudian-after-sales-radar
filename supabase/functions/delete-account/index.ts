// 自助注销账号：输入当前密码 + 输入「注销」两个字确认后，删除这个账号的全部数据，无法恢复。
// 顺序：① 校验（登录身份、不是管理员、确认文字、当前密码，30 分钟内错 5 次锁定）
//       ② 删证据桶里这个账号的全部文件（user_storage_paths；Storage 接口分批删，删完再查一遍，没删干净就停下、不删账号 —— 避免留下孤儿文件）
//       ③ 发「账号已注销」邮件到登录邮箱和提醒邮箱（发不出去不影响注销）
//       ④ auth.admin.deleteUser —— 售后、事件、举证、资料库、店铺、快递记录、客服消息、登录记录等都会级联删除
//       ⑤ delete_user_extras：删不会级联的设备 / 安全事件 / 计数 / 封禁记录，写一条审计日志（审计日志保留）
// 管理员账号不能自助注销（先由超级管理员移除管理员身份）。需要 v6_37 SQL 第 3 段。部署时 verify_jwt=false，身份在下面自己校验。
import { createClient } from "npm:@supabase/supabase-js@2";
import { fmtCN, maskEmail, maskPhone, smtpConfig } from "./lib.ts";
import { sendMail } from "./mail.ts";

const DEV_EMAIL = "1012968575@qq.com";
const BUCKET = "after-sales-evidence";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method", "Method not allowed");
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return fail(401, "no_session", "请先登录");
  const url = Deno.env.get("SUPABASE_URL")!;
  const pubKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const caller = createClient(url, pubKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: ue } = await caller.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (ue || !u?.user) return fail(401, "bad_session", "登录已失效，请重新登录");
  const me = u.user, uid = me.id;
  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) return fail(503, "not_configured", "服务端缺少密钥");
  const svc = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (String(body.confirm || "").trim() !== "注销") return fail(400, "confirm", "请输入「注销」两个字确认");

  const adm = await caller.rpc("is_admin");
  if (adm.error) return fail(503, "check_failed", "暂时无法确认账号身份，请稍后再试");
  if (adm.data === true) return fail(403, "admin", "管理员账号不能自助注销。请先由超级管理员移除管理员身份，或联系 " + DEV_EMAIL);
  const rv = await caller.rpc("is_session_revoked");
  if (!rv.error && rv.data === true) return fail(401, "revoked", "这台设备的登录已失效，请重新登录");

  // 当前密码：30 分钟内错 5 次锁定（服务端计数）
  const pw = String(body.password || "");
  if (!pw) return fail(400, "no_password", "请输入当前密码");
  const tmp = createClient(url, pubKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const cred = me.email ? { email: String(me.email), password: pw } : { phone: "+" + String(me.phone || "").replace(/^\+/, ""), password: pw };
  const si = await tmp.auth.signInWithPassword(cred as any);
  if (si.error || si.data?.user?.id !== uid) {
    if (si.error && !/invalid login credentials|invalid_credentials/i.test(String(si.error.message) + " " + String((si.error as any).code || ""))) return fail(503, "pw_check_failed", "暂时无法验证密码，请稍后再试");
    const q = await svc.rpc("take_quota", { p_user: uid, p_bucket: "delete_pw_fail", p_limit: 4, p_window_seconds: 1800 });
    return fail(400, "wrong_password", !q.error && q.data === false ? "密码错误次数太多，请 30 分钟后再试" : "当前密码不对");
  }
  const lock = await svc.from("quota_counters").select("n,window_start").eq("user_id", uid).eq("bucket", "delete_pw_fail").maybeSingle();
  if (lock.data && Number(lock.data.n) > 4 && Date.now() - Date.parse(lock.data.window_start) < 1800000) return fail(429, "pw_locked", "密码错误次数太多，请 30 分钟后再试");
  try { await tmp.auth.signOut({ scope: "local" }); } catch { /* ignore */ }

  // ② 文件
  const list = async (): Promise<string[] | null> => { const r = await svc.rpc("user_storage_paths", { p_user: uid }); if (r.error) { console.error("user_storage_paths failed", r.error.message); return null; } return (Array.isArray(r.data) ? r.data : []).map((x: any) => typeof x === "string" ? x : x?.user_storage_paths).filter(Boolean); };
  const paths = await list();
  if (!paths) return fail(503, "not_installed", "注销功能还没有开通（管理员需要先执行数据库升级 SQL）");
  for (let i = 0; i < paths.length; i += 100) {
    const del = await svc.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (del.error) { console.error("storage remove failed", del.error.message); return fail(500, "files", "删除文件失败，账号没有注销，请稍后再试"); }
  }
  const left = await list();
  if (!left || left.length) return fail(500, "files", "还有文件没删干净，账号没有注销，请稍后再试");

  // ③ 邮件
  const label = me.email ? String(me.email) : "手机 " + maskPhone(me.phone);
  const smtp = smtpConfig((k) => Deno.env.get(k));
  if (smtp.ok) {
    const row = await svc.from("login_alert_emails").select("email,verified_at").eq("user_id", uid).maybeSingle();
    const to = [...new Set([me.email && me.email_confirmed_at ? String(me.email) : "", row.data?.verified_at ? String(row.data.email || "") : ""].filter(Boolean).map((x) => x.toLowerCase()))];
    const text = "你好！\n\n你的售后雷达账号 " + label + " 已于 " + fmtCN(new Date().toISOString()) + " 注销，账号里的售后、举证文件、资料库、店铺等数据已全部删除，无法恢复。\n\n如果不是你本人操作，请马上发邮件给 " + DEV_EMAIL + "。\n\n— 售后雷达（这封邮件由系统自动发送，请不要直接回复）";
    for (const t of to) { try { await sendMail(smtp.cfg, t, "【售后雷达】你的账号已注销", text); } catch (e) { console.error("goodbye mail failed", (e as Error).message); } }
  }

  // ④ ⑤ 账号和其余记录
  const del = await svc.auth.admin.deleteUser(uid);
  if (del.error) { console.error("deleteUser failed", del.error.message); return fail(500, "delete_failed", "文件已删除，但账号注销失败，请稍后再试或联系 " + DEV_EMAIL); }
  const ex = await svc.rpc("delete_user_extras", { p_user: uid, p_label: me.email ? maskEmail(me.email) : "手机 " + maskPhone(me.phone) });
  if (ex.error) console.error("delete_user_extras failed", ex.error.message);
  return reply(200, { ok: true, files: paths.length });
});
