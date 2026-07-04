// Baccarat AI V9 Prime — Frontend
const SUIT_NAMES = { '♠': 'PIQUE', '♥': 'CŒUR', '♦': 'CARREAU', '♣': 'TRÈFLE' };
const isRed = (s) => s === '♥' || s === '♦';
const $ = (id) => document.getElementById(id);

let firstLoad = true;

function confClass(c) {
  return c >= 70 ? 'conf-high' : c >= 50 ? 'conf-mid' : 'conf-low';
}
function confLabel(c) {
  return c >= 70 ? 'CONFIANCE HAUTE' : c >= 50 ? 'CONFIANCE MOYENNE' : 'CONFIANCE FAIBLE';
}

function renderSide(prefix, pred) {
  const suit = pred.suit;
  const conf = pred.conf;
  $(prefix + '-suit').textContent = suit;
  $(prefix + '-suit').className = 'suit-glyph ' + (isRed(suit) ? 'suit-red' : 'suit-black');
  $(prefix + '-suit-name').textContent = SUIT_NAMES[suit];
  $(prefix + '-conf').textContent = conf + '%';
  $(prefix + '-conf').className = 'font-orbi font-bold ' + (conf >= 70 ? 'text-emerald-400' : conf >= 50 ? 'text-amber-400' : 'text-red-400');
  const bar = $(prefix + '-conf-bar');
  bar.style.width = conf + '%';
  bar.className = 'h-full rounded-full transition-all duration-700 ' + confClass(conf);
  $(prefix + '-conf-label').textContent = confLabel(conf);
  $(prefix + '-ratt').classList.toggle('hidden', !pred.rattrapage);
  // probs par enseigne
  const probsEl = $(prefix + '-probs');
  probsEl.innerHTML = '';
  for (const s of ['♠', '♥', '♦', '♣']) {
    const p = Math.round((pred.probs[s] || 0) * 100);
    const cell = document.createElement('div');
    cell.className = 'prob-cell' + (s === suit ? ' best' : '');
    cell.innerHTML = `<div class="${isRed(s) ? 'text-red-400' : 'text-slate-300'} text-base leading-none">${s}</div><div class="text-slate-500 mt-0.5">${p}%</div>`;
    probsEl.appendChild(cell);
  }
}

function renderHistory(history) {
  const list = $('history-list');
  list.innerHTML = '';
  for (const h of history) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const pIcon = h.p_success ? '✅' : '❌';
    const bIcon = h.b_success ? '✅' : '❌';
    const pMode = h.ratt_p ? '<span class="text-red-400 text-[9px]">[R]</span>' : '';
    const bMode = h.ratt_b ? '<span class="text-red-400 text-[9px]">[R]</span>' : '';
    const suitHtml = (s) => `<span class="${isRed(s) ? 'text-red-400' : 'text-slate-200'}">${s}</span>`;
    row.innerHTML = `
      <span class="text-slate-500 w-14 shrink-0">#${h.n}</span>
      <span class="flex-1">
        <span class="text-cyan-300">J:</span>${suitHtml(h.actual_p1)}
        <span class="text-slate-600">(prédit ${suitHtml(h.pred_p)} ${Math.round(h.conf_p * 100)}% ${pMode})</span> ${pIcon}
      </span>
      <span class="flex-1">
        <span class="text-amber-300">B:</span>${suitHtml(h.actual_b1)}
        <span class="text-slate-600">(prédit ${suitHtml(h.pred_b)} ${Math.round(h.conf_b * 100)}% ${bMode})</span> ${bIcon}
      </span>`;
    list.appendChild(row);
  }
}

function pct(x) { return Math.round(x * 100) + '%'; }

async function refresh() {
  try {
    const { data } = await axios.get('/api/state', { timeout: 25000 });
    // header
    $('live-dot').className = 'w-2.5 h-2.5 rounded-full ' + (data.live ? 'bg-emerald-400 animate-pulse' : 'bg-amber-500');
    $('live-text').textContent = data.live ? 'LIVE TELEGRAM' : 'CACHE (' + data.total_hands + ' mains)';
    $('hand-number').textContent = '#' + data.last_hand.n;
    $('next-n').textContent = '#' + data.next_n;

    // predictions
    renderSide('p', data.prediction.player);
    renderSide('b', data.prediction.banker);
    $('strong-bet').classList.toggle('hidden', !data.prediction.strong_bet);

    // recommandation
    const p = data.prediction.player, b = data.prediction.banker;
    let reco;
    if (p.rattrapage || b.rattrapage) {
      reco = `⚠️ RATTRAPAGE ACTIF — mode défensif : viser la COULEUR ${isRed(p.rattrapage ? p.suit : b.suit) ? 'ROUGE ♥♦' : 'NOIRE ♠♣'} (couverture ~80%). Ne pas répéter l'enseigne échouée.`;
    } else if (data.prediction.strong_bet) {
      reco = `💪 MISE FORTE : Joueur ${p.suit} (${p.conf}%) & Banquier ${b.suit} (${b.conf}%) — double confiance élevée.`;
    } else if (p.conf >= 60 || b.conf >= 60) {
      const side = p.conf >= b.conf ? `Joueur ${p.suit} (${p.conf}%)` : `Banquier ${b.suit} (${b.conf}%)`;
      reco = `💡 Mise standard recommandée sur ${side}.`;
    } else {
      reco = `🔎 Signal faible — mise minimale ou attendre la prochaine main.`;
    }
    $('reco-text').textContent = reco;

    // stats
    $('stat-pj').textContent = pct(data.stats50.p_success);
    $('stat-pb').textContent = pct(data.stats50.b_success);
    $('stat-streak').textContent = data.stats50.current_win_streak + ' ✅';
    $('stat-maxloss').textContent = data.stats50.max_loss_streak;
    $('g-n').textContent = data.statsAll.window;
    $('g-pj').textContent = pct(data.statsAll.p_success);
    $('g-pb').textContent = pct(data.statsAll.b_success);
    $('g-pex').textContent = pct(data.statsAll.p_exact);
    $('g-bex').textContent = pct(data.statsAll.b_exact);
    $('g-ms').textContent = data.computed_ms;

    renderHistory(data.history);
    firstLoad = false;
  } catch (e) {
    $('live-dot').className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    $('live-text').textContent = firstLoad ? 'ERREUR CONNEXION' : 'RECONNEXION…';
  }
}

refresh();
setInterval(refresh, 10000);
