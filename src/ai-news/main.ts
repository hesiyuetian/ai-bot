import { env, pushToAll, runMain } from "../tools/channels.ts";
import { configuredProviders } from "../tools/llm.ts";
import { todayInShanghai } from "../tools/time.ts";
import { toNewsEmailHtml, toNewsPlainText, toNewsTelegramHtml } from "./format.ts";
import { rankStories, windowStart } from "./ranker.ts";
import { fetchAllNews } from "./sources/index.ts";
import { buildDigest } from "./summarize.ts";

const DEFAULT_NEWS_COUNT = 10;

const main = async (): Promise<void> => {
  const now = Date.now();
  const items = await fetchAllNews(windowStart(now, "community"));
  const stories = rankStories(items, now);
  console.log(`🧮 ${items.length} 条内容合并为 ${stories.length} 个事件`);
  if (stories.length === 0) throw new Error("过去 24 小时没有获取到任何 AI 资讯，数据源可能都失败了");

  const digest = await buildDigest(stories, Number(env("NEWS_COUNT") ?? DEFAULT_NEWS_COUNT), configuredProviders());
  const date = todayInShanghai();
  const text = toNewsPlainText(digest, date);
  console.log(text);

  if (process.argv.includes("--dry-run")) return;

  await pushToAll({
    subject: `🤖 AI 圈今日要闻 Top ${digest.entries.length} · ${date}`,
    telegram: toNewsTelegramHtml(digest, date),
    email: toNewsEmailHtml(digest, date),
    text,
  });
};

await runMain(main);
