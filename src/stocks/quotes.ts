import { describeError } from "../tools/async.ts";
import { fetchEastmoneySnapshot } from "./sources/eastmoney.ts";
import { fetchSinaTencentSnapshot } from "./sources/sina-tencent.ts";
import type { MarketSnapshot } from "./types.ts";

type Source = {
  readonly name: string;
  readonly fetch: () => Promise<MarketSnapshot>;
};

// Eastmoney has the richest data (industry flows included) but often refuses overseas IPs such as
// GitHub Actions runners; Sina + Tencent answer from abroad and cover every other factor.
const SOURCES: readonly Source[] = [
  { name: "东方财富", fetch: fetchEastmoneySnapshot },
  { name: "新浪财经 + 腾讯行情", fetch: fetchSinaTencentSnapshot },
];

const fetchFirstAvailable = async (sources: readonly Source[], failures: readonly string[]): Promise<MarketSnapshot> => {
  const [source, ...fallbacks] = sources;
  if (!source) throw new Error(`所有行情数据源都请求失败:\n${failures.join("\n")}`);
  try {
    const snapshot = await source.fetch();
    if (snapshot.quotes.length === 0) throw new Error("没有返回任何股票");
    return snapshot;
  } catch (error: unknown) {
    const failure = `${source.name}: ${describeError(error)}`;
    console.warn(`⚠️ ${failure}${fallbacks.length > 0 ? "，改用备用数据源" : ""}`);
    return fetchFirstAvailable(fallbacks, [...failures, failure]);
  }
};

/** Market data from the first source that answers. */
export const fetchMarketSnapshot = (): Promise<MarketSnapshot> => fetchFirstAvailable(SOURCES, []);
