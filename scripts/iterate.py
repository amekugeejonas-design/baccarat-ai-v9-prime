#!/usr/bin/env python3
"""Iteration: test de signaux additionnels + optimisation du rattrapage."""
import json
from collections import Counter
SUITS = ['♠', '♥', '♦', '♣']
RED = {'♥', '♦'}
hands = json.load(open('/home/user/webapp/analysis/hands_raw.json'))
N = len(hands)

p_all = [[c[-1] for c in h['p_cards']] for h in hands]
b_all = [[c[-1] for c in h['b_cards']] for h in hands]
all_cards = [[c[-1] for c in h['p_cards'] + h['b_cards']] for h in hands]

def color(s): return 'R' if s in RED else 'N'

# --- SIGNAL 1: deplétion sabot. Enseigne la MOINS vue (toutes cartes) sur fenetre W
#     -> plus riche dans le sabot restant?
for W in [10, 20, 40, 80]:
    hit_first = hit_hand = tot = 0
    for i in range(W, N):
        cnt = Counter()
        for cards in all_cards[i-W:i]: cnt.update(cards)
        pred = min(SUITS, key=lambda s: cnt[s])
        tot += 1
        if p_all[i][0] == pred: hit_first += 1
        if pred in p_all[i]: hit_hand += 1
    print(f"DEPLETION W={W}: exact={hit_first/tot:.4f} in_hand={hit_hand/tot:.4f}")

# --- SIGNAL 2: enseigne la PLUS vue (momentum global cartes)
for W in [10, 20, 40]:
    hit_hand = tot = 0
    for i in range(W, N):
        cnt = Counter()
        for cards in all_cards[i-W:i]: cnt.update(cards)
        pred = max(SUITS, key=lambda s: cnt[s])
        tot += 1
        if pred in p_all[i]: hit_hand += 1
    print(f"HOT W={W}: in_hand={hit_hand/tot:.4f}")

# --- BASELINE: meilleure enseigne fixe (coverage globale) walk-forward
for side, arr in [('P', p_all), ('B', b_all)]:
    hit = tot = 0
    for i in range(60, N):
        cov = Counter()
        for s in SUITS:
            cov[s] = sum(1 for cards in arr[:i] if s in cards)
        pred = max(SUITS, key=lambda s: cov[s])
        tot += 1
        if pred in arr[i]: hit += 1
    print(f"BASELINE best-cov-global {side}: in_hand={hit/tot:.4f}")

# --- RATTRAPAGE optimal: apres echec du suit X, choisir couleur opposee,
#     et dans cette couleur l'enseigne avec meilleure coverage globale.
#     Mesure: couleur choisie apparait dans la main suivante.
for side, arr in [('P', p_all), ('B', b_all)]:
    for strat in ['opposite_color', 'dominant_color_excl_failed']:
        hit = tot = 0
        for i in range(60, N-1):
            # simule un echec: pred = best coverage suit, échec si absent
            cov = Counter({s: sum(1 for cards in arr[max(0,i-60):i] if s in cards) for s in SUITS})
            pred = max(SUITS, key=lambda s: cov[s])
            if pred in arr[i]: continue
            tot += 1
            if strat == 'opposite_color':
                target_color = 'N' if color(pred) == 'R' else 'R'
            else:
                # couleur dominante en coverage (fenetre 40), enseigne != pred
                covR = sum(1 for cards in arr[max(0,i-40):i] if any(s in RED for s in cards))
                covN = sum(1 for cards in arr[max(0,i-40):i] if any(s not in RED for s in cards))
                target_color = 'R' if covR >= covN else 'N'
                if target_color == color(pred):
                    # verifie contrainte: on peut garder la couleur si suit != pred
                    pass
            ok = any(color(s) == target_color for s in arr[i+1])
            if ok: hit += 1
        print(f"RATTRAPAGE {side} {strat}: color_hit={hit/tot:.4f} (n={tot})")
