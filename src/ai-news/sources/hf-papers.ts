import type { NewsItem } from "../types.ts";

const DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers?limit=100";
const PAPER_URL = "https://huggingface.co/papers/";
const TIMEOUT_MS = 20_000;

type DailyPaper = {
  /** When the paper was featured on Daily Papers. */
  readonly publishedAt: string;
  readonly paper: {
    readonly id: string;
    readonly title: string;
    readonly summary?: string;
    readonly ai_summary?: string;
    readonly upvotes?: number;
  };
};

export const toNewsItem = ({ publishedAt, paper }: DailyPaper): NewsItem => ({
  title: paper.title,
  url: `${PAPER_URL}${paper.id}`,
  source: "HF Daily Papers",
  kind: "paper",
  publishedAt: Date.parse(publishedAt),
  excerpt: paper.ai_summary || paper.summary || "",
  points: paper.upvotes ?? 0,
});

/** Papers featured on Hugging Face Daily Papers, with their community upvotes. */
export const fetchHfPapers = async (): Promise<NewsItem[]> => {
  const response = await fetch(DAILY_PAPERS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return ((await response.json()) as readonly DailyPaper[]).map(toNewsItem);
};
