import { sleep } from "../tools/async.ts";
import { env, pushToAll, runMain } from "../tools/channels.ts";
import { configuredProviders } from "../tools/llm.ts";
import { shanghaiDate, shanghaiInstant, todayInShanghai } from "../tools/time.ts";
import { selectPicks } from "./analyze.ts";
import { toStockEmailHtml, toStockPlainText, toStockTelegramHtml } from "./format.ts";
import { fetchMarketSnapshot } from "./quotes.ts";
import { screenStocks } from "./screener.ts";
import { fetchOffDays, isTradingDay } from "./trading-calendar.ts";

const DEFAULT_STOCK_COUNT = 10;
/** The rule-screened candidates the AI chooses from. */
const AI_POOL_SIZE = 30;
const DEFAULT_PUSH_TIME = "09:20";
const YEAR_LENGTH = 4;
const MS_PER_SECOND = 1000;

const isDryRun = process.argv.includes("--dry-run");
const skipsCalendar = isDryRun || process.argv.includes("--force");

/**
 * Actions starts the job early (cron delays are common), so the screen runs on the previous session's
 * close before the 9:15 call auction resets the numbers, then waits here until the push time.
 */
const waitUntilPushTime = async (date: string): Promise<void> => {
  const delay = shanghaiInstant(date, env("STOCK_PUSH_TIME") ?? DEFAULT_PUSH_TIME).getTime() - Date.now();
  if (delay <= 0) return;
  console.log(`⏳ 等待 ${Math.round(delay / MS_PER_SECOND)} 秒后推送`);
  await sleep(delay);
};

const main = async (): Promise<void> => {
  const date = shanghaiDate();
  if (!skipsCalendar && !isTradingDay(date, await fetchOffDays(date.slice(0, YEAR_LENGTH)))) {
    console.log(`📅 ${date} 不是 A 股交易日，跳过推送`);
    return;
  }

  const snapshot = await fetchMarketSnapshot();
  const count = Number(env("STOCK_COUNT") ?? DEFAULT_STOCK_COUNT);
  const pool = screenStocks(snapshot.quotes, snapshot.industries, Math.max(AI_POOL_SIZE, count));
  if (pool.length === 0) throw new Error("没有筛选出任何股票，行情数据可能不完整");

  const today = todayInShanghai();
  const meta = { tradeDate: snapshot.quotes[0]?.tradeDate ?? "", source: snapshot.source };
  const { picks, analysis } = await selectPicks(pool, snapshot.industries, meta.tradeDate, count, configuredProviders());
  const text = toStockPlainText(picks, today, meta, analysis);
  console.log(text);

  if (isDryRun) return;

  await waitUntilPushTime(date);
  await pushToAll({
    subject: `📊 今日潜力股 Top ${picks.length} · ${today}`,
    telegram: toStockTelegramHtml(picks, today, meta, analysis),
    email: toStockEmailHtml(picks, today, meta, analysis),
    text,
  });
};

await runMain(main);
