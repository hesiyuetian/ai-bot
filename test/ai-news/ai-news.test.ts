import assert from "node:assert/strict";
import { test } from "node:test";
import { toNewsEmailHtml, toNewsTelegramHtml } from "../../src/ai-news/format.ts";
import { normalizeUrl, rankStories, titleSimilarity } from "../../src/ai-news/ranker.ts";
import { isAiHeadline } from "../../src/ai-news/sources/hacker-news.ts";
import { parseFeed } from "../../src/ai-news/sources/rss.ts";
import { buildDigest, parseAiDigest, pickByRules } from "../../src/ai-news/summarize.ts";
import type { NewsItem, Story } from "../../src/ai-news/types.ts";
import type { LlmProvider } from "../../src/tools/llm.ts";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const HOUR_MS = 3_600_000;
const RECENT = NOW - HOUR_MS;
const TWO_DAYS_MS = 172_800_000;
const TWO_DAYS_AGO = NOW - TWO_DAYS_MS;
const SAME_STORY_SIMILARITY = 0.5;
const HN_POINTS = 520;
const PICK_LIMIT = 10;
const MAX_PER_CATEGORY = 4;
const OFFICIAL_POSTS = 6;
const TWO_STORIES = 2;

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item>
  <title><![CDATA[Introducing GPT-6 & friends]]></title>
  <link>https://openai.com/index/gpt-6/</link>
  <description>&lt;img src="x.png"&gt;Our &lt;b&gt;most capable&lt;/b&gt; model.</description>
  <pubDate>Mon, 02 Nov 2026 17:00:00 GMT</pubDate>
</item>
<item><title>No date</title><link>https://openai.com/x</link></item>
</channel></rss>`;

const ATOM = `<feed><entry>
  <title type="html">Gemini update</title>
  <link rel="alternate" href="https://deepmind.google/blog/gemini/"/>
  <updated>2026-11-02T10:00:00Z</updated>
  <summary>Faster and cheaper.</summary>
</entry></feed>`;

const item = (overrides: Partial<NewsItem>): NewsItem => ({
  title: "Untitled",
  url: "https://example.com/post",
  source: "TechCrunch",
  kind: "media",
  publishedAt: RECENT,
  excerpt: "",
  points: 0,
  ...overrides,
});

const story = (title: string, kind: NewsItem["kind"], url = `https://example.com/${encodeURIComponent(title)}`): Story => ({
  item: item({ title, kind, url }),
  sources: ["来源"],
  points: 0,
  score: 1,
});

test("parses RSS items, unwrapping CDATA and escaped HTML, skipping undated items", () => {
  const [first, ...rest] = parseFeed(RSS, { name: "OpenAI", url: "", kind: "official" });
  assert.equal(rest.length, 0);
  assert.equal(first?.title, "Introducing GPT-6 & friends");
  assert.equal(first?.excerpt, "Our most capable model.");
  assert.equal(first?.publishedAt, Date.parse("2026-11-02T17:00:00Z"));
  assert.equal(first?.kind, "official");
});

test("parses Atom entries with href links", () => {
  const [entry] = parseFeed(ATOM, { name: "DeepMind", url: "", kind: "official" });
  assert.equal(entry?.url, "https://deepmind.google/blog/gemini/");
  assert.equal(entry?.excerpt, "Faster and cheaper.");
});

test("keeps AI headlines from Hacker News only", () => {
  assert.ok(isAiHeadline("Claude 5 is out"));
  assert.ok(isAiHeadline("Running LLMs locally"));
  assert.ok(!isAiHeadline("The beginning of BSD Unix"));
  assert.ok(!isAiHeadline("Said hello to Paris"));
});

test("matches the same story across sources", () => {
  assert.equal(normalizeUrl("https://www.OpenAI.com/index/gpt-6/?utm=x"), "openai.com/index/gpt-6");
  assert.ok(titleSimilarity("OpenAI launches GPT-6 with agents", "OpenAI launches GPT-6 agents today") > SAME_STORY_SIMILARITY);
  assert.ok(titleSimilarity("OpenAI 发布新一代模型", "OpenAI 发布新一代推理模型") > SAME_STORY_SIMILARITY);
  assert.equal(titleSimilarity("GPT-6", "GPT-6"), 0);
});

test("merges coverage, drops stale items and ranks merged stories first", () => {
  const stories = rankStories(
    [
      item({ title: "OpenAI launches GPT-6 with agents", url: "https://openai.com/index/gpt-6", kind: "official", source: "OpenAI" }),
      item({ title: "OpenAI launches GPT-6 with agents", url: "https://openai.com/index/gpt-6/", kind: "community", source: "Hacker News", points: HN_POINTS }),
      item({ title: "A smaller media story about chips", url: "https://techcrunch.com/chips" }),
      item({ title: "Old news from two days ago", publishedAt: TWO_DAYS_AGO }),
    ],
    NOW,
  );
  assert.equal(stories.length, TWO_STORIES);
  assert.deepEqual(stories[0]?.sources, ["OpenAI", "Hacker News"]);
  assert.equal(stories[0]?.points, HN_POINTS);
  assert.equal(stories[0]?.item.kind, "official");
});

test("parses an AI answer wrapped in a code fence, ignoring bad ids and duplicates", () => {
  const stories = [story("A", "official"), story("B", "paper")];
  const answer = '```json\n{"items":[{"id":2,"category":"paper","title":"论文B","summary":"摘要","why":"原因"},' +
    '{"id":2,"category":"paper","title":"重复","summary":"","why":""},' +
    '{"id":9,"category":"release","title":"不存在","summary":"","why":""},' +
    '{"id":1,"category":"nonsense","title":"类别错","summary":"","why":""}]}\n```';
  const entries = parseAiDigest(answer, stories, PICK_LIMIT);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.title, "论文B");
  assert.throws(() => parseAiDigest("抱歉，我无法完成", stories, PICK_LIMIT));
});

test("rule-based picks cap each category, then fill leftover slots by score", () => {
  const stories = [
    ...Array.from({ length: OFFICIAL_POSTS }, (_, index) => story(`官方 ${index}`, "official")),
    story("论文", "paper"),
  ];
  const tight = pickByRules(stories, MAX_PER_CATEGORY + 1);
  assert.equal(tight.filter((pick) => pick.item.kind === "official").length, MAX_PER_CATEGORY);
  assert.ok(tight.some((pick) => pick.item.kind === "paper"));
  assert.equal(pickByRules(stories, PICK_LIMIT).length, stories.length);
});

test("falls back to the next AI provider, then to rules", async () => {
  const stories = [story("模型发布", "official"), story("新论文", "paper")];
  const failing: LlmProvider = { name: "Claude (test)", complete: () => Promise.reject(new Error("401")) };
  const working: LlmProvider = {
    name: "ChatGPT (test)",
    complete: () => Promise.resolve('{"items":[{"id":1,"category":"release","title":"新模型","summary":"s","why":"w"}]}'),
  };

  const fromAi = await buildDigest(stories, 1, [failing, working]);
  assert.equal(fromAi.author, "ChatGPT (test)");
  assert.equal(fromAi.entries[0]?.title, "新模型");

  const fromRules = await buildDigest(stories, PICK_LIMIT, [failing]);
  assert.equal(fromRules.author, "规则排序");
  assert.equal(fromRules.entries.length, TWO_STORIES);
});

test("formatters group by category, escape HTML and credit the author", () => {
  const digest = {
    author: "Claude (test)",
    entries: [
      { story: story("Paper", "paper"), category: "paper" as const, title: "论文 <x>", summary: "摘要", why: "" },
      { story: story("Model", "official"), category: "release" as const, title: "A&B 发布", summary: "", why: "很重要" },
    ],
  };
  const telegram = toNewsTelegramHtml(digest, "2026/11/03");
  assert.ok(telegram.indexOf("模型 / 产品发布") < telegram.indexOf("论文</b>"));
  assert.ok(telegram.includes("1. <a"));
  assert.ok(telegram.includes("A&amp;B 发布"));
  assert.ok(telegram.includes("论文 &lt;x&gt;"));
  assert.ok(telegram.includes("💡 很重要"));
  assert.ok(toNewsEmailHtml(digest, "2026/11/03").includes("由 Claude (test) 挑选和总结"));
});
