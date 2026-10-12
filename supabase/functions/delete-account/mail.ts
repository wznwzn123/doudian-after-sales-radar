// 通过 SMTP（465 / SSL）发一封纯文本邮件。账号和授权码来自服务端 Secrets，不在前端、不在仓库。
import nodemailer from "npm:nodemailer@6.9.16";
import type { SmtpConfig } from "./lib.ts";

export async function sendMail(cfg: SmtpConfig, to: string, subject: string, text: string): Promise<void> {
  const t = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  await t.sendMail({ from: { name: cfg.fromName, address: cfg.user }, to, subject, text });
}
