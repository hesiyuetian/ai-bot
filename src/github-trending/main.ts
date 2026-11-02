import { env, pushToAll, runMain } from "../tools/channels.ts";
import { todayInShanghai } from "../tools/time.ts";
import { toEmailHtml, toPlainText, toTelegramHtml } from "./format.ts";
import { fetchTopByStarsToday, type TrendingRepo } from "./trending.ts";
import { translateToChinese } from "../tools/translate.ts";

const DEFAULT_TOP_COUNT = 10;

const withChineseDescription = async (repo: TrendingRepo): Promise<TrendingRepo> => ({
  ...repo,
  descriptionZh: await translateToChinese(repo.description),
});

const main = async (): Promise<void> => {
  const trending = await fetchTopByStarsToday(Number(env("TOP_COUNT") ?? DEFAULT_TOP_COUNT));
  const repos = env("TRANSLATE") === "false" ? trending : await Promise.all(trending.map(withChineseDescription));
  const date = todayInShanghai();
  const text = toPlainText(repos, date);
  console.log(text);

  if (process.argv.includes("--dry-run")) return;

  await pushToAll({
    subject: `📈 GitHub 今日涨星 Top ${repos.length} · ${date}`,
    telegram: toTelegramHtml(repos, date),
    email: toEmailHtml(repos, date),
    text,
  });
};

await runMain(main);
