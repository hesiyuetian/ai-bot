import { escapeHtml } from "../tools/html.ts";
import type { Recommendation } from "./screener.ts";

const PRICE_DECIMALS = 2;

export const DISCLAIMER = "以上为基于公开行情数据的量化筛选结果，仅供学习研究，不构成任何投资建议。股市有风险，入市需谨慎。";

/** Which session the numbers come from and which data source answered. */
export type DataMeta = { readonly tradeDate: string; readonly source: string };

const dataNote = ({ tradeDate, source }: DataMeta): string => `数据基于 ${tradeDate} 收盘 · 来源 ${source}`;

const signed = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(PRICE_DECIMALS)}%`;

const headline = ({ quote }: Recommendation): string =>
  `${quote.name} ${quote.code}  ¥${quote.price.toFixed(PRICE_DECIMALS)} (${signed(quote.changePct)})`;

const industryOf = ({ quote }: Recommendation): string => (quote.industry ? ` 【${quote.industry}】` : "");

export const toStockTelegramHtml = (picks: readonly Recommendation[], date: string, meta: DataMeta): string => {
  const items = picks.map((pick, index) =>
    [
      `<b>${index + 1}. <a href="${pick.quote.url}">${escapeHtml(headline(pick))}</a></b>${escapeHtml(industryOf(pick))}`,
      ...pick.reasons.map((reason) => `• ${escapeHtml(reason)}`),
      ...(pick.risk ? [`⚠️ ${escapeHtml(pick.risk)}`] : []),
    ].join("\n"),
  );
  return [
    `<b>📊 今日潜力股 Top ${picks.length}</b>  ${date}`,
    `<i>${escapeHtml(dataNote(meta))}</i>`,
    ...items,
    `<i>${escapeHtml(DISCLAIMER)}</i>`,
  ].join("\n\n");
};

export const toStockEmailHtml = (picks: readonly Recommendation[], date: string, meta: DataMeta): string => {
  const rows = picks
    .map(
      (pick, index) => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;color:#888;font-weight:600">${index + 1}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee">
        <a href="${pick.quote.url}" style="font-size:16px;font-weight:600;color:#0969da;text-decoration:none">${escapeHtml(pick.quote.name)}</a>
        <span style="color:#666"> ${pick.quote.code} ${escapeHtml(industryOf(pick))}</span>
        <ul style="margin:6px 0;padding-left:18px;color:#333;line-height:1.6">
          ${pick.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>
        ${pick.risk ? `<div style="color:#bf8700;font-size:13px">⚠️ ${escapeHtml(pick.risk)}</div>` : ""}
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;text-align:right">
        <div style="font-weight:600">¥${pick.quote.price.toFixed(PRICE_DECIMALS)}</div>
        <div style="color:#cf222e;font-size:13px">${signed(pick.quote.changePct)}</div>
      </td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 4px">📊 今日潜力股 Top ${picks.length}</h2>
  <div style="color:#888;margin-bottom:12px">${date} · ${escapeHtml(dataNote(meta))}</div>
  <table style="width:100%;border-collapse:collapse">
    <tr style="text-align:left;color:#888;font-size:12px">
      <th style="padding:4px 8px">#</th><th style="padding:4px 8px">股票 / 推荐理由</th><th style="padding:4px 8px;text-align:right">昨收</th>
    </tr>${rows}
  </table>
  <p style="color:#999;font-size:12px;margin-top:16px">${escapeHtml(DISCLAIMER)}</p>
</body></html>`;
};

export const toStockPlainText = (picks: readonly Recommendation[], date: string, meta: DataMeta): string =>
  [
    `今日潜力股 Top ${picks.length}  ${date}`,
    dataNote(meta),
    ...picks.map((pick, index) =>
      [
        `${index + 1}. ${headline(pick)}${industryOf(pick)}`,
        ...pick.reasons.map((reason) => `   - ${reason}`),
        ...(pick.risk ? [`   ! ${pick.risk}`] : []),
        `   ${pick.quote.url}`,
      ].join("\n"),
    ),
    DISCLAIMER,
  ].join("\n\n");
