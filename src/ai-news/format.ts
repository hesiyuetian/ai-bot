import { escapeHtml } from "../tools/html.ts";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Digest, type DigestEntry } from "./types.ts";

type Section = {
  readonly category: Category;
  readonly entries: readonly { readonly entry: DigestEntry; readonly number: number }[];
};

/** Entries grouped by category in a fixed order, numbered continuously across sections. */
const toSections = (digest: Digest): Section[] => {
  const ordered = CATEGORIES.flatMap((category) => digest.entries.filter((entry) => entry.category === category));
  return CATEGORIES.map((category) => ({
    category,
    entries: ordered
      .map((entry, index) => ({ entry, number: index + 1 }))
      .filter(({ entry }) => entry.category === category),
  })).filter((section) => section.entries.length > 0);
};

const meta = ({ story }: DigestEntry): string =>
  [
    story.sources.join(" / "),
    story.item.kind === "community" && story.points > 0 ? `HN ${story.points} 分` : "",
    story.item.kind === "paper" && story.points > 0 ? `${story.points} 赞` : "",
    story.sources.length > 1 ? `${story.sources.length} 家报道` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const authorNote = (digest: Digest): string =>
  digest.author === "规则排序" ? "按来源权重和热度排序 · 过去 24 小时" : `由 ${digest.author} 挑选和总结 · 过去 24 小时`;

export const toNewsTelegramHtml = (digest: Digest, date: string): string => {
  const sections = toSections(digest).map((section) =>
    [
      `<b>${CATEGORY_LABELS[section.category]}</b>`,
      ...section.entries.map(({ entry, number }) =>
        [
          `<b>${number}. <a href="${escapeHtml(entry.story.item.url)}">${escapeHtml(entry.title)}</a></b>`,
          ...(entry.summary ? [escapeHtml(entry.summary)] : []),
          ...(entry.why ? [`💡 ${escapeHtml(entry.why)}`] : []),
          `<i>${escapeHtml(meta(entry))}</i>`,
        ].join("\n"),
      ),
    ].join("\n\n"),
  );
  return [
    `<b>🤖 AI 圈今日要闻 Top ${digest.entries.length}</b>  ${date}`,
    `<i>${escapeHtml(authorNote(digest))}</i>`,
    ...sections,
  ].join("\n\n");
};

export const toNewsEmailHtml = (digest: Digest, date: string): string => {
  const sections = toSections(digest)
    .map(
      (section) => `
  <h3 style="margin:20px 0 4px;font-size:15px">${CATEGORY_LABELS[section.category]}</h3>
  ${section.entries
    .map(
      ({ entry, number }) => `
  <div style="padding:10px 0;border-bottom:1px solid #eee">
    <a href="${escapeHtml(entry.story.item.url)}" style="font-size:16px;font-weight:600;color:#0969da;text-decoration:none">${number}. ${escapeHtml(entry.title)}</a>
    ${entry.summary ? `<div style="margin:6px 0;color:#333;line-height:1.5">${escapeHtml(entry.summary)}</div>` : ""}
    ${entry.why ? `<div style="margin:0 0 6px;color:#8250df;font-size:13px">💡 ${escapeHtml(entry.why)}</div>` : ""}
    <div style="font-size:12px;color:#888">${escapeHtml(meta(entry))} · <span style="color:#999">${escapeHtml(entry.story.item.title)}</span></div>
  </div>`,
    )
    .join("")}`,
    )
    .join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 4px">🤖 AI 圈今日要闻 Top ${digest.entries.length}</h2>
  <div style="color:#888;margin-bottom:8px">${date} · ${escapeHtml(authorNote(digest))}</div>${sections}
</body></html>`;
};

export const toNewsPlainText = (digest: Digest, date: string): string =>
  [
    `AI 圈今日要闻 Top ${digest.entries.length}  ${date}`,
    authorNote(digest),
    ...toSections(digest).map((section) =>
      [
        CATEGORY_LABELS[section.category],
        ...section.entries.map(({ entry, number }) =>
          [
            `${number}. ${entry.title}`,
            ...(entry.summary ? [`   ${entry.summary}`] : []),
            ...(entry.why ? [`   💡 ${entry.why}`] : []),
            `   ${meta(entry)}`,
            `   ${entry.story.item.url}`,
          ].join("\n"),
        ),
      ].join("\n\n"),
    ),
  ].join("\n\n");
