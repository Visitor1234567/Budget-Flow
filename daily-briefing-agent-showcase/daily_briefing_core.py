#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote_plus, urlencode, urlsplit, urlunsplit

import requests
import yaml
from bs4 import BeautifulSoup

USER_AGENT = 'DailyBriefingAgent/0.1 portfolio-showcase'
REQUEST_TIMEOUT = 20
STATE_PATH = Path('briefing_state.json')
MAX_STATE_ARTICLES = 800


@dataclass
class Article:
    title: str
    url: str
    source: str
    published: str = ''
    excerpt: str = ''


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_config(path: str = 'config.example.yaml') -> dict[str, Any]:
    config_path = Path(path)
    load_env_file(config_path.with_name('.env'))
    return yaml.safe_load(config_path.read_text(encoding='utf-8'))


def fetch_url(url: str) -> str:
    response = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.text


def strip_text(value: str) -> str:
    return re.sub(r'\s+', ' ', BeautifulSoup(value or '', 'html.parser').get_text(' ')).strip()


def normalize_url(url: str) -> str:
    try:
        parts = urlsplit(url.strip())
        query = urlencode(
            [
                (key, value)
                for key, value in parse_qsl(parts.query, keep_blank_values=True)
                if not key.lower().startswith('utm_') and key.lower() not in {'fbclid', 'gclid', 'mc_cid', 'mc_eid'}
            ],
            doseq=True,
        )
        path = parts.path.rstrip('/') or parts.path
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ''))
    except Exception:
        return url.split('?')[0].strip()


def normalized_title(title: str) -> str:
    value = re.sub(r'[^\w\u4e00-\u9fff]+', ' ', title.lower())
    return re.sub(r'\s+', ' ', value).strip()


def stable_key(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode('utf-8')).hexdigest()[:16]
    return f'{prefix}:{digest}'


def article_key(article: Article) -> str:
    return stable_key('url', normalize_url(article.url) or normalized_title(article.title))


def title_key(article: Article) -> str:
    return stable_key('title', normalized_title(article.title))


def parse_published_at(value: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except Exception:
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def is_recent(article: Article, max_age_hours: int) -> bool:
    published = parse_published_at(article.published)
    if not published:
        return True
    return datetime.now(timezone.utc) - published <= timedelta(hours=max_age_hours)


def load_state(path: Path = STATE_PATH) -> dict[str, Any]:
    if not path.exists():
        return {'sent_slots': [], 'sent_article_keys': [], 'sent_title_keys': []}
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        state = {}
    state.setdefault('sent_slots', [])
    state.setdefault('sent_article_keys', [])
    state.setdefault('sent_title_keys', [])
    return state


def save_state(state: dict[str, Any], path: Path = STATE_PATH) -> None:
    state['sent_article_keys'] = list(dict.fromkeys(state.get('sent_article_keys', [])))[-MAX_STATE_ARTICLES:]
    state['sent_title_keys'] = list(dict.fromkeys(state.get('sent_title_keys', [])))[-MAX_STATE_ARTICLES:]
    state['sent_slots'] = list(dict.fromkeys(state.get('sent_slots', [])))[-120:]
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def parse_feed(xml_text: str, source_name: str) -> list[Article]:
    root = ET.fromstring(xml_text)
    articles: list[Article] = []
    if root.tag.lower().endswith('rss'):
        for item in root.findall('.//item'):
            title = strip_text(item.findtext('title', ''))
            link = item.findtext('link', '').strip()
            desc = strip_text(item.findtext('description', ''))
            published = item.findtext('pubDate', '') or ''
            if title and link:
                articles.append(Article(title=title, url=link, source=source_name, published=published, excerpt=desc[:400]))
        return articles

    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    for entry in root.findall('.//atom:entry', ns):
        title = strip_text(entry.findtext('atom:title', '', ns))
        link = next((node.attrib.get('href', '') for node in entry.findall('atom:link', ns) if node.attrib.get('rel', 'alternate') == 'alternate'), '')
        summary = strip_text(entry.findtext('atom:summary', '', ns) or entry.findtext('atom:content', '', ns))
        published = entry.findtext('atom:published', '', ns) or entry.findtext('atom:updated', '', ns) or ''
        if title and link:
            articles.append(Article(title=title, url=link, source=source_name, published=published, excerpt=summary[:400]))
    return articles


def parse_website_links(html_text: str, base_url: str, source_name: str) -> list[Article]:
    soup = BeautifulSoup(html_text, 'html.parser')
    articles: list[Article] = []
    seen: set[str] = set()
    for link in soup.find_all('a', href=True):
        title = strip_text(link.get_text(' '))
        href = link['href'].strip()
        if href.startswith('/'):
            href = base_url.rstrip('/') + href
        if len(title) < 12 or not href.startswith('http') or href in seen:
            continue
        seen.add(href)
        articles.append(Article(title=title[:180], url=href, source=source_name))
    return articles[:30]


def collect_articles(config: dict[str, Any]) -> list[Article]:
    articles: list[Article] = []
    for source in config.get('sources', []):
        source_name = source.get('name') or source.get('url')
        url = source['url']
        try:
            body = fetch_url(url)
            if body.lstrip().startswith('<'):
                try:
                    articles.extend(parse_feed(body, source_name))
                    continue
                except ET.ParseError:
                    pass
            articles.extend(parse_website_links(body, url, source_name))
        except Exception as exc:
            articles.append(Article(title=f'Source fetch failed: {source_name}', url=url, source=source_name, excerpt=str(exc)))
    return dedupe_articles(articles)


def dedupe_articles(articles: list[Article]) -> list[Article]:
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    result: list[Article] = []
    for article in articles:
        url_key = normalize_url(article.url)
        title_fingerprint = normalized_title(article.title)
        if url_key in seen_urls or title_fingerprint in seen_titles:
            continue
        seen_urls.add(url_key)
        seen_titles.add(title_fingerprint)
        result.append(article)
    return result


def keyword_matches(haystack: str, term: str) -> bool:
    term = term.strip()
    if not term:
        return False
    if any('\u4e00' <= char <= '\u9fff' for char in term):
        return term.lower() in haystack.lower()
    return re.search(rf'(?<![A-Za-z0-9_]){re.escape(term.lower())}(?![A-Za-z0-9_])', haystack.lower()) is not None


def score_article(article: Article, interests: list[str]) -> int:
    haystack = f'{article.title} {article.excerpt}'
    score = sum(3 for term in interests if keyword_matches(haystack, term))
    if parse_published_at(article.published):
        score += 1
    return score


def select_relevant_articles(config: dict[str, Any], state: dict[str, Any]) -> list[Article]:
    interests = [str(item) for item in config.get('interests', [])]
    exclusions = [str(item) for item in config.get('excluded_keywords', [])]
    limit = int(config.get('max_news_items', 8))
    max_age = int(config.get('max_general_news_age_hours', 48))
    sent_urls = set(state.get('sent_article_keys', []))
    sent_titles = set(state.get('sent_title_keys', []))

    candidates = []
    for article in collect_articles(config):
        haystack = f'{article.title} {article.excerpt} {article.source}'
        if article.title.startswith('Source fetch failed'):
            continue
        if article_key(article) in sent_urls or title_key(article) in sent_titles:
            continue
        if not is_recent(article, max_age):
            continue
        if any(keyword_matches(haystack, term) for term in exclusions):
            continue
        candidates.append(article)

    candidates.sort(key=lambda item: (score_article(item, interests), parse_published_at(item.published) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return candidates[:limit]


def summarize_article(article: Article, language: str) -> str:
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        return 'OpenAI API key is not configured; summary would be generated here in production.'

    from openai import OpenAI

    body = article.excerpt or article.title
    client = OpenAI(api_key=api_key)
    prompt = (
        'Summarize this article for a personal daily briefing. Translate to Chinese if language is zh-CN. '
        'Cover facts, context, and likely impact. Do not invent facts.\n\n'
        f'Language: {language}\nTitle: {article.title}\nSource: {article.source}\nBody: {body}'
    )
    response = client.chat.completions.create(
        model=os.getenv('OPENAI_MODEL', 'gpt-4.1-mini'),
        messages=[{'role': 'user', 'content': prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content.strip()


def fetch_stock_quote(symbol: str) -> dict[str, Any]:
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{quote_plus(symbol)}?range=1d&interval=1m'
    meta = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT).json()['chart']['result'][0]['meta']
    price = meta.get('regularMarketPrice')
    previous = meta.get('previousClose')
    change = price - previous if price is not None and previous else None
    change_pct = change / previous * 100 if change is not None and previous else None
    return {'symbol': symbol, 'price': price, 'change': change, 'change_pct': change_pct, 'currency': meta.get('currency', 'USD')}


def render_text(title: str, stock_quotes: list[dict[str, Any]], articles: list[tuple[Article, str]]) -> str:
    lines = [title, '', 'Markets']
    for quote in stock_quotes:
        if 'error' in quote:
            lines.append(f"{quote['symbol']}: quote failed - {quote['error']}")
        else:
            lines.append(f"{quote['symbol']}: {quote['currency']} {quote['price']}, {quote['change']:+.2f} / {quote['change_pct']:+.2f}%")
    lines.extend(['', 'News'])
    for index, (article, summary) in enumerate(articles, 1):
        lines.extend([f'{index}. Source: {article.source}', summary, article.url, ''])
    return '\n'.join(lines).strip()


def render_html(title: str, articles: list[tuple[Article, str]]) -> str:
    items = ''.join(
        f'<article><h3>{html.escape(article.source)}</h3><p>{html.escape(summary)}</p><p><a href="{html.escape(article.url)}">Read more</a></p></article>'
        for article, summary in articles
    )
    return f'<!doctype html><meta charset="utf-8"><main><h1>{html.escape(title)}</h1>{items}</main>'


def send_telegram(config: dict[str, Any], text: str) -> None:
    telegram = config.get('delivery', {}).get('telegram', {})
    if not telegram.get('enabled'):
        return
    bot_token = telegram.get('bot_token') or os.getenv('TELEGRAM_BOT_TOKEN')
    chat_id = telegram.get('chat_id')
    if not bot_token or not chat_id:
        raise RuntimeError('Telegram bot token or chat id missing. Use environment variables/secrets, not committed code.')
    url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
    for chunk in [text[i:i + 3900] for i in range(0, len(text), 3900)] or [text]:
        requests.post(url, json={'chat_id': chat_id, 'text': chunk, 'disable_web_page_preview': True}, timeout=REQUEST_TIMEOUT).raise_for_status()


def run_once(config_path: str = 'config.example.yaml') -> None:
    config = load_config(config_path)
    state = load_state()
    articles = select_relevant_articles(config, state)
    summaries = [(article, summarize_article(article, config.get('report_language', 'zh-CN'))) for article in articles]
    quotes = []
    for symbol in config.get('stocks', []):
        try:
            quotes.append(fetch_stock_quote(symbol))
        except Exception as exc:
            quotes.append({'symbol': symbol, 'error': str(exc)})
    title = f"{datetime.now():%Y-%m-%d} Daily Briefing"
    text = render_text(title, quotes, summaries)
    send_telegram(config, text)
    state.setdefault('sent_article_keys', []).extend(article_key(article) for article in articles)
    state.setdefault('sent_title_keys', []).extend(title_key(article) for article in articles)
    save_state(state)
    print(text)


if __name__ == '__main__':
    while True:
        run_once()
        time.sleep(60 * 60)
