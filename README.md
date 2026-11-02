# github-trending-push

每天北京时间 22:00 抓取 [GitHub Trending](https://github.com/trending?since=daily)，按 **今日涨星数** 排序取前 10，推送到 Telegram Bot 和邮箱。每条包含：仓库名、说明、仓库地址、今日涨星、总星数、语言。

GitHub 没有 Trending 官方 API，所以脚本解析 Trending 页面（约 25 个仓库），再按 "stars today" 重新排序。

另外，每个 **A 股交易日北京时间 09:20** 推送 10 只当日潜力股，每只附推荐理由（见下方「每日潜力股」）。两个任务共用同一套 Telegram / 邮箱配置。

## 部署（GitHub Actions）

1. 新建一个 GitHub 仓库（私有也行），把本目录全部推上去。
2. 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret | 说明 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 找 [@BotFather](https://t.me/BotFather) 发 `/newbot` 拿到 |
| `TELEGRAM_CHAT_ID` | 多人用英文逗号分隔，如 `121321,4345345`。获取方式：先给你的 bot 发一条消息，然后打开 `https://api.telegram.org/bot<TOKEN>/getUpdates`，看 `chat.id` |
| `SMTP_HOST` | Gmail: `smtp.gmail.com` · QQ 邮箱: `smtp.qq.com` · 163: `smtp.163.com` |
| `SMTP_PORT` | 可不填，默认 `465` (SSL) |
| `SMTP_USER` | 发件邮箱地址 |
| `SMTP_PASS` | **不是登录密码**：Gmail 用「应用专用密码」，QQ/163 用「SMTP 授权码」 |
| `MAIL_TO` | 收件地址，多个用英文逗号分隔，每人单独发一封（互相看不到对方地址） |

3. 打开 **Actions** 标签 → 选「GitHub 今日涨星推送」→ **Run workflow** 手动跑一次，确认收到。之后每天自动执行。「每日潜力股推送」同理，手动运行时会跳过交易日判断并立即推送。

只配了 Telegram 或只配了邮箱也可以，没配的渠道会自动跳过。

## 本地运行

需要 Node.js ≥ 22.18（原生运行 TypeScript，无需编译）。

```bash
npm install
npm run dry-run        # 只打印榜单，不推送
npm run stocks:dry-run # 只打印潜力股，不推送
cp .env.example .env   # 填好变量后：
node --env-file=.env src/github-trending/main.ts
npm test
```

## 可调整

- 推送时间：改 `.github/workflows/daily.yml` 里的 cron（UTC 时间，北京时间减 8 小时）。
- 数量：加一个 `TOP_COUNT` 环境变量。
- 翻译：英文说明默认用 Google 翻译成中文（免 key，失败时保留原文）。邮件里中文下方附原文。设 `TRANSLATE=false` 可关闭。

## 每日潜力股

工作流 `.github/workflows/stocks.yml` 周一到周五 08:30 启动，先判断今天是不是交易日（周末和法定节假日跳过，节假日数据来自 [holiday-cn](https://github.com/NateScarlet/holiday-cn)），再用上一交易日的收盘数据筛选，等到 09:20 推送。提前启动是因为 Actions 定时任务常有延迟，而且 09:15 集合竞价开始后行情接口的当日数据会被重置。

**数据**：取上一交易日主力资金净流入最多的约 200 只 A 股（沪深主板、创业板、科创板、北交所），都是免 key 的公开接口，按顺序尝试：

1. 东方财富：数据最全，含行业板块资金流向。但它经常拒绝海外 IP，GitHub Actions 上大概率连不上（日志里会看到 `东方财富: fetch failed (UND_ERR_SOCKET)` 之类的警告）。
2. 新浪财经（主力资金排名）+ 腾讯行情（量比、市盈率、市值、5/60 日涨幅）：海外可访问。没有行业数据，所以这时不会有「所属行业」理由，也不限同行业数量。

推送里会写明本次用的是哪个数据源。

**过滤**：排除 ST / 退市股、上市不满 120 天的新股、股价 < 3 元、市值 < 50 亿、成交额 < 3 亿、亏损股（市盈率 ≤ 0）、当日下跌或涨幅 ≥ 9.5%（避免追涨停）、近 5 日涨幅 > 25%（过热）。

**打分**（满分约 100）：主力净流入占比、所属行业资金流入排名、量比、换手率、当日涨幅、中短期趋势、市盈率。同一行业最多 2 只，避免扎堆。

每只股票列出触发的推荐理由（带具体数字），如有超跌反弹、短线涨幅过大、估值偏高等情况会额外给出风险提示。

可调整：`STOCK_COUNT`（数量，默认 10）、`STOCK_PUSH_TIME`（推送时间，默认 `09:20`）。筛选阈值和权重在 `src/stocks/screener.ts` 顶部。

> ⚠️ 这是基于公开行情数据的规则化量化筛选，**不构成投资建议**。它只看资金与量价，不了解公司基本面和消息面，历史表现不代表未来。

## 目录结构

```
src/
  tools/            两个任务共用：推送渠道 (Telegram/邮件)、HTML 转义、北京时间、重试
  github-trending/  GitHub 今日涨星：抓取、翻译、排版、入口 main.ts
  stocks/           每日潜力股：交易日历、筛选打分、排版、入口 main.ts
    sources/        行情数据源：东方财富、新浪 + 腾讯（备用）
test/               与 src 同结构
```

## 注意

- GitHub 定时任务在高峰期可能延迟，且仓库 **60 天没有任何提交** 会自动停用定时任务，到时去 Actions 页面重新启用即可。
- 如果 GitHub 改了 Trending 页面结构导致解析不到数据，任务会失败，GitHub 会发邮件通知你。
- 东方财富接口对同一 IP 的频繁请求会限流（直接断开连接），也常拒绝海外 IP，连不上时自动改用新浪 + 腾讯。本地调试时别连续狂跑。
