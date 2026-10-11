// 新设备登录邮件提醒：纯函数（不碰网络、不碰数据库），方便单独测试。

export function isEmail(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s.length <= 254 && /^[^\s@<>()"',;:\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(s);
}

// 1012968575@qq.com -> 10****75@qq.com；只给前端看打码后的邮箱
export function maskEmail(v: unknown): string {
  const s = String(v ?? "");
  const at = s.lastIndexOf("@");
  if (at < 1) return "";
  const name = s.slice(0, at), dom = s.slice(at);
  if (name.length <= 2) return name[0] + "*" + dom;
  const keep = name.length <= 4 ? 1 : 2;
  return name.slice(0, keep) + "****" + name.slice(-keep) + dom;
}

// 8615770572452 -> 157****2452
export function maskPhone(v: unknown): string {
  const p = String(v ?? "").replace(/^\+?86(?=1\d{10}$)/, "");
  return /^\d{11}$/.test(p) ? p.slice(0, 3) + "****" + p.slice(-4) : p ? "****" + p.slice(-4) : "";
}

export function genCode(rnd: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]): string {
  return String(rnd() % 1000000).padStart(6, "0");
}

// 验证码只存哈希（和用户编号一起算，换个账号同一个码哈希也不同）
export async function hashCode(userId: string, code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId + ":" + code));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SmtpConfig = { host: string; port: number; user: string; pass: string; fromName: string };

// 发信邮箱配置来自 Edge Function Secrets（只在服务端）。QQ 邮箱默认 smtp.qq.com:465。
// Supabase 不允许连 25 / 587 端口，所以只接受 465（SSL）。
export function smtpConfig(get: (k: string) => string | undefined): { ok: true; cfg: SmtpConfig } | { ok: false; message: string } {
  const user = (get("SMTP_USER") || "").trim(), pass = (get("SMTP_PASS") || "").trim();
  if (!user || !pass) return { ok: false, message: "管理员还没有配置发信邮箱（需要在 Supabase 的 Edge Functions → Secrets 里填写 SMTP_USER 和 SMTP_PASS）" };
  const dom = user.split("@")[1]?.toLowerCase() || "";
  const host = (get("SMTP_HOST") || "").trim() || (dom === "qq.com" || dom === "foxmail.com" ? "smtp.qq.com" : dom === "163.com" ? "smtp.163.com" : dom === "126.com" ? "smtp.126.com" : "");
  if (!host) return { ok: false, message: "发信邮箱配置不完整：请在 Secrets 里填写 SMTP_HOST" };
  const port = Number((get("SMTP_PORT") || "465").trim());
  if (port !== 465) return { ok: false, message: "发信端口只能用 465（SSL），Supabase 不允许 25 / 587 端口" };
  return { ok: true, cfg: { host, port, user, pass, fromName: (get("SMTP_FROM_NAME") || "").trim() || "售后雷达" } };
}

export function fmtCN(iso: unknown): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）";
}

export function codeMail(code: string, purpose: "alert" | "login" = "alert"): { subject: string; text: string } {
  const what = purpose === "login" ? "换绑登录邮箱" : "绑定「新设备登录提醒」邮箱";
  return {
    subject: "【售后雷达】" + (purpose === "login" ? "换绑登录邮箱" : "绑定提醒邮箱") + "的验证码：" + code,
    text: "你好！\n\n你正在给售后雷达账号" + what + "，验证码是：\n\n    " + code + "\n\n10 分钟内有效。如果不是你本人操作，请忽略这封邮件。\n\n— 售后雷达",
  };
}

// 中国大陆手机号 -> "+8615770572452"；不合法返回 ""（和前端 parseIdent 同一条规则：13～19 开头的 11 位）
export function normPhone(v: unknown): string {
  const d = String(v ?? "").replace(/[\s-]/g, "").replace(/^\+?86(?=1\d{10}$)/, "");
  return /^1[3-9]\d{9}$/.test(d) ? "+86" + d : "";
}

// 登录手机号 / 登录邮箱被换绑后，发到旧邮箱和提醒邮箱的通知
export function changedMail(o: { kind: "phone" | "email"; account: string; now: string; at: string; contact: string }): { subject: string; text: string } {
  const what = o.kind === "phone" ? "登录手机号" : "登录邮箱";
  return {
    subject: "【售后雷达】你的账号" + what + "已更改",
    text: "你好！\n\n你的售后雷达账号 " + o.account + " 的" + what + "刚刚被改为：" + o.now + "\n时间：" + o.at +
      "\n\n如果是你本人，不用处理。\n如果不是你：请马上发邮件给 " + o.contact + " 联系管理员处理。\n\n— 售后雷达（这封邮件由系统自动发送，请不要直接回复）",
  };
}

// 密码被修改后发到登录邮箱和提醒邮箱的通知
export function passwordMail(o: { account: string; at: string; contact: string }): { subject: string; text: string } {
  return {
    subject: "【售后雷达】你的账号密码已修改",
    text: "你好！\n\n你的售后雷达账号 " + o.account + " 的密码刚刚被修改，其他设备上的登录已全部退出。\n时间：" + o.at +
      "\n\n如果是你本人，不用处理。\n如果不是你：说明有人拿到了你的登录状态，请马上发邮件给 " + o.contact + " 联系管理员处理。\n\n— 售后雷达（这封邮件由系统自动发送，请不要直接回复）",
  };
}

// 和前端 strong() 同一条规则
export function strongPassword(p: string): boolean {
  return p.length >= 8 && p.length <= 72 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

export function alertMail(o: { account: string; device: string; ip: string; at: string; contact: string }): { subject: string; text: string } {
  return {
    subject: "【售后雷达】你的账号在新设备登录",
    text: "你好！\n\n你的售后雷达账号 " + o.account + " 刚刚在一台新设备上登录：\n\n" +
      "  时间：" + o.at + "\n  设备：" + (o.device ? o.device.replace(/[\r\n]+/g, " ").slice(0, 60) + "（设备名称由该设备自己上报，仅供参考，请以时间和 IP 判断）" : "未知设备") + "\n" + (o.ip ? "  IP：" + o.ip + "（服务器记录）\n" : "") +
      "\n如果是你本人，不用处理。\n如果不是你：请马上登录售后雷达 →「工作台设置 → 修改密码」，并发邮件给 " + o.contact + " 请管理员封禁陌生设备。\n\n— 售后雷达（这封邮件由系统自动发送，请不要直接回复）",
  };
}
