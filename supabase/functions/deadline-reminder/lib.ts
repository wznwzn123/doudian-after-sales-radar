// 到期提醒邮件：纯函数（不碰网络、不碰数据库），方便单独测试。

export type SmtpConfig = { host: string; port: number; user: string; pass: string; fromName: string };

// 和 login-alert-mail 同一套规则：账号和授权码来自 Edge Function Secrets，只接受 465（Supabase 不允许 25 / 587）
export function smtpConfig(get: (k: string) => string | undefined): { ok: true; cfg: SmtpConfig } | { ok: false; message: string } {
  const user = (get("SMTP_USER") || "").trim(), pass = (get("SMTP_PASS") || "").trim();
  if (!user || !pass) return { ok: false, message: "SMTP_USER / SMTP_PASS not set" };
  const dom = user.split("@")[1]?.toLowerCase() || "";
  const host = (get("SMTP_HOST") || "").trim() || (dom === "qq.com" || dom === "foxmail.com" ? "smtp.qq.com" : dom === "163.com" ? "smtp.163.com" : dom === "126.com" ? "smtp.126.com" : "");
  if (!host) return { ok: false, message: "SMTP_HOST not set" };
  const port = Number((get("SMTP_PORT") || "465").trim());
  if (port !== 465) return { ok: false, message: "SMTP port must be 465" };
  return { ok: true, cfg: { host, port, user, pass, fromName: (get("SMTP_FROM_NAME") || "").trim() || "售后雷达" } };
}

export function fmtCN(iso: unknown): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）";
}

export const SITE_URL = "https://wznwzn123.github.io/doudian-after-sales-radar/";

// 一条到期提醒（数据库函数 deadline_reminders_due() 返回的一行）
export type Due = { task_id: string; kind: string; email: string; order_id: string | null; buyer_name: string | null; status: string | null; deadline: string; store_name: string | null };

const clean = (v: unknown, n = 60) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

export function reminderMail(d: Due, now = Date.now()): { subject: string; text: string } {
  const mins = Math.max(1, Math.round((Date.parse(d.deadline) - now) / 60000));
  const left = mins >= 60 ? "约 " + Math.round(mins / 60 * 10) / 10 + " 小时" : "约 " + mins + " 分钟";
  const order = clean(d.order_id) || "（未填订单号）";
  return {
    subject: "【售后雷达】售后还剩" + left + "到期：" + order,
    text: "你好！\n\n你的一个售后还剩" + left + "就到举证截止时间：\n\n" +
      "  订单号：" + order + "\n" +
      (clean(d.buyer_name) ? "  买家：" + clean(d.buyer_name) + "\n" : "") +
      (clean(d.store_name) ? "  店铺：" + clean(d.store_name) + "\n" : "") +
      "  当前状态：" + (clean(d.status, 20) || "待处理") + "\n" +
      "  截止时间：" + fmtCN(d.deadline) + "\n\n" +
      "请尽快在抖店后台完成举证。售后雷达里的「已完成」只是本系统的记录，不会代替你在抖店后台操作。\n" +
      "打开售后雷达：" + SITE_URL + "\n\n" +
      "不想收到这类邮件：售后雷达 →「工作台设置 → 到期邮件提醒」里关闭。\n\n— 售后雷达（这封邮件由系统自动发送，请不要直接回复）",
  };
}
