// 管理员给用户重置密码：生成临时密码，只返回给管理员，由管理员私下告诉用户；用户登录后在「工作台设置 → 修改密码」改掉。
// 改别人密码必须用 secret（service_role）权限，所以放在服务端；密钥来自 Supabase 自动注入的环境变量，不在前端、不在仓库。
// 身份：用调用者自己的登录身份 auth.getUser() 校验，再用 is_admin()（服务端 security definer）确认是管理员；不是就拒绝。
// 6.33：重置后用管理员自己的身份调 admin_revoke_user_sessions()（v6_33 SQL，服务端再校验一次管理员），让对方所有设备立刻退出登录；
//   函数还没装时只是不退出（和以前一样），重置照样成功。
// 6.34：重置别的管理员的密码 = 接管对方账号，所以先问服务端 admin_may_target()（v6_34 SQL）：只有超级管理员能重置普通管理员，谁都不能重置超级管理员。
//   v6_34 还没执行时保守处理：用 admin_list_all_users 查对方是不是管理员，是就拒绝（查不到也拒绝）。
// 部署时 verify_jwt=false（项目用新式 publishable/secret key），身份在下面自己校验。
import { createClient } from "npm:@supabase/supabase-js@2";
import { isUuid, strong, tempPassword } from "./lib.ts";

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
  const caller = createClient(url, envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: ue } = await caller.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (ue || !u?.user) return fail(401, "bad_session", "登录已失效，请重新登录");
  const adminId = u.user.id;

  const adm = await caller.rpc("is_admin");
  if (adm.error || adm.data !== true) return fail(403, "forbidden", "没有管理员权限");

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const target = String(body.user_id || "");
  if (!isUuid(target)) return fail(400, "bad_user", "用户编号不正确");
  if (target === adminId) return fail(400, "self", "不能在这里重置自己的密码，请到「工作台设置 → 修改密码」");

  const mt = await caller.rpc("admin_may_target", { p_user: target });
  if (mt.error) {
    const all = await caller.rpc("admin_list_all_users");
    const row = !all.error && Array.isArray(all.data) ? all.data.find((x: any) => x.id === target) : null;
    if (all.error || !row || row.is_admin) return fail(403, "admin_target", "不能重置管理员的密码");
  } else if (mt.data !== true) return fail(403, "admin_target", "不能重置其他管理员的密码（只有超级管理员可以，且不能重置超级管理员）");

  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) return fail(503, "not_configured", "服务端缺少管理密钥，无法重置密码");
  const svc = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const found = await svc.auth.admin.getUserById(target);
  if (found.error || !found.data?.user) return fail(404, "not_found", "找不到该账号");
  const t = found.data.user;
  const label = t.email || (t.phone ? "手机 " + String(t.phone).replace(/^86(?=1\d{10}$)/, "") : target.slice(0, 8));

  const password = tempPassword();
  if (!strong(password)) return fail(500, "weak", "临时密码生成失败，请重试");
  const up = await svc.auth.admin.updateUserById(target, { password });
  if (up.error) return fail(500, "update_failed", "重置失败：" + up.error.message);

  // 审计：谁在什么时候重置了谁的密码（不记录密码本身）
  // （需要 v6_24 SQL 里的 grant insert ... to service_role；写失败不影响重置结果，但要在函数日志里看得到）
  const lg = await svc.from("admin_operation_logs").insert({ user_id: adminId, action: "reset_password", detail: "重置了 " + label + " 的密码" });
  if (lg.error) console.error("audit log insert failed", lg.error.message);

  let signedOut = false, sessions = 0;
  const rv = await caller.rpc("admin_revoke_user_sessions", { p_user_id: target });
  if (!rv.error && rv.data?.ok) { signedOut = true; sessions = Number(rv.data.sessions || 0); }
  else console.error("admin_revoke_user_sessions failed", rv.error?.message || rv.data?.message);

  return reply(200, { ok: true, password, account: label, signed_out: signedOut, sessions });
});
