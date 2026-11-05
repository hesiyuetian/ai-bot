import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSelection, selectPicks } from "../../src/stocks/analyze.ts";
import { DISCLAIMER, toStockEmailHtml, toStockTelegramHtml } from "../../src/stocks/format.ts";
import { parseStockRow } from "../../src/stocks/sources/eastmoney.ts";
import { mergeQuotes, parseTencentQuotes, type MainFlow } from "../../src/stocks/sources/sina-tencent.ts";
import type { StockQuote } from "../../src/stocks/types.ts";
import { describeError } from "../../src/tools/async.ts";
import type { LlmProvider } from "../../src/tools/llm.ts";
import { isEligible, screenStocks } from "../../src/stocks/screener.ts";
import { shanghaiDate } from "../../src/tools/time.ts";
import { isTradingDay } from "../../src/stocks/trading-calendar.ts";

const YI = 100_000_000;
const PICK_LIMIT = 10;
const PER_INDUSTRY_CAP = 2;
const SAME_INDUSTRY_COUNT = 3;

const LIMIT_UP_PCT = 10;
const THIN_AMOUNT = YI;
const WEAK_VOLUME_RATIO = 0.8;
const WEAK_TURNOVER_PCT = 0.5;
const WEAK_MAIN_NET_PCT = 2;
const OVERSOLD_60D_PCT = -45;
const EXTREME_PE = 2466;
const HOT_INDUSTRY_INFLOW = 4_000_000_000;

// A healthy large-cap that passes every filter; tests override one field at a time.
const BASE_QUOTE: StockQuote = JSON.parse(`{
  "code": "600000", "name": "浦发银行", "url": "https://quote.eastmoney.com/sh600000.html", "industry": "银行",
  "price": 10, "changePct": 4, "change5dPct": 6, "change60dPct": 12, "amount": 1000000000, "turnoverPct": 5,
  "volumeRatio": 2, "pe": 15, "marketCap": 50000000000, "mainNetInflow": 120000000, "mainNetPct": 12,
  "listDate": "19991110", "tradeDate": "20261030"
}`);

// A real row from push2.eastmoney.com/api/qt/clist/get, with PE blanked to "-".
const RAW_ROW = JSON.parse(`{
  "f2": 92.2, "f3": 7.13, "f6": 11931248669.9, "f8": 9.33, "f9": "-", "f10": 1.88, "f12": "002384", "f13": 0,
  "f14": "东山精密", "f20": 179365025490, "f24": -46.23, "f26": 20100409, "f62": 1344244560, "f100": "元件",
  "f109": -12.55, "f184": 11.27, "f297": 20261102
}`);

const quote = (overrides: Partial<StockQuote> = {}): StockQuote => ({ ...BASE_QUOTE, ...overrides });

test("parses an Eastmoney row, treating '-' as missing", () => {
  const parsed = parseStockRow(RAW_ROW);
  assert.equal(parsed.url, "https://quote.eastmoney.com/sz002384.html");
  assert.equal(parsed.industry, "元件");
  assert.ok(Number.isNaN(parsed.pe));
  assert.equal(parsed.tradeDate, "20261102");
  assert.equal(parseStockRow({ f12: "920001", f13: 0 }).url, "https://quote.eastmoney.com/bj/920001.html");
  assert.equal(parseStockRow({ f12: "688981", f13: 1 }).url, "https://quote.eastmoney.com/sh688981.html");
});

// Real Tencent quotes trimmed to the fields the parser reads: one stock, one ETF, one symbol Sina never ranked.
const TENCENT_FIELD_COUNT = 72;
const tencentLine = (symbol: string, values: Readonly<Record<number, string>>): string =>
  `v_${symbol}="${Array.from({ length: TENCENT_FIELD_COUNT }, (_, index) => values[index] ?? "").join("~")}";`;
const TENCENT_TEXT = [
  tencentLine("sz300059", JSON.parse(`{"1":"东方财富","2":"300059","3":"18.71","30":"20261102161430","32":"6.31",
    "37":"864560","38":"3.47","39":"19.88","45":"2960.33","49":"2.61","61":"GP-A-CYB","63":"0.86","71":"-7.24"}`)),
  tencentLine("sh512100", JSON.parse(`{"1":"中证1000ETF","2":"512100","61":"ETF"}`)),
  tencentLine("sh600000", JSON.parse(`{"1":"浦发银行","2":"600000","61":"GP-A"}`)),
].join("\n");
const SINA_FLOWS: ReadonlyMap<string, MainFlow> = new Map(JSON.parse(`[
  ["sz300059", {"netInflow": 1385328781, "netPct": 16.02}],
  ["sh512100", {"netInflow": 1948263293, "netPct": 20.35}]
]`));
const TENCENT_AMOUNT = 8_645_600_000;
const TENCENT_MARKET_CAP = 296_033_000_000;
const TENCENT_VOLUME_RATIO = 2.61;
const TENCENT_CHANGE_60D = -7.24;
const SINA_NET_PCT = 16.02;

test("merges Sina flows with Tencent quotes, keeping stocks only", () => {
  const [merged, ...rest] = mergeQuotes(SINA_FLOWS, parseTencentQuotes(TENCENT_TEXT));
  assert.equal(rest.length, 0);
  assert.equal(merged?.name, "东方财富");
  assert.equal(merged?.url, "https://quote.eastmoney.com/sz300059.html");
  assert.equal(merged?.amount, TENCENT_AMOUNT);
  assert.equal(merged?.marketCap, TENCENT_MARKET_CAP);
  assert.equal(merged?.volumeRatio, TENCENT_VOLUME_RATIO);
  assert.equal(merged?.change60dPct, TENCENT_CHANGE_60D);
  assert.equal(merged?.mainNetPct, SINA_NET_PCT);
  assert.equal(merged?.tradeDate, "20261102");
  assert.equal(merged?.industry, "");
});

test("error descriptions include the network cause", () => {
  const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  assert.equal(describeError(new Error("fetch failed", { cause })), "fetch failed (UND_ERR_SOCKET)");
  assert.equal(describeError(new Error("HTTP 500")), "HTTP 500");
});

test("filters out ST, new, near-limit-up, illiquid and loss-making stocks", () => {
  assert.ok(isEligible(quote()));
  assert.ok(!isEligible(quote({ name: "*ST 中天" })));
  assert.ok(!isEligible(quote({ name: "N 海博", listDate: "" })));
  assert.ok(!isEligible(quote({ listDate: "20260901" })));
  assert.ok(!isEligible(quote({ changePct: LIMIT_UP_PCT })));
  assert.ok(!isEligible(quote({ changePct: -1 })));
  assert.ok(!isEligible(quote({ amount: THIN_AMOUNT })));
  assert.ok(!isEligible(quote({ pe: Number.NaN })));
  assert.ok(!isEligible(quote({ pe: EXTREME_PE })));
  assert.ok(!isEligible(quote({ mainNetInflow: -1 })));
});

test("ranks by score, explains each pick, and caps picks per industry", () => {
  const strong = quote({ code: "000001", name: "强势股", industry: "半导体" });
  const weak = quote({ code: "000002", name: "普通股", industry: "银行", volumeRatio: WEAK_VOLUME_RATIO, turnoverPct: WEAK_TURNOVER_PCT, mainNetPct: WEAK_MAIN_NET_PCT });
  const sameIndustry = Array.from({ length: SAME_INDUSTRY_COUNT }, (_, n) =>
    quote({ code: `30000${n}`, name: `电子${n}`, industry: "半导体" }),
  );

  const picks = screenStocks([weak, strong, ...sameIndustry], [{ name: "半导体", changePct: LIMIT_UP_PCT, mainNetInflow: HOT_INDUSTRY_INFLOW }], PICK_LIMIT);

  assert.equal(picks[0]?.quote.name, "强势股");
  assert.equal(picks.filter((pick) => pick.quote.industry === "半导体").length, PER_INDUSTRY_CAP);
  assert.equal(picks.at(-1)?.quote.name, "普通股");
  assert.ok(picks[0]?.reasons.some((reason) => reason.includes("主力资金净流入 1.20 亿元")));
  assert.ok(picks[0]?.reasons.some((reason) => reason.includes("「半导体」主力净流入排名第 1")));
});

test("flags oversold rebounds as a risk", () => {
  const [pick] = screenStocks([quote({ change60dPct: OVERSOLD_60D_PCT })], [], PICK_LIMIT);
  assert.ok(pick?.risk?.includes("超跌反弹"));
});

test("formatters escape HTML and carry reasons and the disclaimer", () => {
  const picks = screenStocks([quote({ name: "A&B" })], [], PICK_LIMIT);
  const meta = { tradeDate: "20261030", source: "新浪财经 + 腾讯行情" };
  const telegram = toStockTelegramHtml(picks, "2026/11/02", meta);
  assert.ok(telegram.includes("A&amp;B"));
  assert.ok(telegram.includes("• 主力资金净流入"));
  assert.ok(telegram.includes(DISCLAIMER));
  assert.ok(toStockEmailHtml(picks, "2026/11/02", meta).includes("行情日期 20261030 · 来源 新浪财经 + 腾讯行情"));
});

test("trading days are weekdays that are not public holidays", () => {
  const offDays = new Set(["2026-10-01", "2026-10-02"]);
  assert.ok(isTradingDay("2026-11-02", offDays));
  assert.ok(!isTradingDay("2026-10-01", offDays));
  assert.ok(!isTradingDay("2026-11-07", offDays));
  assert.ok(!isTradingDay("2026-11-08", offDays));
});

test("uses Beijing time for today's date", () => {
  assert.equal(shanghaiDate(new Date("2026-11-01T17:00:00Z")), "2026-11-02");
});

const TELEGRAM_LIMIT = 4096;
const LONG_TEXT_CHARS = 500;
const MAX_ANALYSIS_CHARS = 90;
const POOL_SIZE = 30;
const TOO_FEW_ANSWERS = 2;
const AI_CHOSEN = 7;
const CODE_SUFFIX_DIGITS = 2;

// Any HTML tag, to measure what Telegram displays. Matches "<b>", "</a>"; rejects "a < b".
// Try it: https://regex101.com/?flavor=javascript&regex=%3C%5B%5E%3E%5D%2B%3E&flags=g&testString=%3Cb%3E%0A%3C%2Fa%3E%0Aa%20%3C%20b
const TAG_PATTERN = /<[^>]+>/g;

// A rule-screened pool, one stock per industry so diversification keeps them all, best score first.
const rulePool = () =>
  screenStocks(
    Array.from({ length: POOL_SIZE }, (_, index) =>
      quote({ code: `6000${String(index).padStart(CODE_SUFFIX_DIGITS, "0")}`, name: `股票${index}`, industry: `行业${index}` }),
    ),
    [],
    POOL_SIZE,
  );

const answerFor = (codes: readonly string[], reason: string, market = "市场观察"): string =>
  "```json\n" + JSON.stringify({ market, picks: codes.map((code) => ({ code, reason })) }) + "\n```";

const codesOf = (picks: readonly { readonly quote: StockQuote }[]): string[] => picks.map((pick) => pick.quote.code);

test("AI picks come from the pool in the AI's order; invented codes are dropped", () => {
  const pool = rulePool();
  const fromBottom = codesOf(pool).reverse().slice(0, PICK_LIMIT);
  const selection = parseSelection(answerFor(["999999", ...fromBottom], "很长".repeat(LONG_TEXT_CHARS)), pool, PICK_LIMIT);
  assert.deepEqual(codesOf(selection.picks), fromBottom);
  assert.ok(!selection.byCode.has("999999"));
  assert.equal(selection.byCode.get(fromBottom[0] ?? "")?.length, MAX_ANALYSIS_CHARS);
});

test("a short AI answer is topped up from the rule ranking; an unusable one throws", () => {
  const pool = rulePool();
  const chosen = codesOf(pool).reverse().slice(0, AI_CHOSEN);
  const selection = parseSelection(answerFor(chosen, "理由"), pool, PICK_LIMIT);
  assert.equal(selection.picks.length, PICK_LIMIT);
  assert.deepEqual(codesOf(selection.picks).slice(0, AI_CHOSEN), chosen);
  assert.deepEqual(codesOf(selection.picks).slice(AI_CHOSEN), codesOf(pool).slice(0, PICK_LIMIT - AI_CHOSEN));
  assert.throws(() => parseSelection(answerFor(chosen.slice(0, TOO_FEW_ANSWERS), "太少"), pool, PICK_LIMIT));
  assert.throws(() => parseSelection("无法分析", pool, PICK_LIMIT));
});

test("selection falls back across providers, then to the rule ranking", async () => {
  const pool = rulePool();
  const aiCodes = codesOf(pool).reverse().slice(0, PICK_LIMIT);
  const failing: LlmProvider = { name: "Claude (test)", complete: () => Promise.reject(new Error("overloaded")) };
  const working: LlmProvider = { name: "ChatGPT (test)", complete: () => Promise.resolve(answerFor(aiCodes, "资金持续流入")) };

  const byAi = await selectPicks(pool, [], "20261102", PICK_LIMIT, [failing, working]);
  assert.equal(byAi.analysis?.author, "ChatGPT (test)");
  assert.equal(byAi.analysis?.poolSize, POOL_SIZE);
  assert.deepEqual(codesOf(byAi.picks), aiCodes);

  const ruleTop = codesOf(pool).slice(0, PICK_LIMIT);
  const withoutAi = await selectPicks(pool, [], "20261102", PICK_LIMIT, []);
  assert.equal(withoutAi.analysis, undefined);
  assert.deepEqual(codesOf(withoutAi.picks), ruleTop);
  assert.deepEqual(codesOf((await selectPicks(pool, [], "20261102", PICK_LIMIT, [failing])).picks), ruleTop);
});

test("push shows how stocks were chosen and stays under Telegram's limit at maximum length", () => {
  const pool = rulePool();
  const parsed = parseSelection(
    answerFor(codesOf(pool).slice(0, PICK_LIMIT), "长".repeat(LONG_TEXT_CHARS), "观".repeat(LONG_TEXT_CHARS)),
    pool,
    PICK_LIMIT,
  );
  const analysis = { market: parsed.market, byCode: parsed.byCode, poolSize: POOL_SIZE, author: "Claude (test)" };
  const meta = { tradeDate: "20261102", source: "东方财富" };

  const telegram = toStockTelegramHtml(parsed.picks, "2026/11/03", meta, analysis);
  const visible = telegram.replace(TAG_PATTERN, "");
  assert.ok(visible.length < TELEGRAM_LIMIT, `visible length ${visible.length}`);
  assert.ok(telegram.includes("AI 从 30 只量化初选股中精选"));
  assert.ok(telegram.includes("🤖 AI 市场观察（Claude (test)）"));
  assert.ok(telegram.includes("🤖 AI：长长"));
  assert.ok(toStockEmailHtml(parsed.picks, "2026/11/03", meta, analysis).includes("AI 市场观察"));
  const ruleOnly = toStockTelegramHtml(parsed.picks, "2026/11/03", meta);
  assert.ok(ruleOnly.includes("按量化得分选出"));
  assert.ok(!ruleOnly.includes("🤖"));
});
