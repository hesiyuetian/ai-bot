import type { NewsItem } from "../types.ts";

const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
const DISCUSSION_URL = "https://news.ycombinator.com/item?id=";
const TIMEOUT_MS = 20_000;
const MIN_POINTS = 80;
const MAX_HITS = 300;
const MS_PER_SECOND = 1000;

// AI-related headline words. Matches "Claude 5 is out", "New LLM benchmark", "OpenAI's agents"; rejects "BSD Unix history", "Said hello".
// Try it: https://regex101.com/?flavor=javascript&regex=%5Cb%28AI%7CAGI%7CLLMs%3F%7CGPT%5B-%5Cw.%5D%2A%7CChatGPT%7COpenAI%7CAnthropic%7CClaude%7CGemini%7CDeepMind%7CLlama%7CMistral%7CDeepSeek%7CQwen%7CHugging%5Cs%3FFace%7Ctransformers%3F%7Cdiffusion%7Cneural%7Cmachine%20learning%7Cdeep%20learning%7Cinference%7Cembeddings%3F%7Cagents%3F%7Cagentic%7CRAG%7Cfine-tun%5Cw%2A%7CNvidia%7CCUDA%7Cvibe%20coding%7CCopilot%7CCursor%29%5Cb&flags=i&testString=Claude%205%20is%20out%0ANew%20LLM%20benchmark%0AOpenAI%27s%20agents%0ABSD%20Unix%20history%0ASaid%20hello
const AI_TITLE_PATTERN = /\b(AI|AGI|LLMs?|GPT[-\w.]*|ChatGPT|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|DeepSeek|Qwen|Hugging\s?Face|transformers?|diffusion|neural|machine learning|deep learning|inference|embeddings?|agents?|agentic|RAG|fine-tun\w*|Nvidia|CUDA|vibe coding|Copilot|Cursor)\b/i;

type Hit = {
  readonly objectID: string;
  readonly title?: string | null;
  readonly url?: string | null;
  readonly points?: number | null;
  readonly created_at_i: number;
};

export const isAiHeadline = (title: string): boolean => AI_TITLE_PATTERN.test(title);

export const toNewsItem = (hit: Hit): NewsItem => ({
  title: hit.title ?? "",
  // Ask HN / Show HN text posts have no external link; point at the discussion instead.
  url: hit.url || `${DISCUSSION_URL}${hit.objectID}`,
  source: "Hacker News",
  kind: "community",
  publishedAt: hit.created_at_i * MS_PER_SECOND,
  excerpt: "",
  points: hit.points ?? 0,
});

/** AI stories that reached the given score on Hacker News since `since`. */
export const fetchHackerNews = async (since: number): Promise<NewsItem[]> => {
  const params = new URLSearchParams({
    tags: "story",
    numericFilters: `created_at_i>${Math.floor(since / MS_PER_SECOND)},points>${MIN_POINTS}`,
    hitsPerPage: String(MAX_HITS),
  });
  const response = await fetch(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { hits } = (await response.json()) as { readonly hits: readonly Hit[] };
  return hits.filter((hit) => hit.title && isAiHeadline(hit.title)).map(toNewsItem);
};
