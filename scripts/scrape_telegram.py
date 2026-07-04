#!/usr/bin/env python3
"""Scrape real Baccarat hands from t.me/s/statistika_baccara with 'before' pagination."""
import re, html, json, time, urllib.request, sys

CH = "statistika_baccara"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
TARGET = 1200

HAND_RE = re.compile(r'#N(\d+)\.\s*(\d)\(([^)]*)\)\s*-\s*(\d)\(([^)]*)\)\s*#T(\d+)(\s*#R)?')
CARD_RE = re.compile(r'(10|[2-9AJQK])(♠|♥|♦|♣)')

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'replace')

def parse_page(raw):
    msgs = re.findall(r'data-post="' + CH + r'/(\d+)".*?tgme_widget_message_text[^>]*>(.*?)</div>', raw, re.S)
    hands = []
    ids = []
    for mid, txt in msgs:
        ids.append(int(mid))
        t = re.sub(r'<[^>]+>', '', re.sub(r'<br/?>', '\n', txt))
        t = html.unescape(t).replace('\ufe0f', '')
        m = HAND_RE.search(t)
        if not m:
            continue
        n, ps, pcards, bs, bcards, total, tie = m.groups()
        p = CARD_RE.findall(pcards)
        b = CARD_RE.findall(bcards)
        if not p or not b:
            continue
        res = 'T' if tie else ('P' if int(ps) > int(bs) else ('B' if int(bs) > int(ps) else 'T'))
        hands.append({
            "msg_id": int(mid), "n": int(n),
            "p_score": int(ps), "b_score": int(bs),
            "p_cards": [r + s for r, s in p], "b_cards": [r + s for r, s in b],
            "result": res
        })
    return hands, ids

all_hands = {}
before = None
empty_streak = 0
for i in range(200):
    url = f"https://t.me/s/{CH}" + (f"?before={before}" if before else "")
    try:
        raw = fetch(url)
    except Exception as e:
        print("fetch error", e); time.sleep(3); continue
    hands, ids = parse_page(raw)
    if not ids:
        empty_streak += 1
        if empty_streak > 3: break
        time.sleep(2); continue
    empty_streak = 0
    for h in hands:
        all_hands[h["msg_id"]] = h
    before = min(ids)
    print(f"page {i}: {len(hands)} hands, total {len(all_hands)}, before={before}")
    if len(all_hands) >= TARGET:
        break
    time.sleep(0.6)

sorted_hands = sorted(all_hands.values(), key=lambda h: h["msg_id"])
with open('/home/user/webapp/analysis/hands_raw.json', 'w') as f:
    json.dump(sorted_hands, f, ensure_ascii=False)
print(f"DONE: {len(sorted_hands)} hands saved")
