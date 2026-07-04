#!/usr/bin/env python3
from __future__ import annotations

import html
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import yaml

from daily_briefing_core import run_once

PROJECT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_DIR / 'config.example.yaml'
HOST = '127.0.0.1'
PORT = 8765
LAST_RUN_STATUS = 'No manual push yet.'
LAST_SYNC_STATUS = 'Not synced yet.'
REPO_FULL_NAME = 'YOUR_GITHUB_USERNAME/daily-briefing-agent'  # sanitized placeholder


def load_config() -> dict:
    return yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8'))


def save_config(config: dict) -> None:
    CONFIG_PATH.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding='utf-8')


def split_lines(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def parse_sources(value: str) -> list[dict[str, str]]:
    sources = []
    for line in split_lines(value):
        if '|' in line:
            name, url = [part.strip() for part in line.split('|', 1)]
        else:
            url = line.strip()
            name = url.replace('https://', '').replace('http://', '').split('/')[0]
        if url:
            sources.append({'name': name or url, 'url': url})
    return sources


def sources_to_text(sources: list[dict[str, str]]) -> str:
    return '\n'.join(f"{source.get('name', '')} | {source.get('url', '')}" for source in sources)


def run_briefing_in_background() -> None:
    global LAST_RUN_STATUS
    try:
        LAST_RUN_STATUS = 'Generating and sending now.'
        run_once(str(CONFIG_PATH))
        LAST_RUN_STATUS = 'Manual push complete.'
    except Exception as exc:
        LAST_RUN_STATUS = f'Manual push failed: {exc}'


def page(config: dict, saved: bool = False) -> str:
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daily Briefing Console</title>
  <style>
    body {{ margin: 0; background: #f6f7f9; color: #171717; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 28px; }}
    section {{ background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 18px; margin-bottom: 16px; }}
    label {{ display: block; font-weight: 650; margin: 12px 0 6px; }}
    input, textarea {{ width: 100%; box-sizing: border-box; border: 1px solid #cfd6df; border-radius: 6px; padding: 10px 12px; font: inherit; }}
    textarea {{ min-height: 120px; resize: vertical; }}
    button {{ border: 0; border-radius: 6px; background: #1557b0; color: white; padding: 10px 14px; font: inherit; cursor: pointer; }}
    .saved {{ color: #0b7a37; font-weight: 650; }}
  </style>
</head>
<body>
<main>
  <h1>Daily Briefing Console</h1>
  <p>Local control panel for sources, keywords, watchlist, push times, and manual sends.</p>
  {f'<p class="saved">Saved.</p>' if saved else ''}
  <form method="post" action="/save">
    <section>
      <h2>Schedule</h2>
      <label><input type="checkbox" name="enabled" value="1" {'checked' if config.get('enabled', True) else ''}> Enable automatic pushes</label>
      <label>Push times</label>
      <textarea name="push_times">{html.escape(chr(10).join(map(str, config.get('push_times', []))))}</textarea>
    </section>
    <section>
      <h2>Sources and Filters</h2>
      <label>Interest keywords</label>
      <textarea name="interests">{html.escape(chr(10).join(config.get('interests', [])))}</textarea>
      <label>Excluded keywords</label>
      <textarea name="excluded_keywords">{html.escape(chr(10).join(config.get('excluded_keywords', [])))}</textarea>
      <label>News sources</label>
      <textarea name="sources">{html.escape(sources_to_text(config.get('sources', [])))}</textarea>
    </section>
    <section>
      <h2>Watchlist</h2>
      <label>Stock tickers</label>
      <textarea name="stocks">{html.escape(chr(10).join(config.get('stocks', [])))}</textarea>
    </section>
    <button type="submit">Save</button>
  </form>
  <section>
    <h2>Manual Push</h2>
    <p>{html.escape(LAST_RUN_STATUS)}</p>
    <form method="post" action="/run-now"><button type="submit">Send once</button></form>
  </section>
  <section>
    <h2>GitHub Sync</h2>
    <p>{html.escape(LAST_SYNC_STATUS)}</p>
    <p>Production syncs sanitized config changes back to GitHub for the scheduled Actions job.</p>
  </section>
</main>
</body>
</html>'''


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.respond(page(load_config(), saved=self.path.startswith('/saved')))

    def do_POST(self) -> None:
        length = int(self.headers.get('Content-Length', '0'))
        form = parse_qs(self.rfile.read(length).decode('utf-8'))
        if self.path == '/run-now':
            threading.Thread(target=run_briefing_in_background, daemon=True).start()
            self.redirect('/')
            return
        if self.path == '/save':
            config = load_config()
            config['enabled'] = 'enabled' in form
            config['push_times'] = split_lines(form.get('push_times', [''])[0]) or ['08:00']
            config['send_time'] = config['push_times'][0]
            config['interests'] = split_lines(form.get('interests', [''])[0])
            config['excluded_keywords'] = split_lines(form.get('excluded_keywords', [''])[0])
            config['sources'] = parse_sources(form.get('sources', [''])[0])
            config['stocks'] = [item.upper() for item in split_lines(form.get('stocks', [''])[0])]
            save_config(config)
            self.redirect('/saved')
            return
        self.send_error(404)

    def respond(self, body: str) -> None:
        encoded = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def redirect(self, location: str) -> None:
        self.send_response(303)
        self.send_header('Location', location)
        self.end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        return


if __name__ == '__main__':
    print(f'Daily Briefing Console: http://{HOST}:{PORT}')
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
