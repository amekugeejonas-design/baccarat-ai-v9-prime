// ============================================================
// Scraper Telegram live (t.me/s/statistika_baccara) côté Worker
// ============================================================
import type { Hand } from './engine';

const CHANNEL = 'statistika_baccara';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const HAND_RE = /#N(\d+)\.\s*(\d)\(([^)]*)\)\s*-\s*(\d)\(([^)]*)\)\s*#T(\d+)(\s*#R)?/;
const CARD_RE = /(10|[2-9AJQK])(♠|♥|♦|♣)/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

export function parsePage(raw: string): Hand[] {
  const hands: Hand[] = [];
  const msgRe = new RegExp(
    `data-post="${CHANNEL}/(\\d+)"[\\s\\S]*?tgme_widget_message_text[^>]*>([\\s\\S]*?)</div>`,
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = msgRe.exec(raw)) !== null) {
    const msgId = parseInt(m[1], 10);
    let txt = m[2].replace(/<br\/?>/g, '\n').replace(/<[^>]+>/g, '');
    txt = decodeEntities(txt).replace(/\ufe0f/g, '');
    const hm = HAND_RE.exec(txt);
    if (!hm) continue;
    const [, n, ps, pcards, bs, bcards, , tie] = hm;
    const p: string[] = [];
    const b: string[] = [];
    let cm: RegExpExecArray | null;
    CARD_RE.lastIndex = 0;
    while ((cm = CARD_RE.exec(pcards)) !== null) p.push(cm[1] + cm[2]);
    CARD_RE.lastIndex = 0;
    while ((cm = CARD_RE.exec(bcards)) !== null) b.push(cm[1] + cm[2]);
    if (!p.length || !b.length) continue;
    const pi = parseInt(ps, 10);
    const bi = parseInt(bs, 10);
    const result = tie ? 'T' : pi > bi ? 'P' : bi > pi ? 'B' : 'T';
    hands.push({
      msg_id: msgId,
      n: parseInt(n, 10),
      p_score: pi,
      b_score: bi,
      p_cards: p,
      b_cards: b,
      result,
    });
  }
  return hands;
}

export async function fetchLatestHands(): Promise<Hand[]> {
  const res = await fetch(`https://t.me/s/${CHANNEL}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  const raw = await res.text();
  return parsePage(raw).sort((a, b) => a.msg_id - b.msg_id);
}
