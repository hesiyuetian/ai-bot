import { describeError } from "../../tools/async.ts";
import type { NewsItem } from "../types.ts";
import { fetchHackerNews } from "./hacker-news.ts";
import { fetchHfPapers } from "./hf-papers.ts";
import { fetchFeed, type Feed } from "./rss.ts";

// Every feed was checked to answer with RSS. Not included: Anthropic (no feed), 机器之心 (feed retired),
// Reddit (blocks scripts).
const FEEDS: readonly Feed[] = [
  { name: "OpenAI", url: "https://openai.com/news/rss.xml", kind: "official" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", kind: "official" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/", kind: "official" },
  { name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", kind: "official" },
  { name: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/", kind: "media" },
  { name: "量子位", url: "https://www.qbitai.com/feed", kind: "media" },
];

type Source = {
  readonly name: string;
  readonly fetch: () => Promise<NewsItem[]>;
};

/** Items from every source; a failing source is logged and skipped so one outage doesn't sink the digest. */
export const fetchAllNews = async (since: number): Promise<NewsItem[]> => {
  const sources: readonly Source[] = [
    ...FEEDS.map((feed) => ({ name: feed.name, fetch: () => fetchFeed(feed) })),
    { name: "Hacker News", fetch: () => fetchHackerNews(since) },
    { name: "HF Daily Papers", fetch: fetchHfPapers },
  ];
  const results = await Promise.allSettled(sources.map((source) => source.fetch()));
  return results.flatMap((result, index) => {
    const name = sources[index]?.name ?? "";
    if (result.status === "rejected") {
      console.warn(`⚠️ ${name} 获取失败: ${describeError(result.reason)}`);
      return [];
    }
    console.log(`📥 ${name}: ${result.value.length} 条`);
    return result.value;
  });
};
