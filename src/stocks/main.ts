import { env, pushToAll, runMain } from "../tools/channels.ts";
import { shanghaiDate, shanghaiInstant, todayInShanghai } from "../tools/time.ts";
import { toStockEmailHtml, toStockPlainText, toStockTelegramHtml } from "./format.ts";
import { fetchIndustryFlows, fetchTopInflowStocks } from "./quotes.ts";
import { screenStocks } from "./screener.ts";
import { fetchOffDays, isTradingDay } from "./trading-calendar.ts";

const DEFAULT_STOCK_COUNT = 10;
const DEFAULT_PUSH_TIME = "09:20";
/** 2 pages × 100 = the 200 stocks with the largest main-capital inflow; plenty of candidates for 10 picks. */
const CANDIDATE_PAGES = 2;
const YEAR_LENGTH = 4;
const MS_PER_SECOND = 1000;

const isDryRun = process.argv.includes("--dry-run");
const skipsCalendar = isDryRun || process.argv.includes("--force");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Sequential on purpose: parallel requests trip Eastmoney's rate limit.
  const quotes = await fetchTopInflowStocks(CANDIDATE_PAGES);
  const industries = await fetchIndustryFlows();
  const picks = screenStocks(quotes, industries, Number(env("STOCK_COUNT") ?? DEFAULT_STOCK_COUNT));
  if (picks.length === 0) throw new Error("没有筛选出任何股票，行情数据可能不完整");

  const tradeDate = quotes[0]?.tradeDate ?? "";
  const today = todayInShanghai();
  const text = toStockPlainText(picks, today, tradeDate);
  console.log(text);

  if (isDryRun) return;

  await waitUntilPushTime(date);
  await pushToAll({
    subject: `📊 今日潜力股 Top ${picks.length} · ${today}`,
    telegram: toStockTelegramHtml(picks, today, tradeDate),
    email: toStockEmailHtml(picks, today, tradeDate),
    text,
  });
};

await runMain(main);
