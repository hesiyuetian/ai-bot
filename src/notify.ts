export const sendTelegram = async (token: string, chatId: string, html: string): Promise<void> => {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const body = (await response.json()) as { ok: boolean; description?: string };
  if (!body.ok) throw new Error(`Telegram 推送失败: ${body.description ?? response.status}`);
};

const SMTPS_PORT = 465;

export type MailConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly to: string;
};

export const sendEmail = async (
  config: MailConfig,
  subject: string,
  html: string,
  text: string,
): Promise<void> => {
  const { createTransport } = await import("nodemailer");
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === SMTPS_PORT,
    auth: { user: config.user, pass: config.pass },
  });
  await transporter.sendMail({ from: config.user, to: config.to, subject, html, text });
};
