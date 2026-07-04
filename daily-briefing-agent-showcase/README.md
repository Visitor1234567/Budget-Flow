# Daily Briefing Agent - Sanitized Public Showcase

This is a safe public showcase copy of a private personal automation project. It preserves the architecture, workflows, and implementation patterns while replacing private values with explicit placeholders.

## What it does

Daily Briefing Agent is a local/cloud hybrid information agent that:

- collects RSS feeds and selected websites
- filters articles by interest keywords and exclusion keywords
- tracks a stock watchlist and finds relevant market news
- uses OpenAI for translated summaries when an API key is configured
- sends briefings to Telegram
- exposes a local web console for editing sources, keywords, watchlists, languages, and push times
- supports Telegram bot commands for remote control
- runs scheduled delivery through GitHub Actions while keeping long-lived Telegram command polling local

## Why this version is public-safe

The original private repo contains personal configuration and local machine paths. This showcase intentionally redacts or replaces:

- Telegram chat IDs and bot tokens
- OpenAI API keys
- GitHub repository owner/repo names used for private sync
- local macOS username paths
- delivery state/history files
- logs and runtime state

See [`SECURITY_REDACTIONS.md`](SECURITY_REDACTIONS.md) for the audit notes.

## Files in this showcase

- [`config.example.yaml`](config.example.yaml) - sanitized example configuration
- [`daily_briefing_core.py`](daily_briefing_core.py) - core collection, filtering, summarization, rendering, delivery logic
- [`telegram_bot_commands.py`](telegram_bot_commands.py) - Telegram command controller pattern
- [`github-actions-daily-briefing.example.yml`](github-actions-daily-briefing.example.yml) - scheduled GitHub Actions workflow example
- [`.env.example`](.env.example) - secret placeholders only

## Design notes

The project separates runtime secrets from code. The local app reads `.env`, GitHub Actions reads repository secrets, and the checked-in config uses blank or placeholder values. This lets the same code run locally and in scheduled cloud jobs without committing tokens.

## Example command surface

```text
/help
/status
/pause
/resume
/sendnow
/addnewsweb Name | https://example.com/rss
/delnewsweb INDEX_OR_URL
/listnewsweb
/addstock TICKER
/delstock TICKER
/liststocks
/addkeyword KEYWORD
/delkeyword KEYWORD
/listkeywords
/addexclude TERM
/delexclude TERM
/listexclude
/setpush 08:00 17:00
/setuilang zh|en
/setreportlang zh|en
/setmaxnews 25
/setstocknews 1
/skipweekends on|off
```

## Reviewer note

This is a representative sanitized copy for portfolio review. The private production repo keeps secrets and delivery state out of public GitHub history.