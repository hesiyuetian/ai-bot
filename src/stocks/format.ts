import { escapeHtml } from "../tools/html.ts";
import type { Message } from "../tools/channels.ts";
import type { StockAnalysis } from "./analyze.ts";
import type { Recommendation } from "./screener.ts";

const PRICE_DECIMALS = 2;

export const DISCLAIMER = "以上为基于公开行情数据的量化筛选结果及 AI 自动生成的点评，仅供学习研究，不构成任何投资建议。股市有风险，入市需谨慎。";

/** Which session the numbers come from and which data source answered. */
export type DataMeta = { readonly tradeDate: string; readonly source: string; readonly screeningNote?: string };

const dataNote = ({ tradeDate, source }: DataMeta): string => `行情日期 ${tradeDate || "未知"} · 来源 ${source}`;

const signed = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(PRICE_DECIMALS)}%`;

const headline = ({ quote }: Recommendation): string =>
  `${quote.name} ${quote.code}  ¥${quote.price.toFixed(PRICE_DECIMALS)} (${signed(quote.changePct)})`;

const industryOf = ({ quote }: Recommendation): string => (quote.industry ? ` 【${quote.industry}】` : "");

const analysisOf = (pick: Recommendation, analysis: StockAnalysis | undefined): string =>
  analysis?.byCode.get(pick.quote.code) ?? "";

const marketTitle = (analysis: StockAnalysis): string => `🤖 AI 市场观察（${analysis.author}）`;

/** How the list was chosen: by the AI from the rule pool, or by the rule score alone. */
const selectionNote = (meta: DataMeta, analysis: StockAnalysis | undefined): string =>
  analysis
    ? `${dataNote(meta)} · AI 从 ${analysis.poolSize} 只量化初选股中精选`
    : `${dataNote(meta)} · 按量化得分选出`;

export const toStockTelegramHtml = (picks: readonly Recommendation[], date: string, meta: DataMeta, analysis?: StockAnalysis): string => {
  // Leave room for the additional per-stock qualification on relaxed candidates.
  const reasonLimit = meta.screeningNote ? 3 : 5;
  const items = picks.map((pick, index) =>
    [
      `<b>${index + 1}. <a href="${pick.quote.url}">${escapeHtml(headline(pick))}</a></b>${escapeHtml(industryOf(pick))}`,
      ...(pick.screeningNote ? [`筛选：${escapeHtml(pick.screeningNote)}`] : []),
      ...pick.reasons.slice(0, reasonLimit).map((reason) => `• ${escapeHtml(reason)}`),
      ...(pick.risk ? [`⚠️ ${escapeHtml(pick.risk)}`] : []),
      ...(analysisOf(pick, analysis) ? [`🤖 AI：${escapeHtml(analysisOf(pick, analysis))}`] : []),
    ].join("\n"),
  );
  return [
    `<b>📊 今日潜力股 Top ${picks.length}</b>  ${date}`,
    `<i>${escapeHtml(selectionNote(meta, analysis))}</i>`,
    ...(meta.screeningNote ? [`⚠️ ${escapeHtml(meta.screeningNote)}`] : []),
    ...(analysis?.market ? [`<b>${escapeHtml(marketTitle(analysis))}</b>\n${escapeHtml(analysis.market)}`] : []),
    ...items,
    `<i>${escapeHtml(DISCLAIMER)}</i>`,
  ].join("\n\n");
};

export const toStockEmailHtml = (picks: readonly Recommendation[], date: string, meta: DataMeta, analysis?: StockAnalysis): string => {
  const rows = picks
    .map(
      (pick, index) => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;color:#888;font-weight:600">${index + 1}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #eee">
        <a href="${pick.quote.url}" style="font-size:16px;font-weight:600;color:#0969da;text-decoration:none">${escapeHtml(pick.quote.name)}</a>
        <span style="color:#666"> ${pick.quote.code} ${escapeHtml(industryOf(pick))}</span>
        ${pick.screeningNote ? `<div style="margin-top:4px;color:#bf8700;font-size:13px">筛选：${escapeHtml(pick.screeningNote)}</div>` : ""}
        <ul style="margin:6px 0;padding-left:18px;color:#333;line-height:1.6">
          ${pick.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>
        ${pick.risk ? `<div style="color:#bf8700;font-size:13px">⚠️ ${escapeHtml(pick.risk)}</div>` : ""}
        ${analysisOf(pick, analysis) ? `<div style="margin-top:4px;color:#8250df;font-size:13px;line-height:1.5">🤖 AI：${escapeHtml(analysisOf(pick, analysis))}</div>` : ""}
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
  <div style="color:#888;margin-bottom:12px">${date} · ${escapeHtml(selectionNote(meta, analysis))}</div>
  ${meta.screeningNote ? `<p style="color:#bf8700">⚠️ ${escapeHtml(meta.screeningNote)}</p>` : ""}
  ${analysis?.market ? `<div style="margin:0 0 12px;padding:10px 12px;background:#f6f0ff;border-radius:6px;line-height:1.6"><b>${escapeHtml(marketTitle(analysis))}</b><br>${escapeHtml(analysis.market)}</div>` : ""}
  <table style="width:100%;border-collapse:collapse">
    <tr style="text-align:left;color:#888;font-size:12px">
      <th style="padding:4px 8px">#</th><th style="padding:4px 8px">股票 / 推荐理由</th><th style="padding:4px 8px;text-align:right">价格</th>
    </tr>${rows}
  </table>
  <p style="color:#999;font-size:12px;margin-top:16px">${escapeHtml(DISCLAIMER)}</p>
</body></html>`;
};

export const toStockPlainText = (picks: readonly Recommendation[], date: string, meta: DataMeta, analysis?: StockAnalysis): string =>
  [
    `今日潜力股 Top ${picks.length}  ${date}`,
    selectionNote(meta, analysis),
    ...(meta.screeningNote ? [`⚠️ ${meta.screeningNote}`] : []),
    ...(analysis?.market ? [`${marketTitle(analysis)}\n${analysis.market}`] : []),
    ...picks.map((pick, index) =>
      [
        `${index + 1}. ${headline(pick)}${industryOf(pick)}`,
        ...(pick.screeningNote ? [`   筛选：${pick.screeningNote}`] : []),
        ...pick.reasons.map((reason) => `   - ${reason}`),
        ...(pick.risk ? [`   ! ${pick.risk}`] : []),
        ...(analysisOf(pick, analysis) ? [`   AI: ${analysisOf(pick, analysis)}`] : []),
        `   ${pick.quote.url}`,
      ].join("\n"),
    ),
    DISCLAIMER,
  ].join("\n\n");

/** A status notification still reaches users when no usable candidates can be produced. */
export const toStockStatusMessage = (date: string, detail: string): Message => {
  const title = `📊 潜力股推送状态 · ${date}`;
  return {
    subject: title,
    telegram: `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(detail)}`,
    email: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>`,
    text: `${title}\n\n${detail}`,
  };
};
