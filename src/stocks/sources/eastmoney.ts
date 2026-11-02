import { inSequence, withRetry } from "../../tools/async.ts";
import { quoteUrl, type IndustryFlow, type MarketSnapshot, type StockQuote } from "../types.ts";

// Eastmoney rate-limits push2 aggressively per IP; the numbered mirror usually still answers.
const HOSTS = ["https://push2.eastmoney.com", "https://82.push2.eastmoney.com"] as const;
const CLIST_PATH = "/api/qt/clist/get";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const REQUEST_GAP_MS = 1_500;
const PAGE_SIZE = 100;
/** 2 pages × 100 = the 200 stocks with the largest main-capital inflow; plenty of candidates for 10 picks. */
const STOCK_PAGES = 2;

/** Every listed A-share: SZ main board, ChiNext, SH main board, STAR, Beijing exchange. */
const ALL_A_SHARES = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const INDUSTRY_BOARDS = "m:90+t:2";
const SORT_BY_MAIN_NET_INFLOW = "f62";

const STOCK_FIELDS = "f2,f3,f6,f8,f9,f10,f12,f14,f20,f24,f26,f62,f100,f109,f184,f297";
const INDUSTRY_FIELDS = "f3,f14,f62";

type RawRow = Readonly<Record<string, string | number | null | undefined>>;
type ClistResponse = { readonly data?: { readonly diff?: readonly RawRow[] | null } | null };

/** Eastmoney marks missing values (suspended stocks, loss-making PE) with "-". */
const toNumber = (value: RawRow[string]): number => (typeof value === "number" ? value : Number.NaN);
const toText = (value: RawRow[string]): string => (value === null || value === undefined ? "" : String(value));

export const parseStockRow = (row: RawRow): StockQuote => {
  const code = toText(row.f12);
  return {
    code,
    name: toText(row.f14),
    url: quoteUrl(code),
    industry: toText(row.f100) === "-" ? "" : toText(row.f100),
    price: toNumber(row.f2),
    changePct: toNumber(row.f3),
    change5dPct: toNumber(row.f109),
    change60dPct: toNumber(row.f24),
    amount: toNumber(row.f6),
    turnoverPct: toNumber(row.f8),
    volumeRatio: toNumber(row.f10),
    pe: toNumber(row.f9),
    marketCap: toNumber(row.f20),
    mainNetInflow: toNumber(row.f62),
    mainNetPct: toNumber(row.f184),
    listDate: toText(row.f26),
    tradeDate: toText(row.f297),
  };
};

const parseIndustryRow = (row: RawRow): IndustryFlow => ({
  name: toText(row.f14),
  changePct: toNumber(row.f3),
  mainNetInflow: toNumber(row.f62),
});

const requestPage = async (host: string, params: URLSearchParams): Promise<readonly RawRow[]> => {
  const response = await fetch(`${host}${CLIST_PATH}?${params}`, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://quote.eastmoney.com/" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as ClistResponse;
  const rows = body.data?.diff;
  if (!rows) throw new Error("响应中没有数据");
  return rows;
};

const fetchPage = (filter: string, fields: string, page: number): Promise<readonly RawRow[]> => {
  const params = new URLSearchParams({
    pn: String(page),
    pz: String(PAGE_SIZE),
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: SORT_BY_MAIN_NET_INFLOW,
    fs: filter,
    fields,
  });
  return withRetry((attempt) => requestPage(HOSTS[attempt % HOSTS.length] ?? HOSTS[0], params), MAX_ATTEMPTS, RETRY_DELAY_MS);
};

export const fetchEastmoneySnapshot = async (): Promise<MarketSnapshot> => {
  const stockPages = Array.from({ length: STOCK_PAGES }, (_, index) => () => fetchPage(ALL_A_SHARES, STOCK_FIELDS, index + 1));
  const [industryRows = [], ...stockRows] = await inSequence(
    [() => fetchPage(INDUSTRY_BOARDS, INDUSTRY_FIELDS, 1), ...stockPages],
    REQUEST_GAP_MS,
  );
  return {
    source: "东方财富",
    quotes: stockRows.flat().map(parseStockRow),
    industries: industryRows.map(parseIndustryRow),
  };
};
