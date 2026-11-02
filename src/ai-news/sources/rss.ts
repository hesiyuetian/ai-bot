import { htmlToText } from "../../tools/html.ts";
import type { NewsItem, SourceKind } from "../types.ts";

export type Feed = {
  readonly name: string;
  readonly url: string;
  readonly kind: SourceKind;
};

const TIMEOUT_MS = 20_000;

// One RSS <item> or Atom <entry>. Matches "<item><title>a</title></item>"; rejects "<items>".
// Try it: https://regex101.com/?flavor=javascript&regex=%3C%28item%7Centry%29%5B%5Cs%3E%5D%5B%5Cs%5CS%5D%2A%3F%3C%5C%2F%5C1%3E&flags=g&testString=%3Citem%3E%3Ctitle%3Ea%3C%2Ftitle%3E%3C%2Fitem%3E%0A%3Citems%3E
const ENTRY_PATTERN = /<(item|entry)[\s>][\s\S]*?<\/\1>/g;

// Atom link. Captures the URL from "<link rel=\"alternate\" href=\"https://a.b\"/>"; rejects "<link>https://a.b</link>".
// Try it: https://regex101.com/?flavor=javascript&regex=%3Clink%5B%5E%3E%5D%2A%5Cshref%3D%22%28%5B%5E%22%5D%2B%29%22&flags=&testString=%3Clink%20rel%3D%22alternate%22%20href%3D%22https%3A%2F%2Fa.b%22%2F%3E%0A%3Clink%3Ehttps%3A%2F%2Fa.b%3C%2Flink%3E
const ATOM_LINK_PATTERN = /<link[^>]*\shref="([^"]+)"/;

// CDATA wrapper. Captures "text" from "<![CDATA[text]]>"; rejects "text".
// Try it: https://regex101.com/?flavor=javascript&regex=%3C%21%5C%5BCDATA%5C%5B%28%5B%5Cs%5CS%5D%2A%3F%29%5C%5D%5C%5D%3E&flags=g&testString=%3C%21%5BCDATA%5Btext%5D%5D%3E%0Atext
const CDATA_PATTERN = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

/** Text content of the first <tag>…</tag> in an entry, CDATA unwrapped; "" when absent. */
const tagText = (entry: string, tag: string): string => {
  // Built per tag. For "pubDate": captures the date from "<pubDate>Fri, 30 Oct 2026</pubDate>"; rejects "<pubDate/>".
  // Try it: https://regex101.com/?flavor=javascript&regex=%3CpubDate%28%3F%3A%5Cs%5B%5E%3E%5D%2A%29%3F%3E%28%5B%5Cs%5CS%5D%2A%3F%29%3C%2FpubDate%3E&flags=&testString=%3CpubDate%3EFri%2C%2030%20Oct%202026%2009%3A30%3A00%20GMT%3C%2FpubDate%3E%0A%3CpubDate%2F%3E
  const match = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return (match?.[1] ?? "").replace(CDATA_PATTERN, "$1").trim();
};

const firstNonEmpty = (entry: string, tags: readonly string[]): string =>
  tags.map((tag) => tagText(entry, tag)).find(Boolean) ?? "";

const parseEntry = (entry: string, feed: Feed): NewsItem | undefined => {
  const title = htmlToText(tagText(entry, "title"));
  const url = tagText(entry, "link") || (entry.match(ATOM_LINK_PATTERN)?.[1] ?? "");
  const publishedAt = Date.parse(firstNonEmpty(entry, ["pubDate", "published", "updated", "dc:date"]));
  if (!title || !url || Number.isNaN(publishedAt)) return undefined;
  return {
    title,
    url: htmlToText(url),
    source: feed.name,
    kind: feed.kind,
    publishedAt,
    // Descriptions are often escaped HTML ("&lt;img…&gt;"): the first pass decodes it, the second strips it.
    excerpt: htmlToText(htmlToText(firstNonEmpty(entry, ["description", "summary"]))),
    points: 0,
  };
};

export const parseFeed = (xml: string, feed: Feed): NewsItem[] =>
  [...xml.matchAll(ENTRY_PATTERN)]
    .map(([entry]) => parseEntry(entry, feed))
    .filter((item): item is NewsItem => item !== undefined);

export const fetchFeed = async (feed: Feed): Promise<NewsItem[]> => {
  const response = await fetch(feed.url, {
    headers: { "User-Agent": "Mozilla/5.0 (github-trending-push)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFeed(await response.text(), feed);
};
