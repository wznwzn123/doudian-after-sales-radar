// Fake npm:nodemailer for dev/login-alert-mail.handler.test.ts: records mails instead of sending them.
export const mailbox: any = { sent: [], fail: false, transports: [] };
export default {
  createTransport(opts: any) {
    mailbox.transports.push(opts);
    return {
      async sendMail(m: any) {
        if (mailbox.fail) throw new Error("535 Login fail");
        mailbox.sent.push({ opts, ...m });
        return { messageId: "fake" };
      },
    };
  },
};
