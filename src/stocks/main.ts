import { sleep } from "../tools/async.ts";
import { env, pushToAll, runMain, type Message } from "../tools/channels.ts";
import { configuredProviders } from "../tools/llm.ts";
import { shanghaiDate, shanghaiInstant, todayInShanghai } from "../tools/time.ts";
import { selectPicks } from "./analyze.ts";
import { toStockEmailHtml, toStockPlainText, toStockStatusMessage, toStockTelegramHtml } from "./format.ts";
import { fetchMarketSnapshot } from "./quotes.ts";
import { screenStocksWithFallback } from "./screener.ts";
import { fetchOffDays, isTradingDay } from "./trading-calendar.ts";
import type { MarketSnapshot } from "./types.ts";

const DEFAULT_STOCK_COUNT = 10;
/** The rule-screened candidates the AI chooses from. */
const AI_POOL_SIZE = 30;
const DEFAULT_PUSH_TIME = "09:20";
/** Stop scheduled screens before the call auction; individual fields may reset even earlier. */
const SCREEN_DEADLINE = "09:15";
const YEAR_LENGTH = 4;
const MS_PER_SECOND = 1000;

const isDryRun = process.argv.includes("--dry-run");
const skipsSchedule = isDryRun || process.argv.includes("--force");

/**
 * Screen the available pre-market snapshot first, then wait until the requested push time.
 * The message identifies the source's session date and any relaxed or unverified conditions.
 */
const waitUntilPushTime = async (date: string): Promise<void> => {
  const delay = shanghaiInstant(date, env("STOCK_PUSH_TIME") ?? DEFAULT_PUSH_TIME).getTime() - Date.now();
  if (delay <= 0) return;
  console.log(`⏳ 等待 ${Math.round(delay / MS_PER_SECOND)} 秒后推送`);
  await sleep(delay);
};

const publish = async (message: Message, date: string): Promise<void> => {
  console.log(message.text);
  if (isDryRun) return;
  await waitUntilPushTime(date);
  await pushToAll(message);
};

/** Record why pre-market data was rejected instead of only reporting an empty result. */
const screenSnapshot = (snapshot: MarketSnapshot, count: number) => {
  const result = screenStocksWithFallback(snapshot.quotes, snapshot.industries, Math.max(AI_POOL_SIZE, count), count);
  const fields = ["price", "changePct", "amount", "turnoverPct", "volumeRatio", "marketCap", "mainNetInflow", "mainNetPct", "pe"] as const;
  console.log("📋 股票筛选", JSON.stringify({
    source: snapshot.source,
    total: snapshot.quotes.length,
    tradeDates: [...new Set(snapshot.quotes.map((quote) => quote.tradeDate))],
    stages: result.stages,
    fields: Object.fromEntries(fields.map((field) => [field, {
      missing: snapshot.quotes.filter((quote) => !Number.isFinite(quote[field])).length,
      zero: snapshot.quotes.filter((quote) => quote[field] === 0).length,
    }])),
  }));
  return result;
};

const main = async (): Promise<void> => {
  const date = shanghaiDate();
  const today = todayInShanghai();
  if (!skipsSchedule && !isTradingDay(date, await fetchOffDays(date.slice(0, YEAR_LENGTH)))) {
    console.log(`📅 ${date} 不是 A 股交易日，跳过推送`);
    return;
  }
  if (!skipsSchedule && Date.now() >= shanghaiInstant(date, SCREEN_DEADLINE).getTime()) {
    const detail = `任务启动已超过 ${SCREEN_DEADLINE}，无法确认接口数据是否仍为上一交易日收盘数据。今天未生成股票名单，请查看任务运行记录。`;
    await publish(toStockStatusMessage(today, detail), date);
    // Status delivery must not count as a successful stock push in already-pushed.yml.
    throw new Error(detail);
  }

  const count = Number(env("STOCK_COUNT") ?? DEFAULT_STOCK_COUNT);
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("STOCK_COUNT 必须为正整数");
  let screening: ReturnType<typeof screenStocksWithFallback> | undefined;
  let snapshot: MarketSnapshot;
  try {
    snapshot = await fetchMarketSnapshot((candidate) => {
      const result = screenSnapshot(candidate, count);
      if (result.picks.length === 0) throw new Error("逐级放宽后仍无可用股票，尝试备用数据源");
      screening = result;
    });
  } catch (error: unknown) {
    await publish(toStockStatusMessage(today,
      "今天未能生成股票名单：已逐级放宽筛选并尝试备用行情源，仍没有符合基本条件的股票或行情不可用。请查看运行记录中的数据源、分档数量及缺失字段统计。"), date);
    throw error;
  }
  if (!screening) throw new Error("没有生成筛选结果");
  const pool = screening.picks;

  const screeningNote = [
    screening.note,
    ...(pool.length < count ? [`符合基本条件的候选仅 ${pool.length} 只，本次按实际数量推送`] : []),
  ].filter(Boolean).join("；");
  const meta = { tradeDate: pool[0]?.quote.tradeDate ?? "", source: snapshot.source, screeningNote };
  const { picks, analysis } = await selectPicks(pool, snapshot.industries, meta.tradeDate, count, configuredProviders());
  const text = toStockPlainText(picks, today, meta, analysis);
  await publish({
    subject: `📊 今日潜力股 Top ${picks.length} · ${today}`,
    telegram: toStockTelegramHtml(picks, today, meta, analysis),
    email: toStockEmailHtml(picks, today, meta, analysis),
    text,
  }, date);
};

await runMain(main);
