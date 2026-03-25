/* =========================================================
   CluckCluck — Egg Cracking Tournament Logic
   ========================================================= */

'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  players: [],        // { id, name, emoji }
  rounds: [],         // rounds[r] = [ { p1, p2, winner, loser, bye } ]
  currentRound: 0,
  currentMatchIdx: 0,
  totalMatches: 0,
  completedMatches: 0,
  status: 'setup',    // 'setup' | 'playing' | 'done'
  history: [],
};

const STORAGE_KEY = 'cluckcluck_save';
const EGG_EMOJIS  = ['🥚','🐣','🐥','🐰','🐇','🌸','🌷','🌼','🎀','🥕','🐣','🥚'];

// ── Helpers ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
function getRoundName(roundIndex, totalRounds) {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return 'Semifinal';
  if (remaining === 3) return 'Quarterfinal';
  return `Round ${roundIndex + 1}`;
}
function uid() { return Math.random().toString(36).slice(2, 9); }
function randomEmoji() { return EGG_EMOJIS[Math.floor(Math.random() * EGG_EMOJIS.length)]; }

// ── Screen switching ───────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

// ── Setup Screen ───────────────────────────────────────────
function setupAddPlayer() {
  const input = $('player-input');
  const name  = input.value.trim();
  if (!name) return;
  if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 400);
    return;
  }
  state.players.push({ id: uid(), name, emoji: randomEmoji() });
  input.value = '';
  renderPlayerList();
  saveState();
}

function removePlayer(id) {
  state.players = state.players.filter(p => p.id !== id);
  renderPlayerList();
  saveState();
}

function shufflePlayers() {
  for (let i = state.players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.players[i], state.players[j]] = [state.players[j], state.players[i]];
  }
  renderPlayerList();
}

function renderPlayerList() {
  const list  = $('player-list');
  const count = state.players.length;
  $('player-count').textContent = count;
  $('btn-shuffle').disabled   = count < 2;
  $('btn-clear-all').disabled = count === 0;
  $('btn-start').disabled     = count < 2;

  if (count === 0) {
    list.innerHTML = '<li class="empty-state">No contestants yet. Add some above!</li>';
    $('bracket-info').classList.add('hidden');
    return;
  }

  list.innerHTML = state.players.map((p, i) => `
    <li class="player-item">
      <span class="player-seed">#${i + 1}</span>
      <span class="player-emoji">${p.emoji}</span>
      <span class="player-name">${escHtml(p.name)}</span>
      <button class="btn-remove" data-id="${p.id}" title="Remove">✕</button>
    </li>`).join('');

  list.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => removePlayer(btn.dataset.id));
  });

  // Bracket info preview
  const total  = count;
  const size   = nextPowerOf2(total);
  const byes   = size - total;
  const rounds = Math.log2(size);
  const info   = $('bracket-info');
  info.classList.remove('hidden');
  info.innerHTML = `
    🥚 <strong>${total}</strong> contestants &nbsp;·&nbsp;
    📋 <strong>${rounds}</strong> rounds &nbsp;·&nbsp;
    ${byes > 0 ? `⏩ <strong>${byes}</strong> first-round bye${byes > 1 ? 's' : ''} &nbsp;·&nbsp;` : ''}
    🏆 <strong>${total - 1}</strong> total matches`;
}

// ── Bracket generation ─────────────────────────────────────
function generateBracket(players) {
  const size           = nextPowerOf2(players.length);
  const byes           = size - players.length;
  // Number of round-0 matches where both slots are real players
  const realMatchCount = players.length - size / 2;

  const round0 = [];
  let pi = 0;

  // Real matches (two players each)
  for (let i = 0; i < realMatchCount; i++) {
    round0.push({
      id: uid(), round: 0,
      p1: { ...players[pi++] },
      p2: { ...players[pi++] },
      winner: null, loser: null,
      status: 'pending',
    });
  }

  // Bye matches (one real player, one empty slot — never null vs null)
  for (let i = 0; i < byes; i++) {
    const p = players[pi++];
    round0.push({
      id: uid(), round: 0,
      p1: { ...p }, p2: null,
      winner: { ...p }, loser: null,
      status: 'bye',
    });
  }

  const rounds = [round0];

  // Generate subsequent empty rounds
  let prev = round0;
  while (prev.length > 1) {
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push({
        id: uid(), round: rounds.length,
        p1: null, p2: null,
        winner: null, loser: null,
        status: 'pending',
      });
    }
    rounds.push(next);
    prev = next;
  }

  return rounds;
}

function propagateByes(rounds) {
  // Push each round-0 bye winner into the correct slot in round 1.
  // With the new layout every bye match has exactly one real player,
  // so no null-vs-null chains can occur and no cascade is needed.
  rounds[0].forEach((match, idx) => {
    if (match.status === 'bye' && rounds.length > 1) {
      const nextMatch = rounds[1][Math.floor(idx / 2)];
      const slot      = idx % 2 === 0 ? 'p1' : 'p2';
      nextMatch[slot] = match.winner;
    }
  });
}

// ── Tournament start ───────────────────────────────────────
function startTournament() {
  if (state.players.length < 2) return;

  state.rounds           = generateBracket(state.players);
  state.currentRound     = 0;
  state.currentMatchIdx  = 0;
  state.status           = 'playing';
  state.history          = [];
  state.completedMatches = 0;

  propagateByes(state.rounds);

  // Count real matches (non-bye)
  state.totalMatches = state.rounds.flat().filter(m => m.status !== 'bye').length;

  // Find first non-bye match
  advanceToNextRealMatch();

  showScreen('tournament');
  renderTournament();
  saveState();
}

function advanceToNextRealMatch() {
  // Scan from currentRound/currentMatchIdx forward
  for (let r = state.currentRound; r < state.rounds.length; r++) {
    const start = r === state.currentRound ? state.currentMatchIdx : 0;
    for (let m = start; m < state.rounds[r].length; m++) {
      if (state.rounds[r][m].status === 'pending') {
        state.currentRound    = r;
        state.currentMatchIdx = m;
        return true;
      }
    }
  }
  return false; // no more matches
}

function getCurrentMatch() {
  return state.rounds[state.currentRound]?.[state.currentMatchIdx] || null;
}

// ── Record result ──────────────────────────────────────────
function recordResult(crackedPlayerSlot) {
  const match  = getCurrentMatch();
  if (!match || match.status !== 'pending') return;

  const loser  = crackedPlayerSlot === 'p1' ? match.p1 : match.p2;
  const winner = crackedPlayerSlot === 'p1' ? match.p2 : match.p1;

  match.winner = winner;
  match.loser  = loser;
  match.status = 'done';
  state.completedMatches++;

  // History
  state.history.unshift({
    round:  getRoundName(state.currentRound, state.rounds.length),
    winner: winner.name,
    loser:  loser.name,
  });

  // Propagate winner to next round
  propagateWinner(state.currentRound, state.currentMatchIdx, winner);

  // Animate
  const crackedEl   = crackedPlayerSlot === 'p1' ? $('battler-p1') : $('battler-p2');
  const winnerEl    = crackedPlayerSlot === 'p1' ? $('battler-p2') : $('battler-p1');
  const crackedEgg  = crackedPlayerSlot === 'p1' ? $('egg-p1') : $('egg-p2');
  crackedEl.classList.add('loser-crack');
  winnerEl.classList.add('winner-flash');
  crackedEgg.textContent = '🍳';

  // Disable buttons during animation
  $('btn-p1-cracked').disabled = true;
  $('btn-p2-cracked').disabled = true;

  setTimeout(() => {
    crackedEl.classList.remove('loser-crack', 'winner-flash');
    winnerEl.classList.remove('winner-flash');

    const hasNext = advanceToNextRealMatch();
    if (!hasNext) {
      finishTournament();
    } else {
      renderTournament();
      saveState();
    }
  }, 900);

  renderBracket();
  renderHistory();
  saveState();
}

function propagateWinner(roundIdx, matchIdx, winner) {
  const nextRoundIdx = roundIdx + 1;
  if (nextRoundIdx >= state.rounds.length) return;

  const nextMatchIdx = Math.floor(matchIdx / 2);
  const slot         = matchIdx % 2 === 0 ? 'p1' : 'p2';
  const nextMatch    = state.rounds[nextRoundIdx][nextMatchIdx];

  nextMatch[slot] = winner;

  // Auto-bye if other slot is already filled but match is still pending
  if (nextMatch.p1 && !nextMatch.p2) {
    // wait — may be filled by other match
  } else if (!nextMatch.p1 && nextMatch.p2) {
    // wait
  }
}

// ── Finish tournament ──────────────────────────────────────
function finishTournament() {
  state.status = 'done';
  const finalMatch = state.rounds[state.rounds.length - 1][0];
  const champion   = finalMatch.winner;

  saveState();
  showWinnerScreen(champion);
}

function showWinnerScreen(champion) {
  $('winner-name').textContent = `${champion.emoji} ${champion.name}`;
  showScreen('winner');
  launchConfetti();
}

// ── Confetti ───────────────────────────────────────────────
function launchConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';
  const colors = ['#1565C0','#42A5F5','#80DEEA','#90CAF9','#BBDEFB','#FFFFFF','#64B5F6','#00ACC1','#E3F2FD'];

  for (let i = 0; i < 120; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      top: ${-10 - Math.random() * 20}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${6 + Math.random() * 10}px;
      height: ${6 + Math.random() * 10}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration: ${1.5 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 1.2}s;
    `;
    container.appendChild(piece);
  }
}

// ── Render: full tournament ─────────────────────────────────
function renderTournament() {
  const match = getCurrentMatch();
  const totalRounds = state.rounds.length;

  // Header round label + prominent banner
  const roundName = getRoundName(state.currentRound, totalRounds);
  $('round-label').textContent      = roundName;
  $('round-banner-text').textContent = roundName;

  // Progress
  const done  = state.completedMatches;
  const total = state.totalMatches;
  $('progress-text').textContent  = `Match ${done + 1} of ${total}`;
  $('progress-round').textContent = `${total - done} match${total - done !== 1 ? 'es' : ''} left`;
  $('progress-bar-fill').style.width = total > 0 ? `${(done / total) * 100}%` : '0%';

  // Active match
  if (match && match.status === 'pending') {
    $('active-match-section').classList.remove('hidden');
    $('bye-section').classList.add('hidden');
    $('egg-p1').textContent   = match.p1?.emoji || '🥚';
    $('egg-p2').textContent   = match.p2?.emoji || '🥚';
    $('name-p1').textContent  = match.p1?.name  || 'TBD';
    $('name-p2').textContent  = match.p2?.name  || 'TBD';
    $('btn-p1-cracked').disabled = false;
    $('btn-p2-cracked').disabled = false;

    // Reset egg icons
    $('egg-p1').textContent = match.p1?.emoji || '🥚';
    $('egg-p2').textContent = match.p2?.emoji || '🥚';
  }

  renderBracket();
  renderHistory();
}

// ── Render: bracket ─────────────────────────────────────────
function renderBracket() {
  const container   = $('bracket-container');
  const totalRounds = state.rounds.length;
  const match       = getCurrentMatch();

  container.innerHTML = state.rounds.map((round, rIdx) => {
    const roundName = getRoundName(rIdx, totalRounds);
    const matches   = round.map((m) => {
      const isActive = match && m.id === match.id;
      const isBye    = m.status === 'bye';
      const classes  = ['bracket-match', isActive ? 'active-match' : '', isBye ? 'bye-match' : ''].filter(Boolean).join(' ');

      const p1Html = playerSlotHtml(m.p1, m.winner, m.loser);
      const p2Html = m.p2 !== null
        ? playerSlotHtml(m.p2, m.winner, m.loser)
        : isBye
          ? `<div class="bracket-player tbd"><span class="bp-name">bye</span></div>`
          : `<div class="bracket-player tbd"><span class="bp-name">TBD</span></div>`;

      return `<div class="${classes}">${p1Html}${p2Html}</div>`;
    }).join('');

    return `<div class="bracket-round">
      <div class="round-title">${roundName}</div>
      ${matches}
    </div>`;
  }).join('');
}

function playerSlotHtml(player, winner, loser) {
  if (!player) return `<div class="bracket-player tbd"><span class="bp-name">TBD</span></div>`;
  const isWinner = winner && winner.id === player.id;
  const isLoser  = loser  && loser.id  === player.id;
  const cls      = isWinner ? 'winner' : isLoser ? 'loser' : '';
  const icon     = isWinner ? '✓' : isLoser ? '💔' : '';
  return `<div class="bracket-player ${cls}">
    <span class="bp-icon">${icon}</span>
    <span class="bp-name">${escHtml(player.name)}</span>
    <span class="bp-icon">${player.emoji}</span>
  </div>`;
}

// ── Render: history ─────────────────────────────────────────
function renderHistory() {
  const list = $('history-list');
  if (state.history.length === 0) {
    list.innerHTML = '<li class="empty-state">No results yet.</li>';
    return;
  }
  list.innerHTML = state.history.map(h => `
    <li class="history-item">
      <span class="hi-round">${h.round}</span>
      <span class="hi-icon">🥚</span>
      <span class="hi-winner">${escHtml(h.winner)}</span>
      <span class="hi-vs">beat</span>
      <span class="hi-loser">${escHtml(h.loser)}</span>
      <span class="hi-icon">💔</span>
    </li>`).join('');
}

// ── Local storage ───────────────────────────────────────────
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      players:           state.players,
      rounds:            state.rounds,
      currentRound:      state.currentRound,
      currentMatchIdx:   state.currentMatchIdx,
      totalMatches:      state.totalMatches,
      completedMatches:  state.completedMatches,
      status:            state.status,
      history:           state.history,
    }));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    Object.assign(state, saved);
    return true;
  } catch (_) { return false; }
}

function clearSave() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Restart ─────────────────────────────────────────────────
function restart() {
  state.players          = [];
  state.rounds           = [];
  state.currentRound     = 0;
  state.currentMatchIdx  = 0;
  state.totalMatches     = 0;
  state.completedMatches = 0;
  state.status           = 'setup';
  state.history          = [];
  clearSave();
  renderPlayerList();
  showScreen('setup');
}

// ── Escape HTML ─────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Event listeners ─────────────────────────────────────────
function bindEvents() {
  // Setup
  $('btn-add-player').addEventListener('click', setupAddPlayer);
  $('player-input').addEventListener('keydown', e => { if (e.key === 'Enter') setupAddPlayer(); });
  $('btn-shuffle').addEventListener('click', shufflePlayers);
  $('btn-clear-all').addEventListener('click', () => {
    if (confirm('Remove all contestants?')) {
      state.players = [];
      renderPlayerList();
      saveState();
    }
  });
  $('btn-start').addEventListener('click', startTournament);

  // Tournament
  $('btn-p1-cracked').addEventListener('click', () => recordResult('p1'));
  $('btn-p2-cracked').addEventListener('click', () => recordResult('p2'));
  $('btn-back-setup').addEventListener('click', () => {
    if (state.status === 'playing') {
      if (!confirm('Return to setup? Your current tournament will be paused (progress is saved).')) return;
    }
    showScreen('setup');
  });
  $('btn-confirm-bye').addEventListener('click', () => {
    $('bye-section').classList.add('hidden');
    $('active-match-section').classList.remove('hidden');
  });

  // Winner screen
  $('btn-restart').addEventListener('click', restart);
  $('btn-view-bracket').addEventListener('click', () => {
    showScreen('tournament');
    renderTournament();
  });
}

// ── Boot ────────────────────────────────────────────────────
function boot() {
  bindEvents();

  const restored = loadState();
  if (restored && state.status === 'playing') {
    renderPlayerList();
    showScreen('tournament');
    renderTournament();
  } else if (restored && state.status === 'done') {
    const finalMatch = state.rounds[state.rounds.length - 1]?.[0];
    if (finalMatch?.winner) {
      renderPlayerList();
      showWinnerScreen(finalMatch.winner);
    } else {
      renderPlayerList();
    }
  } else if (restored) {
    renderPlayerList();
  } else {
    renderPlayerList();
  }
}

boot();
