export type StockQuote = {
  readonly code: string;
  readonly name: string;
  readonly url: string;
  /** Empty when the source has no industry data. */
  readonly industry: string;
  readonly price: number;
  readonly changePct: number;
  readonly change5dPct: number;
  readonly change60dPct: number;
  /** Turnover in CNY. */
  readonly amount: number;
  readonly turnoverPct: number;
  readonly volumeRatio: number;
  readonly pe: number;
  /** In CNY. */
  readonly marketCap: number;
  /** Net inflow of large and extra-large orders, in CNY. */
  readonly mainNetInflow: number;
  readonly mainNetPct: number;
  /** "YYYYMMDD", empty when unknown. */
  readonly listDate: string;
  /** "YYYYMMDD" of the session these numbers belong to. */
  readonly tradeDate: string;
};

export type IndustryFlow = {
  readonly name: string;
  readonly changePct: number;
  readonly mainNetInflow: number;
};

/** The candidates to screen: the A-shares with the largest main-capital inflow in the latest session. */
export type MarketSnapshot = {
  readonly source: string;
  readonly quotes: readonly StockQuote[];
  readonly industries: readonly IndustryFlow[];
};

const BEIJING_CODE_PREFIXES = ["4", "8", "92"] as const;
const SHANGHAI_CODE_PREFIX = "6";

export const quoteUrl = (code: string): string => {
  if (BEIJING_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return `https://quote.eastmoney.com/bj/${code}.html`;
  return `https://quote.eastmoney.com/${code.startsWith(SHANGHAI_CODE_PREFIX) ? "sh" : "sz"}${code}.html`;
};
