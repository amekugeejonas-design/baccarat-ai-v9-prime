import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import { walkForward, rollingStats, type Hand } from './engine';
import { fetchLatestHands } from './telegram';
import seedRaw from './seed.json';

type Bindings = {
  DB?: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.use('/static/*', serveStatic({ root: './public' }));

// ------------------------------------------------------------
// Historique : seed embarqué (1217 mains réelles) + live Telegram
// ------------------------------------------------------------
const SEED: Hand[] = (seedRaw as [number, number, number, number, string, string, string][]).map(
  (r) => ({
    msg_id: r[0],
    n: r[1],
    p_score: r[2],
    b_score: r[3],
    p_cards: r[4].split(','),
    b_cards: r[5].split(','),
    result: r[6],
  })
);

// Cache mémoire (par isolate) pour limiter le scraping (rate-limit Telegram)
let liveCache: { hands: Hand[]; ts: number; ok: boolean } = { hands: [], ts: 0, ok: false };
const LIVE_TTL_MS = 8000;

async function getMergedHands(env: Bindings): Promise<{ hands: Hand[]; live: boolean; liveCount: number }> {
  const now = Date.now();
  if (now - liveCache.ts > LIVE_TTL_MS) {
    try {
      const latest = await fetchLatestHands();
      liveCache = { hands: latest, ts: now, ok: true };
      // Persistance D1 (best effort, non bloquant pour la réponse)
      if (env.DB && latest.length) {
        try {
          const stmts = latest.map((h) =>
            env.DB!.prepare(
              'INSERT OR IGNORE INTO hands (msg_id,n,p_score,b_score,p_cards,b_cards,result) VALUES (?,?,?,?,?,?,?)'
            ).bind(h.msg_id, h.n, h.p_score, h.b_score, h.p_cards.join(','), h.b_cards.join(','), h.result)
          );
          await env.DB.batch(stmts);
        } catch {
          /* D1 optionnel */
        }
      }
    } catch {
      liveCache = { hands: liveCache.hands, ts: now, ok: false };
    }
  }
  const map = new Map<number, Hand>();
  for (const h of SEED) map.set(h.msg_id, h);
  // D1 : récupérer les mains persistées au-delà du seed (autres isolates / historiques)
  if (env.DB) {
    try {
      const maxSeed = SEED[SEED.length - 1].msg_id;
      const rows = await env.DB.prepare(
        'SELECT msg_id,n,p_score,b_score,p_cards,b_cards,result FROM hands WHERE msg_id > ? ORDER BY msg_id'
      )
        .bind(maxSeed)
        .all();
      for (const r of (rows.results || []) as Record<string, unknown>[]) {
        map.set(r.msg_id as number, {
          msg_id: r.msg_id as number,
          n: r.n as number,
          p_score: r.p_score as number,
          b_score: r.b_score as number,
          p_cards: (r.p_cards as string).split(','),
          b_cards: (r.b_cards as string).split(','),
          result: r.result as string,
        });
      }
    } catch {
      /* D1 optionnel */
    }
  }
  let liveCount = 0;
  for (const h of liveCache.hands) {
    if (!map.has(h.msg_id)) liveCount++;
    map.set(h.msg_id, h);
  }
  const hands = [...map.values()].sort((a, b) => a.msg_id - b.msg_id);
  return { hands, live: liveCache.ok, liveCount };
}

// ------------------------------------------------------------
// API
// ------------------------------------------------------------
app.get('/api/state', async (c) => {
  const t0 = Date.now();
  const { hands, live } = await getMergedHands(c.env);
  const { steps, nextPrediction } = walkForward(hands, 60);
  const stats50 = rollingStats(steps, 50);
  const statsAll = rollingStats(steps, steps.length);
  const lastHand = hands[hands.length - 1];
  const history = steps.slice(-30).reverse();
  const p = nextPrediction.player;
  const b = nextPrediction.banker;
  const strongBet = p.conf >= 0.75 && b.conf >= 0.7;
  return c.json({
    live,
    computed_ms: Date.now() - t0,
    total_hands: hands.length,
    last_hand: lastHand,
    next_n: lastHand.n + 1,
    prediction: {
      player: { suit: p.suit, conf: Math.round(p.conf * 100), rattrapage: p.rattrapage, probs: p.probs },
      banker: { suit: b.suit, conf: Math.round(b.conf * 100), rattrapage: b.rattrapage, probs: b.probs },
      strong_bet: strongBet,
    },
    stats50,
    statsAll,
    history,
  });
});

app.get('/api/metrics', (c) => c.redirect('/static/metrics.json'));

app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#06080f"/><text x="16" y="24" font-size="22" text-anchor="middle" fill="#ff4d6d">♦</text></svg>`;
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' });
});

app.get('/api/health', (c) => c.json({ ok: true, version: 'V9 Prime', hands_seed: SEED.length }));

// ------------------------------------------------------------
// UI
// ------------------------------------------------------------
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Baccarat AI V9 Prime — By BI~CODE</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<script>
tailwind.config = { theme: { extend: { fontFamily: { orbi: ['Orbitron','sans-serif'], mono: ['JetBrains Mono','monospace'] } } } }
</script>
</head>
<body class="bg-[#06080f] text-slate-200 font-mono min-h-screen">
<div class="scanlines"></div>
<main class="max-w-6xl mx-auto px-3 py-4 relative z-10">

  <!-- HEADER -->
  <header id="app-header" class="hud-panel rounded-2xl px-5 py-4 mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="font-orbi text-xl md:text-2xl font-black tracking-widest neon-cyan">
        <i class="fas fa-diamond mr-1"></i>BACCARAT AI <span class="text-amber-400">V9</span> PRIME
      </h1>
      <p class="text-[11px] text-slate-500 tracking-wider mt-1">MOTEUR STATISTIQUE 5 SIGNAUX · BY BI~CODE · CALIBRÉ SUR 1217 MAINS RÉELLES</p>
    </div>
    <div class="flex items-center gap-4 text-xs">
      <div id="live-badge" class="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700 bg-black/40">
        <span id="live-dot" class="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
        <span id="live-text" class="tracking-widest">CONNEXION…</span>
      </div>
      <div class="text-right">
        <div class="text-slate-500 text-[10px] tracking-widest">DERNIÈRE MAIN</div>
        <div id="hand-number" class="font-orbi text-lg neon-amber">#----</div>
      </div>
    </div>
  </header>

  <!-- PREDICTION -->
  <section id="prediction-section" class="mb-4">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-orbi text-sm tracking-[0.3em] text-slate-400"><i class="fas fa-crosshairs mr-2 text-cyan-400"></i>PROCHAINE MAIN <span id="next-n" class="neon-cyan">#----</span></h2>
      <div id="strong-bet" class="hidden strong-pulse font-orbi text-[11px] tracking-widest px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-black">
        <i class="fas fa-bolt mr-1"></i>MISE FORTE
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- JOUEUR -->
      <article id="player-card" class="hud-panel pred-card rounded-2xl p-5 border-cyan-500/30">
        <div class="flex items-center justify-between mb-3">
          <span class="font-orbi tracking-widest text-cyan-300 text-sm"><i class="fas fa-user mr-2"></i>JOUEUR</span>
          <span id="p-ratt" class="hidden text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/50 ratt-blink"><i class="fas fa-shield-halved mr-1"></i>RATTRAPAGE</span>
        </div>
        <div class="flex items-center gap-5">
          <div id="p-suit-box" class="suit-box rounded-2xl flex items-center justify-center">
            <span id="p-suit" class="suit-glyph">?</span>
          </div>
          <div class="flex-1">
            <div id="p-suit-name" class="font-orbi text-lg font-bold tracking-widest text-slate-300">—</div>
            <div class="mt-2 h-3 bg-black/60 rounded-full overflow-hidden border border-slate-800">
              <div id="p-conf-bar" class="h-full rounded-full transition-all duration-700" style="width:0%"></div>
            </div>
            <div class="flex justify-between mt-1.5 text-[11px]">
              <span id="p-conf-label" class="text-slate-500">CONFIANCE —</span>
              <span id="p-conf" class="font-orbi font-bold">--%</span>
            </div>
          </div>
        </div>
        <div id="p-probs" class="grid grid-cols-4 gap-1.5 mt-4 text-center text-[10px]"></div>
      </article>

      <!-- BANQUIER -->
      <article id="banker-card" class="hud-panel pred-card rounded-2xl p-5 border-amber-500/30">
        <div class="flex items-center justify-between mb-3">
          <span class="font-orbi tracking-widest text-amber-300 text-sm"><i class="fas fa-landmark mr-2"></i>BANQUIER</span>
          <span id="b-ratt" class="hidden text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/50 ratt-blink"><i class="fas fa-shield-halved mr-1"></i>RATTRAPAGE</span>
        </div>
        <div class="flex items-center gap-5">
          <div id="b-suit-box" class="suit-box rounded-2xl flex items-center justify-center">
            <span id="b-suit" class="suit-glyph">?</span>
          </div>
          <div class="flex-1">
            <div id="b-suit-name" class="font-orbi text-lg font-bold tracking-widest text-slate-300">—</div>
            <div class="mt-2 h-3 bg-black/60 rounded-full overflow-hidden border border-slate-800">
              <div id="b-conf-bar" class="h-full rounded-full transition-all duration-700" style="width:0%"></div>
            </div>
            <div class="flex justify-between mt-1.5 text-[11px]">
              <span id="b-conf-label" class="text-slate-500">CONFIANCE —</span>
              <span id="b-conf" class="font-orbi font-bold">--%</span>
            </div>
          </div>
        </div>
        <div id="b-probs" class="grid grid-cols-4 gap-1.5 mt-4 text-center text-[10px]"></div>
      </article>
    </div>

    <div id="reco-banner" class="hud-panel rounded-xl mt-4 px-4 py-3 text-sm flex items-center gap-3">
      <i class="fas fa-lightbulb text-amber-400"></i>
      <span id="reco-text" class="text-slate-400">Calcul de la recommandation…</span>
    </div>
  </section>

  <!-- STATS -->
  <section id="stats-section" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="hud-panel rounded-xl p-4 text-center">
      <div class="text-[10px] tracking-widest text-slate-500 mb-1">PRÉCISION J <span class="text-slate-600">(50m)</span></div>
      <div id="stat-pj" class="font-orbi text-2xl font-bold neon-cyan">--%</div>
      <div class="text-[9px] text-slate-600 mt-1">enseigne dans la main / couleur en rattrapage</div>
    </div>
    <div class="hud-panel rounded-xl p-4 text-center">
      <div class="text-[10px] tracking-widest text-slate-500 mb-1">PRÉCISION B <span class="text-slate-600">(50m)</span></div>
      <div id="stat-pb" class="font-orbi text-2xl font-bold neon-amber">--%</div>
      <div class="text-[9px] text-slate-600 mt-1">enseigne dans la main / couleur en rattrapage</div>
    </div>
    <div class="hud-panel rounded-xl p-4 text-center">
      <div class="text-[10px] tracking-widest text-slate-500 mb-1">SÉRIE ACTUELLE</div>
      <div id="stat-streak" class="font-orbi text-2xl font-bold text-emerald-400">--</div>
      <div class="text-[9px] text-slate-600 mt-1">victoires J+B consécutives</div>
    </div>
    <div class="hud-panel rounded-xl p-4 text-center">
      <div class="text-[10px] tracking-widest text-slate-500 mb-1">PERTES MAX (50m)</div>
      <div id="stat-maxloss" class="font-orbi text-2xl font-bold text-red-400">--</div>
      <div class="text-[9px] text-slate-600 mt-1">consécutives côté Joueur</div>
    </div>
  </section>

  <!-- DETAIL STATS GLOBALES -->
  <section id="global-stats" class="hud-panel rounded-xl px-4 py-3 mb-4 text-[11px] flex flex-wrap gap-x-6 gap-y-1 text-slate-500">
    <span>📊 GLOBAL (<span id="g-n">--</span> préd.) :</span>
    <span>J succès <b id="g-pj" class="text-cyan-300">--%</b></span>
    <span>B succès <b id="g-pb" class="text-amber-300">--%</b></span>
    <span>J enseigne exacte 1ère carte <b id="g-pex" class="text-slate-300">--%</b></span>
    <span>B enseigne exacte 1ère carte <b id="g-bex" class="text-slate-300">--%</b></span>
    <span>calcul <b id="g-ms" class="text-slate-300">--</b> ms</span>
  </section>

  <!-- HISTORIQUE -->
  <section id="history-section" class="hud-panel rounded-2xl p-4">
    <h2 class="font-orbi text-sm tracking-[0.3em] text-slate-400 mb-3"><i class="fas fa-clock-rotate-left mr-2 text-cyan-400"></i>HISTORIQUE DES PRÉDICTIONS</h2>
    <div id="history-list" class="space-y-1.5 max-h-96 overflow-y-auto pr-1 text-xs"></div>
  </section>

  <footer class="text-center text-[10px] text-slate-600 mt-6 pb-4 leading-relaxed">
    <p>⚠️ HONNÊTETÉ STATISTIQUE : le sabot est quasi-uniforme (χ² non significatif). Enseigne exacte 1ère carte ≈ 26-27% (hasard 25%).</p>
    <p>La fiabilité vient de la cible « enseigne présente dans la main » (~52-54%) et du rattrapage couleur (~80-82%), mesurés par backtest walk-forward sur 1157 prédictions réelles.</p>
    <p class="mt-1">Source live : t.me/statistika_baccara · <a href="/api/metrics" class="underline text-slate-500">metrics.json</a> · Baccarat AI V9 By BI~CODE</p>
  </footer>
</main>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/app.js"></script>
</body>
</html>`);
});

export default app;
