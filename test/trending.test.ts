import assert from "node:assert/strict";
import { test } from "node:test";
import { toEmailHtml, toTelegramHtml } from "../src/format.ts";
import { parseTrending } from "../src/trending.ts";

const card = (path: string, description: string, language: string, total: string, today: string): string => `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a data-view-component="true" href="/${path}" class="Link">
      <svg aria-hidden="true"></svg>
      <span data-view-component="true" class="text-normal">${path.split("/")[0]} /</span>
      ${path.split("/")[1]}
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">
    ${description}
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span class="d-inline-block ml-0 mr-3">
      <span class="repo-language-color"></span>
      <span itemprop="programmingLanguage">${language}</span>
    </span>
    <a href="/${path}/stargazers" class="Link d-inline-block mr-3">
      <svg aria-label="star"></svg>
      ${total}</a>
    <a href="/${path}/forks" class="Link d-inline-block mr-3"><svg></svg> 99</a>
    <span class="d-inline-block float-sm-right">
      <svg aria-hidden="true"></svg>
      ${today} stars today
    </span>
  </div>
</article>`;

const ALPHA = { total: 12345, today: 321 } as const;
const BETA_TODAY = 1204;
const CARD_COUNT = 2;

const fixture = [
  card("alpha/one", "A &amp; B &lt;fast&gt; tool", "Rust", "12,345", "321"),
  card("beta/two", "", "", "800", "1,204"),
].join("\n");

test("parses every trending card", () => {
  const repos = parseTrending(fixture);
  assert.equal(repos.length, CARD_COUNT);
  assert.deepEqual(repos[0], {
    fullName: "alpha/one",
    url: "https://github.com/alpha/one",
    description: "A & B <fast> tool",
    language: "Rust",
    totalStars: ALPHA.total,
    starsToday: ALPHA.today,
  });
  assert.equal(repos[1]?.starsToday, BETA_TODAY);
  assert.equal(repos[1]?.description, "");
});

test("formatters escape HTML and include url + stars today", () => {
  const repos = parseTrending(fixture);
  const telegram = toTelegramHtml(repos, "2026/11/02");
  assert.ok(telegram.includes("A &amp; B &lt;fast&gt; tool"));
  assert.ok(telegram.includes("今日 +1,204"));
  assert.ok(telegram.includes("https://github.com/beta/two"));
  assert.ok(toEmailHtml(repos, "2026/11/02").includes("（暂无说明）"));
});

test("shows the Chinese description and keeps the original in email", () => {
  const [repo] = parseTrending(fixture);
  assert.ok(repo);
  const translated = { ...repo, descriptionZh: "快速工具" };
  assert.ok(toTelegramHtml([translated], "2026/11/02").includes("快速工具"));
  const email = toEmailHtml([translated], "2026/11/02");
  assert.ok(email.includes("快速工具"));
  assert.ok(email.includes("A &amp; B &lt;fast&gt; tool"));
});
