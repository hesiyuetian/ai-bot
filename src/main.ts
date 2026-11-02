import { toEmailHtml, toPlainText, todayInShanghai, toTelegramHtml } from "./format.ts";
import { sendEmail, sendTelegram } from "./notify.ts";
import { fetchTopByStarsToday } from "./trending.ts";

const DEFAULT_TOP_COUNT = 10;
const DEFAULT_SMTP_PORT = 465;

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

type Channel = {
  readonly name: string;
  readonly send: () => Promise<void>;
};

const runChannel = async (channel: Channel): Promise<void> => {
  await channel.send();
  console.log(`✅ ${channel.name} 已推送`);
};

const buildChannels = (html: { telegram: string; email: string; text: string }, subject: string): Channel[] => {
  const channels: Channel[] = [];

  const tgToken = env("TELEGRAM_BOT_TOKEN");
  const tgChat = env("TELEGRAM_CHAT_ID");
  if (tgToken && tgChat) {
    channels.push({ name: "Telegram", send: () => sendTelegram(tgToken, tgChat, html.telegram) });
  } else {
    console.warn("⚠️ 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID，跳过 Telegram");
  }

  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const to = env("MAIL_TO");
  if (host && user && pass && to) {
    const config = { host, user, pass, to, port: Number(env("SMTP_PORT") ?? DEFAULT_SMTP_PORT) };
    channels.push({ name: "邮件", send: () => sendEmail(config, subject, html.email, html.text) });
  } else {
    console.warn("⚠️ 未配置 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_TO，跳过邮件");
  }

  return channels;
};

const main = async (): Promise<void> => {
  const repos = await fetchTopByStarsToday(Number(env("TOP_COUNT") ?? DEFAULT_TOP_COUNT));
  const date = todayInShanghai();
  const text = toPlainText(repos, date);
  console.log(text);

  if (process.argv.includes("--dry-run")) return;

  const subject = `📈 GitHub 今日涨星 Top ${repos.length} · ${date}`;
  const channels = buildChannels(
    { telegram: toTelegramHtml(repos, date), email: toEmailHtml(repos, date), text },
    subject,
  );

  if (channels.length === 0) {
    throw new Error("Telegram 和邮件都没有配置，没有任何渠道可推送。请检查 GitHub Secrets 名称是否正确");
  }

  const results = await Promise.allSettled(channels.map(runChannel));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String(result.reason));
  if (failures.length > 0) throw new Error(failures.join("\n"));
};

try {
  await main();
} catch (error: unknown) {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
}
