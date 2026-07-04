// ============================================================
// Baccarat AI V9 Prime — Moteur de prédiction d'enseigne
// Poids et fenêtres APPRIS par grid-search sur 1217 mains réelles
// (voir /analysis/backtest_results.json et /analysis/metrics.json)
// ============================================================

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export type Suit = typeof SUITS[number];
export const RED = new Set<Suit>(['♥', '♦']);
export const color = (s: Suit): 'R' | 'N' => (RED.has(s) ? 'R' : 'N');

// Configuration retenue après tuning (train 1ère moitié / validation 2e moitié)
export const WEIGHTS = { freq: 0.2, momentum: 0.2, markov: 1.0, coverage: 2.0, color: 2.0 };
export const RATT_WEIGHTS = { freq: 0.2, momentum: 0.2, markov: 0.2, coverage: 3.0, color: 2.0 };
export const COV_WINDOW = 60;
export const RATT_WINDOW = 20;

export interface Hand {
  msg_id: number;
  n: number;
  p_score: number;
  b_score: number;
  p_cards: string[];
  b_cards: string[];
  result: string;
}

type Probs = Record<Suit, number>;

const uniform = (): Probs => ({ '♠': 0.25, '♥': 0.25, '♦': 0.25, '♣': 0.25 });

function normalize(p: Probs): Probs {
  const t = SUITS.reduce((a, s) => a + p[s], 0) || 1;
  const o = {} as Probs;
  for (const s of SUITS) o[s] = p[s] / t;
  return o;
}

// --- 1. ENGINE_FREQ : fréquence 1ère carte pondérée par récence ---
function engineFreq(firsts: Suit[], decay = 0.85, window = 20): Probs {
  const sc = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 } as Probs;
  const recent = firsts.slice(-window);
  for (let i = 0; i < recent.length; i++) {
    sc[recent[recent.length - 1 - i]] += Math.pow(decay, i);
  }
  return normalize(sc);
}

// --- 2. ENGINE_MOMENTUM : anti-momentum (mesuré empiriquement 21% < 25%) ---
function engineMomentum(firsts: Suit[], window = 5): Probs {
  const recent = firsts.slice(-window);
  const sc = uniform();
  if (!recent.length) return sc;
  const cnt = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 } as Probs;
  for (const s of recent) cnt[s]++;
  let top: Suit = '♠', max = -1;
  for (const s of SUITS) if (cnt[s] > max) { max = cnt[s]; top = s; }
  if (max >= 3) {
    for (const s of SUITS) sc[s] = s === top ? 0.16 : 0.28;
  }
  return normalize(sc);
}

// --- 3. ENGINE_MARKOV : ordres 1 et 2, construits en ligne sur l'historique réel ---
export type MarkovTable = Map<string, Record<Suit, number>>;

function engineMarkov(firsts: Suit[], m1: MarkovTable, m2: MarkovTable): Probs {
  const sc = uniform();
  if (firsts.length >= 1) {
    const row = m1.get(firsts[firsts.length - 1]);
    if (row) {
      const tot = SUITS.reduce((a, s) => a + row[s], 0);
      if (tot >= 20) for (const s of SUITS) sc[s] = 0.5 * sc[s] + 0.5 * (row[s] / tot);
    }
  }
  if (firsts.length >= 2) {
    const row = m2.get(firsts[firsts.length - 2] + firsts[firsts.length - 1]);
    if (row) {
      const tot = SUITS.reduce((a, s) => a + row[s], 0);
      if (tot >= 12) for (const s of SUITS) sc[s] = 0.6 * sc[s] + 0.4 * (row[s] / tot);
    }
  }
  return normalize(sc);
}

// --- 4. ENGINE_COVERAGE : P(enseigne apparaît dans la main) fenêtre glissante ---
function engineCoverage(handsSuits: Suit[][], window = COV_WINDOW): Probs {
  const recent = handsSuits.slice(-window);
  const n = recent.length || 1;
  const sc = {} as Probs;
  for (const s of SUITS) sc[s] = recent.filter((c) => c.includes(s)).length / n;
  return normalize(sc);
}

// --- 5. ENGINE_COLOR_GUARD : couverture couleur dominante ---
function engineColorGuard(handsSuits: Suit[][], window = RATT_WINDOW): Probs {
  const recent = handsSuits.slice(-window);
  const n = recent.length || 1;
  const covR = recent.filter((c) => c.some((x) => RED.has(x))).length / n;
  const covN = recent.filter((c) => c.some((x) => !RED.has(x))).length / n;
  const t = covR + covN || 1;
  const sc = {} as Probs;
  for (const s of SUITS) sc[s] = (RED.has(s) ? covR / t : covN / t) / 2;
  return normalize(sc);
}

export interface Prediction {
  suit: Suit;
  conf: number;
  probs: Probs;
  rattrapage: boolean;
}

// --- 6. FUSION ADAPTATIVE + MODE RATTRAPAGE ---
export function predict(
  firsts: Suit[],
  handsSuits: Suit[][],
  m1: MarkovTable,
  m2: MarkovTable,
  rattrapage: boolean,
  lastFailed: Suit | null
): Prediction {
  const eF = engineFreq(firsts);
  const eM = engineMomentum(firsts);
  const eK = engineMarkov(firsts, m1, m2);
  const eC = engineCoverage(handsSuits);
  const eG = engineColorGuard(handsSuits);
  const w = rattrapage ? RATT_WEIGHTS : WEIGHTS;
  const fused = {} as Probs;
  for (const s of SUITS) {
    fused[s] = w.freq * eF[s] + w.momentum * eM[s] + w.markov * eK[s] + w.coverage * eC[s] + w.color * eG[s];
  }
  if (rattrapage && lastFailed) {
    fused[lastFailed] = 0; // ne JAMAIS répéter l'enseigne qui vient d'échouer
    const recent = handsSuits.slice(-RATT_WINDOW);
    const n = recent.length || 1;
    const covR = recent.filter((c) => c.some((x) => RED.has(x))).length / n;
    const covN = recent.filter((c) => c.some((x) => !RED.has(x))).length / n;
    let dom: 'R' | 'N' = covR >= covN ? 'R' : 'N';
    if (dom === color(lastFailed)) dom = dom === 'R' ? 'N' : 'R';
    for (const s of SUITS) if (color(s) !== dom) fused[s] *= 0.25;
  }
  const probs = normalize(fused);
  let best: Suit = '♠', bp = -1;
  for (const s of SUITS) if (probs[s] > bp) { bp = probs[s]; best = s; }
  const recent = handsSuits.slice(-COV_WINDOW);
  const n = recent.length || 1;
  const covBest = recent.length ? recent.filter((c) => c.includes(best)).length / n : 0.5;
  const covCol = recent.length
    ? recent.filter((c) => c.some((x) => color(x) === color(best))).length / n
    : 0.8;
  let conf = (rattrapage ? covCol : covBest) + (probs[best] - 0.25) * 0.3;
  conf = Math.max(0.05, Math.min(0.97, conf));
  return { suit: best, conf, probs, rattrapage };
}

// ============================================================
// Walk-forward déterministe : rejoue toutes les prédictions —
// chaque prédiction n'utilise QUE le passé (aucune fuite).
// ============================================================
export interface StepResult {
  msg_id: number;
  n: number;
  pred_p: Suit; conf_p: number; ratt_p: boolean;
  pred_b: Suit; conf_b: number; ratt_b: boolean;
  actual_p1: Suit; actual_b1: Suit;
  p_cards: string[]; b_cards: string[];
  p_in_hand: boolean; b_in_hand: boolean;
  p_color_ok: boolean; b_color_ok: boolean;
  p_success: boolean; b_success: boolean;
}

interface SideState {
  firsts: Suit[];
  hs: Suit[][];
  m1: MarkovTable;
  m2: MarkovTable;
  rattrapage: boolean;
  lastFailed: Suit | null;
}

function newSide(): SideState {
  return { firsts: [], hs: [], m1: new Map(), m2: new Map(), rattrapage: false, lastFailed: null };
}

function bump(t: MarkovTable, k: string, s: Suit) {
  let row = t.get(k);
  if (!row) { row = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 }; t.set(k, row); }
  row[s]++;
}

export function walkForward(hands: Hand[], warmup = 60) {
  const P = newSide(), B = newSide();
  const steps: StepResult[] = [];
  let nextP: Prediction | null = null, nextB: Prediction | null = null;

  const stepSide = (st: SideState, cards: string[], pred: Prediction | null) => {
    const suits = cards.map((c) => c[c.length - 1] as Suit);
    const first = suits[0];
    let out: { hit: boolean; colorOk: boolean; success: boolean } | null = null;
    if (pred) {
      const inHand = suits.includes(pred.suit);
      const colorOk = suits.some((x) => color(x) === color(pred.suit));
      const success = pred.rattrapage ? colorOk : inHand;
      if (success) { st.rattrapage = false; st.lastFailed = null; }
      else { st.lastFailed = pred.suit; st.rattrapage = true; }
      out = { hit: inHand, colorOk, success };
    }
    if (st.firsts.length >= 1) bump(st.m1, st.firsts[st.firsts.length - 1], first);
    if (st.firsts.length >= 2) bump(st.m2, st.firsts[st.firsts.length - 2] + st.firsts[st.firsts.length - 1], first);
    st.firsts.push(first);
    st.hs.push(suits);
    return { first, out };
  };

  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    const predP = i >= warmup ? nextP : null;
    const predB = i >= warmup ? nextB : null;
    const rp = stepSide(P, h.p_cards, predP);
    const rb = stepSide(B, h.b_cards, predB);
    if (predP && predB && rp.out && rb.out) {
      steps.push({
        msg_id: h.msg_id, n: h.n,
        pred_p: predP.suit, conf_p: predP.conf, ratt_p: predP.rattrapage,
        pred_b: predB.suit, conf_b: predB.conf, ratt_b: predB.rattrapage,
        actual_p1: rp.first, actual_b1: rb.first,
        p_cards: h.p_cards, b_cards: h.b_cards,
        p_in_hand: rp.out.hit, b_in_hand: rb.out.hit,
        p_color_ok: rp.out.colorOk, b_color_ok: rb.out.colorOk,
        p_success: rp.out.success, b_success: rb.out.success,
      });
    }
    nextP = predict(P.firsts, P.hs, P.m1, P.m2, P.rattrapage, P.lastFailed);
    nextB = predict(B.firsts, B.hs, B.m1, B.m2, B.rattrapage, B.lastFailed);
  }
  return { steps, nextPrediction: { player: nextP!, banker: nextB! } };
}

export function rollingStats(steps: StepResult[], window = 50) {
  const recent = steps.slice(-window);
  const n = recent.length || 1;
  const rate = (f: (s: StepResult) => boolean) => recent.filter(f).length / n;
  let curStreak = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].p_success && steps[i].b_success) curStreak++;
    else break;
  }
  let maxLoss = 0, cur = 0;
  for (const s of recent) {
    if (!s.p_success) { cur++; maxLoss = Math.max(maxLoss, cur); } else cur = 0;
  }
  return {
    window: recent.length,
    p_success: rate((s) => s.p_success),
    b_success: rate((s) => s.b_success),
    p_in_hand: rate((s) => s.p_in_hand),
    b_in_hand: rate((s) => s.b_in_hand),
    p_exact: rate((s) => s.pred_p === s.actual_p1),
    b_exact: rate((s) => s.pred_b === s.actual_b1),
    p_color: rate((s) => s.p_color_ok),
    b_color: rate((s) => s.b_color_ok),
    current_win_streak: curStreak,
    max_loss_streak: maxLoss,
  };
}
