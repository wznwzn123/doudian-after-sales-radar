// End-to-end tests (Deno, fake Supabase client + fake mailer) for the 6.36 Edge Functions:
//   deadline-reminder, phone-password-reset, delete-account. NOT a test against the real database or a real mailbox.
// Run: deno test --no-lock --config dev/kuaidi100-fakes/deno.json -A dev/v636-functions.handler.test.ts
import { state } from "./kuaidi100-fakes/supabase.ts";
import { mailbox } from "./kuaidi100-fakes/nodemailer.ts";
import { hashCode } from "../supabase/functions/phone-password-reset/lib.ts";
import { reminderMail } from "../supabase/functions/deadline-reminder/lib.ts";

const handlers: Record<string, (r: Request) => Promise<Response>> = {};
let loading = "";
(Deno as any).serve = (h: any) => { handlers[loading] = h; return {} as any; };
const env = new Map<string, string>([
  ["SUPABASE_URL", "https://x.supabase.co"], ["SUPABASE_PUBLISHABLE_KEYS", '{"default":"sb_publishable_test"}'], ["SUPABASE_SECRET_KEYS", '{"default":"sb_secret_test"}'],
  ["SMTP_USER", "sender@qq.com"], ["SMTP_PASS", "fake-auth-code"],
]);
(Deno.env as any).get = (k: string) => env.get(k);
const origError = console.error; console.error = () => {};
for (const f of ["deadline-reminder", "phone-password-reset", "delete-account"]) { loading = f; await import("../supabase/functions/" + f + "/index.ts"); }
console.error = origError;

const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const call = async (fn: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await handlers[fn](new Request("https://x/functions/v1/" + fn, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() };
};
const KEY = "a".repeat(64);
const A = "11111111-1111-1111-1111-111111111111", P = "22222222-2222-2222-2222-222222222222", ADMIN = "33333333-3333-3333-3333-333333333333";
function seed() {
  console.error = () => {};
  state.users = { "tok-a": A, "tok-p": P, "tok-admin": ADMIN };
  state.admins = [ADMIN];
  state.authUsers = { [A]: { email: "a@x.com", email_confirmed_at: "2026-10-01" }, [P]: { phone: "8615770572452", email: "" }, [ADMIN]: { email: "boss@x.com" } };
  state.passwords = { [A]: "Aa#12345", [P]: "Pp#12345", [ADMIN]: "Ad#12345" };
  state.db = { app_secrets: [{ name: "cron_key", value: KEY }], task_deadline_mails: [], login_alert_emails: [], admin_operation_logs: [], quota_counters: [] };
  state.pk = {}; state.deny = {}; state.adminCalls = []; state.signIns = []; state.signOuts = []; state.signInError = null; state.updateError = null;
  state.storage = []; state.storageRemoved = []; state.storageSticky = false; state.storageRemoveError = null; state.deletedUsers = []; state.deleteUserError = null;
  const quota: Record<string, number> = {};
  state.quotaLimitHit = null;
  state.rpcs = {
    take_quota: (a: any) => { const k = a.p_user + ":" + a.p_bucket; quota[k] = (quota[k] || 0) + 1; return { data: state.quotaLimitHit === a.p_bucket.split(":")[0] ? false : quota[k] <= a.p_limit, error: null }; },
    auth_user_by_phone: (a: any) => ({ data: Object.keys(state.authUsers).find((k) => state.authUsers[k].phone && state.authUsers[k].phone === String(a.p_phone).replace(/^\+/, "")) || null, error: null }),
    service_revoke_all_sessions: (a: any) => { state.revokedAll = (state.revokedAll || []).concat([a.p_user]); return { data: 2, error: null }; },
    is_admin: (_a: any, uid: string) => ({ data: state.admins.includes(uid), error: null }),
    is_session_revoked: () => ({ data: false, error: null }),
    user_storage_paths: (a: any) => ({ data: (state.storage || []).filter((p: string) => p.startsWith(a.p_user + "/")), error: null }),
    delete_user_extras: (a: any) => { state.extras = (state.extras || []).concat([a]); return { data: null, error: null }; },
  };
  mailbox.sent = []; mailbox.fail = false;
}

// ---------------- deadline-reminder ----------------
const DUE = [
  { task_id: "t1", kind: "60", email: "alert@x.com", order_id: "ORD-1", buyer_name: "张三", status: "待举证", deadline: new Date(Date.now() + 55 * 60000).toISOString(), store_name: "店A" },
  { task_id: "t2", kind: "30", email: "b@x.com", order_id: "ORD-2\r\nBcc: evil@x.com", buyer_name: null, status: "待处理", deadline: new Date(Date.now() + 20 * 60000).toISOString(), store_name: null },
];
Deno.test("deadline-reminder: wrong / missing cron key -> 401, nothing claimed or sent", async () => {
  seed(); let n = 0; state.rpcs.deadline_reminders_due = () => { n++; return { data: DUE, error: null }; };
  eq((await call("deadline-reminder", {})).status, 401, "no key"); eq((await call("deadline-reminder", {}, { "x-radar-cron": "b".repeat(64) })).status, 401, "wrong key");
  eq(n, 0, "due not called"); eq(mailbox.sent.length, 0, "no mail");
});
Deno.test("deadline-reminder: due reminders are mailed to the right address with the order details", async () => {
  seed(); state.rpcs.deadline_reminders_due = () => ({ data: DUE, error: null });
  const r = await call("deadline-reminder", {}, { "x-radar-cron": KEY });
  eq(r.status, 200, "ok"); eq(r.json.sent, 2, "two sent");
  eq(mailbox.sent[0].to, "alert@x.com", "to"); ok(mailbox.sent[0].subject.includes("ORD-1") && mailbox.sent[0].text.includes("张三") && mailbox.sent[0].text.includes("店A") && mailbox.sent[0].text.includes("抖店后台"), mailbox.sent[0].text);
  ok(!/[\r\n]/.test(mailbox.sent[1].subject), "order id cannot inject mail headers: " + JSON.stringify(mailbox.sent[1].subject));
});
Deno.test("deadline-reminder: a failed send is un-claimed so the next run retries", async () => {
  seed(); state.db.task_deadline_mails = [{ task_id: "t1", kind: "60" }, { task_id: "t2", kind: "30" }];
  state.rpcs.deadline_reminders_due = () => ({ data: DUE, error: null }); mailbox.fail = true;
  const r = await call("deadline-reminder", {}, { "x-radar-cron": KEY });
  eq(r.json.failed, 2, "failed"); eq(state.db.task_deadline_mails.length, 0, "claims removed");
});
Deno.test("deadline-reminder: SMTP not configured -> 503 before claiming anything", async () => {
  seed(); let n = 0; state.rpcs.deadline_reminders_due = () => { n++; return { data: DUE, error: null }; }; env.delete("SMTP_PASS");
  const r = await call("deadline-reminder", {}, { "x-radar-cron": KEY }); env.set("SMTP_PASS", "fake-auth-code");
  eq(r.status, 503, "status"); eq(n, 0, "nothing claimed");
});
Deno.test("deadline-reminder lib: time left wording", () => {
  ok(reminderMail({ ...DUE[0], deadline: new Date(Date.now() + 60 * 60000).toISOString() }).subject.includes("约 1 小时"), "1 h");
  ok(reminderMail({ ...DUE[0], deadline: new Date(Date.now() + 29 * 60000).toISOString() }).subject.includes("约 29 分钟"), "29 min");
});

// ---------------- phone-password-reset ----------------
const withAlert = () => { state.db.login_alert_emails = [{ user_id: P, email: "alert@qq.com", verified_at: "2026-10-01T00:00:00Z" }]; };
Deno.test("phone reset: bad phone -> 400; unknown phone and phone without alert email get the same answer and no mail", async () => {
  seed();
  eq((await call("phone-password-reset", { action: "send", phone: "123" })).status, 400, "bad phone");
  const a = await call("phone-password-reset", { action: "send", phone: "13900000000" });
  const b = await call("phone-password-reset", { action: "send", phone: "15770572452" });
  eq(a.status, 200, "unknown ok"); eq(b.status, 200, "no alert email ok"); eq(a.json.message, b.json.message, "same message (no enumeration)"); eq(mailbox.sent.length, 0, "no mail");
});
Deno.test("phone reset: code goes to the verified alert email, only a hash is stored, 60 s resend guard", async () => {
  seed(); withAlert();
  const r = await call("phone-password-reset", { action: "send", phone: "+86 157 7057 2452" });
  eq(r.status, 200, "ok"); eq(mailbox.sent.length, 1, "one mail"); eq(mailbox.sent[0].to, "alert@qq.com", "to alert email");
  const code = mailbox.sent[0].subject.slice(-6); const row = state.db.login_alert_emails[0];
  eq(row.rst_code_hash, await hashCode(P, "reset:" + code), "hash stored"); ok(!JSON.stringify(row).includes(code), "code itself not stored");
  await call("phone-password-reset", { action: "send", phone: "15770572452" }); eq(mailbox.sent.length, 1, "resend within 60 s ignored");
});
Deno.test("phone reset: wrong codes -> same generic message, the 5th wrong try kills the code", async () => {
  seed(); withAlert(); await call("phone-password-reset", { action: "send", phone: "15770572452" });
  const code = mailbox.sent[0].subject.slice(-6), wrong = code === "000000" ? "111111" : "000000";
  let last: any;
  for (let i = 0; i < 5; i++) last = await call("phone-password-reset", { action: "reset", phone: "15770572452", code: wrong, new_password: "New#Pass9" });
  eq(last.json.code, "bad_code", "generic"); eq(state.db.login_alert_emails[0].rst_code_hash, null, "code invalidated");
  eq((await call("phone-password-reset", { action: "reset", phone: "15770572452", code, new_password: "New#Pass9" })).json.code, "bad_code", "even the right code no longer works");
  eq(state.adminCalls.length, 0, "password never changed");
  eq((await call("phone-password-reset", { action: "reset", phone: "13900000000", code: "123456", new_password: "New#Pass9" })).json.message, last.json.message === "验证码错误次数太多，已作废，请重新获取" ? "验证码不对或已过期，请重新获取" : last.json.message, "unknown phone -> same generic message");
});
Deno.test("phone reset: right code -> password set, every session revoked, logged, notice mailed; weak password refused first", async () => {
  seed(); withAlert(); await call("phone-password-reset", { action: "send", phone: "15770572452" });
  const code = mailbox.sent[0].subject.slice(-6);
  eq((await call("phone-password-reset", { action: "reset", phone: "15770572452", code, new_password: "weak" })).json.code, "weak", "weak");
  const r = await call("phone-password-reset", { action: "reset", phone: "15770572452", code, new_password: "New#Pass9" });
  eq(r.status, 200, "ok"); eq(state.adminCalls.at(-1).id, P, "own account"); eq(state.adminCalls.at(-1).attrs.password, "New#Pass9", "new password");
  eq(JSON.stringify(state.revokedAll), JSON.stringify([P]), "all sessions revoked"); eq(state.db.admin_operation_logs.at(-1).action, "reset_password_self", "logged");
  ok(!JSON.stringify(state.db.admin_operation_logs).includes("New#Pass9"), "password not logged"); ok(mailbox.sent.at(-1).subject.includes("密码已修改"), "notice mail");
  eq(state.db.login_alert_emails[0].rst_code_hash, null, "code cleared");
});
Deno.test("phone reset: rate limits (per IP / phone / site) -> 429, nothing sent", async () => {
  seed(); withAlert(); state.quotaLimitHit = "pr_phone";
  const r = await call("phone-password-reset", { action: "send", phone: "15770572452" });
  eq(r.status, 429, "limited"); eq(mailbox.sent.length, 0, "no mail");
});

// ---------------- delete-account ----------------
const del = (tok: string | null, body: unknown) => call("delete-account", body, tok ? { Authorization: "Bearer " + tok } : {});
Deno.test("delete-account: needs login, the word 注销, and refuses admins", async () => {
  seed();
  eq((await del(null, { password: "Aa#12345", confirm: "注销" })).status, 401, "no login");
  eq((await del("tok-a", { password: "Aa#12345", confirm: "删除" })).json.code, "confirm", "confirm word");
  eq((await del("tok-admin", { password: "Ad#12345", confirm: "注销" })).json.code, "admin", "admin refused");
  eq(state.deletedUsers.length, 0, "nobody deleted");
});
Deno.test("delete-account: wrong password -> refused, counted; 5 wrong -> locked even with the right password", async () => {
  seed(); state.storage = [A + "/tasks/t/a.jpg"];
  eq((await del("tok-a", { password: "nope", confirm: "注销" })).json.code, "wrong_password", "wrong");
  for (let i = 0; i < 4; i++) await del("tok-a", { password: "nope", confirm: "注销" });
  state.db.quota_counters = [{ user_id: A, bucket: "delete_pw_fail", n: 5, window_start: new Date().toISOString() }];
  eq((await del("tok-a", { password: "Aa#12345", confirm: "注销" })).json.code, "pw_locked", "locked");
  eq(state.deletedUsers.length, 0, "not deleted"); eq(state.storageRemoved.length, 0, "no files touched");
});
Deno.test("delete-account: files first (all of them), goodbye mail, then the account and the extra rows", async () => {
  seed(); state.storage = [A + "/tasks/t/a.jpg", A + "/library/l.pdf", A + "/old/v.mp4", P + "/tasks/x/b.jpg"];
  state.db.login_alert_emails = [{ user_id: A, email: "alert@x.com", verified_at: "2026-10-01" }];
  const r = await del("tok-a", { password: "Aa#12345", confirm: "注销" });
  eq(r.status, 200, "ok"); eq(r.json.files, 3, "3 files");
  eq(JSON.stringify(state.storage), JSON.stringify([P + "/tasks/x/b.jpg"]), "only the other user's file left");
  eq(JSON.stringify(state.deletedUsers), JSON.stringify([A]), "account deleted"); eq(state.extras[0].p_user, A, "extras removed"); ok(!state.extras[0].p_label.includes("a@x.com"), "log label masked");
  eq(JSON.stringify(mailbox.sent.map((m: any) => m.to).sort()), JSON.stringify(["a@x.com", "alert@x.com"]), "goodbye mail to login + alert email");
});
Deno.test("delete-account: files not all gone -> stop, account kept", async () => {
  seed(); state.storage = [A + "/tasks/t/a.jpg"]; state.storageSticky = true;
  const r = await del("tok-a", { password: "Aa#12345", confirm: "注销" });
  eq(r.json.code, "files", "stopped"); eq(state.deletedUsers.length, 0, "account kept");
});
Deno.test("delete-account: SQL not installed -> clear message, nothing deleted", async () => {
  seed(); delete state.rpcs.user_storage_paths;
  const r = await del("tok-a", { password: "Aa#12345", confirm: "注销" });
  eq(r.json.code, "not_installed", "message"); eq(state.deletedUsers.length, 0, "kept");
  console.error = origError;
});
