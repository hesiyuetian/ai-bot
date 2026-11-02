export type TrendingRepo = {
  readonly fullName: string;
  readonly url: string;
  readonly description: string;
  readonly descriptionZh?: string;
  readonly language: string;
  readonly totalStars: number;
  readonly starsToday: number;
};

const TRENDING_URL = "https://github.com/trending?since=daily";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// HTML entity: named, decimal or hex. Matches "&amp;", "&#39;", "&#x2F;"; rejects "& amp;".
// Try it: https://regex101.com/?flavor=javascript&regex=%26%28%23x%5B0-9a-f%5D%2B%7C%23%5Cd%2B%7C%5Ba-z%5D%2B%29%3B&flags=gi&testString=%26amp%3B%0A%26%2339%3B%0A%26%23x2F%3B%0A%26%20amp%3B
const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

// Any HTML tag. Matches "<span class=\"a\">", "</p>"; rejects "a < b".
// Try it: https://regex101.com/?flavor=javascript&regex=%3C%5B%5E%3E%5Cs%5D%5B%5E%3E%5D%2A%3E&flags=g&testString=%3Cspan%20class%3D%22a%22%3E%0A%3C%2Fp%3E%0Aa%20%3C%20b
const TAG_PATTERN = /<[^>\s][^>]*>/g;

// Runs of whitespace. Matches "  \n  "; rejects "a".
// Try it: https://regex101.com/?flavor=javascript&regex=%5Cs%2B&flags=g&testString=%20%20%5Cn%20%20%0Aa
const WHITESPACE_PATTERN = /\s+/g;

// Anything that is not a digit. Matches "," in "12,345"; rejects "7".
// Try it: https://regex101.com/?flavor=javascript&regex=%5CD&flags=g&testString=%2C%0A12%2C345%0A7
const NON_DIGIT_PATTERN = /\D/g;

// One trending card. Matches "<article class=\"Box-row\">…</article>"; rejects "<article class=\"other\">".
// Try it: https://regex101.com/?flavor=javascript&regex=%3Carticle%20class%3D%22Box-row%22%5B%5Cs%5CS%5D%2A%3F%3C%5C%2Farticle%3E&flags=g&testString=%3Carticle%20class%3D%22Box-row%22%3E%E2%80%A6%3C%2Farticle%3E%0A%3Carticle%20class%3D%22other%22%3E
const ARTICLE_PATTERN = /<article class="Box-row"[\s\S]*?<\/article>/g;

// Repo path in the card's <h2> link. Captures "owner/repo" from "<h2 …><a href=\"/owner/repo\">"; rejects "href=\"/owner\"".
// Try it: https://regex101.com/?flavor=javascript&regex=%3Ch2%5B%5E%3E%5D%2A%3E%5B%5Cs%5CS%5D%2A%3Fhref%3D%22%5C%2F%28%5B%5E%22%2F%5D%2B%5C%2F%5B%5E%22%2F%5D%2B%29%22&flags=&testString=owner%2Frepo%0A%3Ch2%20%E2%80%A6%3E%3Ca%20href%3D%22%2Fowner%2Frepo%22%3E%0Ahref%3D%22%2Fowner%22
const REPO_PATH_PATTERN = /<h2[^>]*>[\s\S]*?href="\/([^"/]+\/[^"/]+)"/;

// Description paragraph. Captures the text of "<p class=\"col-9 color-fg-muted\">text</p>"; rejects "<p class=\"f6\">".
// Try it: https://regex101.com/?flavor=javascript&regex=%3Cp%20class%3D%22col-9%5B%5E%22%5D%2A%22%5B%5E%3E%5D%2A%3E%28%5B%5Cs%5CS%5D%2A%3F%29%3C%5C%2Fp%3E&flags=&testString=%3Cp%20class%3D%22col-9%20color-fg-muted%22%3Etext%3C%2Fp%3E%0A%3Cp%20class%3D%22f6%22%3E
const DESCRIPTION_PATTERN = /<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/;

// Language label. Captures "Rust" from "itemprop=\"programmingLanguage\">Rust</span>"; rejects "itemprop=\"name\"".
// Try it: https://regex101.com/?flavor=javascript&regex=itemprop%3D%22programmingLanguage%22%5B%5E%3E%5D%2A%3E%28%5B%5Cs%5CS%5D%2A%3F%29%3C%5C%2Fspan%3E&flags=&testString=Rust%0Aitemprop%3D%22programmingLanguage%22%3ERust%3C%2Fspan%3E%0Aitemprop%3D%22name%22
const LANGUAGE_PATTERN = /itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/;

// Total stars link. Captures the inner HTML of "href=\"/o/r/stargazers\">… 12,345</a>"; rejects "href=\"/o/r/forks\"".
// Try it: https://regex101.com/?flavor=javascript&regex=href%3D%22%5C%2F%5B%5E%22%5D%2B%5C%2Fstargazers%22%5B%5E%3E%5D%2A%3E%28%5B%5Cs%5CS%5D%2A%3F%29%3C%5C%2Fa%3E&flags=&testString=href%3D%22%2Fo%2Fr%2Fstargazers%22%3E%E2%80%A6%2012%2C345%3C%2Fa%3E%0Ahref%3D%22%2Fo%2Fr%2Fforks%22
const TOTAL_STARS_PATTERN = /href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/;

// Today's star count. Captures "1,234" from "1,234 stars today"; rejects "1,234 stars this week".
// Try it: https://regex101.com/?flavor=javascript&regex=%28%5B%5Cd%2C%5D%2B%29%5Cs%2Bstars%3F%5Cs%2Btoday&flags=&testString=1%2C234%0A1%2C234%20stars%20today%0A1%2C234%20stars%20this%20week
const STARS_TODAY_PATTERN = /([\d,]+)\s+stars?\s+today/;

const HEX_PREFIX = "#x";
const HEX_RADIX = 16;

const decodeEntity = (entity: string, body: string): string => {
  if (body.startsWith(HEX_PREFIX) || body.startsWith(HEX_PREFIX.toUpperCase())) {
    return String.fromCodePoint(parseInt(body.slice(HEX_PREFIX.length), HEX_RADIX));
  }
  if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
  return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
};

const toText = (html: string): string =>
  html.replace(TAG_PATTERN, "").replace(ENTITY_PATTERN, decodeEntity).replace(WHITESPACE_PATTERN, " ").trim();

const toNumber = (text: string): number => Number(text.replace(NON_DIGIT_PATTERN, "")) || 0;

const parseArticle = (article: string): TrendingRepo | undefined => {
  const path = article.match(REPO_PATH_PATTERN)?.[1];
  if (!path) return undefined;

  return {
    fullName: path,
    url: `https://github.com/${path}`,
    description: toText(article.match(DESCRIPTION_PATTERN)?.[1] ?? ""),
    language: toText(article.match(LANGUAGE_PATTERN)?.[1] ?? ""),
    totalStars: toNumber(toText(article.match(TOTAL_STARS_PATTERN)?.[1] ?? "")),
    starsToday: toNumber(article.match(STARS_TODAY_PATTERN)?.[1] ?? ""),
  };
};

export const parseTrending = (html: string): TrendingRepo[] =>
  [...html.matchAll(ARTICLE_PATTERN)]
    .map(([article]) => parseArticle(article))
    .filter((repo): repo is TrendingRepo => repo !== undefined);

export const fetchTopByStarsToday = async (limit: number): Promise<TrendingRepo[]> => {
  const response = await fetch(TRENDING_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (github-trending-push)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`GitHub Trending 请求失败: HTTP ${response.status}`);

  const repos = parseTrending(await response.text());
  if (repos.length === 0) throw new Error("没有解析到任何仓库，GitHub Trending 页面结构可能已变化");

  return [...repos].sort((a, b) => b.starsToday - a.starsToday).slice(0, limit);
};
