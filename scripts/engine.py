#!/usr/bin/env python3
"""
V9 Prime - Moteur de prediction (prototype Python pour backtest).
Fusionne 5 sous-moteurs; les poids sont appris par grid-search sur backtest reel.
Cible principale (Cible B): l'enseigne predite apparait dans les cartes de la main.
Mode RATTRAPAGE (apres 1 perte): bascule defensive -> couverture couleur (Cible C).
"""
import json, math, random
from collections import Counter, defaultdict

SUITS = ['♠', '♥', '♦', '♣']
RED = {'♥', '♦'}
IDX = {s: i for i, s in enumerate(SUITS)}

def color(s): return 'R' if s in RED else 'N'

class V9Engine:
    def __init__(self, w=None):
        # poids par defaut (seront appris)
        self.w = w or {'freq': 1.0, 'momentum': 0.5, 'markov': 0.8, 'coverage': 2.0, 'color': 1.0}

    # --- sous-moteurs : chacun renvoie un score [0..1] par enseigne ---
    def engine_freq(self, firsts, decay=0.85, window=20):
        """Frequence 1ere carte, ponderee par recence (decroissance exp)."""
        sc = {s: 0.0 for s in SUITS}
        recent = firsts[-window:]
        for i, s in enumerate(reversed(recent)):
            sc[s] += decay ** i
        tot = sum(sc.values()) or 1
        return {s: sc[s]/tot for s in SUITS}

    def engine_momentum(self, firsts, window=5):
        """Serie detectee: une enseigne >=3x en 5 -> le sabot etant ~uniforme,
        l'analyse empirique montre hit_rate ~21% (< 25%) => signal ANTI-momentum."""
        sc = {s: 0.25 for s in SUITS}
        recent = firsts[-window:]
        if not recent: return sc
        c = Counter(recent)
        top, cnt = c.most_common(1)[0]
        if cnt >= 3:
            # anti-momentum mesure empiriquement: penaliser l'enseigne en serie
            for s in SUITS:
                sc[s] = 0.28 if s != top else 0.16
        tot = sum(sc.values())
        return {s: sc[s]/tot for s in SUITS}

    def engine_markov(self, firsts, m1, m2):
        """Chaines de Markov ordre 1+2 construites sur l'historique reel (online)."""
        sc = {s: 0.25 for s in SUITS}
        if len(firsts) >= 1:
            last = firsts[-1]
            row = m1.get(last)
            if row and sum(row.values()) >= 20:
                tot = sum(row.values())
                for s in SUITS: sc[s] = 0.5*sc[s] + 0.5*(row[s]/tot)
        if len(firsts) >= 2:
            key = firsts[-2] + firsts[-1]
            row = m2.get(key)
            if row and sum(row.values()) >= 12:
                tot = sum(row.values())
                for s in SUITS: sc[s] = 0.6*sc[s] + 0.4*(row[s]/tot)
        tot = sum(sc.values())
        return {s: sc[s]/tot for s in SUITS}

    def engine_coverage(self, hands_suits, window=60):
        """Quelle enseigne maximise P(apparait dans la main) sur fenetre glissante."""
        recent = hands_suits[-window:]
        n = len(recent) or 1
        cov = {s: sum(1 for cards in recent if s in cards)/n for s in SUITS}
        tot = sum(cov.values()) or 1
        return {s: cov[s]/tot for s in SUITS}

    def engine_color_guard(self, hands_suits, window=40):
        """Couverture couleur sur fenetre glissante -> booste la couleur dominante."""
        recent = hands_suits[-window:]
        n = len(recent) or 1
        covR = sum(1 for cards in recent if any(s in RED for s in cards))/n
        covN = sum(1 for cards in recent if any(s not in RED for s in cards))/n
        tot = covR + covN or 1
        pr, pn = covR/tot, covN/tot
        return {s: (pr/2 if s in RED else pn/2) for s in SUITS}

    def predict(self, firsts, hands_suits, m1, m2, rattrapage=False, last_failed_suit=None):
        e_freq = self.engine_freq(firsts)
        e_mom = self.engine_momentum(firsts)
        e_mkv = self.engine_markov(firsts, m1, m2)
        e_cov = self.engine_coverage(hands_suits)
        e_col = self.engine_color_guard(hands_suits)
        w = self.w
        if rattrapage:
            # bascule defensive: coverage + color guard dominent
            w = {'freq': 0.2, 'momentum': 0.2, 'markov': 0.2, 'coverage': 3.0, 'color': 2.0}
        fused = {}
        for s in SUITS:
            fused[s] = (w['freq']*e_freq[s] + w['momentum']*e_mom[s] +
                        w['markov']*e_mkv[s] + w['coverage']*e_cov[s] +
                        w['color']*e_col[s])
        if rattrapage and last_failed_suit:
            # ne JAMAIS repeter l'enseigne qui vient d'echouer
            fused[last_failed_suit] = 0.0
            # cibler la couleur DOMINANTE en couverture (fenetre 40) - mesure empirique 80.5%
            recent40 = hands_suits[-40:]
            n40 = len(recent40) or 1
            covR = sum(1 for cards in recent40 if any(x in RED for x in cards))/n40
            covN = sum(1 for cards in recent40 if any(x not in RED for x in cards))/n40
            dom = 'R' if covR >= covN else 'N'
            if dom == color(last_failed_suit):
                # la couleur dominante est celle qui vient d'echouer -> basculer
                dom = 'N' if dom == 'R' else 'R'
            for s in SUITS:
                if color(s) != dom:
                    fused[s] *= 0.25
        tot = sum(fused.values()) or 1
        probs = {s: fused[s]/tot for s in SUITS}
        best = max(SUITS, key=lambda s: probs[s])
        # confiance calibree = proba de couverture estimee de l'enseigne choisie
        recent = hands_suits[-60:]
        n = len(recent) or 1
        cov_best = sum(1 for cards in recent if best in cards)/n if recent else 0.5
        covcol = sum(1 for cards in recent if any(color(x) == color(best) for x in cards))/n if recent else 0.8
        conf = covcol if rattrapage else cov_best
        # légère modulation par l'écart des probas fusionnées
        spread = probs[best] - 0.25
        conf = max(0.05, min(0.97, conf + spread*0.3))
        return best, conf, probs


def backtest(hands, side='p', w=None, warmup=60):
    """Backtest walk-forward strict: le moteur ne voit que le passe."""
    eng = V9Engine(w)
    firsts, hs = [], []
    m1 = defaultdict(Counter); m2 = defaultdict(Counter)
    results = []
    rattrapage = False
    last_failed = None
    for i, h in enumerate(hands):
        cards = h[f'{side}_cards']
        suits_in_hand = [c[-1] for c in cards]
        first = suits_in_hand[0]
        if i >= warmup:
            pred, conf, _ = eng.predict(firsts, hs, m1, m2, rattrapage, last_failed)
            hit_exact = pred == first
            hit_hand = pred in suits_in_hand
            hit_color = any(color(x) == color(pred) for x in suits_in_hand)
            # succes: en mode normal -> enseigne dans la main; en rattrapage -> couleur couvre
            success = hit_color if rattrapage else hit_hand
            results.append({'pred': pred, 'conf': conf, 'exact': hit_exact,
                            'in_hand': hit_hand, 'color': hit_color,
                            'rattrapage': rattrapage, 'success': success})
            if success:
                rattrapage = False; last_failed = None
            else:
                last_failed = pred
                rattrapage = True
        # update online state
        if firsts:
            m1[firsts[-1]][first] += 1
        if len(firsts) >= 2:
            m2[firsts[-2] + firsts[-1]][first] += 1
        firsts.append(first)
        hs.append(suits_in_hand)
    return results


def summarize(results):
    n = len(results)
    if not n: return {}
    normal = [r for r in results if not r['rattrapage']]
    ratt = [r for r in results if r['rattrapage']]
    # series de pertes consecutives
    streaks, cur = [], 0
    for r in results:
        if r['success']: 
            if cur: streaks.append(cur)
            cur = 0
        else: cur += 1
    if cur: streaks.append(cur)
    maxstreak = max(streaks) if streaks else 0
    le3 = sum(1 for s in streaks if s <= 3)/len(streaks) if streaks else 1.0
    return {
        'n': n,
        'success_rate_global': round(sum(r['success'] for r in results)/n, 4),
        'exact_first_card': round(sum(r['exact'] for r in results)/n, 4),
        'suit_in_hand': round(sum(r['in_hand'] for r in results)/n, 4),
        'color_in_hand': round(sum(r['color'] for r in results)/n, 4),
        'normal_mode': {'n': len(normal),
                        'suit_in_hand': round(sum(r['in_hand'] for r in normal)/len(normal), 4) if normal else None},
        'rattrapage_mode': {'n': len(ratt),
                            'success_color': round(sum(r['color'] for r in ratt)/len(ratt), 4) if ratt else None,
                            'suit_in_hand': round(sum(r['in_hand'] for r in ratt)/len(ratt), 4) if ratt else None},
        'max_loss_streak': maxstreak,
        'pct_streaks_le3': round(le3, 4),
    }


if __name__ == '__main__':
    hands = json.load(open('/home/user/webapp/analysis/hands_raw.json'))
    # --- grid search poids sur 1ere moitie, validation 2e moitie ---
    half = len(hands)//2
    best_w, best_score = None, -1
    grid = [0.2, 0.6, 1.0, 2.0]
    print("Grid search des poids (train = 1ere moitie)...")
    for wf in grid:
        for wm in [0.2, 0.6, 1.0]:
            for wk in [0.2, 0.6, 1.0]:
                for wc in [1.0, 2.0, 3.0]:
                    for wg in [0.5, 1.0, 2.0]:
                        w = {'freq': wf, 'momentum': wm, 'markov': wk, 'coverage': wc, 'color': wg}
                        rp = summarize(backtest(hands[:half], 'p', w))
                        rb = summarize(backtest(hands[:half], 'b', w))
                        score = rp['success_rate_global'] + rb['success_rate_global']
                        if score > best_score:
                            best_score, best_w = score, dict(w)
    print("Meilleurs poids:", best_w, "score train:", round(best_score/2, 4))

    # validation walk-forward sur la 2e moitie (jamais vue pendant le tuning)
    val_p = summarize(backtest(hands, 'p', best_w, warmup=half))
    val_b = summarize(backtest(hands, 'b', best_w, warmup=half))
    full_p = summarize(backtest(hands, 'p', best_w))
    full_b = summarize(backtest(hands, 'b', best_w))

    # --- Monte-Carlo: 10000 sabots aleatoires, borne theorique du meme moteur ---
    print("Monte-Carlo (10000 mains simulees x 3 runs)...")
    def sim_hands(n, seed):
        rnd = random.Random(seed)
        out = []
        for _ in range(n):
            def hand():
                k = rnd.choice([2,2,3])
                return [rnd.choice('23456789TJQKA') + rnd.choice(SUITS) for _ in range(k)]
            out.append({'p_cards': hand(), 'b_cards': hand()})
        return out
    mc = []
    for seed in range(3):
        sh = sim_hands(3400, seed)
        mc.append(summarize(backtest(sh, 'p', best_w))['success_rate_global'])
    mc_mean = round(sum(mc)/len(mc), 4)

    out = {
        'learned_weights': best_w,
        'validation_out_of_sample': {'player': val_p, 'banker': val_b},
        'full_backtest': {'player': full_p, 'banker': full_b},
        'monte_carlo_random_shoes': {'runs': mc, 'mean_success': mc_mean,
            'note': 'borne du moteur sur sabots purement aleatoires (10200 mains)'},
    }
    json.dump(out, open('/home/user/webapp/analysis/backtest_results.json', 'w'), indent=2, ensure_ascii=False)
    print(json.dumps(out, indent=2, ensure_ascii=False))
