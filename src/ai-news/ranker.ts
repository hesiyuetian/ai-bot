import type { NewsItem, SourceKind, Story } from "./types.ts";

const HOUR_MS = 3_600_000;
/** A day plus slack for Actions start delays; papers get two since Daily Papers updates once a day. */
const NEWS_WINDOW_HOURS = 26;
const PAPER_WINDOW_HOURS = 48;

const SIMILAR_TITLE_THRESHOLD = 0.6;
const MIN_TOKENS_TO_COMPARE = 3;

const OFFICIAL_WEIGHT = 30;
const MEDIA_WEIGHT = 15;
const COMMUNITY_WEIGHT = 10;
const PAPER_WEIGHT = 5;
const KIND_WEIGHT: Readonly<Record<SourceKind, number>> = {
  official: OFFICIAL_WEIGHT,
  media: MEDIA_WEIGHT,
  community: COMMUNITY_WEIGHT,
  paper: PAPER_WEIGHT,
};

const HN_POINTS_PER_SCORE = 10;
const UPVOTES_PER_SCORE = 3;
/** Points needed for one score point; feeds carry no points, so their divisor never matters. */
const POINTS_PER_SCORE: Readonly<Record<SourceKind, number>> = {
  official: 1,
  media: 1,
  community: HN_POINTS_PER_SCORE,
  paper: UPVOTES_PER_SCORE,
};
const MAX_POINTS_SCORE = 40;
const EXTRA_SOURCE_SCORE = 15;

// Latin words or digits. Matches "gpt", "5" in "gpt-5"; rejects "-".
// Try it: https://regex101.com/?flavor=javascript&regex=%5Ba-z0-9%5D%2B&flags=g&testString=gpt-5%0A-
const WORD_PATTERN = /[a-z0-9]+/g;

// Runs of CJK characters. Matches "发布新模型" in "OpenAI 发布新模型"; rejects "OpenAI".
// Try it: https://regex101.com/?flavor=javascript&regex=%5B%5Cu4e00-%5Cu9fff%5D%2B&flags=g&testString=OpenAI%20%E5%8F%91%E5%B8%83%E6%96%B0%E6%A8%A1%E5%9E%8B%0AOpenAI
const CJK_RUN_PATTERN = /[一-鿿]+/g;

// Trailing slashes of a URL path. Matches "/" in "/blog/post/"; rejects "/blog/post".
// Try it: https://regex101.com/?flavor=javascript&regex=%5C%2F%2B%24&flags=&testString=%2Fblog%2Fpost%2F%0A%2Fblog%2Fpost
const TRAILING_SLASHES_PATTERN = /\/+$/;

const WWW_PREFIX = "www.";
const BIGRAM_LENGTH = 2;

export const windowStart = (now: number, kind: SourceKind): number =>
  now - (kind === "paper" ? PAPER_WINDOW_HOURS : NEWS_WINDOW_HOURS) * HOUR_MS;

/** Same page despite tracking parameters, "www." or a trailing slash. */
export const normalizeUrl = (url: string): string => {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.startsWith(WWW_PREFIX) ? hostname.slice(WWW_PREFIX.length) : hostname;
    return `${host}${pathname.replace(TRAILING_SLASHES_PATTERN, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** Latin words plus CJK character pairs, so Chinese titles can be compared without a segmenter. */
const titleTokens = (title: string): Set<string> => {
  const lower = title.toLowerCase();
  const words = lower.match(WORD_PATTERN) ?? [];
  const cjkPairs = (lower.match(CJK_RUN_PATTERN) ?? []).flatMap((run) =>
    Array.from({ length: Math.max(run.length - 1, 1) }, (_, index) => run.slice(index, index + BIGRAM_LENGTH)),
  );
  return new Set([...words, ...cjkPairs]);
};

export const titleSimilarity = (a: string, b: string): number => {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size < MIN_TOKENS_TO_COMPARE || right.size < MIN_TOKENS_TO_COMPARE) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / (left.size + right.size - shared);
};

const isSameStory = (a: NewsItem, b: NewsItem): boolean =>
  normalizeUrl(a.url) === normalizeUrl(b.url) || titleSimilarity(a.title, b.title) >= SIMILAR_TITLE_THRESHOLD;

const pointsScore = (item: NewsItem): number => Math.min(item.points / POINTS_PER_SCORE[item.kind], MAX_POINTS_SCORE);

const toStory = (group: readonly NewsItem[]): Story | undefined => {
  const [main] = group;
  if (!main) return undefined;
  const sources = [...new Set(group.map((item) => item.source))];
  const pointsScores = group.map(pointsScore);
  return {
    item: main,
    sources,
    points: Math.max(...group.map((item) => item.points)),
    score: KIND_WEIGHT[main.kind] + Math.max(...pointsScores) + (sources.length - 1) * EXTRA_SOURCE_SCORE,
  };
};

/** Groups items about the same story; the highest-weight source leads each group. */
const groupStories = (items: readonly NewsItem[]): NewsItem[][] =>
  [...items]
    .sort((a, b) => KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind] || b.points - a.points)
    .reduce<NewsItem[][]>((groups, item) => {
      const group = groups.find((candidate) => candidate.some((member) => isSameStory(member, item)));
      if (!group) return [...groups, [item]];
      group.push(item);
      return groups;
    }, []);

/** Recent items merged into stories, best first. */
export const rankStories = (items: readonly NewsItem[], now: number): Story[] =>
  groupStories(items.filter((item) => item.publishedAt >= windowStart(now, item.kind) && item.publishedAt <= now))
    .map(toStory)
    .filter((story): story is Story => story !== undefined)
    .sort((a, b) => b.score - a.score);
