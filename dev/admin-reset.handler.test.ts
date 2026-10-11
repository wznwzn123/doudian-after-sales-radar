// End-to-end test of supabase/functions/admin-reset-password/index.ts in Deno with a fake Supabase client.
// NOT a test against the real database.
// Run: deno test --no-lock --config dev/kuaidi100-fakes/deno.json --allow-env --allow-read dev/admin-reset.handler.test.ts
import { state } from "./kuaidi100-fakes/supabase.ts";
import { strong, tempPassword } from "../supabase/functions/admin-reset-password/lib.ts";

let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {} as any; };
const env = new Map<string, string>([["SUPABASE_URL", "https://x.supabase.co"], ["SUPABASE_PUBLISHABLE_KEYS", '{"default":"sb_publishable_test"}'], ["SUPABASE_SECRET_KEYS", '{"default":"sb_secret_test"}']]);
(Deno.env as any).get = (k: string) => env.get(k);
await import("../supabase/functions/admin-reset-password/index.ts");

const ADMIN = "11111111-1111-1111-1111-111111111111", USER = "22222222-2222-2222-2222-222222222222", P1 = "33333333-3333-3333-3333-333333333333";
function seed() {
  state.users = { "tok-admin": ADMIN, "tok-user": USER };
  state.admins = [ADMIN];
  state.authUsers = { [P1]: { phone: "8615770572452", email: null }, [ADMIN]: { email: "boss@x.com" } };
  state.adminCalls = []; state.db = { admin_operation_logs: [] }; state.clients = [];
}
const call = async (body: unknown, token: string | null) => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await handler(new Request("https://x/functions/v1/admin-reset-password", { method: "POST", headers: h, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() };
};
const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

Deno.test("temp password: 12 chars, always strong, no look-alike chars, random", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) { const p = tempPassword(); eq(p.length, 12, "length"); if (!strong(p)) throw new Error("weak: " + p); if (/[0O1lI]/.test(p)) throw new Error("ambiguous: " + p); seen.add(p); }
  if (seen.size < 495) throw new Error("not random enough: " + seen.size);
});
Deno.test("not logged in -> 401, nothing changed", async () => {
  seed(); eq((await call({ user_id: P1 }, null)).status, 401, "no token"); eq((await call({ user_id: P1 }, "forged")).status, 401, "forged");
  eq(state.adminCalls.length, 0, "no admin calls");
});
Deno.test("normal user -> 403, nothing changed (admin check on the server)", async () => {
  seed(); const r = await call({ user_id: P1 }, "tok-user"); eq(r.status, 403, "status"); eq(r.json.code, "forbidden", "code"); eq(state.adminCalls.length, 0, "no admin calls");
});
Deno.test("admin resets a phone user: new strong password returned, set via admin API, logged without the password", async () => {
  seed(); const r = await call({ user_id: P1 }, "tok-admin");
  eq(r.status, 200, "status"); eq(r.json.ok, true, "ok"); eq(r.json.account, "手机 15770572452", "label");
  if (!strong(r.json.password)) throw new Error("weak password returned");
  eq(state.adminCalls.length, 1, "one update"); eq(state.adminCalls[0].id, P1, "target"); eq(state.adminCalls[0].attrs.password, r.json.password, "same password");
  const log = state.db.admin_operation_logs; eq(log.length, 1, "one log row"); eq(log[0].user_id, ADMIN, "logged admin"); eq(log[0].action, "reset_password", "action");
  if (JSON.stringify(log).includes(r.json.password)) throw new Error("password leaked into the log");
  if (state.clients.some((c: any) => c.key === "sb_secret_test" && c.auth)) throw new Error("secret client must not carry the caller's token");
});
Deno.test("admin cannot reset own password here", async () => {
  seed(); const r = await call({ user_id: ADMIN }, "tok-admin"); eq(r.status, 400, "status"); eq(r.json.code, "self", "code"); eq(state.adminCalls.length, 0, "no update");
});
Deno.test("bad / unknown user id", async () => {
  seed(); eq((await call({ user_id: "x" }, "tok-admin")).json.code, "bad_user", "bad id");
  eq((await call({ user_id: "44444444-4444-4444-4444-444444444444" }, "tok-admin")).json.code, "not_found", "unknown");
  eq(state.adminCalls.length, 0, "no update");
});
Deno.test("no secret key in the environment -> 503, nothing changed", async () => {
  seed(); const keep = env.get("SUPABASE_SECRET_KEYS")!; env.delete("SUPABASE_SECRET_KEYS");
  const r = await call({ user_id: P1 }, "tok-admin"); env.set("SUPABASE_SECRET_KEYS", keep);
  eq(r.status, 503, "status"); eq(state.adminCalls.length, 0, "no update");
});
