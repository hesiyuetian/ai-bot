import assert from "node:assert/strict";
import { test } from "node:test";
import { isEligible, screenStocks, screenStocksWithFallback } from "../../src/stocks/screener.ts";
import type { StockQuote } from "../../src/stocks/types.ts";

const quote = (code: string, overrides: Partial<StockQuote> = {}): StockQuote => ({
  code, name: `股票${code}`, url: `https://example.com/${code}`, industry: code,
  price: 10, changePct: 4, change5dPct: 6, change60dPct: 12,
  amount: 1_000_000_000, turnoverPct: 5, volumeRatio: 2, pe: 15,
  marketCap: 50_000_000_000, mainNetInflow: 120_000_000, mainNetPct: 12,
  listDate: "19991110", tradeDate: "20261104", ...overrides,
});

test("strict screening keeps its existing behavior and needs no fallback when the minimum is met", () => {
  const strict = quote("600001");
  const relaxed = quote("600002", { amount: 200_000_000 });
  assert.ok(!isEligible(relaxed));
  assert.deepEqual(screenStocks([strict, relaxed], [], 10).map((pick) => pick.quote.code), [strict.code]);

  const result = screenStocksWithFallback([strict, quote("600003"), relaxed], [], 30, 2);
  assert.equal(result.picks.length, 2);
  assert.ok(result.picks.every((pick) => pick.screeningTier === 0));
  assert.equal(result.note, undefined);
  assert.deepEqual(result.stages, [{ name: "严格筛选", count: 2 }]);
});

test("fallback preserves strict picks before higher-scoring relaxed and observation candidates", () => {
  const strict = quote("600001", { volumeRatio: 0.5, turnoverPct: 0.5, mainNetPct: 1 });
  const relaxed = quote("600002", { amount: 200_000_000, mainNetPct: 20 });
  const observation = quote("600003", { amount: 50_000_000, mainNetPct: 20 });
  const result = screenStocksWithFallback([observation, relaxed, strict], [], 3);
  assert.deepEqual(result.picks.map((pick) => pick.quote.code), [strict.code, relaxed.code, observation.code]);
  assert.deepEqual(result.picks.map((pick) => pick.screeningTier), [0, 1, 2]);
  assert.deepEqual(result.stages.map((stage) => stage.count), [1, 2, 3]);
  assert.ok(result.note?.includes("观察候选"));
  assert.ok(result.picks.filter((pick) => pick.screeningTier).every((pick) =>
    pick.screeningNote && pick.screeningNote.length <= 35));
});

test("fallback only fills the minimum, rather than lowering standards to fill the entire AI pool", () => {
  const strict = quote("600001");
  const relaxed = Array.from({ length: 10 }, (_, index) => quote(`6001${index}`, { amount: 200_000_000 }));
  const result = screenStocksWithFallback([strict, ...relaxed], [], 30, 3);
  assert.equal(result.picks.length, 3);
  assert.deepEqual(result.picks.map((pick) => pick.screeningTier), [0, 1, 1]);
  assert.equal(result.stages.length, 2);
});

test("premarket missing activity fields can produce explicitly marked observation candidates", () => {
  const incomplete = quote("600001", {
    amount: 0, mainNetInflow: 0, mainNetPct: Number.NaN,
    volumeRatio: Number.NaN, turnoverPct: Number.NaN, changePct: 0,
  });
  const [pick] = screenStocksWithFallback([incomplete], [], 10).picks;
  assert.equal(pick?.screeningTier, 2);
  assert.ok(pick?.screeningNote?.includes("无法验证昨日量能"));
  assert.ok(pick?.screeningNote?.includes("无法验证资金流入"));
  assert.ok(Number.isFinite(pick?.score));
  assert.ok(!pick?.reasons.some((reason) => /主力资金净流入|量比|换手率/.test(reason)));

  const absent = quote("600002", { amount: Number.NaN, mainNetInflow: Number.NaN, mainNetPct: Number.POSITIVE_INFINITY });
  const [missingPick] = screenStocksWithFallback([absent], [], 10).picks;
  assert.equal(missingPick?.screeningTier, 2);
  assert.ok(Number.isFinite(missingPick?.score));
  assert.ok(!missingPick?.reasons.some((reason) => reason.includes("主力资金净流入")));
});

test("net outflows remain visible as observation risks and never earn positive capital-flow reasons", () => {
  const result = screenStocksWithFallback([quote("600001", {
    amount: Number.NaN, volumeRatio: Number.NaN, mainNetInflow: -100_000_000, mainNetPct: 20,
  })], [], 10);
  const [pick] = result.picks;
  assert.equal(pick?.screeningTier, 2);
  assert.ok(pick?.screeningNote?.includes("主力资金净流出"));
  assert.ok(!pick?.reasons.some((reason) => reason.includes("主力资金净流入")));
});

test("zero or missing activity and non-finite trends do not create positive market evidence", () => {
  const inactive = quote("600001", {
    amount: 0, mainNetInflow: 0, mainNetPct: 0, changePct: 0,
    change60dPct: Number.POSITIVE_INFINITY, change5dPct: 0,
  });
  const industries = [
    { name: inactive.industry, mainNetInflow: 0, changePct: 0 },
    { name: "其他行业", mainNetInflow: -1_000_000, changePct: -1 },
  ];
  const [pick] = screenStocksWithFallback([inactive], industries, 10).picks;
  assert.equal(pick?.score, 5, "only the valid PE factor can contribute");
  assert.ok(!pick?.reasons.some((reason) => /资金关注度高|走势偏强|趋势向上|成交.*放大|换手率/.test(reason)));

  const finiteTrend = quote("600002", { change60dPct: 5, change5dPct: Number.NEGATIVE_INFINITY });
  const [invalidTrendPick] = screenStocksWithFallback([finiteTrend], [], 10).picks;
  assert.ok(!invalidTrendPick?.reasons.some((reason) => reason.includes("中短期趋势向上")));
});

test("fallback keeps hard exclusions even if all remaining candidates would otherwise be observation picks", () => {
  const exclusions: Partial<StockQuote>[] = [
    { name: "*ST 股票" }, { name: "退市股票" }, { name: "N新股" }, { name: "C新股" },
    { listDate: "20261001" }, { price: 0 }, { price: Number.NaN },
    { marketCap: 999_999_999 }, { marketCap: Number.NaN },
    { changePct: Number.NaN }, { changePct: 9.5 }, { changePct: -5 }, { change5dPct: 41 },
    { pe: -1 }, { pe: 0 }, { pe: Number.NaN }, { pe: 301 },
  ];
  for (const excluded of exclusions) {
    const result = screenStocksWithFallback([quote("600001", { amount: 0, ...excluded })], [], 10);
    assert.equal(result.picks.length, 0, `must reject ${JSON.stringify(excluded)}`);
  }
  assert.equal(screenStocksWithFallback([], [], 10).picks.length, 0);
});

test("fallback deduplicates stock codes and keeps the industry cap across all tiers", () => {
  const first = quote("600001", { industry: "银行" });
  const second = quote("600002", { industry: "银行" });
  const third = quote("600003", { industry: "银行", amount: 200_000_000 });
  const observation = quote("600004", { industry: "电子", amount: 0 });
  const result = screenStocksWithFallback([first, first, second, third, observation], [], 10);
  assert.equal(result.picks.length, 3);
  assert.equal(new Set(result.picks.map((pick) => pick.quote.code)).size, 3);
  assert.equal(result.picks.filter((pick) => pick.quote.industry === "银行").length, 2);
});
