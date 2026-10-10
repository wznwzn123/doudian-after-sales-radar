// 按需查询物流：前端点按钮 -> 本函数 -> 快递100 实时查询 -> 写回 tracking_records.last_match + 事件。
// 快递100 的 customer / key 只放在 Supabase Edge Function Secrets（KUAIDI100_CUSTOMER / KUAIDI100_KEY），不进前端、不进仓库。
// 数据库读写都用「调用者自己的登录身份」（受 RLS 限制），所以只能查自己的售后；本函数不需要 service_role / secret key。
// 部署时关闭平台的 JWT 校验（verify_jwt=false），身份在下面用 auth.getUser() 自己校验。
import { createClient } from "npm:@supabase/supabase-js@2";
import { CARRIER_CODES, CONFIG_ERRORS, MIN_INTERVAL_MS, PHONE_REQUIRED, QUERY_URL, buildRequest, normalizeNo, parseResponse, validPhone } from "./lib.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => reply(status, { ok: false, code, message, ...extra });

function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method", "Method not allowed");

  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return fail(401, "no_session", "请先登录");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: ue } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (ue || !u?.user) return fail(401, "bad_session", "登录已失效，请重新登录");
  const uid = u.user.id;

  // 粘贴时常带进空格/换行，会导致签名失败，去掉
  const customer = (Deno.env.get("KUAIDI100_CUSTOMER") || "").trim();
  const key = (Deno.env.get("KUAIDI100_KEY") || "").trim();
  if (!customer || !key) return fail(503, "not_configured", "快递100 还没有配置：请在 Supabase 的 Edge Functions → Secrets 里填写 KUAIDI100_CUSTOMER 和 KUAIDI100_KEY");

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const taskId = String(body.task_id || "");
  const phone = String(body.phone || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail(400, "bad_task", "售后编号不正确");
  if (phone && !validPhone(phone)) return fail(400, "bad_phone", "手机号请填后四位或完整 11 位");

  // RLS 保证只能读到自己的售后；读不到就是不存在或不属于你
  const t = await sb.from("after_sales_tasks").select("id,user_id,tracking_no").eq("id", taskId).maybeSingle();
  if (t.error) return fail(500, "db", "读取售后失败：" + t.error.message);
  if (!t.data || t.data.user_id !== uid) return fail(404, "not_found", "售后不存在");
  const rr = await sb.from("tracking_records").select("id,tracking_no,carrier").eq("task_id", taskId).order("created_at", { ascending: true }).limit(1);
  if (rr.error) return fail(500, "db", "读取快递记录失败：" + rr.error.message);
  const rec = rr.data?.[0] || null;

  const num = normalizeNo(rec?.tracking_no || t.data.tracking_no);
  if (!/^[A-Za-z0-9-]{6,32}$/.test(num)) return fail(400, "no_number", "请先在「快递」里保存正确的快递单号");
  const com = CARRIER_CODES[rec?.carrier || ""];
  if (!com) return fail(400, "no_carrier", "请先在「快递」里选择具体的承运商（不能是「其他」）");
  if (PHONE_REQUIRED.has(com) && !phone) return fail(400, "need_phone", "顺丰、中通需要填写收件人或寄件人手机号后四位");

  // 频率限制：同一售后 30 分钟内只查一次（以 tracking_queried 事件为准）
  const since = new Date(Date.now() - MIN_INTERVAL_MS).toISOString();
  const recent = await sb.from("after_sales_events").select("created_at").eq("task_id", taskId).eq("event_type", "tracking_queried").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  if (recent.error) return fail(500, "db", "读取查询记录失败：" + recent.error.message);
  if (recent.data?.length) {
    const wait = Math.ceil((new Date(recent.data[0].created_at).getTime() + MIN_INTERVAL_MS - Date.now()) / 60000);
    return fail(429, "too_soon", "同一单号 30 分钟内只能查一次，请约 " + Math.max(wait, 1) + " 分钟后再查");
  }

  const { body: form } = buildRequest({ com, num, phone: phone || undefined, customer, key });
  let j: unknown;
  try {
    const r = await fetch(QUERY_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(15000) });
    j = await r.json();
  } catch (e) {
    return fail(502, "upstream", "连接快递100 失败：" + (e instanceof Error ? e.message : String(e)));
  }
  const p = parseResponse(j);
  const now = new Date().toISOString();
  if (!p.ok) {
    // 和单号有关的失败（查不到、电话不对、太频繁）也计入 30 分钟频率限制（快递100 对频繁查询会锁单）；
    // 签名错误、额度用完这类配置问题不计入，修好后可以马上重试
    const counts = !CONFIG_ERRORS.has(p.code);
    await sb.from("after_sales_events").insert({ user_id: uid, task_id: taskId, event_type: counts ? "tracking_queried" : "tracking_query_failed", message: "快递100 查询失败：" + p.message });
    return fail(502, "kuaidi100_" + p.code, p.message);
  }

  // 走到这里 rec 一定存在（承运商来自它）
  const w = await sb.from("tracking_records").update({ tracking_no: num, last_match: p.lastMatch, updated_at: now }).eq("id", rec!.id);
  if (w.error) return fail(500, "db", "保存物流状态失败：" + w.error.message);
  await sb.from("after_sales_events").insert({ user_id: uid, task_id: taskId, event_type: "tracking_queried", message: "快递100：" + p.lastMatch });

  return reply(200, { ok: true, state: p.state, state_text: p.stateText, signed: p.signed, latest: p.latest, count: p.count, last_match: p.lastMatch });
});
