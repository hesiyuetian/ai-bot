export type StockQuote = {
  readonly code: string;
  readonly name: string;
  readonly url: string;
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
  readonly marketCap: number;
  /** Net inflow of large and extra-large orders, in CNY. */
  readonly mainNetInflow: number;
  readonly mainNetPct: number;
  /** "YYYYMMDD". */
  readonly listDate: string;
  /** "YYYYMMDD" of the session these numbers belong to. */
  readonly tradeDate: string;
};

export type IndustryFlow = {
  readonly name: string;
  readonly changePct: number;
  readonly mainNetInflow: number;
};

// Eastmoney rate-limits push2 aggressively per IP; the numbered mirror usually still answers.
const HOSTS = ["https://push2.eastmoney.com", "https://82.push2.eastmoney.com"] as const;
const CLIST_PATH = "/api/qt/clist/get";
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2_000;
const PAGE_GAP_MS = 1_500;
const PAGE_SIZE = 100;

/** Every listed A-share: SZ main board, ChiNext, SH main board, STAR, Beijing exchange. */
const ALL_A_SHARES = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const INDUSTRY_BOARDS = "m:90+t:2";
const SORT_BY_MAIN_NET_INFLOW = "f62";

const STOCK_FIELDS = "f2,f3,f6,f8,f9,f10,f12,f13,f14,f20,f24,f26,f62,f100,f109,f184,f297";
const INDUSTRY_FIELDS = "f3,f14,f62";

const SHANGHAI_MARKET = 1;
const BEIJING_CODE_PREFIXES = ["4", "8", "92"] as const;

type RawRow = Readonly<Record<string, string | number | null | undefined>>;
type ClistResponse = { readonly data?: { readonly diff?: readonly RawRow[] | null } | null };

/** Eastmoney marks missing values (suspended stocks, loss-making PE) with "-". */
const toNumber = (value: RawRow[string]): number => (typeof value === "number" ? value : Number.NaN);
const toText = (value: RawRow[string]): string => (value === null || value === undefined ? "" : String(value));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const quoteUrl = (code: string, market: number): string => {
  if (BEIJING_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return `https://quote.eastmoney.com/bj/${code}.html`;
  return `https://quote.eastmoney.com/${market === SHANGHAI_MARKET ? "sh" : "sz"}${code}.html`;
};

export const parseStockRow = (row: RawRow): StockQuote => {
  const code = toText(row.f12);
  return {
    code,
    name: toText(row.f14),
    url: quoteUrl(code, toNumber(row.f13)),
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

const requestWithRetry = async (params: URLSearchParams, attempt = 0): Promise<readonly RawRow[]> => {
  const host = HOSTS[attempt % HOSTS.length] ?? HOSTS[0];
  try {
    return await requestPage(host, params);
  } catch (error: unknown) {
    if (attempt + 1 >= MAX_ATTEMPTS) {
      throw new Error(`东方财富行情请求失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(RETRY_DELAY_MS * (attempt + 1));
    return requestWithRetry(params, attempt + 1);
  }
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
  return requestWithRetry(params);
};

/** The A-shares with the largest main-capital net inflow in the latest session, strongest first. */
export const fetchTopInflowStocks = async (pages: number): Promise<StockQuote[]> => {
  const pageNumbers = Array.from({ length: pages }, (_, index) => index + 1);
  // One page at a time: parallel requests trip Eastmoney's rate limit.
  const rows = await pageNumbers.reduce<Promise<readonly RawRow[]>>(
    async (collected, page) => {
      const earlier = await collected;
      if (page > 1) await sleep(PAGE_GAP_MS);
      return [...earlier, ...(await fetchPage(ALL_A_SHARES, STOCK_FIELDS, page))];
    },
    Promise.resolve([]),
  );
  return rows.map(parseStockRow);
};

/** Industry boards ordered by main-capital net inflow, strongest first. */
export const fetchIndustryFlows = async (): Promise<IndustryFlow[]> => {
  await sleep(PAGE_GAP_MS);
  return (await fetchPage(INDUSTRY_BOARDS, INDUSTRY_FIELDS, 1)).map(parseIndustryRow);
};
