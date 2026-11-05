import { extractJson, withFirstWorkingProvider, type LlmProvider } from "../tools/llm.ts";
import type { Recommendation } from "./screener.ts";
import type { IndustryFlow } from "./types.ts";

/** What the AI added: its market read and why it chose each stock. */
export type StockAnalysis = {
  /** A short read of the market from the sector flows and the candidates. */
  readonly market: string;
  /** Why the AI picked each stock, by code. */
  readonly byCode: ReadonlyMap<string, string>;
  /** How many rule-screened candidates the AI chose from. */
  readonly poolSize: number;
  /** e.g. "Claude (claude-sonnet-5-5)". */
  readonly author: string;
};

export type Selection = {
  readonly picks: readonly Recommendation[];
  /** Absent when no AI is configured or every provider failed; the picks are then the rule ranking. */
  readonly analysis?: StockAnalysis;
};

const MAX_TOKENS = 4_000;
const TOP_INDUSTRIES = 10;
const YI = 100_000_000;
const DECIMALS = 2;
const PE_DECIMALS = 1;
// Hard caps keep the Telegram message under its 4096-character limit whatever the AI writes.
const MAX_MARKET_CHARS = 150;
const MAX_ANALYSIS_CHARS = 90;
/** An answer choosing fewer valid stocks than this share of the limit is treated as a failure. */
const MIN_CHOSEN_SHARE = 0.5;

const SYSTEM_PROMPT = `你是一名严谨的 A 股市场分析师。量化规则已经从全市场初选出一批股票，你负责从中精选出最值得关注的几只，并说明理由，读者是个人投资者。
选择时综合考虑：主力资金是否持续、量价是否配合、所属行业的资金热度和景气度、估值是否合理、短期是否已经过热；同一行业不要选太多。
规则：
1. 只能从给出的候选股票里选，用候选里的代码。
2. 只依据用户提供的行情数据，以及公司主营业务等公开常识来分析；不编造新闻、公告、政策、业绩数字。
3. 不给出买入/卖出建议、目标价或仓位建议，只做客观分析，可以指出风险。
4. 优先选择严格筛选的股票；放宽筛选和观察候选仅用于补足。缺失数据表示无法验证，不可当作资金流入、放量或上涨的证据。
只输出 JSON，不要输出任何其他文字。`;

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const fixed = (value: number, digits = DECIMALS): string => (Number.isFinite(value) ? value.toFixed(digits) : "-");

const describeCandidate = ({ quote, reasons, risk, score, screeningNote }: Recommendation): string =>
  [
    `- ${quote.code} ${quote.name}${quote.industry ? `（${quote.industry}）` : ""}，量化得分 ${fixed(score, 0)}`,
    `  价格 ${fixed(quote.price)}，涨幅 ${fixed(quote.changePct)}%，近 5 日 ${fixed(quote.change5dPct)}%，近 60 日 ${fixed(quote.change60dPct)}%`,
    `  主力净流入 ${fixed(quote.mainNetInflow / YI)} 亿（占成交额 ${fixed(quote.mainNetPct)}%），量比 ${fixed(quote.volumeRatio)}，换手率 ${fixed(quote.turnoverPct)}%`,
    `  市盈率 ${fixed(quote.pe, PE_DECIMALS)}，总市值 ${fixed(quote.marketCap / YI, 0)} 亿`,
    `  量化理由：${reasons.join("；")}`,
    ...(screeningNote ? [`  筛选条件：${screeningNote}`] : []),
    ...(risk ? [`  量化风险提示：${risk}`] : []),
  ].join("\n");

const describeIndustries = (industries: readonly IndustryFlow[]): string =>
  [...industries]
    .filter((industry) => Number.isFinite(industry.mainNetInflow))
    .sort((a, b) => b.mainNetInflow - a.mainNetInflow)
    .slice(0, TOP_INDUSTRIES)
    .map((industry, index) => `${index + 1}. ${industry.name}：主力净流入 ${fixed(industry.mainNetInflow / YI)} 亿，涨幅 ${fixed(industry.changePct)}%`)
    .join("\n");

export const buildSelectionPrompt = (
  pool: readonly Recommendation[],
  industries: readonly IndustryFlow[],
  tradeDate: string,
  limit: number,
): string => {
  const sectors = describeIndustries(industries);
  return `以下是行情日期 ${tradeDate || "未知"} 的快照中，量化规则（主力资金、量价、行业热度、估值）初选出的 ${pool.length} 只候选股票，按筛选档位优先、同档量化得分从高到低排列：

${pool.map(describeCandidate).join("\n\n")}
${sectors ? `\n当日主力资金净流入前 ${TOP_INDUSTRIES} 的行业：\n${sectors}\n` : ""}
请从中精选 ${Math.min(limit, pool.length)} 只最值得关注的股票，按推荐程度从高到低排列。输出：
- market：结合行业资金流向和候选股票的共性，写一段今日市场观察（不超过 100 字）
- picks：选中的股票，每只给出 code 和 reason（为什么选它、需要注意什么，不超过 60 字）

输出格式：{"market":"…","picks":[{"code":"300059","reason":"…"}]}`;
};

type ChosenLine = { readonly code: string; readonly reason: string };

const isChosenLine = (value: unknown): value is ChosenLine => {
  if (typeof value !== "object" || value === null) return false;
  const line: Record<string, unknown> = { ...value };
  return typeof line.code === "string" && typeof line.reason === "string" && line.reason !== "";
};

/**
 * The AI's picks, in its order and restricted to the pool, topped up from the rule ranking if it chose
 * fewer than `limit`. Throws when the answer is unusable.
 */
export const parseSelection = (
  text: string,
  pool: readonly Recommendation[],
  limit: number,
): { readonly picks: Recommendation[]; readonly market: string; readonly byCode: Map<string, string> } => {
  const parsed = extractJson(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("JSON 格式不对");
  const answer: Record<string, unknown> = { ...parsed };
  if (!Array.isArray(answer.picks)) throw new Error("JSON 里没有 picks 数组");

  const byCode = new Map(
    answer.picks
      .filter(isChosenLine)
      // Only codes from the pool: the AI must not invent or bring in stocks the rules never screened.
      .filter((line) => pool.some((candidate) => candidate.quote.code === line.code))
      .slice(0, limit)
      .map((line) => [line.code, truncate(line.reason.trim(), MAX_ANALYSIS_CHARS)]),
  );
  const wanted = Math.min(limit, pool.length);
  if (byCode.size < wanted * MIN_CHOSEN_SHARE) throw new Error(`只选出 ${byCode.size} 只有效股票`);

  const chosen = [...byCode.keys()].flatMap((code) => pool.filter((candidate) => candidate.quote.code === code));
  const topUp = pool.filter((candidate) => !byCode.has(candidate.quote.code)).slice(0, wanted - chosen.length);
  const market = typeof answer.market === "string" ? truncate(answer.market.trim(), MAX_MARKET_CHARS) : "";
  // The AI may reorder candidates within a tier, but a relaxed pick must not outrank a strict one.
  const picks = [...chosen, ...topUp].sort((a, b) => (a.screeningTier ?? 0) - (b.screeningTier ?? 0));
  return { picks, market, byCode };
};

/**
 * Lets the AI choose `limit` stocks from the rule-screened pool and explain each choice.
 * Without a configured or working AI, the top of the rule ranking is used as is.
 */
export const selectPicks = async (
  pool: readonly Recommendation[],
  industries: readonly IndustryFlow[],
  tradeDate: string,
  limit: number,
  providers: readonly LlmProvider[],
): Promise<Selection> => {
  const byRules = { picks: pool.slice(0, limit) };
  if (providers.length === 0) {
    console.log("ℹ️ 未配置 ANTHROPIC_API_KEY / OPENAI_API_KEY，按量化得分选股");
    return byRules;
  }
  const request = {
    system: SYSTEM_PROMPT,
    prompt: buildSelectionPrompt(pool, industries, tradeDate, limit),
    maxTokens: MAX_TOKENS,
  };
  try {
    const { result, provider } = await withFirstWorkingProvider(providers, async (candidate) =>
      parseSelection(await candidate.complete(request), pool, limit),
    );
    return {
      picks: result.picks,
      analysis: { market: result.market, byCode: result.byCode, poolSize: pool.length, author: provider.name },
    };
  } catch {
    console.warn("⚠️ 所有 AI 服务都失败了，按量化得分选股");
    return byRules;
  }
};
