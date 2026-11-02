import type { IndustryFlow, StockQuote } from "./quotes.ts";

export type Recommendation = {
  readonly quote: StockQuote;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly risk?: string;
};

const YI = 100_000_000;
const MS_PER_DAY = 86_400_000;
const DECIMALS = 2;
const PE_DECIMALS = 1;

const MIN_PRICE = 3;
const MIN_MARKET_CAP = 5_000_000_000;
const MIN_AMOUNT = 300_000_000;
const MIN_LISTED_DAYS = 120;
/** Skip stocks that closed at or near limit-up: they rarely open buyable and chasing them is risky. */
const MAX_CHANGE_PCT = 9.5;
const MAX_CHANGE_5D_PCT = 25;
const MAX_PER_INDUSTRY = 2;
const MAX_REASONS = 5;

const MAIN_NET_PCT_CAP = 20;
const MAIN_NET_POINTS_PER_PCT = 1.5;
const TREND_POINTS = 10;
const HOT_INDUSTRY_RANK = 15;
const HOT_INDUSTRY_POINTS = 10;

const OVERSOLD_60D_PCT = -30;
const OVERHEATED_5D_PCT = 15;
const EXPENSIVE_PE = 100;
/** Above this the PE says more about collapsed earnings than about valuation. */
const MAX_PE = 200;

// Factor scoring bands. A metric inside the "ideal" range earns full points, inside the wider "ok" range half-ish.
const VOLUME_RATIO_IDEAL_MIN = 1.5;
const VOLUME_RATIO_IDEAL_MAX = 4;
const VOLUME_RATIO_OK_MIN = 1.2;
const VOLUME_RATIO_OK_MAX = 6;
const VOLUME_RATIO_IDEAL_POINTS = 20;
const VOLUME_RATIO_OK_POINTS = 10;

const TURNOVER_IDEAL_MIN = 3;
const TURNOVER_IDEAL_MAX = 15;
const TURNOVER_OK_MIN = 1.5;
const TURNOVER_OK_MAX = 20;
const TURNOVER_IDEAL_POINTS = 15;
const TURNOVER_OK_POINTS = 8;

const CHANGE_IDEAL_MIN = 2;
const CHANGE_IDEAL_MAX = 7;
const CHANGE_IDEAL_POINTS = 15;
const CHANGE_STRONG_POINTS = 8;
const CHANGE_MILD_POINTS = 4;

const LOW_PE_MAX = 30;
const LOW_PE_POINTS = 5;

/** Points for a metric falling in [min, max]; the first matching band wins. */
type Band = { readonly min: number; readonly max: number; readonly points: number };

const VOLUME_RATIO_BANDS: readonly Band[] = [
  { min: VOLUME_RATIO_IDEAL_MIN, max: VOLUME_RATIO_IDEAL_MAX, points: VOLUME_RATIO_IDEAL_POINTS },
  { min: VOLUME_RATIO_OK_MIN, max: VOLUME_RATIO_OK_MAX, points: VOLUME_RATIO_OK_POINTS },
];
const TURNOVER_BANDS: readonly Band[] = [
  { min: TURNOVER_IDEAL_MIN, max: TURNOVER_IDEAL_MAX, points: TURNOVER_IDEAL_POINTS },
  { min: TURNOVER_OK_MIN, max: TURNOVER_OK_MAX, points: TURNOVER_OK_POINTS },
];
const CHANGE_BANDS: readonly Band[] = [
  { min: CHANGE_IDEAL_MIN, max: CHANGE_IDEAL_MAX, points: CHANGE_IDEAL_POINTS },
  { min: CHANGE_IDEAL_MAX, max: Number.POSITIVE_INFINITY, points: CHANGE_STRONG_POINTS },
  { min: 0, max: CHANGE_IDEAL_MIN, points: CHANGE_MILD_POINTS },
];
const LOW_PE_BANDS: readonly Band[] = [{ min: 0, max: LOW_PE_MAX, points: LOW_PE_POINTS }];

// ST / *ST / 退市整理 names. Matches "*ST 中天", "退市海越"; rejects "中国平安".
// Try it: https://regex101.com/?flavor=javascript&regex=ST%7C%E9%80%80&flags=&testString=*ST%20%E4%B8%AD%E5%A4%A9%0A%E9%80%80%E5%B8%82%E6%B5%B7%E8%B6%8A%0A%E4%B8%AD%E5%9B%BD%E5%B9%B3%E5%AE%89
const RISK_NAME_PATTERN = /ST|退/;

// Compact date. Captures "2026", "11", "02" from "20261102"; rejects "2026-11-02".
// Try it: https://regex101.com/?flavor=javascript&regex=%5E%28%5Cd%7B4%7D%29%28%5Cd%7B2%7D%29%28%5Cd%7B2%7D%29%24&flags=&testString=20261102%0A2026-11-02
const COMPACT_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

const yi = (amount: number): string => (amount / YI).toFixed(DECIMALS);
const pct = (value: number): string => `${value.toFixed(DECIMALS)}%`;
const between = (value: number, min: number, max: number): boolean => value >= min && value <= max;
const bandPoints = (value: number, bands: readonly Band[]): number =>
  bands.find((band) => between(value, band.min, band.max))?.points ?? 0;

type Factor = {
  readonly points: (quote: StockQuote, industryRank: number | undefined) => number;
  readonly reason: (quote: StockQuote, industryRank: number | undefined) => string;
};

/** Ordered by importance; a pick lists the reasons that fired in this order. */
const FACTORS: readonly Factor[] = [
  {
    points: (quote) => Math.min(quote.mainNetPct, MAIN_NET_PCT_CAP) * MAIN_NET_POINTS_PER_PCT,
    reason: (quote) => `主力资金净流入 ${yi(quote.mainNetInflow)} 亿元，占成交额 ${pct(quote.mainNetPct)}`,
  },
  {
    points: (_, rank) => (rank !== undefined && rank <= HOT_INDUSTRY_RANK ? HOT_INDUSTRY_POINTS : 0),
    reason: (quote, rank) => `所属行业「${quote.industry}」主力净流入排名第 ${rank}，板块资金关注度高`,
  },
  {
    points: (quote) => bandPoints(quote.volumeRatio, VOLUME_RATIO_BANDS),
    reason: (quote) =>
      `量比 ${quote.volumeRatio.toFixed(DECIMALS)}，${quote.volumeRatio >= VOLUME_RATIO_IDEAL_MIN ? "成交明显放大" : "成交温和放大"}`,
  },
  {
    points: (quote) => bandPoints(quote.turnoverPct, TURNOVER_BANDS),
    reason: (quote) =>
      `换手率 ${pct(quote.turnoverPct)}，${between(quote.turnoverPct, TURNOVER_IDEAL_MIN, TURNOVER_IDEAL_MAX) ? "交投活跃" : "流动性尚可"}`,
  },
  {
    points: (quote) => bandPoints(quote.changePct, CHANGE_BANDS),
    reason: (quote) => `最近交易日上涨 ${pct(quote.changePct)}，走势偏强但未涨停`,
  },
  {
    points: (quote) => (quote.change60dPct > 0 && quote.change5dPct >= 0 ? TREND_POINTS : 0),
    reason: (quote) => `近 60 日涨 ${pct(quote.change60dPct)}、近 5 日涨 ${pct(quote.change5dPct)}，中短期趋势向上`,
  },
  {
    points: (quote) => bandPoints(quote.pe, LOW_PE_BANDS),
    reason: (quote) => `市盈率 ${quote.pe.toFixed(PE_DECIMALS)}，估值不高`,
  },
];

const RISKS: readonly { readonly applies: (quote: StockQuote) => boolean; readonly message: (quote: StockQuote) => string }[] = [
  {
    applies: (quote) => quote.change60dPct < OVERSOLD_60D_PCT,
    message: (quote) => `近 60 日累计下跌 ${pct(Math.abs(quote.change60dPct))}，属超跌反弹，波动可能较大`,
  },
  {
    applies: (quote) => quote.change5dPct > OVERHEATED_5D_PCT,
    message: (quote) => `近 5 日已涨 ${pct(quote.change5dPct)}，短线获利盘较多，谨防回调`,
  },
  {
    applies: (quote) => quote.pe > EXPENSIVE_PE,
    message: (quote) => `市盈率 ${quote.pe.toFixed(PE_DECIMALS)}，估值偏高`,
  },
];

const compactDateToTime = (yyyymmdd: string): number => Date.parse(yyyymmdd.replace(COMPACT_DATE_PATTERN, "$1-$2-$3"));

const listedDays = (quote: StockQuote): number =>
  (compactDateToTime(quote.tradeDate) - compactDateToTime(quote.listDate)) / MS_PER_DAY;

const hasCompleteData = (quote: StockQuote): boolean =>
  [quote.price, quote.changePct, quote.amount, quote.turnoverPct, quote.volumeRatio, quote.marketCap, quote.mainNetPct]
    .every(Number.isFinite);

export const isEligible = (quote: StockQuote): boolean =>
  hasCompleteData(quote) &&
  !RISK_NAME_PATTERN.test(quote.name) &&
  // Unknown listing dates yield NaN and pass; new listings are the ones to drop.
  !(listedDays(quote) < MIN_LISTED_DAYS) &&
  quote.price >= MIN_PRICE &&
  quote.marketCap >= MIN_MARKET_CAP &&
  quote.amount >= MIN_AMOUNT &&
  quote.mainNetInflow > 0 &&
  quote.changePct > 0 &&
  quote.changePct < MAX_CHANGE_PCT &&
  !(quote.change5dPct > MAX_CHANGE_5D_PCT) &&
  // Profitable companies only; Eastmoney reports a negative or missing PE for losses.
  quote.pe > 0 &&
  quote.pe <= MAX_PE;

const evaluate = (quote: StockQuote, industryRanks: ReadonlyMap<string, number>): Recommendation => {
  const rank = industryRanks.get(quote.industry);
  const scored = FACTORS.map((factor) => ({ factor, points: factor.points(quote, rank) })).filter(
    ({ points }) => points > 0,
  );
  const risk = RISKS.find((candidate) => candidate.applies(quote))?.message(quote);
  return {
    quote,
    score: scored.reduce((total, { points }) => total + points, 0),
    reasons: scored.slice(0, MAX_REASONS).map(({ factor }) => factor.reason(quote, rank)),
    ...(risk ? { risk } : {}),
  };
};

const rankIndustries = (industries: readonly IndustryFlow[]): Map<string, number> =>
  new Map(
    [...industries]
      .filter((industry) => Number.isFinite(industry.mainNetInflow))
      .sort((a, b) => b.mainNetInflow - a.mainNetInflow)
      .map((industry, index) => [industry.name, index + 1]),
  );

/** Keeps the ranking order but allows at most MAX_PER_INDUSTRY picks per industry, so one hot sector can't fill the list. */
const diversify = (ranked: readonly Recommendation[], limit: number): Recommendation[] =>
  ranked.reduce<{ picks: Recommendation[]; perIndustry: Map<string, number> }>(
    ({ picks, perIndustry }, recommendation) => {
      const industry = recommendation.quote.industry;
      const count = perIndustry.get(industry) ?? 0;
      if (picks.length >= limit || (industry && count >= MAX_PER_INDUSTRY)) return { picks, perIndustry };
      return { picks: [...picks, recommendation], perIndustry: new Map(perIndustry).set(industry, count + 1) };
    },
    { picks: [], perIndustry: new Map() },
  ).picks;

/** Scores the candidates on capital flow, volume, momentum, sector heat and valuation and returns the top picks. */
export const screenStocks = (
  quotes: readonly StockQuote[],
  industries: readonly IndustryFlow[],
  limit: number,
): Recommendation[] => {
  const industryRanks = rankIndustries(industries);
  const ranked = quotes
    .filter(isEligible)
    .map((quote) => evaluate(quote, industryRanks))
    .sort((a, b) => b.score - a.score || b.quote.mainNetInflow - a.quote.mainNetInflow);
  return diversify(ranked, limit);
};
