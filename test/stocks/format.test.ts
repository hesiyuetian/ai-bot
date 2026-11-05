import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSelectionPrompt, parseSelection } from "../../src/stocks/analyze.ts";
import { toStockEmailHtml, toStockPlainText, toStockStatusMessage, toStockTelegramHtml } from "../../src/stocks/format.ts";
import { screenStocksWithFallback } from "../../src/stocks/screener.ts";
import type { StockQuote } from "../../src/stocks/types.ts";

const quote = (index: number, overrides: Partial<StockQuote> = {}): StockQuote => ({
  code: `6000${String(index).padStart(2, "0")}`, name: `股票${index}`, url: "https://example.com/quote", industry: `行业${index}`,
  price: 10, changePct: 4, change5dPct: 20, change60dPct: 12, amount: 200_000_000,
  turnoverPct: 5, volumeRatio: 2, pe: 180, marketCap: 50_000_000_000,
  mainNetInflow: 120_000_000, mainNetPct: 20, listDate: "19991110", tradeDate: "20261104", ...overrides,
});

test("relaxed qualification is visible in every channel and in the AI request, within Telegram's limit", () => {
  const result = screenStocksWithFallback(Array.from({ length: 10 }, (_, i) => quote(i)), [], 30, 10);
  const meta = { tradeDate: "20261104", source: "东方财富", screeningNote: result.note };
  const parsed = parseSelection(JSON.stringify({
    market: "观".repeat(150), picks: result.picks.map((pick) => ({ code: pick.quote.code, reason: "长".repeat(90) })),
  }), result.picks, 10);
  const analysis = { market: parsed.market, byCode: parsed.byCode, poolSize: result.picks.length, author: "Claude (test)" };
  const telegram = toStockTelegramHtml(result.picks, "2026/11/05", meta, analysis);
  for (const text of [telegram, toStockEmailHtml(result.picks, "2026/11/05", meta, analysis), toStockPlainText(result.picks, "2026/11/05", meta, analysis)]) {
    assert.ok(text.includes("严格筛选不足"));
    assert.ok(text.includes("成交额门槛放宽"));
    assert.ok(!text.includes("NaN"));
    assert.ok(!text.includes("收盘"));
  }
  assert.ok(telegram.replace(/<[^>]+>/g, "").length < 4096);
  assert.ok(buildSelectionPrompt(result.picks, [], "20261104", 10).includes("成交额门槛放宽"));
});

test("premarket observation messages show missing evidence without claiming zero change is strength", () => {
  const result = screenStocksWithFallback([quote(1, {
    amount: 0, mainNetInflow: 0, mainNetPct: Number.NaN, volumeRatio: Number.NaN, turnoverPct: 0, changePct: 0,
  })], [], 10);
  const meta = { tradeDate: "20261104", source: "东方财富", screeningNote: result.note };
  const text = toStockPlainText(result.picks, "2026/11/05", meta);
  assert.ok(text.includes("观察候选"));
  assert.ok(text.includes("无法验证资金流入"));
  assert.ok(!/NaN|走势偏强|成交明显放大|交投活跃/.test(text));
});

test("AI keeps its order within a tier while strict candidates stay ahead of fallback candidates", () => {
  const result = screenStocksWithFallback([
    quote(1, { amount: 1_000_000_000 }), quote(2), quote(3), quote(4, { amount: 0 }),
  ], [], 4);
  const answer = JSON.stringify({ picks: [4, 3, 2, 1].map((index) => ({ code: quote(index).code, reason: "理由" })) });
  const parsed = parseSelection(answer, result.picks, 4);
  assert.deepEqual(parsed.picks.map((pick) => pick.quote.code), [1, 3, 2, 4].map((index) => quote(index).code));
});

test("empty-data status messages are readable and escape user-visible HTML", () => {
  const message = toStockStatusMessage("2026/11/05", "行情缺失 <数据源> & 无候选");
  assert.ok(message.subject.includes("推送状态"));
  assert.ok(message.text.includes("行情缺失 <数据源>"));
  assert.ok(message.telegram.includes("&lt;数据源&gt; &amp;"));
  assert.ok(message.email.includes("&lt;数据源&gt; &amp;"));
});
