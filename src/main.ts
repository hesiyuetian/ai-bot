import { toEmailHtml, toPlainText, todayInShanghai, toTelegramHtml } from "./format.ts";
import { splitList } from "./list.ts";
import { sendEmail, sendTelegram } from "./notify.ts";
import { fetchTopByStarsToday, type TrendingRepo } from "./trending.ts";
import { translateToChinese } from "./translate.ts";

const DEFAULT_TOP_COUNT = 10;
const DEFAULT_SMTP_PORT = 465;

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

type Channel = {
  readonly name: string;
  readonly send: () => Promise<void>;
};

const runChannel = async (channel: Channel): Promise<void> => {
  try {
    await channel.send();
  } catch (error: unknown) {
    throw new Error(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`✅ ${channel.name} 已推送`);
};

/** Names a recipient by position only, so chat IDs and addresses never show up in Actions logs. */
const recipientName = (channel: string, index: number, total: number): string =>
  total > 1 ? `${channel} (${index + 1}/${total})` : channel;

const buildChannels = (html: { telegram: string; email: string; text: string }, subject: string): Channel[] => {
  const channels: Channel[] = [];

  const tgToken = env("TELEGRAM_BOT_TOKEN");
  const chatIds = splitList(env("TELEGRAM_CHAT_ID"));
  if (tgToken && chatIds.length > 0) {
    channels.push(
      ...chatIds.map((chatId, index) => ({
        name: recipientName("Telegram", index, chatIds.length),
        send: () => sendTelegram(tgToken, chatId, html.telegram),
      })),
    );
  } else {
    console.warn("⚠️ 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID，跳过 Telegram");
  }

  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const recipients = splitList(env("MAIL_TO"));
  if (host && user && pass && recipients.length > 0) {
    const port = Number(env("SMTP_PORT") ?? DEFAULT_SMTP_PORT);
    channels.push(
      ...recipients.map((to, index) => ({
        name: recipientName("邮件", index, recipients.length),
        send: () => sendEmail({ host, user, pass, port, to }, subject, html.email, html.text),
      })),
    );
  } else {
    console.warn("⚠️ 未配置 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_TO，跳过邮件");
  }

  return channels;
};

const withChineseDescription = async (repo: TrendingRepo): Promise<TrendingRepo> => ({
  ...repo,
  descriptionZh: await translateToChinese(repo.description),
});

const main = async (): Promise<void> => {
  const trending = await fetchTopByStarsToday(Number(env("TOP_COUNT") ?? DEFAULT_TOP_COUNT));
  const repos = env("TRANSLATE") === "false" ? trending : await Promise.all(trending.map(withChineseDescription));
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
