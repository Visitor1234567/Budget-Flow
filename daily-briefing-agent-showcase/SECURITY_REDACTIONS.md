# Security Redactions

This public showcase was prepared from a private personal automation repo. The following items were intentionally removed or replaced before publication.

## Redacted

- `TELEGRAM_BOT_TOKEN`: replaced with `REDACTED_TELEGRAM_BOT_TOKEN` / GitHub Secret references.
- Telegram `chat_id`: replaced with `123456789` or `REDACTED_TELEGRAM_CHAT_ID`.
- `OPENAI_API_KEY`: kept only as `.env.example` and GitHub Secret references.
- Private GitHub repo name used by the local console for secret sync: replaced with `YOUR_GITHUB_USERNAME/daily-briefing-agent`.
- Local machine paths such as `/Users/<real-user>/Documents/daily-briefing`: replaced with `/Users/YOUR_USERNAME/Documents/daily-briefing-agent`.
- Runtime delivery state: omitted. State files only contain sent-article hashes and duplicate-prevention metadata, so they are not useful for portfolio review.
- Logs, `.env`, virtualenvs, local tool downloads, and Telegram polling offsets: omitted.

## Preserved

- Agent architecture
- Feed collection and deduplication flow
- Keyword filtering and exclusion logic
- OpenAI summarization pattern
- Telegram delivery pattern
- Telegram command-control surface
- GitHub Actions scheduling pattern
- Local/cloud separation of responsibilities

## Important

This repository is not the production deployment. It is a public-safe copy whose placeholders make the redactions visible to reviewers.