import { escapeHtml } from "../tools/html.ts";
import type { TrendingRepo } from "./trending.ts";

const MAX_TELEGRAM_DESCRIPTION = 200;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const formatCount = (count: number): string => count.toLocaleString("en-US");

const describe = (repo: TrendingRepo): string => repo.descriptionZh || repo.description || "（暂无说明）";

const originalIfTranslated = (repo: TrendingRepo): string =>
  repo.descriptionZh && repo.descriptionZh !== repo.description ? repo.description : "";

export const toTelegramHtml = (repos: readonly TrendingRepo[], date: string): string => {
  const items = repos.map((repo, index) => {
    const meta = [repo.language, `⭐ ${formatCount(repo.totalStars)}`].filter(Boolean).join(" · ");
    return [
      `<b>${index + 1}. <a href="${repo.url}">${escapeHtml(repo.fullName)}</a></b>`,
      `🔥 今日 +${formatCount(repo.starsToday)}  |  ${escapeHtml(meta)}`,
      escapeHtml(truncate(describe(repo), MAX_TELEGRAM_DESCRIPTION)),
      repo.url,
    ].join("\n");
  });
  return [`<b>📈 GitHub 今日涨星 Top ${repos.length}</b>  ${date}`, ...items].join("\n\n");
};

export const toEmailHtml = (repos: readonly TrendingRepo[], date: string): string => {
  const rows = repos
    .map(
      (repo, index) => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;color:#888;font-weight:600">${index + 1}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee">
        <a href="${repo.url}" style="font-size:16px;font-weight:600;color:#0969da;text-decoration:none">${escapeHtml(repo.fullName)}</a>
        <div style="margin:6px 0;color:#333;line-height:1.5">${escapeHtml(describe(repo))}</div>
        ${originalIfTranslated(repo) ? `<div style="margin:0 0 6px;color:#999;font-size:12px;line-height:1.4">${escapeHtml(originalIfTranslated(repo))}</div>` : ""}
        <div style="font-size:12px;color:#666">
          ${repo.language ? `${escapeHtml(repo.language)} · ` : ""}⭐ ${formatCount(repo.totalStars)} ·
          <a href="${repo.url}" style="color:#666">${repo.url}</a>
        </div>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;color:#cf222e;font-weight:600;text-align:right">+${formatCount(repo.starsToday)}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 4px">📈 GitHub 今日涨星 Top ${repos.length}</h2>
  <div style="color:#888;margin-bottom:12px">${date} · 数据来源 github.com/trending</div>
  <table style="width:100%;border-collapse:collapse">
    <tr style="text-align:left;color:#888;font-size:12px">
      <th style="padding:4px 8px">#</th><th style="padding:4px 8px">仓库 / 说明</th><th style="padding:4px 8px;text-align:right">今日涨星</th>
    </tr>${rows}
  </table>
</body></html>`;
};

export const toPlainText = (repos: readonly TrendingRepo[], date: string): string =>
  [
    `GitHub 今日涨星 Top ${repos.length}  ${date}`,
    ...repos.map(
      (repo, index) =>
        `${index + 1}. ${repo.fullName}  (今日 +${formatCount(repo.starsToday)})\n   ${describe(repo)}\n   ${repo.url}`,
    ),
  ].join("\n\n");
