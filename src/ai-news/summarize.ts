import { inSequence } from "../tools/async.ts";
import { extractJson, withFirstWorkingProvider, type LlmProvider } from "../tools/llm.ts";
import { translateToChinese } from "../tools/translate.ts";
import { CATEGORIES, type Category, type Digest, type DigestEntry, type SourceKind, type Story } from "./types.ts";

/** How many top stories the AI chooses from. */
const AI_CANDIDATES = 40;
const MAX_TOKENS = 4_000;
const MAX_EXCERPT_CHARS = 300;
const RULE_SUMMARY_CHARS = 120;
const MAX_PER_CATEGORY = 4;
/** An AI answer naming fewer valid stories than this share of the limit is treated as a failure. */
const MIN_VALID_SHARE = 0.5;
const TRANSLATE_GAP_MS = 300;

const CATEGORY_BY_KIND: Readonly<Record<SourceKind, Category>> = {
  official: "release",
  media: "company",
  paper: "paper",
  community: "discussion",
};

const SYSTEM_PROMPT = `你是一名资深 AI 行业编辑，每天早上为中文读者挑选过去 24 小时 AI 圈最值得关注的事件。
判断标准：对行业的影响 > 新颖程度 > 讨论热度。优先：重要模型/产品发布、头部公司重大动态、有影响力的论文和开源项目。
避免：营销软文、重复报道同一事件、与 AI 关系不大的内容。只输出 JSON，不要输出任何其他文字。`;

type AiEntry = {
  readonly id: number;
  readonly category: Category;
  readonly title: string;
  readonly summary: string;
  readonly why: string;
};

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

const describeHeat = (story: Story): string =>
  [
    story.item.kind === "community" && story.points > 0 ? `HN ${story.points} 分` : "",
    story.item.kind === "paper" && story.points > 0 ? `${story.points} 赞` : "",
    story.sources.length > 1 ? `${story.sources.length} 个来源报道` : "",
  ]
    .filter(Boolean)
    .join("，");

export const buildPrompt = (stories: readonly Story[], limit: number): string => {
  const candidates = stories.map((story, index) =>
    [
      `[${index + 1}] (${story.sources.join(" / ")}) ${story.item.title}`,
      story.item.excerpt ? `    简介: ${truncate(story.item.excerpt, MAX_EXCERPT_CHARS)}` : "",
      describeHeat(story) ? `    热度: ${describeHeat(story)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `以下是过去 24 小时的 ${stories.length} 条 AI 相关候选内容：

${candidates.join("\n\n")}

请选出最重要的 ${limit} 条（不足则全选），按重要程度从高到低排列，同一事件只选一条。每条给出：
- id：候选编号
- category：${CATEGORIES.join(" / ")} 之一（release=模型/产品发布，company=行业/公司动态，paper=论文，opensource=开源/工具，discussion=社区热议）
- title：简洁的中文标题（不超过 30 字）
- summary：一句话中文摘要（不超过 60 字）
- why：为什么值得关注（不超过 40 字）

输出格式：{"items":[{"id":1,"category":"release","title":"…","summary":"…","why":"…"}]}`;
};

const isCategory = (value: unknown): value is Category => CATEGORIES.some((category) => category === value);

const isAiEntry = (value: unknown): value is AiEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry: Record<string, unknown> = { ...value };
  return (
    typeof entry.id === "number" &&
    isCategory(entry.category) &&
    typeof entry.title === "string" &&
    entry.title !== "" &&
    typeof entry.summary === "string" &&
    typeof entry.why === "string"
  );
};

/** Turns an AI answer into digest entries; throws when too few usable entries come back. */
export const parseAiDigest = (text: string, stories: readonly Story[], limit: number): DigestEntry[] => {
  const parsed = extractJson(text);
  const items: unknown = typeof parsed === "object" && parsed !== null && "items" in parsed ? parsed.items : undefined;
  if (!Array.isArray(items)) throw new Error("JSON 里没有 items 数组");

  const entries = items.filter(isAiEntry).flatMap((entry) => {
    const story = stories[entry.id - 1];
    return story ? [{ story, category: entry.category, title: entry.title, summary: entry.summary, why: entry.why }] : [];
  });
  const unique = entries.filter((entry, index) => entries.findIndex((other) => other.story === entry.story) === index);
  const wanted = Math.min(limit, stories.length);
  if (unique.length < wanted * MIN_VALID_SHARE) throw new Error(`只解析出 ${unique.length} 条有效内容`);
  return unique.slice(0, limit);
};

/**
 * Top stories by score, at most MAX_PER_CATEGORY per category so one busy source can't fill the list;
 * on quiet days the leftover slots go to the next best stories regardless of category.
 */
export const pickByRules = (stories: readonly Story[], limit: number): Story[] => {
  const capped = stories.reduce<Story[]>((picks, story) => {
    const category = CATEGORY_BY_KIND[story.item.kind];
    const sameCategory = picks.filter((pick) => CATEGORY_BY_KIND[pick.item.kind] === category).length;
    return picks.length < limit && sameCategory < MAX_PER_CATEGORY ? [...picks, story] : picks;
  }, []);
  const leftovers = stories.filter((story) => !capped.includes(story)).slice(0, limit - capped.length);
  return stories.filter((story) => capped.includes(story) || leftovers.includes(story));
};

const toRuleEntry = async (story: Story): Promise<DigestEntry> => ({
  story,
  category: CATEGORY_BY_KIND[story.item.kind],
  title: await translateToChinese(story.item.title),
  summary: story.item.excerpt ? await translateToChinese(truncate(story.item.excerpt, RULE_SUMMARY_CHARS)) : "",
  why: "",
});

const digestByRules = async (stories: readonly Story[], limit: number): Promise<Digest> => ({
  // One at a time: the free translate endpoint answers bursts with HTTP 429.
  entries: await inSequence(
    pickByRules(stories, limit).map((story) => () => toRuleEntry(story)),
    TRANSLATE_GAP_MS,
  ),
  author: "规则排序",
});

/**
 * Lets the configured AI pick and summarize the top stories; falls back to rule-based ranking
 * with translated titles when no API key is set or every provider fails.
 */
export const buildDigest = async (
  stories: readonly Story[],
  limit: number,
  providers: readonly LlmProvider[],
): Promise<Digest> => {
  if (providers.length === 0) {
    console.log("ℹ️ 未配置 ANTHROPIC_API_KEY / OPENAI_API_KEY，使用规则排序");
    return digestByRules(stories, limit);
  }

  const candidates = stories.slice(0, AI_CANDIDATES);
  const request = { system: SYSTEM_PROMPT, prompt: buildPrompt(candidates, limit), maxTokens: MAX_TOKENS };
  try {
    const { result, provider } = await withFirstWorkingProvider(providers, async (candidate) =>
      parseAiDigest(await candidate.complete(request), candidates, limit),
    );
    return { entries: result, author: provider.name };
  } catch {
    console.warn("⚠️ 所有 AI 服务都失败了，改用规则排序");
    return digestByRules(stories, limit);
  }
};
