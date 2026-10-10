// End-to-end test of supabase/functions/kuaidi100-query/index.ts in Deno.
// Only the Supabase client (import map -> dev/kuaidi100-fakes/supabase.ts) and the 快递100 HTTP call (fetch) are fake.
// NOT a test against the real database or a real 快递100 account.
// Run: deno test --no-lock --config dev/kuaidi100-fakes/deno.json --allow-env --allow-read dev/kuaidi100.handler.test.ts
import { createHash } from "node:crypto";
import { state } from "./kuaidi100-fakes/supabase.ts";

let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {} as any; };
const env = new Map<string, string>([["SUPABASE_URL", "https://x.supabase.co"], ["SUPABASE_PUBLISHABLE_KEYS", '{"default":"sb_publishable_test"}']]);
(Deno.env as any).get = (k: string) => env.get(k);
(Deno.env as any).toObject = () => Object.fromEntries(env);
let calls: { url: string; body: string }[] = [];
let upstream: any = null;
(globalThis as any).fetch = async (url: string, init: any) => { calls.push({ url: String(url), body: String(init.body) }); return new Response(JSON.stringify(upstream)); };
await import("../supabase/functions/kuaidi100-query/index.ts");

const T1 = "11111111-1111-1111-1111-111111111111", T2 = "22222222-2222-2222-2222-222222222222", T3 = "33333333-3333-3333-3333-333333333333", TX = "99999999-9999-9999-9999-999999999999";
function seed() {
  state.db = {
    after_sales_tasks: [
      { id: T1, user_id: "u1", tracking_no: "YT123456789" },
      { id: T2, user_id: "u1", tracking_no: "SF123456789" },
      { id: T3, user_id: "u1", tracking_no: "ZZ123456789" },
      { id: TX, user_id: "u2", tracking_no: "YT999999999" },
    ],
    tracking_records: [
      { id: "k1", user_id: "u1", task_id: T1, tracking_no: "YT123456789", carrier: "圆通", monitoring: true, last_match: "", created_at: "2026-10-01" },
      { id: "k2", user_id: "u1", task_id: T2, tracking_no: "SF123456789", carrier: "顺丰", monitoring: true, last_match: "", created_at: "2026-10-01" },
      { id: "k3", user_id: "u1", task_id: T3, tracking_no: "ZZ123456789", carrier: "其他", monitoring: true, last_match: "", created_at: "2026-10-01" },
      { id: "kx", user_id: "u2", task_id: TX, tracking_no: "YT999999999", carrier: "圆通", monitoring: true, last_match: "", created_at: "2026-10-01" },
    ],
    after_sales_events: [],
  };
  calls = [];
}
const call = async (body: unknown, token: string | null = "tok-u1") => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await handler(new Request("https://x.supabase.co/functions/v1/kuaidi100-query", { method: "POST", headers: h, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json(), headers: r.headers };
};
const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const OK = { message: "ok", state: "0", status: "200", ischeck: "0", com: "yuantong", nu: "YT123456789", data: [{ time: "2026-10-10 14:20:00", ftime: "2026-10-10 14:20:00", context: "已到达上海转运中心" }] };

Deno.test("CORS preflight", async () => {
  const r = await handler(new Request("https://x/f", { method: "OPTIONS" }));
  eq(r.status, 200, "status"); eq(r.headers.get("Access-Control-Allow-Origin"), "*", "cors");
});
Deno.test("no login -> 401, nothing called", async () => {
  seed(); env.set("KUAIDI100_CUSTOMER", "CUST"); env.set("KUAIDI100_KEY", "KEY");
  const r = await call({ task_id: T1 }, null); eq(r.status, 401, "status"); eq(calls.length, 0, "fetch");
  const r2 = await call({ task_id: T1 }, "forged"); eq(r2.status, 401, "forged token");
});
Deno.test("secrets missing -> 503 not_configured, no upstream call", async () => {
  seed(); env.delete("KUAIDI100_CUSTOMER"); env.delete("KUAIDI100_KEY");
  const r = await call({ task_id: T1 }); eq(r.status, 503, "status"); eq(r.json.code, "not_configured", "code"); eq(calls.length, 0, "fetch");
  env.set("KUAIDI100_CUSTOMER", "CUST"); env.set("KUAIDI100_KEY", "KEY");
});
Deno.test("someone else's task -> 404, no upstream call", async () => {
  seed(); const r = await call({ task_id: TX }); eq(r.status, 404, "status"); eq(calls.length, 0, "fetch");
});
Deno.test("bad input -> 400", async () => {
  seed();
  eq((await call({ task_id: "x" })).json.code, "bad_task", "bad id");
  eq((await call({ task_id: T1, phone: "12" })).json.code, "bad_phone", "bad phone");
  eq((await call({ task_id: T3 })).json.code, "no_carrier", "其他 carrier");
  eq((await call({ task_id: T2 })).json.code, "need_phone", "顺丰 needs phone");
  eq(calls.length, 0, "fetch");
});
Deno.test("success: signed form request, record + event written, key not leaked", async () => {
  seed(); upstream = OK;
  const r = await call({ task_id: T1 });
  eq(r.status, 200, "status"); eq(r.json.ok, true, "ok"); eq(r.json.state_text, "在途", "state");
  eq(calls.length, 1, "one upstream call"); eq(calls[0].url, "https://poll.kuaidi100.com/poll/query.do", "url");
  const f = new URLSearchParams(calls[0].body); const param = f.get("param")!;
  eq(f.get("customer"), "CUST", "customer");
  eq(f.get("sign"), createHash("md5").update(param + "KEY" + "CUST").digest("hex").toUpperCase(), "sign");
  eq(JSON.parse(param).com, "yuantong", "com"); eq(JSON.parse(param).num, "YT123456789", "num");
  eq(state.db.tracking_records.find((x: any) => x.id === "k1").last_match, "【在途】2026-10-10 14:20:00 已到达上海转运中心（快递100）", "last_match");
  eq(state.db.tracking_records.length, 4, "no new record");
  const ev = state.db.after_sales_events; eq(ev.length, 1, "one event"); eq(ev[0].event_type, "tracking_queried", "event type"); eq(ev[0].user_id, "u1", "event user");
  if (JSON.stringify(r.json).includes("KEY") || JSON.stringify(r.json).includes("CUST")) throw new Error("credentials leaked in response");
  if (state.clients.some((c: any) => c.key !== "sb_publishable_test")) throw new Error("function used a non-publishable key");
});
Deno.test("顺丰 with phone -> phone sent", async () => {
  seed(); upstream = { ...OK, com: "shunfeng" };
  const r = await call({ task_id: T2, phone: "1234" }); eq(r.status, 200, "status");
  eq(JSON.parse(new URLSearchParams(calls[0].body).get("param")!).phone, "1234", "phone");
});
Deno.test("second query within 30 min -> 429, no upstream call", async () => {
  seed(); upstream = OK;
  eq((await call({ task_id: T1 })).status, 200, "first");
  const r = await call({ task_id: T1 }); eq(r.status, 429, "second"); eq(r.json.code, "too_soon", "code"); eq(calls.length, 1, "only one upstream call");
});
Deno.test("old query (>30 min) does not block", async () => {
  seed(); upstream = OK;
  state.db.after_sales_events.push({ id: "e0", user_id: "u1", task_id: T1, event_type: "tracking_queried", created_at: new Date(Date.now() - 31 * 60000).toISOString() });
  eq((await call({ task_id: T1 })).status, 200, "status");
});
Deno.test("config error (bad signature) -> 502 hint, logged but does NOT block a retry", async () => {
  seed(); upstream = { result: false, returnCode: "503", message: "验证签名失败" };
  const r = await call({ task_id: T1 });
  eq(r.status, 502, "status"); eq(r.json.code, "kuaidi100_503", "code");
  if (!r.json.message.includes("签名")) throw new Error("message: " + r.json.message);
  eq(state.db.tracking_records.find((x: any) => x.id === "k1").last_match, "", "record untouched");
  eq(state.db.after_sales_events[0].event_type, "tracking_query_failed", "logged as config failure");
  upstream = OK; eq((await call({ task_id: T1 })).status, 200, "retry right after fixing config");
});
Deno.test("parcel-level error (no result yet) counts toward the 30-min limit", async () => {
  seed(); upstream = { result: false, returnCode: "500", message: "查询无结果，请隔段时间再查" };
  const r = await call({ task_id: T1 }); eq(r.status, 502, "status");
  if (!r.json.message.includes("暂时查不到")) throw new Error("message: " + r.json.message);
  eq((await call({ task_id: T1 })).status, 429, "blocked for 30 min"); eq(calls.length, 1, "one upstream call");
});
Deno.test("secrets pasted with spaces/newlines still sign correctly", async () => {
  seed(); upstream = OK; env.set("KUAIDI100_CUSTOMER", "  CUST\n"); env.set("KUAIDI100_KEY", " KEY \n");
  const r = await call({ task_id: T1 }); eq(r.status, 200, "status");
  const f = new URLSearchParams(calls[0].body);
  eq(f.get("customer"), "CUST", "customer trimmed");
  eq(f.get("sign"), createHash("md5").update(f.get("param")! + "KEY" + "CUST").digest("hex").toUpperCase(), "sign uses trimmed values");
  env.set("KUAIDI100_CUSTOMER", "CUST"); env.set("KUAIDI100_KEY", "KEY");
});
Deno.test("misnamed secrets -> names (not values) reported; case/space variants accepted", async () => {
  seed(); env.delete("KUAIDI100_CUSTOMER"); env.delete("KUAIDI100_KEY");
  env.set("KUAIDI_CUSTOMER", "SECRETVALUE1"); env.set("kuaidi100_key ", "SECRETVALUE2");
  const r = await call({ task_id: T1 });
  eq(r.status, 503, "status");
  if (!r.json.message.includes("KUAIDI100_CUSTOMER") || !r.json.message.includes('"KUAIDI_CUSTOMER"')) throw new Error(r.json.message);
  if (r.json.message.includes("SECRETVALUE")) throw new Error("value leaked: " + r.json.message);
  if (r.json.message.includes("、KUAIDI100_KEY")) throw new Error("lowercase key with space should have been accepted: " + r.json.message);
  env.delete("KUAIDI_CUSTOMER"); env.set("KUAIDI100_CUSTOMER", "CUST"); upstream = OK;
  eq((await call({ task_id: T1 })).status, 200, "lowercase/space-padded key name accepted");
  env.delete("kuaidi100_key "); env.set("KUAIDI100_KEY", "KEY");
});
