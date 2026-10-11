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
  state.authUsers = { [P]: { phone: "8615770572452", email: "" }, [PEND]: { phone: "8613800000000", email: "" }, [E]: { email: "boss@x.com", email_confirmed_at: ago(1e9) }, [BAN]: { phone: "8613900000000", email: "" } };
  state.db = { login_alert_emails: [], login_alert_mails: [] }; state.clients = []; state.deny = {};
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
  eq(maskPhone("8615770572452"), "157****2452", "phone");
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
  ok(m.text.includes("157****2452") && m.text.includes("Windows · Chrome") && m.text.includes("8.8.8.8") && m.text.includes("修改密码"), "body");
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
  console.error = origError;
});
