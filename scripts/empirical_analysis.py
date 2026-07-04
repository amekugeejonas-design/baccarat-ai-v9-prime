#!/usr/bin/env python3
"""ETAPE 2 - Analyse empirique obligatoire sur les mains reelles."""
import json, math
from collections import Counter, defaultdict

SUITS = ['♠', '♥', '♦', '♣']
RED = {'♥', '♦'}

hands = json.load(open('/home/user/webapp/analysis/hands_raw.json'))
N = len(hands)

def suit(card): return card[-1]
def color(s): return 'R' if s in RED else 'N'

p1 = [suit(h['p_cards'][0]) for h in hands]   # 1ere carte Joueur
b1 = [suit(h['b_cards'][0]) for h in hands]   # 1ere carte Banquier
p_all = [[suit(c) for c in h['p_cards']] for h in hands]
b_all = [[suit(c) for c in h['b_cards']] for h in hands]

report = {"sample_size": N, "source": "t.me/statistika_baccara", "hands_range": [hands[0]['n'], hands[-1]['n']]}

# a) Frequences 1ere carte
report['freq_first_card'] = {
    'player': {s: round(p1.count(s)/N, 4) for s in SUITS},
    'banker': {s: round(b1.count(s)/N, 4) for s in SUITS},
}

# b) Correlations main(n) -> main(n+1) : matrices de transition ordre 1
def transition(seq):
    m = defaultdict(Counter)
    for a, b in zip(seq, seq[1:]): m[a][b] += 1
    out = {}
    for a in SUITS:
        tot = sum(m[a].values()) or 1
        out[a] = {b: round(m[a][b]/tot, 4) for b in SUITS}
    return out
report['markov1'] = {'player': transition(p1), 'banker': transition(b1)}

# Markov ordre 2
def transition2(seq):
    m = defaultdict(Counter)
    for a, b, c in zip(seq, seq[1:], seq[2:]): m[a+b][c] += 1
    out = {}
    for k, cnt in m.items():
        tot = sum(cnt.values())
        if tot >= 5:
            out[k] = {s: round(cnt[s]/tot, 4) for s in SUITS}
    return out
report['markov2_states_ge5'] = {'player': len(transition2(p1)), 'banker': len(transition2(b1))}

# c) Couverture : enseigne apparait dans P1 (2-3 cartes) / P2
def coverage(all_suits):
    cov = {}
    for s in SUITS:
        cov[s] = round(sum(1 for cards in all_suits if s in cards)/N, 4)
    return cov
report['coverage_appears_in_hand'] = {'player': coverage(p_all), 'banker': coverage(b_all)}

# d) Couverture par groupe couleur (au moins une carte de la couleur dans la main)
def cov_color(all_suits):
    r = sum(1 for cards in all_suits if any(s in RED for s in cards))/N
    n = sum(1 for cards in all_suits if any(s not in RED for s in cards))/N
    return {'red': round(r, 4), 'black': round(n, 4)}
report['coverage_color'] = {'player': cov_color(p_all), 'banker': cov_color(b_all)}
# couleur exacte de la 1ere carte
report['first_card_color_freq'] = {
    'player': {'red': round(sum(1 for s in p1 if s in RED)/N, 4)},
    'banker': {'red': round(sum(1 for s in b1 if s in RED)/N, 4)},
}

# e) Momentum : si une enseigne sort >=3 fois dans les 5 dernieres, proba qu'elle ressorte
def momentum_test(seq, win, thresh):
    hit = tot = 0
    for i in range(win, len(seq)):
        c = Counter(seq[i-win:i])
        top, cnt = c.most_common(1)[0]
        if cnt >= thresh:
            tot += 1
            if seq[i] == top: hit += 1
    return {'occurrences': tot, 'hit_rate': round(hit/tot, 4) if tot else None}
report['momentum'] = {
    'player': {f'win{w}_ge{t}': momentum_test(p1, w, t) for w, t in [(5,3),(10,5),(20,8)]},
    'banker': {f'win{w}_ge{t}': momentum_test(b1, w, t) for w, t in [(5,3),(10,5),(20,8)]},
}

# f) Auto-correlation du sabot : P(suit_n == suit_{n-k})
def autocorr(seq, k):
    same = sum(1 for i in range(k, len(seq)) if seq[i] == seq[i-k])
    return round(same/(len(seq)-k), 4)
report['autocorrelation'] = {
    'player': {f'lag{k}': autocorr(p1, k) for k in range(1, 9)},
    'banker': {f'lag{k}': autocorr(b1, k) for k in range(1, 9)},
    'baseline_random': 0.25
}

# g) Rattrapage : apres un echec (enseigne predite = plus frequente recente absente de P1..),
# quelle strategie gagne : (1) repeter, (2) changer de couleur + coverage, (3) anti-derniere
# On simule avec une strategie naive "predire l'enseigne la plus frequente des 10 dernieres"
def naive_pred(seq, i):
    c = Counter(seq[max(0,i-10):i])
    return c.most_common(1)[0][0] if c else '♠'

strategies = {'repeat_same': 0, 'switch_color_best_cov': 0, 'anti_last': 0}
tot_fail = 0
for i in range(10, N-1):
    pred = naive_pred(p1, i)
    if pred not in p_all[i]:  # echec (cible B: dans la main)
        tot_fail += 1
        nxt = p_all[i+1]
        # repeat
        if pred in nxt: strategies['repeat_same'] += 1
        # switch color: enseigne de l'autre couleur la plus couvrante globalement
        other = [s for s in SUITS if (s in RED) != (pred in RED)]
        best_other = max(other, key=lambda s: sum(1 for cs in p_all[:i] if s in cs))
        if best_other in nxt: strategies['switch_color_best_cov'] += 1
        # anti-last: enseigne de la 1ere carte de la main i
        if p1[i] in nxt: strategies['anti_last'] += 1
report['rattrapage_after_fail'] = {
    'fails_analyzed': tot_fail,
    'strategy_hit_rates': {k: round(v/tot_fail, 4) for k, v in strategies.items()}
}

# cartes par main (distribution 2 vs 3 cartes)
report['cards_per_hand'] = {
    'player': dict(Counter(len(c) for c in p_all)),
    'banker': dict(Counter(len(c) for c in b_all)),
}
# resultats
report['results'] = dict(Counter(h['result'] for h in hands))

# Chi2 vs uniforme pour la 1ere carte
def chi2(seq):
    exp = len(seq)/4
    return round(sum((seq.count(s)-exp)**2/exp for s in SUITS), 2)
report['chi2_uniformity'] = {'player': chi2(p1), 'banker': chi2(b1), 'critical_0.05_df3': 7.81}

json.dump(report, open('/home/user/webapp/analysis/empirical_report.json', 'w'), indent=2, ensure_ascii=False)
print(json.dumps(report, indent=2, ensure_ascii=False))
