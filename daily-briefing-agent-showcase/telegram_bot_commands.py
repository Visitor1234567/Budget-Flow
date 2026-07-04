#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

import requests
import yaml

from daily_briefing_core import load_env_file, run_once

PROJECT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_DIR / 'config.example.yaml'
STATE_PATH = PROJECT_DIR / 'telegram_bot_state.yaml'
REPO_FULL_NAME = 'YOUR_GITHUB_USERNAME/daily-briefing-agent'  # sanitized placeholder
REQUEST_TIMEOUT = 30


def load_config() -> dict[str, Any]:
    load_env_file(PROJECT_DIR / '.env')
    return yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8'))


def save_config(config: dict[str, Any]) -> None:
    CONFIG_PATH.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding='utf-8')


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {'offset': 0}
    return yaml.safe_load(STATE_PATH.read_text(encoding='utf-8')) or {'offset': 0}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(yaml.safe_dump(state, allow_unicode=True, sort_keys=False), encoding='utf-8')


def bot_token(config: dict[str, Any]) -> str:
    token = config.get('delivery', {}).get('telegram', {}).get('bot_token') or os.getenv('TELEGRAM_BOT_TOKEN')
    if not token:
        raise RuntimeError('Telegram bot token is missing. Use TELEGRAM_BOT_TOKEN, not committed source.')
    return token


def api(config: dict[str, Any], method: str, **payload: Any) -> Any:
    url = f'https://api.telegram.org/bot{bot_token(config)}/{method}'
    response = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    if not data.get('ok'):
        raise RuntimeError(str(data))
    return data.get('result')


def send(config: dict[str, Any], chat_id: int | str, text: str) -> None:
    for chunk in [text[i:i + 3900] for i in range(0, len(text), 3900)] or [text]:
        api(config, 'sendMessage', chat_id=str(chat_id), text=chunk, disable_web_page_preview=True)


def authorized(config: dict[str, Any], chat_id: int | str) -> bool:
    expected = str(config.get('delivery', {}).get('telegram', {}).get('chat_id', ''))
    return bool(expected) and str(chat_id) == expected


def split_args(text: str) -> tuple[str, str]:
    parts = text.strip().split(maxsplit=1)
    command = parts[0].split('@', 1)[0].lower() if parts else ''
    rest = parts[1].strip() if len(parts) > 1 else ''
    return command, rest


def parse_source(line: str) -> dict[str, str]:
    if '|' in line:
        name, url = [part.strip() for part in line.split('|', 1)]
    else:
        url = line.strip()
        name = url.replace('https://', '').replace('http://', '').split('/')[0]
    if not url.startswith(('http://', 'https://')):
        raise ValueError('URL must start with http:// or https://')
    return {'name': name or url, 'url': url}


def sync_to_github() -> tuple[bool, str]:
    # Production uses git pull/add/commit/push so Telegram commands can update
    # config.yaml for the scheduled GitHub Actions job. Repo name is sanitized.
    if not (PROJECT_DIR / '.git').exists():
        return False, 'not a git repository'
    commands = [
        ['git', 'pull', '--rebase', '--autostash', 'origin', 'main'],
        ['git', 'add', 'config.example.yaml', 'briefing_state.json'],
    ]
    for command in commands:
        result = subprocess.run(command, cwd=PROJECT_DIR, text=True, capture_output=True, timeout=120)
        if result.returncode != 0:
            return False, (result.stdout + result.stderr).strip()
    diff = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=PROJECT_DIR)
    if diff.returncode == 0:
        return True, 'no changes'
    result = subprocess.run(['git', 'commit', '-m', 'Update briefing config from Telegram bot'], cwd=PROJECT_DIR, text=True, capture_output=True, timeout=120)
    if result.returncode != 0:
        return False, (result.stdout + result.stderr).strip()
    result = subprocess.run(['git', 'push', 'origin', 'main'], cwd=PROJECT_DIR, text=True, capture_output=True, timeout=120)
    if result.returncode != 0:
        return False, (result.stdout + result.stderr).strip()
    return True, 'synced'


def save_and_sync(config: dict[str, Any]) -> str:
    save_config(config)
    ok, detail = sync_to_github()
    return 'Saved and synced to GitHub.' if ok else f'Saved locally, but GitHub sync failed: {detail}'


def help_text() -> str:
    return '''Commands:
/status - show current settings
/pause - disable automatic pushes
/resume - enable automatic pushes
/sendnow - send one briefing now
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
/skipweekends on|off'''


def status_text(config: dict[str, Any]) -> str:
    return (
        f"Automatic pushes: {'on' if config.get('enabled', True) else 'off'}\n"
        f"UI language: {config.get('ui_language', 'zh-CN')}\n"
        f"Report language: {config.get('report_language') or config.get('language', 'zh-CN')}\n"
        f"Push times: {', '.join(map(str, config.get('push_times', [])))}\n"
        f"Sources: {len(config.get('sources', []))}\n"
        f"Stocks: {', '.join(config.get('stocks', [])) or 'none'}\n"
        f"Skip weekends: {'yes' if config.get('skip_weekends', True) else 'no'}"
    )


def handle_command(config: dict[str, Any], chat_id: int, text: str) -> str:
    command, arg = split_args(text)
    if command in {'/start', '/help'}:
        return help_text()
    if command == '/status':
        return status_text(config)
    if command == '/pause':
        config['enabled'] = False
        return save_and_sync(config)
    if command == '/resume':
        config['enabled'] = True
        return save_and_sync(config)
    if command == '/sendnow':
        send(config, chat_id, 'Generating and sending now.')
        run_once(str(CONFIG_PATH))
        return 'Manual push complete.'
    if command == '/addnewsweb':
        config.setdefault('sources', []).append(parse_source(arg))
        return save_and_sync(config)
    if command == '/listnewsweb':
        lines = [f"{idx}. {item.get('name')} | {item.get('url')}" for idx, item in enumerate(config.get('sources', []), 1)]
        return '\n'.join(lines) or 'No news sources.'
    if command == '/delnewsweb':
        sources = config.get('sources', [])
        before = len(sources)
        if arg.isdigit():
            index = int(arg) - 1
            if 0 <= index < len(sources):
                sources.pop(index)
        else:
            sources[:] = [item for item in sources if arg not in item.get('url', '') and arg.lower() != str(item.get('name', '')).lower()]
        if len(sources) == before:
            return 'No matching source found.'
        config['sources'] = sources
        return save_and_sync(config)
    if command == '/addstock':
        symbol = arg.upper().strip()
        if not re.match(r'^[A-Z0-9.\-]{1,15}$', symbol):
            return 'Send a valid ticker.'
        stocks = config.setdefault('stocks', [])
        if symbol not in stocks:
            stocks.append(symbol)
        return save_and_sync(config)
    if command == '/delstock':
        symbol = arg.upper().strip()
        config['stocks'] = [item for item in config.get('stocks', []) if item.upper() != symbol]
        return save_and_sync(config)
    if command == '/liststocks':
        return ', '.join(config.get('stocks', [])) or 'No stocks.'
    if command in {'/addkeyword', '/addexclude'}:
        key = 'interests' if command == '/addkeyword' else 'excluded_keywords'
        values = config.setdefault(key, [])
        if arg and arg not in values:
            values.append(arg)
        return save_and_sync(config)
    if command in {'/delkeyword', '/delexclude'}:
        key = 'interests' if command == '/delkeyword' else 'excluded_keywords'
        config[key] = [item for item in config.get(key, []) if item.lower() != arg.lower()]
        return save_and_sync(config)
    if command in {'/listkeywords', '/listexclude'}:
        key = 'interests' if command == '/listkeywords' else 'excluded_keywords'
        return '\n'.join(config.get(key, [])) or 'None.'
    if command == '/setpush':
        times = [part for part in re.split(r'[\s,]+', arg) if re.match(r'^\d{2}:\d{2}$', part)]
        if not times:
            return 'Format: /setpush 08:00 17:00'
        config['push_times'] = times
        config['send_time'] = times[0]
        return save_and_sync(config)
    if command in {'/setuilang', '/setreportlang'}:
        value = {'zh': 'zh-CN', 'en': 'en-US'}.get(arg.strip().lower())
        if not value:
            return 'Use zh or en.'
        config['ui_language' if command == '/setuilang' else 'report_language'] = value
        return save_and_sync(config)
    if command in {'/setmaxnews', '/setstocknews'}:
        if not arg.isdigit():
            return 'Send a number.'
        key = 'max_news_items' if command == '/setmaxnews' else 'max_stock_news_per_symbol'
        config[key] = max(1, int(arg))
        return save_and_sync(config)
    if command == '/skipweekends':
        value = arg.strip().lower()
        if value not in {'on', 'off'}:
            return 'Format: /skipweekends on or /skipweekends off'
        config['skip_weekends'] = value == 'on'
        return save_and_sync(config)
    return 'Unknown command. Send /help.'


def poll() -> None:
    print('Daily Briefing Telegram bot is running.')
    while True:
        try:
            config = load_config()
            state = load_state()
            result = api(config, 'getUpdates', offset=int(state.get('offset', 0)), timeout=25, allowed_updates=['message'])
            for update in result:
                state['offset'] = int(update['update_id']) + 1
                save_state(state)
                message = update.get('message') or {}
                chat_id = (message.get('chat') or {}).get('id')
                text = message.get('text') or ''
                if not chat_id or not text.startswith('/'):
                    continue
                config = load_config()
                if not authorized(config, chat_id):
                    send(config, chat_id, 'Unauthorized chat.')
                    continue
                try:
                    reply = handle_command(config, int(chat_id), text)
                except Exception as exc:
                    reply = f'Command failed: {exc}'
                send(load_config(), chat_id, reply)
        except Exception as exc:
            print(f'Telegram bot error: {exc}')
            time.sleep(5)


if __name__ == '__main__':
    poll()
