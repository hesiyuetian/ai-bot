/** Where an item comes from; decides its base weight and, without AI, its category. */
export type SourceKind = "official" | "media" | "community" | "paper";

export type NewsItem = {
  readonly title: string;
  readonly url: string;
  /** Display name, e.g. "OpenAI" or "Hacker News". */
  readonly source: string;
  readonly kind: SourceKind;
  /** Epoch milliseconds. */
  readonly publishedAt: number;
  /** Short plain-text description, possibly empty. */
  readonly excerpt: string;
  /** Hacker News points or Hugging Face upvotes; 0 when the source has none. */
  readonly points: number;
};

/** One story after merging the items that cover it. */
export type Story = {
  readonly item: NewsItem;
  /** Every source that covered it, the main item's first. */
  readonly sources: readonly string[];
  readonly points: number;
  readonly score: number;
};

export const CATEGORIES = ["release", "company", "paper", "opensource", "discussion"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  release: "🚀 模型 / 产品发布",
  company: "🏢 行业 / 公司动态",
  paper: "📄 论文",
  opensource: "🛠 开源 / 工具",
  discussion: "💬 社区热议",
};

export type DigestEntry = {
  readonly story: Story;
  readonly category: Category;
  /** Chinese headline. */
  readonly title: string;
  /** One-sentence Chinese summary, possibly empty. */
  readonly summary: string;
  /** Why it matters; only AI digests have it. */
  readonly why: string;
};

export type Digest = {
  readonly entries: readonly DigestEntry[];
  /** Who picked and summarized the entries, e.g. "Claude (claude-sonnet-5-5)" or "规则排序". */
  readonly author: string;
};
