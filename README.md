# github-trending-push

每天北京时间 22:00 抓取 [GitHub Trending](https://github.com/trending?since=daily)，按 **今日涨星数** 排序取前 10，推送到 Telegram Bot 和邮箱。每条包含：仓库名、说明、仓库地址、今日涨星、总星数、语言。

GitHub 没有 Trending 官方 API，所以脚本解析 Trending 页面（约 25 个仓库），再按 "stars today" 重新排序。

另外还有两个推送，三个任务共用同一套 Telegram / 邮箱配置：

- **每天北京时间 08:00**：AI 圈过去 24 小时的 10 条要闻，用 Claude 或 ChatGPT 挑选和写中文摘要（见下方「AI 圈每日要闻」）。
- **每个 A 股交易日北京时间 09:20**：10 只当日潜力股，每只附推荐理由，可选 AI 选股和点评（见下方「每日潜力股」）。

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
| `ANTHROPIC_API_KEY` | 可选，AI 要闻和潜力股 AI 选股用 Claude。在 [Claude Console](https://platform.claude.com) 创建，按用量单独计费，和 Claude Pro 订阅无关 |
| `OPENAI_API_KEY` | 可选，AI 要闻和潜力股 AI 选股用 ChatGPT。在 [OpenAI Platform](https://platform.openai.com) 创建，同样和 ChatGPT Plus 订阅无关 |

3. 打开 **Actions** 标签 → 选「GitHub 今日涨星推送」→ **Run workflow** 手动跑一次，确认收到。之后每天自动执行。「AI 圈每日要闻推送」「每日潜力股推送」同理，潜力股手动运行时会跳过交易日判断并立即推送。

只配了 Telegram 或只配了邮箱也可以，没配的渠道会自动跳过。

## 本地运行

需要 Node.js ≥ 22.18（原生运行 TypeScript，无需编译）。

```bash
npm install
npm run dry-run        # 只打印榜单，不推送
npm run stocks:dry-run # 只打印潜力股，不推送
npm run ai-news:dry-run # 只打印 AI 要闻，不推送
cp .env.example .env   # 填好变量后：
node --env-file=.env src/github-trending/main.ts
npm test
```

## 可调整

- 推送时间：改 `.github/workflows/daily.yml` 里的 cron（UTC 时间，北京时间减 8 小时）。
- 数量：加一个 `TOP_COUNT` 环境变量。
- 翻译：英文说明默认用 Google 翻译成中文（免 key，失败时保留原文；被限流时会返回 HTTP 429）。邮件里中文下方附原文。设 `TRANSLATE=false` 可关闭。

## AI 圈每日要闻

工作流 `.github/workflows/ai-news.yml` 每天 08:00 运行：

1. **抓取**过去 24 小时的内容（论文 48 小时）：
   - 官方博客：OpenAI、Google DeepMind、Google AI、Hugging Face
   - 媒体：TechCrunch AI、量子位
   - 社区：Hacker News 上 80 分以上的 AI 相关帖子
   - 论文：Hugging Face Daily Papers（带点赞数）

   Anthropic 官网没有 RSS、机器之心 RSS 已下线、Reddit 拒绝脚本访问，所以没有收录。某个源挂了只会跳过它。
2. **合并打分**：同一事件被多个来源报道会合并（按链接和标题相似度），按来源权重 + HN 分数 / 论文点赞 + 报道家数打分。
3. **AI 挑选和总结**：把前 40 个事件交给 AI，选出最重要的 10 条，写中文标题、一句话摘要和「为什么值得关注」，并分为模型/产品发布、行业/公司动态、论文、开源/工具、社区热议。
   - 配了 `ANTHROPIC_API_KEY` 先用 Claude，配了 `OPENAI_API_KEY` 用 ChatGPT；两个都配时一个失败会自动换另一个。
   - 都没配或都失败时退回**规则排序**：按分数取前 10（每类最多 4 条），标题和简介用 Google 翻译成中文，没有点评。

可选的 Actions **Variables**（Settings → Secrets and variables → Actions → Variables）：

| Variable | 说明 |
| --- | --- |
| `AI_PROVIDER` | 设为 `openai` 则优先用 ChatGPT，默认优先 Claude |
| `ANTHROPIC_MODEL` | 默认 `claude-sonnet-5-5` |
| `OPENAI_MODEL` | 默认 `gpt-5-mini` |
| `OPENAI_BASE_URL` | 默认 `https://api.openai.com/v1`。填其他兼容 OpenAI 接口的服务地址（如 DeepSeek、通义千问）也能用，`OPENAI_API_KEY` 和 `OPENAI_MODEL` 换成对应服务的 |

数量用 `NEWS_COUNT` 调整，默认 10。

## 每日潜力股

工作流 `.github/workflows/stocks.yml` 周一到周五 08:30 启动，先判断今天是不是交易日（周末和法定节假日跳过，节假日数据来自 [holiday-cn](https://github.com/NateScarlet/holiday-cn)），再用上一交易日的收盘数据筛选，等到 09:20 推送。提前启动是因为 Actions 定时任务常有延迟，而且 09:15 集合竞价开始后行情接口的当日数据会被重置。

**数据**：取上一交易日主力资金净流入最多的约 200 只 A 股（沪深主板、创业板、科创板、北交所），都是免 key 的公开接口，按顺序尝试：

1. 东方财富：数据最全，含行业板块资金流向。但它经常拒绝海外 IP，GitHub Actions 上大概率连不上（日志里会看到 `东方财富: fetch failed (UND_ERR_SOCKET)` 之类的警告）。
2. 新浪财经（主力资金排名）+ 腾讯行情（量比、市盈率、市值、5/60 日涨幅）：海外可访问。没有行业数据，所以这时不会有「所属行业」理由，也不限同行业数量。

推送里会写明本次用的是哪个数据源。

**过滤**：排除 ST / 退市股、上市不满 120 天的新股、股价 < 3 元、市值 < 50 亿、成交额 < 3 亿、亏损股（市盈率 ≤ 0）、当日下跌或涨幅 ≥ 9.5%（避免追涨停）、近 5 日涨幅 > 25%（过热）。

**打分**（满分约 100）：主力净流入占比、所属行业资金流入排名、量比、换手率、当日涨幅、中短期趋势、市盈率。同一行业最多 2 只，避免扎堆。

每只股票列出触发的推荐理由（带具体数字），如有超跌反弹、短线涨幅过大、估值偏高等情况会额外给出风险提示。

**AI 选股**（可选）：配了 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`（与 AI 要闻共用，切换规则也一样）后，选股分两步：

1. 量化规则按上面的过滤和打分初选 30 只（同一行业最多 2 只）。
2. 把这 30 只的行情数据、量化理由和行业资金流向交给 AI，由 AI 综合资金持续性、量价配合、行业景气、估值和过热风险，**精选 10 只并排序**。

推送里会多出 🤖 **AI 市场观察**（一段话总结当日盘面），每只股票下多一句 🤖 **AI 入选理由**，标题下注明「AI 从 30 只量化初选股中精选」。

AI 只能从这 30 只里选，返回其他代码会被丢弃；它被要求只依据给它的数据、不编造新闻、不给买卖建议或目标价。AI 少选了会用量化排名补齐；没配 key 或 AI 调用失败时，直接用量化得分前 10，推送里注明「按量化得分选出」。

可调整：`STOCK_COUNT`（数量，默认 10）、`STOCK_PUSH_TIME`（推送时间，默认 `09:20`）。筛选阈值和权重在 `src/stocks/screener.ts` 顶部。

> ⚠️ 这是基于公开行情数据的规则化量化筛选，**不构成投资建议**。它只看资金与量价，不了解公司基本面和消息面，历史表现不代表未来。

## 目录结构

```
src/
  tools/            各任务共用：推送渠道 (Telegram/邮件)、Claude/ChatGPT 调用、翻译、HTML 处理、北京时间、重试
  github-trending/  GitHub 今日涨星：抓取、翻译、排版、入口 main.ts
  ai-news/          AI 圈要闻：抓取、合并打分、AI 总结、排版、入口 main.ts
    sources/        RSS、Hacker News、HF Daily Papers
  stocks/           每日潜力股：交易日历、筛选打分、排版、入口 main.ts
    sources/        行情数据源：东方财富、新浪 + 腾讯（备用）
test/               与 src 同结构
```

## 注意

- GitHub 定时任务在高峰期可能延迟，且仓库 **60 天没有任何提交** 会自动停用定时任务，到时去 Actions 页面重新启用即可。
- 如果 GitHub 改了 Trending 页面结构导致解析不到数据，任务会失败，GitHub 会发邮件通知你。
- 东方财富接口对同一 IP 的频繁请求会限流（直接断开连接），也常拒绝海外 IP，连不上时自动改用新浪 + 腾讯。本地调试时别连续狂跑。
