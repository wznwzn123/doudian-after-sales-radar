// 到期提醒邮件：数据库定时任务（pg_cron + pg_net，每 5 分钟）调用本函数 → 发「还剩 1 小时 / 30 分钟」的提醒邮件。
// 谁该收、发哪一档，由数据库函数 deadline_reminders_due()（v6_37 SQL，只有服务端能调）决定，并在返回前先记进 task_deadline_mails（先占位再发），
//   同一个售后同一档提醒只会发一次；发送失败就删掉占位，下一轮再试。
// 调用凭据：定时任务从数据库表 app_secrets 读出随机 cron_key 放进请求头 x-radar-cron，本函数用 secret key 读同一张表比对 ——
//   这个值只在数据库里，不在前端、不在仓库、也不需要用户手动配置。就算被人乱调用，也只会把「已经到点、还没发过」的提醒提前发出，不会重复发。
// 部署时 verify_jwt=false（定时任务不带用户登录）。
import { createClient } from "npm:@supabase/supabase-js@2";
import { reminderMail, smtpConfig, type Due } from "./lib.ts";
import { sendMail } from "./mail.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function envKey(jsonName: string, legacyName: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) || "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get(legacyName) || "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  const secret = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) return json(503, { ok: false, code: "not_configured" });
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const given = req.headers.get("x-radar-cron") || "";
  const k = await svc.from("app_secrets").select("value").eq("name", "cron_key").maybeSingle();
  if (k.error || !k.data?.value || given.length < 20 || given !== k.data.value) return json(401, { ok: false, code: "bad_key" });

  const smtp = smtpConfig((n) => Deno.env.get(n));
  if (!smtp.ok) { console.error("deadline-reminder: smtp", smtp.message); return json(503, { ok: false, code: "smtp_missing" }); }

  const due = await svc.rpc("deadline_reminders_due");
  if (due.error) { console.error("deadline-reminder: due", due.error.message); return json(500, { ok: false, code: "db" }); }
  const rows: Due[] = Array.isArray(due.data) ? due.data : [];
  let sent = 0, failed = 0;
  for (const d of rows) {
    const m = reminderMail(d);
    try { await sendMail(smtp.cfg, d.email, m.subject, m.text); sent++; } catch (e) {
      failed++;
      console.error("deadline-reminder: send failed", (e as Error).message);
      const un = await svc.from("task_deadline_mails").delete().eq("task_id", d.task_id).eq("kind", d.kind);
      if (un.error) console.error("deadline-reminder: unclaim failed", un.error.message);
    }
  }
  return json(200, { ok: true, due: rows.length, sent, failed });
});
