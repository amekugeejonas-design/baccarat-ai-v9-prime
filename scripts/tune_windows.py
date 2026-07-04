#!/usr/bin/env python3
"""Iteration 2: sweep des fenetres (coverage, color, rattrapage) du moteur."""
import json, itertools, importlib.util
spec = importlib.util.spec_from_file_location('engine', '/home/user/webapp/scripts/engine.py')
eng_mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng_mod)

hands = json.load(open('/home/user/webapp/analysis/hands_raw.json'))
W = {'freq': 0.2, 'momentum': 0.2, 'markov': 1.0, 'coverage': 2.0, 'color': 2.0}

# monkey-patch windows on the class
import types
best = None
for cov_w in [30, 60, 100, 200]:
    for ratt_w in [20, 40, 80]:
        src_predict = eng_mod.V9Engine.predict
        def make_predict(cw, rw):
            def predict(self, firsts, hands_suits, m1, m2, rattrapage=False, last_failed_suit=None):
                SUITS = eng_mod.SUITS; RED = eng_mod.RED; color = eng_mod.color
                e_freq = self.engine_freq(firsts)
                e_mom = self.engine_momentum(firsts)
                e_mkv = self.engine_markov(firsts, m1, m2)
                e_cov = self.engine_coverage(hands_suits, window=cw)
                e_col = self.engine_color_guard(hands_suits, window=rw)
                w = self.w
                if rattrapage:
                    w = {'freq': 0.2, 'momentum': 0.2, 'markov': 0.2, 'coverage': 3.0, 'color': 2.0}
                fused = {s: (w['freq']*e_freq[s] + w['momentum']*e_mom[s] + w['markov']*e_mkv[s]
                             + w['coverage']*e_cov[s] + w['color']*e_col[s]) for s in SUITS}
                if rattrapage and last_failed_suit:
                    fused[last_failed_suit] = 0.0
                    recent = hands_suits[-rw:]; n = len(recent) or 1
                    covR = sum(1 for c in recent if any(x in RED for x in c))/n
                    covN = sum(1 for c in recent if any(x not in RED for x in c))/n
                    dom = 'R' if covR >= covN else 'N'
                    if dom == color(last_failed_suit): dom = 'N' if dom == 'R' else 'R'
                    for s in SUITS:
                        if color(s) != dom: fused[s] *= 0.25
                tot = sum(fused.values()) or 1
                probs = {s: fused[s]/tot for s in SUITS}
                bestS = max(SUITS, key=lambda s: probs[s])
                recent = hands_suits[-cw:]; n = len(recent) or 1
                cov_best = sum(1 for c in recent if bestS in c)/n if recent else 0.5
                covcol = sum(1 for c in recent if any(color(x) == color(bestS) for x in c))/n if recent else 0.8
                conf = covcol if rattrapage else cov_best
                conf = max(0.05, min(0.97, conf + (probs[bestS]-0.25)*0.3))
                return bestS, conf, probs
            return predict
        eng_mod.V9Engine.predict = make_predict(cov_w, ratt_w)
        rp = eng_mod.summarize(eng_mod.backtest(hands, 'p', W))
        rb = eng_mod.summarize(eng_mod.backtest(hands, 'b', W))
        score = rp['success_rate_global'] + rb['success_rate_global']
        rc = ((rp['rattrapage_mode']['success_color'] or 0) + (rb['rattrapage_mode']['success_color'] or 0))/2
        print(f"cov_w={cov_w} ratt_w={ratt_w}: P_in={rp['suit_in_hand']} B_in={rb['suit_in_hand']} "
              f"P_glob={rp['success_rate_global']} B_glob={rb['success_rate_global']} ratt_avg={rc:.4f} "
              f"maxstreak={max(rp['max_loss_streak'], rb['max_loss_streak'])}")
        if best is None or score > best[0]:
            best = (score, cov_w, ratt_w, rp, rb)
        eng_mod.V9Engine.predict = src_predict

print("\nBEST:", best[1], best[2], round(best[0]/2, 4))
json.dump({'cov_window': best[1], 'ratt_window': best[2],
           'player': best[3], 'banker': best[4]},
          open('/home/user/webapp/analysis/window_tuning.json', 'w'), indent=2, ensure_ascii=False)
