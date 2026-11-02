# github-trending-push

每天北京时间 22:00 抓取 [GitHub Trending](https://github.com/trending?since=daily)，按 **今日涨星数** 排序取前 10，推送到 Telegram Bot 和邮箱。每条包含：仓库名、说明、仓库地址、今日涨星、总星数、语言。

GitHub 没有 Trending 官方 API，所以脚本解析 Trending 页面（约 25 个仓库），再按 "stars today" 重新排序。

## 部署（GitHub Actions）

1. 新建一个 GitHub 仓库（私有也行），把本目录全部推上去。
2. 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret | 说明 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 找 [@BotFather](https://t.me/BotFather) 发 `/newbot` 拿到 |
| `TELEGRAM_CHAT_ID` | 先给你的 bot 发一条消息，然后打开 `https://api.telegram.org/bot<TOKEN>/getUpdates`，看 `chat.id` |
| `SMTP_HOST` | Gmail: `smtp.gmail.com` · QQ 邮箱: `smtp.qq.com` · 163: `smtp.163.com` |
| `SMTP_PORT` | 可不填，默认 `465` (SSL) |
| `SMTP_USER` | 发件邮箱地址 |
| `SMTP_PASS` | **不是登录密码**：Gmail 用「应用专用密码」，QQ/163 用「SMTP 授权码」 |
| `MAIL_TO` | 收件地址，多个用英文逗号分隔 |

3. 打开 **Actions** 标签 → 选「GitHub 今日涨星推送」→ **Run workflow** 手动跑一次，确认收到。之后每天自动执行。

只配了 Telegram 或只配了邮箱也可以，没配的渠道会自动跳过。

## 本地运行

需要 Node.js ≥ 22.18（原生运行 TypeScript，无需编译）。

```bash
npm install
npm run dry-run        # 只打印榜单，不推送
cp .env.example .env   # 填好变量后：
node --env-file=.env src/main.ts
npm test
```

## 可调整

- 推送时间：改 `.github/workflows/daily.yml` 里的 cron（UTC 时间，北京时间减 8 小时）。
- 数量：加一个 `TOP_COUNT` 环境变量。

## 注意

- GitHub 定时任务在高峰期可能延迟，且仓库 **60 天没有任何提交** 会自动停用定时任务，到时去 Actions 页面重新启用即可。
- 如果 GitHub 改了 Trending 页面结构导致解析不到数据，任务会失败，GitHub 会发邮件通知你。
