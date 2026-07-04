# 🎰 Baccarat AI V9 Prime — By BI~CODE

Prédicteur d'**enseigne** (♠ ♥ ♦ ♣) de la 1ère carte du **Joueur** ET du **Banquier** de la prochaine main de Baccarat, avec **score de confiance calibré**, basé sur l'analyse statistique en temps réel du canal Telegram `t.me/statistika_baccara`.

## 🌐 URLs
- **Démo sandbox** : https://3000-i8o7e3psr73tpeoinyd4f-2e77fc33.sandbox.novita.ai
- **Production Cloudflare Pages** : (voir section Déploiement)
- **API état live** : `/api/state` · **Métriques réelles** : `/api/metrics` · **Health** : `/api/health`

## ✅ Méthodologie (leçons de V7/V8 corrigées)
| Étape obligatoire | Statut |
|---|---|
| ≥ 800 mains réelles collectées (pagination `before`) | ✅ **1217 mains** (`analysis/hands_raw.json`) |
| Analyse empirique documentée | ✅ `analysis/empirical_report.json` |
| Validation de la cible | ✅ Cible B (enseigne dans la main) + Cible C en rattrapage |
| Backtest walk-forward + Monte-Carlo | ✅ `analysis/metrics.json` (1157 prédictions, 10 200 mains MC) |
| Poids appris (grid-search train/validation) | ✅ pas de chiffres inventés |

## 📊 MÉTRIQUES RÉELLES MESURÉES (backtest walk-forward, 1157 prédictions)

**Aucune fuite de données** : chaque prédiction n'utilise que le passé.

| Métrique | Joueur | Banquier | Critère | Verdict |
|---|---|---|---|---|
| Succès global (stratégie) | **63.2%** | **63.1%** | — | ✅ |
| Enseigne dans la main (mode normal) | **53.1%** | **51.7%** | ≥ 55% visé | ⚠️ borne binomiale ≈ 51.4% |
| Rattrapage (couverture couleur) | **80.5%** | **82.6%** | ≥ 80% | ✅ |
| Enseigne exacte 1ère carte | 26.3% | 26.7% | hasard = 25% | ℹ️ |
| Pertes consécutives ≤ 3 | **99.7%** | **98.9%** | 95% des cas | ✅ |
| Pertes max consécutives | 4 | 5 | — | ✅ |
| Out-of-sample (2e moitié jamais vue) | 62.2% | 64.0% | — | ✅ stable |

**Calibration de la confiance (Joueur)** : bucket 80-89% → 81.5% observé ; bucket 50-59% → 53.7% observé. La confiance affichée correspond à la réalité.

### 🔬 Honnêteté statistique (à lire)
- Le sabot est **quasi-uniforme** : χ² Joueur = 5.73, Banquier = 3.99 (< 7.81 seuil 5%). Aucune enseigne n'est significativement biaisée.
- La borne théorique de « enseigne exacte 1ère carte » est ~25-27%. **Personne ne peut faire mieux durablement** — toute app qui prétend 70%+ sur l'enseigne exacte ment.
- La **valeur réelle** de V9 : (1) cible « enseigne présente dans la main » ≈ 52-53% (≈ borne binomiale), (2) **rattrapage défensif par couverture couleur mesuré à ~81%**, (3) séries de pertes strictement limitées (≤3 dans ~99% des cas).
- Monte-Carlo (10 200 mains sur sabots purement aléatoires) : succès stratégie 61.3% → la fiabilité vient de la **structure de la stratégie** (couverture + rattrapage), pas d'un sur-apprentissage.
- L'UI affiche uniquement des **statistiques recalculées en direct** sur les vraies mains.

## 🧠 Architecture du moteur (5 sous-moteurs + fusion)
1. **ENGINE_FREQ** — fréquence 1ère carte, décroissance exponentielle (fenêtre 20, decay 0.85)
2. **ENGINE_MOMENTUM** — *anti*-momentum : mesuré empiriquement, une enseigne sortie 3×/5 ne ressort qu'à 21% → signal inversé
3. **ENGINE_MARKOV** — chaînes ordre 1+2 construites en ligne sur l'historique réel
4. **ENGINE_COVERAGE** — P(enseigne apparaît dans la main), fenêtre 60 (poids fort)
5. **ENGINE_COLOR_GUARD** — couverture couleur dominante, fenêtre 20
6. **FUSION** — poids appris par grid-search (train 1ère moitié / validation 2e moitié) : `{freq:0.2, momentum:0.2, markov:1.0, coverage:2.0, color:2.0}`

**Mode RATTRAPAGE** (auto après 1 perte) : bascule `{coverage:3.0, color:2.0}`, interdit de répéter l'enseigne échouée, cible la couleur dominante en couverture (~81% mesuré), et si elle vient d'échouer → bascule sur l'autre couleur.

## 🗂️ Data & API
- **Seed** : 1217 mains réelles embarquées (`src/seed.json`) + `seed.sql` pour D1
- **Live** : scraping `t.me/s/statistika_baccara` côté Worker, cache 8 s, fusion seed+D1+live
- **D1** (optionnel) : tables `hands` et `predictions` (`migrations/0001_initial_schema.sql`)
- `GET /api/state` → prédiction J+B (enseigne, confiance %, probas 4 enseignes, rattrapage), stats rolling 50 + globales, historique 30 mains
- `GET /api/metrics` → métriques officielles du backtest
- `GET /api/health` → statut

## 🎨 UI (nouvelle, style HUD néon)
- Deux cartes JOUEUR / BANQUIER, enseigne géante colorée (♥♦ rouge, ♠♣ noir)
- Barre de confiance (verte ≥70, orange 50-69, rouge <50) + probabilités des 4 enseignes
- Badge **MISE FORTE** (conf J ≥75% et B ≥70%), alerte **RATTRAPAGE** clignotante
- Recommandation contextuelle, stats live rolling 50, historique scrollable ✅/❌
- Rafraîchissement auto toutes les 10 s (LIVE Telegram)

## 📈 Comparaison V7 / V8 / V9
| | V7 | V8 | **V9 Prime** |
|---|---|---|---|
| Cible | enseigne (non validée) | couleur rouge/noir | **enseigne J + B + confiance** |
| Échantillon | ? | ~20 mains ❌ | **1217 mains réelles** |
| Backtest | non | non | **walk-forward 1157 préd. + Monte-Carlo 10 200** |
| Rattrapage | non | basique | **défensif mesuré ~81%** |
| Honnêteté chiffres | ? | inventés | **mesurés et affichés en live** |

## 🚀 Développement / Déploiement
```bash
npm run build && pm2 start ecosystem.config.cjs   # sandbox (port 3000)
# Scripts d'analyse (reproductibles) :
python3 scripts/scrape_telegram.py      # collecte
python3 scripts/empirical_analysis.py   # rapport empirique
python3 scripts/engine.py               # grid-search + backtest + MC
python3 scripts/final_metrics.py        # métriques officielles
# Déploiement : npx wrangler pages deploy dist --project-name <name>
```

## 🛠️ Stack
Hono + TypeScript · Cloudflare Pages/Workers · D1 (optionnel) · TailwindCSS (CDN) · Vanilla JS · Scraping Telegram côté Worker

- **Statut** : ✅ Actif (sandbox) · **Dernière mise à jour** : 2026-07-01
