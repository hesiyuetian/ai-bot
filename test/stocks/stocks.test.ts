import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCLAIMER, toStockEmailHtml, toStockTelegramHtml } from "../../src/stocks/format.ts";
import { parseStockRow, type StockQuote } from "../../src/stocks/quotes.ts";
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

test("filters out ST, new, near-limit-up, illiquid and loss-making stocks", () => {
  assert.ok(isEligible(quote()));
  assert.ok(!isEligible(quote({ name: "*ST 中天" })));
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
  const telegram = toStockTelegramHtml(picks, "2026/11/02", "20261030");
  assert.ok(telegram.includes("A&amp;B"));
  assert.ok(telegram.includes("• 主力资金净流入"));
  assert.ok(telegram.includes(DISCLAIMER));
  assert.ok(toStockEmailHtml(picks, "2026/11/02", "20261030").includes("数据基于 20261030 收盘"));
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
