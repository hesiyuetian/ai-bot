import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAIN = fileURLToPath(new URL("../../src/stocks/main.ts", import.meta.url));
const PUSH_PREFIX = "TEST_PUSH ";
const REQUEST_PREFIX = "TEST_REQUEST ";

// Every fetch is intercepted, including notifications. An unexpected URL throws;
// no test can fall through to the real network or use the developer's credentials.
const PRELOAD = `
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) =>
  nativeSetTimeout(callback, delay === 500 || delay === 1500 ? 0 : delay, ...args);
const mode = process.env.TEST_MARKET_MODE;
if (mode === 'late') {
  const NativeDate = globalThis.Date;
  const instant = NativeDate.parse('2026-11-05T01:30:00Z');
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
}
const row = {
  f2: 10, f3: 4, f6: 1000000000, f8: 5, f9: 15, f10: 2,
  f12: '600001', f14: 'TestStock', f20: 50000000000, f24: 12,
  f26: 19991110, f62: 120000000, f100: 'TestSector', f109: 6,
  f184: 12, f297: 20261104,
};
if (mode === 'premarket') Object.assign(row, {
  f3: 0, f6: 0, f8: 0, f10: '-', f62: 0, f184: '-',
});
else row.f2 = '-';
const json = (body) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json' },
});
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  console.log('${REQUEST_PREFIX}' + url.hostname);
  if (url.href === 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json') {
    return json({ days: [] });
  }
  if (url.hostname.endsWith('push2.eastmoney.com')) {
    const industryRequest = url.searchParams.get('fs') === 'm:90+t:2';
    return json({ data: { diff: industryRequest ? [] : [row] } });
  }
  if (url.hostname === 'vip.stock.finance.sina.com.cn') {
    return json(mode === 'fallback' && url.searchParams.get('page') === '1'
      ? [{ symbol: 'sh600001', r0_net: '120000000', r0_ratio: '0.12' }]
      : []);
  }
  if (url.hostname === 'qt.gtimg.cn') {
    const values = {
      1: 'FallbackStock', 2: '600001', 3: '10', 30: '20261104150000',
      32: '4', 37: '100000', 38: '5', 39: '15', 45: '500',
      49: '2', 61: 'GP-A', 63: '6', 71: '12',
    };
    return new Response('v_sh600001="' + Array.from({ length: 72 },
      (_, index) => values[index] ?? '').join('~') + '";');
  }
  if (url.href === 'https://api.telegram.org/bottest-token/sendMessage') {
    const payload = JSON.parse(options.body);
    console.log('${PUSH_PREFIX}' + JSON.stringify(payload));
    return json({ ok: true });
  }
  throw new Error('Unexpected test URL: ' + url.href);
};
`;

type PushPayload = { readonly text: string; readonly parse_mode: string; readonly chat_id: string };

const runStockPush = (mode: "premarket" | "fallback" | "unavailable" | "late", dryRun = false) => {
  const directory = mkdtempSync(join(tmpdir(), "stock-push-test-"));
  try {
    const preload = join(directory, "mock-fetch.mjs");
    writeFileSync(preload, PRELOAD);
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types", "--import", pathToFileURL(preload).href,
      MAIN, ...(mode === "late" ? [] : [dryRun ? "--dry-run" : "--force"]),
    ], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        NODE_NO_WARNINGS: "1",
        TEST_MARKET_MODE: mode,
        STOCK_COUNT: "1",
        STOCK_PUSH_TIME: "00:00",
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "test-chat",
      },
    });
    assert.equal(result.error, undefined, result.error?.message);
    const lines = result.stdout.split("\n");
    return {
      ...result,
      pushes: lines.filter((line) => line.startsWith(PUSH_PREFIX))
        .map((line) => JSON.parse(line.slice(PUSH_PREFIX.length)) as PushPayload),
      hosts: lines.filter((line) => line.startsWith(REQUEST_PREFIX))
        .map((line) => line.slice(REQUEST_PREFIX.length)),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("premarket activity gaps still deliver marked observation candidates", () => {
  const result = runStockPush("premarket");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.pushes.length, 1);
  const [message] = result.pushes;
  assert.ok(message?.text.includes("TestStock"));
  assert.ok(message?.text.includes("观察候选"));
  assert.ok(message?.text.includes("无法验证昨日量能"));
  assert.ok(message?.text.includes("无法验证资金流入"));
  assert.ok(!message?.text.includes("NaN"));
  assert.ok(!message?.text.includes("主力资金净流入 0.00"));
  assert.equal(message?.parse_mode, "HTML");
  assert.equal(message?.chat_id, "test-chat");
  assert.ok(!result.hosts.includes("vip.stock.finance.sina.com.cn"));
});

test("a nonempty but unusable primary response falls back and delivers usable stocks", () => {
  const result = runStockPush("fallback");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.hosts.includes("vip.stock.finance.sina.com.cn"));
  assert.ok(result.hosts.includes("qt.gtimg.cn"));
  assert.equal(result.pushes.length, 1);
  assert.ok(result.pushes[0]?.text.includes("FallbackStock"));
  assert.ok(result.pushes[0]?.text.includes("新浪财经 + 腾讯行情"));
});

test("unavailable candidates deliver a status and keep failure status for a later retry", () => {
  const result = runStockPush("unavailable");
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.hosts.includes("vip.stock.finance.sina.com.cn"));
  assert.equal(result.pushes.length, 1);
  assert.ok(result.pushes[0]?.text.includes("潜力股推送状态"));
  assert.ok(result.pushes[0]?.text.includes("今天未能生成股票名单"));
  assert.ok(!result.pushes[0]?.text.includes("Top 0"));
});

test("dry runs print relaxed candidates without sending notifications", () => {
  const result = runStockPush("premarket", true);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("观察候选"));
  assert.equal(result.pushes.length, 0);
  assert.ok(!result.hosts.includes("api.telegram.org"));
});

test("a scheduled late start delivers a status instead of silently succeeding", () => {
  const result = runStockPush("late");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.pushes.length, 1);
  assert.ok(result.pushes[0]?.text.includes("任务启动已超过 09:15"));
  assert.ok(!result.hosts.some((host) => host.endsWith("push2.eastmoney.com")));
});
