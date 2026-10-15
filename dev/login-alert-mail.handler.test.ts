// End-to-end test of supabase/functions/login-alert-mail/index.ts in Deno with a fake Supabase client and a fake mailer.
// NOT a test against the real database or a real mailbox.
// Run: deno test --no-lock --config dev/kuaidi100-fakes/deno.json --allow-env --allow-read dev/login-alert-mail.handler.test.ts
import { state } from "./kuaidi100-fakes/supabase.ts";
import { mailbox } from "./kuaidi100-fakes/nodemailer.ts";
import { hashCode, isEmail, maskEmail, maskPhone, smtpConfig } from "../supabase/functions/login-alert-mail/lib.ts";

let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {} as any; };
const env = new Map<string, string>([
  ["SUPABASE_URL", "https://x.supabase.co"], ["SUPABASE_PUBLISHABLE_KEYS", '{"default":"sb_publishable_test"}'], ["SUPABASE_SECRET_KEYS", '{"default":"sb_secret_test"}'],
  ["SMTP_USER", "sender@qq.com"], ["SMTP_PASS", "fake-auth-code"],
]);
(Deno.env as any).get = (k: string) => env.get(k);
const origError = console.error; console.error = () => {};
await import("../supabase/functions/login-alert-mail/index.ts");

const P = "11111111-1111-1111-1111-111111111111", PEND = "22222222-2222-2222-2222-222222222222", E = "33333333-3333-3333-3333-333333333333", BAN = "44444444-4444-4444-4444-444444444444";
const DAY = 24 * 3600 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
function seed() {
  state.users = { "tok-p": P, "tok-pend": PEND, "tok-e": E, "tok-ban": BAN };
  state.authUsers = { [P]: { phone: "8613512345678", email: "" }, [PEND]: { phone: "8613800000000", email: "" }, [E]: { email: "boss@x.com", email_confirmed_at: ago(1e9) }, [BAN]: { phone: "8613900000000", email: "" } };
  state.db = { login_alert_emails: [], login_alert_mails: [], admin_operation_logs: [] }; state.clients = []; state.deny = {};
  state.passwords = { [P]: "Pw#12345", [E]: "Em#12345", [PEND]: "Pd#12345" }; state.signIns = []; state.signOuts = []; state.signInError = null; state.updateError = null; state.adminCalls = []; state.adminSignOuts = []; state.adminSignOutError = null;
  state.pk = { login_alert_mails: ["user_id", "device_id"], login_alert_emails: ["user_id"] };
  state.devices = { [P]: [] };
  state.rpcs = {
    my_account_status: (_a: any, uid: string) => ({ data: { pending: uid === PEND }, error: null }),
    is_user_banned: (a: any) => ({ data: a?.p_user_id === BAN, error: null }),
    my_login_alerts: (a: any, uid: string) => ({ data: { ok: true, devices: (state.devices[uid] || []).map((d: any) => ({ ...d, current: d.device_id === a.p_device_id })) }, error: null }),
  };
  mailbox.sent = []; mailbox.fail = false; mailbox.transports = [];
  env.set("SMTP_USER", "sender@qq.com"); env.set("SMTP_PASS", "fake-auth-code"); env.delete("SMTP_PORT");
}
const call = async (body: unknown, token: string | null) => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await handler(new Request("https://x/functions/v1/login-alert-mail", { method: "POST", headers: h, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() };
};
const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const rowOf = (uid: string) => state.db.login_alert_emails.find((r: any) => r.user_id === uid);
async function bind(tok: string, uid: string, email: string) {
  eq((await call({ action: "send_code", email }, tok)).status, 200, "send_code");
  const code = mailbox.sent.at(-1).subject.match(/(\d{6})$/)[1];
  const r = await call({ action: "verify_code", code }, tok); eq(r.status, 200, "verify"); return r;
}

Deno.test("lib: masks, email check, smtp config (QQ default host, only port 465)", () => {
  eq(maskEmail("1012968575@qq.com"), "10****75@qq.com", "mask long"); eq(maskEmail("ab@x.com"), "a*@x.com", "mask short");
  eq(maskPhone("8613512345678"), "135****5678", "phone");
  ok(isEmail("a.b@qq.com") && !isEmail("a@b") && !isEmail("x y@qq.com") && !isEmail(""), "isEmail");
  const c: any = smtpConfig((k) => ({ SMTP_USER: "me@qq.com", SMTP_PASS: "x" } as any)[k]); eq(c.ok && c.cfg.host, "smtp.qq.com", "qq host"); eq(c.cfg.port, 465, "port");
  eq(smtpConfig((k) => ({ SMTP_USER: "me@qq.com", SMTP_PASS: "x", SMTP_PORT: "587" } as any)[k]).ok, false, "587 refused");
  eq(smtpConfig(() => undefined).ok, false, "missing");
});
Deno.test("not logged in -> 401; tables not installed -> 503", async () => {
  seed(); eq((await call({}, null)).status, 401, "no token"); eq((await call({}, "forged")).status, 401, "forged");
  state.deny.login_alert_emails = true; const r = await call({ action: "status" }, "tok-p"); eq(r.status, 503, "not installed"); eq(r.json.code, "not_installed", "code");
});
Deno.test("status for a phone user: configured, phone_only, nothing bound", async () => {
  seed(); const r = await call({ action: "status" }, "tok-p");
  eq(r.json.ok, true, "ok"); eq(r.json.status.configured, true, "configured"); eq(r.json.status.phone_only, true, "phone_only"); eq(r.json.status.email, "", "no email");
  if (state.clients.some((c: any) => c.key === "sb_secret_test" && c.auth)) throw new Error("secret client must not carry the caller's token");
});
Deno.test("bind: code mailed (only its hash stored), resend throttled, wrong code counted, right code binds", async () => {
  seed();
  eq((await call({ action: "send_code", email: "bad" }, "tok-p")).json.code, "bad_email", "bad email");
  const s = await call({ action: "send_code", email: "Me@QQ.com" }, "tok-p"); eq(s.status, 200, "sent"); eq(s.json.sent_to, "m*@qq.com", "masked");
  eq(mailbox.sent.length, 1, "one mail"); eq(mailbox.sent[0].to, "me@qq.com", "to"); eq(mailbox.transports[0].host, "smtp.qq.com", "host"); eq(mailbox.transports[0].secure, true, "ssl");
  const code = mailbox.sent[0].subject.match(/(\d{6})$/)[1]; ok(mailbox.sent[0].text.includes(code), "code in body");
  const row = rowOf(P); eq(row.code_hash, await hashCode(P, code), "hash stored"); ok(!JSON.stringify(row).includes('"' + code + '"'), "plain code not stored");
  eq((await call({ action: "send_code", email: "me@qq.com" }, "tok-p")).json.code, "too_fast", "60s throttle"); eq(mailbox.sent.length, 1, "no second mail");
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  const w = await call({ action: "verify_code", code: wrong }, "tok-p"); eq(w.json.code, "wrong_code", "wrong"); eq(rowOf(P).code_tries, 1, "tries counted");
  const v = await call({ action: "verify_code", code }, "tok-p"); eq(v.status, 200, "verified"); eq(v.json.status.email, "m*@qq.com", "bound (masked)");
  eq(rowOf(P).email, "me@qq.com", "stored"); eq(rowOf(P).code_hash, null, "code cleared");
});
Deno.test("bind: pending or banned accounts refused, no mail sent", async () => {
  seed();
  const a = await call({ action: "send_code", email: "x@qq.com" }, "tok-pend"); eq(a.status, 403, "pending"); ok(a.json.message.includes("审核"), "msg");
  eq((await call({ action: "send_code", email: "x@qq.com" }, "tok-ban")).status, 403, "banned"); eq(mailbox.sent.length, 0, "no mail");
});
Deno.test("bind: 5 wrong codes lock it; 5 codes per day max; expired code refused", async () => {
  seed(); await call({ action: "send_code", email: "me@qq.com" }, "tok-p");
  for (let i = 0; i < 5; i++) await call({ action: "verify_code", code: "x" }, "tok-p");
  eq((await call({ action: "verify_code", code: mailbox.sent[0].subject.slice(-6) }, "tok-p")).json.code, "locked", "locked even with the right code");
  for (let i = 0; i < 4; i++) { rowOf(P).last_sent_at = ago(61000); eq((await call({ action: "send_code", email: "me@qq.com" }, "tok-p")).status, 200, "send " + (i + 2)); }
  rowOf(P).last_sent_at = ago(61000); eq((await call({ action: "send_code", email: "me@qq.com" }, "tok-p")).json.code, "too_many", "6th refused");
  rowOf(P).code_expires = ago(1); eq((await call({ action: "verify_code", code: mailbox.sent.at(-1).subject.slice(-6) }, "tok-p")).json.code, "expired", "expired");
});
Deno.test("notify: new device after binding -> one alert mail to the bound email; never twice; old devices ignored", async () => {
  seed(); await bind("tok-p", P, "me@qq.com"); mailbox.sent = [];
  state.devices[P] = [
    { device_id: "dev-old-000001", first_seen: ago(5 * DAY), name: "iPhone · Safari", ip: "1.1.1.1" },
    { device_id: "dev-new-000002", first_seen: new Date(Date.now() + 1000).toISOString(), name: "Windows · Chrome", ip: "8.8.8.8" },
  ];
  const n = await call({ action: "notify", device_id: "dev-new-000002" }, "tok-p"); eq(n.json.sent, true, "sent");
  eq(mailbox.sent.length, 1, "one mail"); const m = mailbox.sent[0]; eq(m.to, "me@qq.com", "to bound email"); ok(m.subject.includes("新设备登录"), "subject");
  ok(m.text.includes("135****5678") && m.text.includes("Windows · Chrome") && m.text.includes("8.8.8.8") && m.text.includes("修改密码"), "body");
  eq((await call({ action: "notify", device_id: "dev-new-000002" }, "tok-p")).json.reason, "already_sent", "dedupe"); eq(mailbox.sent.length, 1, "still one");
  eq((await call({ action: "notify", device_id: "dev-old-000001" }, "tok-p")).json.reason, "not_new", "old device"); eq(mailbox.sent.length, 1, "no mail for old");
  eq((await call({ action: "notify", device_id: "dev-unknown-03" }, "tok-p")).json.reason, "no_device", "someone else's / unknown device");
});
Deno.test("notify: device that appeared before the email was bound is not alerted; nothing bound -> no mail", async () => {
  seed(); state.devices[P] = [{ device_id: "dev-a-00000001", first_seen: ago(60000), name: "Android" }];
  eq((await call({ action: "notify", device_id: "dev-a-00000001" }, "tok-p")).json.reason, "no_email", "nothing bound");
  await bind("tok-p", P, "me@qq.com"); mailbox.sent = [];
  eq((await call({ action: "notify", device_id: "dev-a-00000001" }, "tok-p")).json.reason, "not_new", "seen before binding"); eq(mailbox.sent.length, 0, "no mail");
});
Deno.test("notify: mail failure frees the dedupe slot so the next login can retry", async () => {
  seed(); await bind("tok-p", P, "me@qq.com"); state.devices[P] = [{ device_id: "dev-new-000009", first_seen: new Date(Date.now() + 1000).toISOString() }];
  mailbox.fail = true; eq((await call({ action: "notify", device_id: "dev-new-000009" }, "tok-p")).json.reason, "send_failed", "failed");
  eq(state.db.login_alert_mails.length, 0, "slot freed"); mailbox.fail = false;
  eq((await call({ action: "notify", device_id: "dev-new-000009" }, "tok-p")).json.sent, true, "retry works");
});
Deno.test("SMTP not configured: status says so, send_code 503, notify skipped", async () => {
  seed(); env.delete("SMTP_PASS");
  eq((await call({ action: "status" }, "tok-p")).json.status.configured, false, "configured false");
  eq((await call({ action: "send_code", email: "me@qq.com" }, "tok-p")).status, 503, "send_code 503");
  state.db.login_alert_emails.push({ user_id: P, email: "me@qq.com", verified_at: ago(DAY) });
  state.devices[P] = [{ device_id: "dev-new-000005", first_seen: new Date().toISOString() }];
  eq((await call({ action: "notify", device_id: "dev-new-000005" }, "tok-p")).json.reason, "smtp_missing", "notify skipped"); eq(mailbox.sent.length, 0, "no mail");
});
Deno.test("email-registered user can turn alerts on with the verified login email; phone user cannot", async () => {
  seed(); const r = await call({ action: "use_account_email" }, "tok-e"); eq(r.status, 200, "ok"); eq(r.json.status.email, "b****s@x.com", "bound"); eq(rowOf(E).email, "boss@x.com", "stored");
  eq((await call({ action: "use_account_email" }, "tok-p")).json.code, "no_account_email", "phone user");
});
Deno.test("decline and remove", async () => {
  seed(); eq((await call({ action: "decline" }, "tok-p")).json.status.declined, true, "declined");
  await bind("tok-p", P, "me@qq.com"); eq(rowOf(P).prompt_declined_at, null, "binding clears decline");
  const r = await call({ action: "remove" }, "tok-p"); eq(r.json.status.email, "", "removed"); eq(rowOf(P).email, null, "db cleared");
  eq((await call({ action: "nope" }, "tok-p")).json.code, "bad_action", "unknown action");
});

// ---- 6.25 换绑登录手机号 / 登录邮箱
Deno.test("change phone: needs the current password (checked with a temporary session that is then signed out locally)", async () => {
  seed();
  eq((await call({ action: "change_phone", phone: "12345", password: "Pw#12345" }, "tok-p")).json.code, "bad_phone", "bad phone");
  eq((await call({ action: "change_phone", phone: "13512345678", password: "Pw#12345" }, "tok-p")).json.code, "same", "same phone");
  const w = await call({ action: "change_phone", phone: "13912345678", password: "wrong" }, "tok-p");
  eq(w.json.code, "wrong_password", "wrong pw"); ok(w.json.message.includes("还可以再试 4 次"), w.json.message); eq(state.adminCalls.length, 0, "not changed");
  eq(state.signIns[0].phone, "+8613512345678", "verified with the current phone"); eq(state.signIns[0].key, "sb_publishable_test", "publishable key, not secret");
  const r = await call({ action: "change_phone", phone: "139 1234 5678", password: "Pw#12345" }, "tok-p");
  eq(r.status, 200, "ok"); eq(r.json.phone, "139****5678", "masked"); eq(state.authUsers[P].phone, "8613912345678", "phone changed");
  eq(state.adminCalls.at(-1).attrs.phone, "+8613912345678", "admin api"); eq(state.adminCalls.at(-1).attrs.phone_confirm, true, "confirmed");
  eq(state.signOuts.length, 1, "temp session signed out"); eq(state.signOuts[0].scope, "local", "only the temp session");
  const log = state.db.admin_operation_logs.at(-1); eq(log.action, "change_phone", "logged"); eq(log.user_id, P, "by the user"); ok(log.detail.includes("135****5678") && log.detail.includes("139****5678"), log.detail);
});
Deno.test("change phone: number used by another account -> clear message; pending/banned refused; 5 wrong passwords lock", async () => {
  seed();
  const d = await call({ action: "change_phone", phone: "13800000000", password: "Pw#12345" }, "tok-p"); eq(d.status, 409, "dup"); eq(d.json.code, "taken", "pre-checked"); ok(d.json.message.includes("已经被其他账号使用"), d.json.message); eq(state.adminCalls.length, 0, "no update attempted");
  eq((await call({ action: "change_phone", phone: "13700000000", password: "Pd#12345" }, "tok-pend")).status, 403, "pending");
  eq((await call({ action: "change_phone", phone: "13700000000", password: "x" }, "tok-ban")).status, 403, "banned");
  for (let i = 0; i < 5; i++) await call({ action: "change_phone", phone: "13700000000", password: "bad" }, "tok-p");
  const l = await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p"); eq(l.json.code, "pw_locked", "locked even with the right password");
  rowOf(P).pw_fail_at = ago(31 * 60000); eq((await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p")).status, 200, "unlocked after 30 min");
  eq(rowOf(P).pw_fail_count, 0, "fail counter reset");
});
Deno.test("change phone: auth service trouble is not counted as a wrong password", async () => {
  seed(); state.signInError = { message: "Request rate limit reached", code: "over_request_rate_limit" };
  const r = await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p"); eq(r.json.code, "pw_check_failed", "code");
  eq(rowOf(P), undefined, "no fail recorded"); eq(state.adminCalls.length, 0, "not changed");
});
Deno.test("change login email (phone user): password + code to the NEW email; becomes login email and the alert email", async () => {
  seed();
  eq((await call({ action: "email_change_code", email: "new@qq.com", password: "nope" }, "tok-p")).json.code, "wrong_password", "wrong pw"); eq(mailbox.sent.length, 0, "no code before password");
  const c = await call({ action: "email_change_code", email: "New@QQ.com", password: "Pw#12345" }, "tok-p"); eq(c.status, 200, "sent"); eq(c.json.status.chg_email, "n****w@qq.com", "pending shown (masked)");
  eq(mailbox.sent[0].to, "new@qq.com", "code to new email"); ok(mailbox.sent[0].subject.includes("换绑登录邮箱"), "subject");
  const code = mailbox.sent[0].subject.slice(-6);
  eq((await call({ action: "verify_code", code }, "tok-p")).json.code, "no_code", "alert-binding code path is separate");
  eq((await call({ action: "email_change_verify", code: code === "000000" ? "111111" : "000000" }, "tok-p")).json.code, "wrong_code", "wrong code");
  const v = await call({ action: "email_change_verify", code }, "tok-p"); eq(v.status, 200, "ok"); eq(v.json.alert_set, true, "alert email set too");
  eq(state.authUsers[P].email, "new@qq.com", "login email set"); eq(state.adminCalls.at(-1).attrs.email_confirm, true, "confirmed");
  eq(rowOf(P).email, "new@qq.com", "alert email"); eq(rowOf(P).chg_code_hash, null, "code cleared");
  eq(state.db.admin_operation_logs.at(-1).action, "change_email", "logged");
});
Deno.test("change login email (email user): old address and alert email are told; taken email refused", async () => {
  seed(); state.authUsers["55555555-5555-5555-5555-555555555555"] = { email: "taken@qq.com" };
  state.db.login_alert_emails.push({ user_id: E, email: "alert@qq.com", verified_at: ago(DAY), sent_count: 0 });
  const t = await call({ action: "email_change_code", email: "Taken@qq.com", password: "Em#12345" }, "tok-e"); eq(t.status, 409, "taken"); eq(t.json.code, "taken", "code");
  ok(t.json.message.includes("另一个账号的登录邮箱") && t.json.message.includes("提醒邮箱可以重复"), t.json.message);
  eq(mailbox.sent.length, 0, "no code mailed for a taken email"); eq(rowOf(E).last_sent_at, undefined, "send quota not used");
  eq(state.authUsers[E].email, "boss@x.com", "unchanged");
  mailbox.sent = [];
  await call({ action: "email_change_code", email: "me2@qq.com", password: "Em#12345" }, "tok-e");
  const v = await call({ action: "email_change_verify", code: mailbox.sent.at(-1).subject.slice(-6) }, "tok-e"); eq(v.status, 200, "ok"); eq(v.json.alert_set, false, "existing alert email kept");
  eq(rowOf(E).email, "alert@qq.com", "alert email unchanged");
  const notes = mailbox.sent.filter((m: any) => m.subject.includes("已更改")).map((m: any) => m.to).sort();
  eq(JSON.stringify(notes), JSON.stringify(["alert@qq.com", "boss@x.com"]), "old login email + alert email notified");
  ok(mailbox.sent.find((m: any) => m.to === "boss@x.com").text.includes("m****2@qq.com"), "new email mentioned (masked)");
});
Deno.test("change login email: SMTP missing -> 503 before any password check; codes share the daily limit", async () => {
  seed(); env.delete("SMTP_PASS");
  eq((await call({ action: "email_change_code", email: "x@qq.com", password: "Pw#12345" }, "tok-p")).status, 503, "smtp"); eq(state.signIns.length, 0, "no password check");
  env.set("SMTP_PASS", "fake-auth-code");
  state.db.login_alert_emails.push({ user_id: P, last_sent_at: ago(10000), sent_count: 1, sent_window: ago(10000) });
  eq((await call({ action: "email_change_code", email: "x@qq.com", password: "Pw#12345" }, "tok-p")).json.code, "too_fast", "60s shared");
});
Deno.test("change login email: if the account service still refuses (\"Error updating user\" = unique key hit), say it is taken", async () => {
  seed(); await call({ action: "email_change_code", email: "race@qq.com", password: "Pw#12345" }, "tok-p");
  state.updateError = { message: "Error updating user", status: 500 };
  const v = await call({ action: "email_change_verify", code: mailbox.sent.at(-1).subject.slice(-6) }, "tok-p");
  eq(v.status, 409, "status"); ok(v.json.message.includes("已经被其他账号使用"), v.json.message); eq(state.authUsers[P].email, "", "unchanged");
});
// ---- 6.32 修改密码：要当前密码，改完把其他设备全部退出，并发邮件通知
Deno.test("change password: needs the current password; weak / same refused; nothing changed", async () => {
  seed();
  eq((await call({ action: "change_password", password: "Pw#12345", new_password: "weak" }, "tok-p")).json.code, "weak", "weak");
  eq((await call({ action: "change_password", password: "Pw#12345", new_password: "Pw#12345" }, "tok-p")).json.code, "same", "same");
  const w = await call({ action: "change_password", password: "nope", new_password: "New#Pass9" }, "tok-p");
  eq(w.json.code, "wrong_password", "wrong current"); eq(state.adminCalls.length, 0, "not changed"); eq(state.adminSignOuts.length, 0, "nobody signed out");
});
Deno.test("change password: set via admin API, other sessions signed out with the caller's own token, logged, mails sent", async () => {
  seed(); state.db.login_alert_emails.push({ user_id: E, email: "alert@qq.com", verified_at: ago(DAY) });
  const r = await call({ action: "change_password", password: "Em#12345", new_password: "New#Pass9" }, "tok-e");
  eq(r.status, 200, "ok"); eq(r.json.others_signed_out, true, "others out");
  eq(state.adminCalls.at(-1).attrs.password, "New#Pass9", "new password set"); eq(state.adminCalls.at(-1).id, E, "own account");
  eq(state.adminSignOuts.length, 1, "one signOut"); eq(state.adminSignOuts[0].scope, "others", "scope others"); eq(state.adminSignOuts[0].jwt, "tok-e", "with the caller's token");
  eq(state.db.admin_operation_logs.at(-1).action, "change_password", "logged");
  ok(!JSON.stringify(state.db.admin_operation_logs).includes("New#Pass9"), "password not in the log");
  const to = mailbox.sent.filter((m: any) => m.subject.includes("密码已修改")).map((m: any) => m.to).sort();
  eq(JSON.stringify(to), JSON.stringify(["alert@qq.com", "boss@x.com"]), "login + alert email notified");
  ok(!mailbox.sent.some((m: any) => m.text.includes("New#Pass9")), "password not mailed");
});
Deno.test("change password: if signing out the others fails the password is still changed and the client is told", async () => {
  seed(); state.adminSignOutError = { message: "boom" };
  const r = await call({ action: "change_password", password: "Pw#12345", new_password: "New#Pass9" }, "tok-p");
  eq(r.status, 200, "ok"); eq(r.json.others_signed_out, false, "reported");
  console.error = origError;
});
// ---- 6.33（v6_33 SQL 执行后）：作废其他登录用数据库函数；换绑查重用 SQL 函数 + 每天次数限制
Deno.test("change password (6.33): other logins revoked in the database with the caller's identity; Auth sign-out kept as a backup", async () => {
  seed(); console.error = () => {};
  const seen: any[] = [];
  state.rpcs.revoke_other_sessions = (_a: any, uid: string) => { seen.push(uid); return { data: { ok: true, sessions: 2 }, error: null }; };
  state.adminSignOutError = { message: "boom" };
  const r = await call({ action: "change_password", password: "Pw#12345", new_password: "New#Pass9" }, "tok-p");
  eq(r.status, 200, "ok"); eq(r.json.others_signed_out, true, "revoked by the database function");
  eq(JSON.stringify(seen), JSON.stringify([P]), "called as the user (not with the secret key)");
  eq(state.adminSignOuts.length, 1, "Auth sign-out still attempted");
});
Deno.test("change password (6.33): wrong current password -> nothing revoked", async () => {
  seed(); let n = 0; state.rpcs.revoke_other_sessions = () => { n++; return { data: { ok: true }, error: null }; };
  eq((await call({ action: "change_password", password: "nope", new_password: "New#Pass9" }, "tok-p")).json.code, "wrong_password", "refused");
  eq(n, 0, "not revoked");
});
Deno.test("rebind (6.33): duplicate check uses auth_identity_taken with the secret key", async () => {
  seed(); const seen: any[] = [];
  state.rpcs.auth_identity_taken = (a: any, uid: string | null) => { seen.push({ ...a, uid }); return { data: true, error: null }; };
  const d = await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p");
  eq(d.status, 409, "taken by the SQL answer (no such user in the scan)"); eq(d.json.code, "taken", "code");
  eq(seen.length, 1, "asked once"); eq(seen[0].p_user, P, "excluding self"); eq(seen[0].p_kind, "phone", "kind"); eq(seen[0].p_value, "+8613700000000", "normalized"); eq(seen[0].uid, null, "secret-key client");
  state.rpcs.auth_identity_taken = () => ({ data: false, error: null });
  const ok2 = await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p");
  eq(ok2.status, 200, "free -> changed"); eq(state.authUsers[P].phone, "8613700000000", "phone changed");
});
Deno.test("rebind (6.33): at most 10 duplicate checks a day; wrong password does not count", async () => {
  seed(); let n = 0;
  state.rpcs.take_quota = (a: any) => { n++; return { data: a.p_bucket === "identity_check" && a.p_limit === 10 && a.p_window_seconds === 86400 && n <= 1, error: null }; };
  eq((await call({ action: "change_phone", phone: "13700000000", password: "nope" }, "tok-p")).json.code, "wrong_password", "wrong password first");
  eq(n, 0, "wrong password did not use a check");
  eq((await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p")).status, 200, "1st check ok");
  const r = await call({ action: "change_phone", phone: "13600000000", password: "Pw#12345" }, "tok-p");
  eq(r.status, 429, "2nd refused by the (fake) limit"); eq(r.json.code, "too_many_checks", "code"); eq(state.authUsers[P].phone, "8613700000000", "not changed again");
  const e = await call({ action: "email_change_code", email: "new@qq.com", password: "Em#12345" }, "tok-e");
  eq(e.json.code, "too_many_checks", "email rebind limited too"); eq(mailbox.sent.length, 0, "no code mailed");
});
Deno.test("rebind (6.33): SQL functions not installed yet -> falls back to the old scan, no limit", async () => {
  seed(); state.authUsers["55555555-5555-5555-5555-555555555555"] = { phone: "8613700000000" };
  const d = await call({ action: "change_phone", phone: "13700000000", password: "Pw#12345" }, "tok-p");
  eq(d.json.code, "taken", "scan still finds it");
  console.error = origError;
});
// ---- 6.36 到期邮件提醒开关 + 手机号新账号注册通知运营方
Deno.test("6.36 deadline_mail: on by default, turning off / on is saved server-side and shown in the status", async () => {
  seed(); console.error = () => {};
  const s0 = await call({ action: "status" }, "tok-e");
  eq(s0.json.status.deadline_mail, true, "on by default"); eq(s0.json.status.deadline_mail_to, maskEmail("boss@x.com"), "goes to the confirmed login email");
  const off = await call({ action: "deadline_mail", on: false }, "tok-e");
  eq(off.json.status.deadline_mail, false, "off"); eq(rowOf(E).deadline_mail_off, true, "saved");
  eq((await call({ action: "deadline_mail", on: true }, "tok-e")).json.status.deadline_mail, true, "on again");
  eq((await call({ action: "status" }, "tok-p")).json.status.deadline_mail_to, "", "phone account without alert email: nowhere to send");
});
Deno.test("6.36 registered: a pending phone account notifies the owner once (masked number); others never", async () => {
  seed(); state.authUsers[PEND].created_at = "2026-10-12T01:00:00Z";
  const r = await call({ action: "registered" }, "tok-pend");
  eq(r.json.notified, true, "notified"); eq(mailbox.sent.length, 1, "one mail"); eq(mailbox.sent[0].to, "1012968575@qq.com", "to the owner");
  ok(mailbox.sent[0].subject.includes("138****0000") && !mailbox.sent[0].text.includes("13800000000"), "number masked");
  eq((await call({ action: "registered" }, "tok-pend")).json.notified, false, "only once"); eq(mailbox.sent.length, 1, "still one");
  eq((await call({ action: "registered" }, "tok-p")).json.notified, false, "approved phone account: no mail");
  eq((await call({ action: "registered" }, "tok-e")).json.notified, false, "email account: no mail"); eq(mailbox.sent.length, 1, "still one");
});
Deno.test("6.36 registered: site-wide daily limit stops a flood of fake sign-ups", async () => {
  seed(); state.rpcs.take_quota = () => ({ data: false, error: null });
  eq((await call({ action: "registered" }, "tok-pend")).json.reason, "daily_limit", "limited"); eq(mailbox.sent.length, 0, "no mail");
  console.error = origError;
});
