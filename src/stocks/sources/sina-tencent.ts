import { inSequence, withRetry } from "../../tools/async.ts";
import { quoteUrl, type MarketSnapshot, type StockQuote } from "../types.ts";

// Sina ranks stocks by main-capital net inflow but carries few quote fields; Tencent fills in the rest
// (volume ratio, PE, market cap, 5/60-day change). Neither has industry data.
const SINA_FLOW_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_bkzj_ssggzj";
const TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q=";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const REQUEST_GAP_MS = 500;
const SINA_PAGE_SIZE = 100;
/** The ranking mixes in ETFs; 3 pages leave roughly 200+ stocks. */
const SINA_PAGES = 3;
const TENCENT_BATCH_SIZE = 50;

const PERCENT = 100;
const WAN = 10_000;
const YI = 100_000_000;
const COMPACT_DATE_LENGTH = 8;

// Positions in Tencent's "~"-separated quote string.
const TENCENT_NAME = 1;
const TENCENT_CODE = 2;
const TENCENT_PRICE = 3;
const TENCENT_TIME = 30;
const TENCENT_CHANGE_PCT = 32;
const TENCENT_AMOUNT_WAN = 37;
const TENCENT_TURNOVER_PCT = 38;
const TENCENT_PE = 39;
const TENCENT_MARKET_CAP_YI = 45;
const TENCENT_VOLUME_RATIO = 49;
const TENCENT_SECURITY_TYPE = 61;
const TENCENT_CHANGE_5D_PCT = 63;
const TENCENT_CHANGE_60D_PCT = 71;

/** Tencent's type for common stocks ("GP-A", "GP-A-CYB", "GP" on the Beijing exchange); funds differ. */
const STOCK_TYPE_PREFIX = "GP";

// A-share stock symbols. Matches "sh600519", "sz300059", "bj920001"; rejects ETFs "sh512100", "sz159915".
// Try it: https://regex101.com/?flavor=javascript&regex=%5E%28sh6%7Csz0%7Csz3%7Cbj%29%5Cd%2B%24&flags=&testString=sh600519%0Asz300059%0Abj920001%0Ash512100%0Asz159915
const A_SHARE_SYMBOL_PATTERN = /^(sh6|sz0|sz3|bj)\d+$/;

// One Tencent quote line. Captures "sz300059" and the payload from v_sz300059="51~东方财富~…";
// Try it: https://regex101.com/?flavor=javascript&regex=v_%28%5Ba-z%5D%7B2%7D%5Cd%2B%29%3D%22%28%5B%5E%22%5D%2A%29%22&flags=g&testString=v_sz300059%3D%2251~%E4%B8%9C%E6%96%B9%E8%B4%A2%E5%AF%8C~300059%22%3B%0Av_pv_none_match%3D%221%22%3B
const TENCENT_LINE_PATTERN = /v_([a-z]{2}\d+)="([^"]*)"/g;

type SinaFlowRow = {
  readonly symbol: string;
  readonly r0_net: string;
  /** Fraction of turnover, e.g. "0.16". */
  readonly r0_ratio: string;
};

export type MainFlow = { readonly netInflow: number; readonly netPct: number };

const toNumber = (text: string | undefined): number => (text ? Number(text) : Number.NaN);

const fetchText = async (url: string, encoding: string): Promise<string> => {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.sina.com.cn/" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new TextDecoder(encoding).decode(await response.arrayBuffer());
};

const fetchSinaPage = async (page: number): Promise<readonly SinaFlowRow[]> => {
  const params = new URLSearchParams({
    page: String(page),
    num: String(SINA_PAGE_SIZE),
    sort: "r0_net",
    asc: "0",
    bankuai: "",
    shichang: "",
  });
  const text = await withRetry(() => fetchText(`${SINA_FLOW_URL}?${params}`, "utf-8"), MAX_ATTEMPTS, RETRY_DELAY_MS);
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("新浪资金流向响应格式异常");
  return rows;
};

/** Main-capital flow by symbol, for the A-shares with the largest inflow. */
const fetchMainFlows = async (): Promise<Map<string, MainFlow>> => {
  const pages = await inSequence(
    Array.from({ length: SINA_PAGES }, (_, index) => () => fetchSinaPage(index + 1)),
    REQUEST_GAP_MS,
  );
  return new Map(
    pages
      .flat()
      .filter((row) => A_SHARE_SYMBOL_PATTERN.test(row.symbol))
      .map((row) => [row.symbol, { netInflow: toNumber(row.r0_net), netPct: toNumber(row.r0_ratio) * PERCENT }]),
  );
};

export const parseTencentQuotes = (text: string): Map<string, readonly string[]> =>
  new Map([...text.matchAll(TENCENT_LINE_PATTERN)].map(([, symbol = "", payload = ""]) => [symbol, payload.split("~")]));

const toStockQuote = (fields: readonly string[], flow: MainFlow): StockQuote | undefined => {
  if (!fields[TENCENT_SECURITY_TYPE]?.startsWith(STOCK_TYPE_PREFIX)) return undefined;
  const code = fields[TENCENT_CODE] ?? "";
  return {
    code,
    name: fields[TENCENT_NAME] ?? "",
    url: quoteUrl(code),
    industry: "",
    price: toNumber(fields[TENCENT_PRICE]),
    changePct: toNumber(fields[TENCENT_CHANGE_PCT]),
    change5dPct: toNumber(fields[TENCENT_CHANGE_5D_PCT]),
    change60dPct: toNumber(fields[TENCENT_CHANGE_60D_PCT]),
    amount: toNumber(fields[TENCENT_AMOUNT_WAN]) * WAN,
    turnoverPct: toNumber(fields[TENCENT_TURNOVER_PCT]),
    volumeRatio: toNumber(fields[TENCENT_VOLUME_RATIO]),
    pe: toNumber(fields[TENCENT_PE]),
    marketCap: toNumber(fields[TENCENT_MARKET_CAP_YI]) * YI,
    mainNetInflow: flow.netInflow,
    mainNetPct: flow.netPct,
    listDate: "",
    tradeDate: (fields[TENCENT_TIME] ?? "").slice(0, COMPACT_DATE_LENGTH),
  };
};

/** Joins Sina's flow ranking with Tencent quotes; stocks missing from either side are dropped. */
export const mergeQuotes = (
  flows: ReadonlyMap<string, MainFlow>,
  quotes: ReadonlyMap<string, readonly string[]>,
): StockQuote[] =>
  [...flows].flatMap(([symbol, flow]) => {
    const fields = quotes.get(symbol);
    const quote = fields ? toStockQuote(fields, flow) : undefined;
    return quote ? [quote] : [];
  });

const fetchTencentQuotes = async (symbols: readonly string[]): Promise<Map<string, readonly string[]>> => {
  const batches = Array.from({ length: Math.ceil(symbols.length / TENCENT_BATCH_SIZE) }, (_, index) =>
    symbols.slice(index * TENCENT_BATCH_SIZE, (index + 1) * TENCENT_BATCH_SIZE),
  );
  const texts = await inSequence(
    batches.map((batch) => () =>
      withRetry(() => fetchText(`${TENCENT_QUOTE_URL}${batch.join(",")}`, "gbk"), MAX_ATTEMPTS, RETRY_DELAY_MS),
    ),
    REQUEST_GAP_MS,
  );
  return parseTencentQuotes(texts.join("\n"));
};

export const fetchSinaTencentSnapshot = async (): Promise<MarketSnapshot> => {
  const flows = await fetchMainFlows();
  const quotes = await fetchTencentQuotes([...flows.keys()]);
  return { source: "新浪财经 + 腾讯行情", quotes: mergeQuotes(flows, quotes), industries: [] };
};
