/* ============================================================
   FuteVôlei — app.js  (versão limpa, sem duplicatas)
   Fase 1: todos contra todos
   Fase 2: partidas manuais
   Ranking por jogador individual
   Gerenciar duplas: trocar, remover, nova dupla
   localStorage: salva tudo automaticamente
============================================================ */

const STORAGE_KEY = 'futevolei_v3';

// ══════════════════════════════════════════════════════════
//  SUPABASE — histórico persistente
// ══════════════════════════════════════════════════════════
const SB_URL = 'https://horswcspypmwcvwptyaf.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN3Y3NweXBtd2N2d3B0eWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MjI2MTMsImV4cCI6MjA5MDk5ODYxM30.T4vKBP7nXb2LO51DUnvHcn3ffMmRUZPkvTGPSw3khjs';

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey':        SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  return res.status === 204 ? null : res.json();
}

async function salvarTorneioSupabase() {
  try {
    const playerStats = buildPlayerStats();
    const ranked = playerStats.sort((a,b) =>
      b.pts!==a.pts ? b.pts-a.pts : b.saldo!==a.saldo ? b.saldo-a.saldo : b.v-a.v
    );
    const rankedPositions = calcPositions(ranked);
    ranked.forEach((p, i) => { p.pos = rankedPositions[i]; });
    const payload = {
      evento_nome:  eventName  || null,
      evento_data:  eventDate  || null,
      duracao_ms:   torneioElapsed,
      total_jogos:  doneCount,
      ranking:      ranked,
      partidas:     histItems,
      duplas:       duplas,
    };
    await sbFetch('/torneios', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    console.log('✅ Torneio salvo no Supabase!');
    return true;
  } catch(e) {
    console.warn('⚠️ Erro ao salvar no Supabase:', e.message);
    return false;
  }
}

async function buscarTorneiosSupabase() {
  try {
    const data = await sbFetch('/torneios?select=*&order=criado_em.desc&limit=50');
    return data || [];
  } catch(e) {
    console.warn('⚠️ Erro ao buscar histórico:', e.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════
//  TIMERS
// ══════════════════════════════════════════════════════════
let matchTimerInterval   = null;
let matchStartTime       = null;
let torneioTimerInterval = null;
let torneioTimerBase     = null;
let torneioElapsed       = 0;
let matchStarted         = false;

function fmtMS(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function fmtHMS(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s%3600)/60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function stopMatchTimer() {
  clearInterval(matchTimerInterval);
  return matchStartTime ? Date.now() - matchStartTime : 0;
}

function startTorneioTimer() {
  clearInterval(torneioTimerInterval);
  torneioTimerBase = Date.now();
  torneioTimerInterval = setInterval(() => {
    const total = torneioElapsed + (Date.now() - torneioTimerBase);
    document.getElementById('torneioTimer').textContent = fmtHMS(total);
  }, 1000);
}
function captureTorneioElapsed() {
  if (torneioTimerBase) {
    torneioElapsed += Date.now() - torneioTimerBase;
    torneioTimerBase = null;
  }
  clearInterval(torneioTimerInterval);
}
function stopTorneioTimer() {
  captureTorneioElapsed();
  return torneioElapsed;
}

// ══════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════
let numDuplas    = 6;
let streakLimit  = 2;
let permMode     = 'leave';
let eventDate    = '';
let eventName    = '';

let duplas       = [];
let pendingSet   = new Set();
let queue        = [];
let wait         = {};
let currentMatch = null;
let histItems    = [];
let doneCount    = 0;
let totalMatches = 0;

let fase         = 1;
let fase2Matches = [];
let fase2Index   = 0;

let rankView     = 'player';

// Trocar de lado
let trocaLado  = false;
let sideSwapped = false;
let lastSwapAt  = -1;

// Gerenciar duplas
let gdEditId = null;
let swapSelA = null;
let swapSelB = null;

// ══════════════════════════════════════════════════════════
//  LOCALSTORAGE
// ══════════════════════════════════════════════════════════
function saveState() {
  captureTorneioElapsed();
  if (torneioTimerBase === null && duplas.length > 0) startTorneioTimer();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      numDuplas, streakLimit, permMode, eventDate, eventName,
      trocaLado, sideSwapped, lastSwapAt,
      duplas, pendingArray: [...pendingSet], totalMatches,
      queue, wait, currentMatch,
      histItems, doneCount,
      fase, fase2Matches, fase2Index,
      forcedMatch,
      rodadaInicialDone, rodadaInicialPairs, rodadaInicialIdx,
      torneioElapsed,
    }));
  } catch(e) { console.warn('localStorage cheio:', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    numDuplas     = s.numDuplas    ?? 6;
    streakLimit   = s.streakLimit  ?? 2;
    permMode      = s.permMode     ?? 'leave';
    eventDate     = s.eventDate    ?? '';
    eventName     = s.eventName    ?? '';
    duplas        = s.duplas       ?? [];
    pendingSet    = new Set(s.pendingArray ?? []);
    totalMatches  = s.totalMatches ?? 0;
    queue         = s.queue        ?? [];
    wait          = s.wait         ?? {};
    currentMatch  = s.currentMatch ?? null;
    histItems     = s.histItems    ?? [];
    doneCount     = s.doneCount    ?? 0;
    fase          = s.fase         ?? 1;
    fase2Matches  = s.fase2Matches ?? [];
    fase2Index    = s.fase2Index   ?? 0;
    forcedMatch   = s.forcedMatch  ?? null;
    rodadaInicialDone  = s.rodadaInicialDone  ?? false;
    rodadaInicialPairs = s.rodadaInicialPairs ?? [];
    rodadaInicialIdx   = s.rodadaInicialIdx   ?? 0;
    torneioElapsed = s.torneioElapsed ?? 0;
    trocaLado  = s.trocaLado  ?? false;
    sideSwapped = s.sideSwapped ?? false;
    lastSwapAt  = s.lastSwapAt  ?? -1;
    return duplas.length > 0;
  } catch(e) { return false; }
}

function clearState() { localStorage.removeItem(STORAGE_KEY); }

// ══════════════════════════════════════════════════════════
//  SETUP UI
// ══════════════════════════════════════════════════════════
function stepDuplas(d) {
  numDuplas = Math.max(2, Math.min(12, numDuplas + d));
  document.getElementById('stepDuplas').textContent = numDuplas;
  const total = numDuplas*(numDuplas-1)/2;
  document.getElementById('lblDuplas').textContent = `${numDuplas} duplas · ${total} partidas`;
  document.getElementById('infoN').textContent = `${numDuplas} duplas`;

  const streakSection = document.getElementById('streakSection');
  const infoDesc      = document.getElementById('infoDesc');

  if (numDuplas >= 6) {
    streakSection.style.display = 'none';
    const pairs = Math.floor(numDuplas / 2);
    infoDesc.innerHTML = `rodada inicial: <strong>${pairs} jogos</strong> em sequência. Depois: <strong>ganhou ou perdeu, sai da quadra</strong> — sempre entram as 2 próximas da fila. Espera máx.: <strong>~3 jogos</strong>.`;
  } else if (numDuplas === 5) {
    streakSection.style.display = 'none';
    infoDesc.innerHTML = `<strong>vencedor espera 1 jogo</strong>, <strong>perdedor espera 2 jogos</strong>. Rodízio contínuo.`;
  } else {
    streakSection.style.display = 'block';
    infoDesc.innerHTML = `<strong>vencedor fica na quadra</strong> até ${streakLimit}× vitória${streakLimit>1?'s':''} seguida${streakLimit>1?'s':''}. Perdedor vai pro fim da fila.`;
  }
  buildDuplasGrid();
}

function selStreak(n) {
  streakLimit = n;
  document.querySelectorAll('.tog-btn').forEach(b => b.classList.toggle('sel', +b.dataset.s === n));
  if (numDuplas <= 4) {
    const infoDesc = document.getElementById('infoDesc');
    if (infoDesc) infoDesc.innerHTML = `<strong>vencedor fica na quadra</strong> até ${n}× vitória${n>1?'s':''} seguida${n>1?'s':''}. Perdedor vai pro fim da fila.`;
  }
}

function selPerm(m) {
  permMode = m;
  document.getElementById('permLeave').className = 'perm-btn' + (m==='leave' ? ' sel-leave' : '');
  document.getElementById('permStay').className  = 'perm-btn' + (m==='stay'  ? ' sel-stay'  : '');
}

function buildDuplasGrid() {
  const g = document.getElementById('duplasGrid');
  const vals = [];
  g.querySelectorAll('.fi').forEach(i => vals.push(i.value));
  g.innerHTML = '';
  for (let i = 0; i < numDuplas; i++) {
    const row = document.createElement('div');
    row.className = 'dupla-row';
    row.innerHTML = `
      <div class="dupla-num">${i+1}</div>
      <input class="fi" placeholder="Jogador A" value="${vals[i*2]  ||''}" id="p1_${i}" maxlength="14">
      <input class="fi" placeholder="Jogador B" value="${vals[i*2+1]||''}" id="p2_${i}" maxlength="14">`;
    g.appendChild(row);
  }
}

// ══════════════════════════════════════════════════════════
//  BARRA DO EVENTO
// ══════════════════════════════════════════════════════════
function renderEventBar() {
  const bar      = document.getElementById('eventBar');
  const resetBar = document.getElementById('resetBar');
  const name     = document.getElementById('eventBarName');
  const date     = document.getElementById('eventBarDate');

  if (!eventDate && !eventName) {
    bar.style.display      = 'none';
    resetBar.style.display = 'flex';
  } else {
    bar.style.display      = 'flex';
    resetBar.style.display = 'none';
    name.textContent = eventName || 'Torneio de FuteVôlei';
    if (eventDate) {
      const d        = new Date(eventDate + 'T12:00:00');
      const months   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const weekdays = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
      date.textContent = `${weekdays[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
    } else {
      date.textContent = '';
    }
  }
}

// ══════════════════════════════════════════════════════════
//  RESET / ZERAR TORNEIO
// ══════════════════════════════════════════════════════════
function confirmReset() {
  const jogadas = doneCount || 0;
  const msg = jogadas > 0
    ? `Zerar o torneio?\n\n⚠️ Isso apagará:\n• ${jogadas} partida${jogadas>1?'s':''} jogada${jogadas>1?'s':''}\n• Todo o histórico e ranking\n• Configurações das duplas\n\nEssa ação não pode ser desfeita.`
    : `Zerar o torneio?\n\nIsso limpará todas as configurações.`;
  if (!confirm(msg)) return;
  novoTorneio();
}

function novoTorneio() {
  clearState();
  location.reload();
}

// ══════════════════════════════════════════════════════════
//  INICIAR TORNEIO
// ══════════════════════════════════════════════════════════
function startTorneio() {
  clearState();
  eventDate = document.getElementById('cfgDate').value || '';
  eventName = document.getElementById('cfgEventName').value.trim() || '';

  duplas = [];
  for (let i = 0; i < numDuplas; i++) {
    const p1 = document.getElementById(`p1_${i}`).value.trim() || `Dupla ${i+1} A`;
    const p2 = document.getElementById(`p2_${i}`).value.trim() || `Dupla ${i+1} B`;
    duplas.push({ id:i, p1, p2, j:0, v:0, d:0, saldo:0, pts:0, streak:0, inactive:false });
  }

  trocaLado  = document.getElementById('trocaLadoSim').classList.contains('sel');
  sideSwapped = false;
  lastSwapAt  = -1;

  fase = 1;
  pendingSet = new Set();
  for (let a = 0; a < duplas.length; a++)
    for (let b = a+1; b < duplas.length; b++)
      pendingSet.add(`${a}-${b}`);
  totalMatches = pendingSet.size;

  doneCount = 0; histItems = [];
  currentMatch = null;
  fase2Matches = []; fase2Index = 0;
  torneioElapsed = 0; torneioTimerBase = null;
  matchStarted = false;

  queue = duplas.map(d => d.id);
  wait  = {}; duplas.forEach(d => wait[d.id] = 0);

  buildRodadaInicial();

  goTab(1);
  renderEventBar();
  startTorneioTimer();
  enterMatchArea();
  saveState();
  loadNextMatch();
}

// ══════════════════════════════════════════════════════════
//  START MANUAL DA PARTIDA
// ══════════════════════════════════════════════════════════
function setMatchReady() {
  matchStarted = false;
  clearInterval(matchTimerInterval);
  document.getElementById('matchTimer').textContent            = '⏱ 00:00';
  document.getElementById('matchStartOverlay').style.display  = 'flex';
  document.getElementById('scoreZone').style.opacity          = '0.3';
  document.getElementById('scoreZone').style.pointerEvents    = 'none';
  document.getElementById('finishBtn').style.display          = 'none';
}

function startMatch() {
  if (matchStarted) return;
  matchStarted = true;

  document.getElementById('matchStartOverlay').style.display = 'none';
  document.getElementById('scoreZone').style.opacity         = '1';
  document.getElementById('scoreZone').style.pointerEvents   = 'auto';
  document.getElementById('finishBtn').style.display         = 'block';

  openFullscreen();
  startMatchTimer();
}

function openFullscreen() {
  if (!currentMatch) return;

  document.getElementById('fsMatchNum').textContent = document.getElementById('matchNum').textContent;
  document.getElementById('fsFaseTag').textContent  = fase === 1 ? 'Fase 1' : 'Fase 2';

  renderMatchSides();

  document.getElementById('fsOverlay').classList.add('open');

  try {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch(e) {}

  try {
    screen.orientation.lock('landscape').catch(()=>{});
  } catch(e) {}
}

function closeFullscreen() {
  document.getElementById('fsOverlay').classList.remove('open');
  try {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch(e) {}
  try { screen.orientation.unlock(); } catch(e) {}
}

function renderScores() {
  if (!currentMatch) return;
  const dispA = sideSwapped ? currentMatch.scoreB : currentMatch.scoreA;
  const dispB = sideSwapped ? currentMatch.scoreA : currentMatch.scoreB;
  document.getElementById('snA').textContent      = dispA;
  document.getElementById('snB').textContent      = dispB;
  document.getElementById('fsScoreA').textContent = dispA;
  document.getElementById('fsScoreB').textContent = dispB;
}

function renderMatchSides() {
  if (!currentMatch) return;
  const d1 = duplas[currentMatch.dA], d2 = duplas[currentMatch.dB];
  const leftD  = sideSwapped ? d2 : d1;
  const rightD = sideSwapped ? d1 : d2;
  document.getElementById('mnA').innerHTML =
    `<div class="pname">${leftD.p1}</div><div class="pname">${leftD.p2}</div>`;
  document.getElementById('mnB').innerHTML =
    `<div class="pname">${rightD.p1}</div><div class="pname">${rightD.p2}</div>`;
  document.getElementById('fsNamesA').innerHTML =
    `<span>${leftD.p1}</span><span>${leftD.p2}</span>`;
  document.getElementById('fsNamesB').innerHTML =
    `<span>${rightD.p1}</span><span>${rightD.p2}</span>`;
  renderScores();
}

function addScore(t) {
  if (!currentMatch || !matchStarted) return;
  const side = sideSwapped ? (t === 'a' ? 'b' : 'a') : t;
  if (side === 'a') currentMatch.scoreA++; else currentMatch.scoreB++;
  renderScores();
  const fsEl = document.getElementById(t === 'a' ? 'fsScoreA' : 'fsScoreB');
  fsEl.classList.remove('fs-score-pop');
  void fsEl.offsetWidth;
  fsEl.classList.add('fs-score-pop');
  if (trocaLado) {
    const total = currentMatch.scoreA + currentMatch.scoreB;
    if (total > 0 && total % 5 === 0 && total !== lastSwapAt) {
      lastSwapAt = total;
      const dispA = sideSwapped ? currentMatch.scoreB : currentMatch.scoreA;
      const dispB = sideSwapped ? currentMatch.scoreA : currentMatch.scoreB;
      const sub = `Placar: ${dispA} × ${dispB} · ${total} pontos no total`;
      document.getElementById('trocaLadoPlacar').textContent = sub;
      document.getElementById('fsSwapSub').textContent = sub;
      document.getElementById('fsSwapPrompt').classList.add('show');
      document.getElementById('modalTrocaLado').classList.add('show');
    }
  }
}

function subScore(t) {
  if (!currentMatch || !matchStarted) return;
  const side = sideSwapped ? (t === 'a' ? 'b' : 'a') : t;
  if (side === 'a' && currentMatch.scoreA > 0) currentMatch.scoreA--;
  else if (side === 'b' && currentMatch.scoreB > 0) currentMatch.scoreB--;
  renderScores();
}

function confirmarTrocaLado() {
  sideSwapped = !sideSwapped;
  document.getElementById('fsSwapPrompt').classList.remove('show');
  closeModal('modalTrocaLado');
  renderMatchSides();
}

function recusarTrocaLado() {
  document.getElementById('fsSwapPrompt').classList.remove('show');
  closeModal('modalTrocaLado');
}

function setTrocaLado(val) {
  trocaLado = val;
  document.getElementById('trocaLadoSim').classList.toggle('sel',  val);
  document.getElementById('trocaLadoNao').classList.toggle('sel', !val);
}

const _origStartMatchTimer = startMatchTimer;
function startMatchTimer() {
  clearInterval(matchTimerInterval);
  matchStartTime = Date.now();
  document.getElementById('matchTimer').textContent = '⏱ 00:00';
  document.getElementById('fsTimer').textContent    = '⏱ 00:00';
  matchTimerInterval = setInterval(() => {
    const t = '⏱ ' + fmtMS(Date.now() - matchStartTime);
    document.getElementById('matchTimer').textContent = t;
    document.getElementById('fsTimer').textContent    = t;
  }, 1000);
}

function openFinish() {
  closeFullscreen();
  _doOpenFinish();
}

// ══════════════════════════════════════════════════════════
//  SISTEMA DE FILA
// ══════════════════════════════════════════════════════════

let rodadaInicialDone  = false;
let rodadaInicialPairs = [];
let rodadaInicialIdx   = 0;

function buildRodadaInicial() {
  const ativas = duplas.filter(d => !d.inactive).map(d => d.id);
  rodadaInicialPairs = [];
  for (let i = 0; i + 1 < ativas.length; i += 2)
    rodadaInicialPairs.push({ dA: ativas[i], dB: ativas[i+1] });
  rodadaInicialIdx  = 0;
  rodadaInicialDone = false;
}

function pairKey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

function nAtivas() {
  return duplas.filter(d => !d.inactive).length;
}

function peekNextMatch() {
  if (forcedMatch) return forcedMatch;
  const n = nAtivas();
  if (n >= 6) {
    if (!rodadaInicialDone && rodadaInicialIdx < rodadaInicialPairs.length)
      return rodadaInicialPairs[rodadaInicialIdx];
    const ativas = queue.filter(id => !duplas[id]?.inactive);
    for (let i = 0; i < ativas.length; i++)
      for (let j = i+1; j < ativas.length; j++)
        if (pendingSet.has(pairKey(ativas[i], ativas[j])))
          return { dA: ativas[i], dB: ativas[j] };
    return null;
  }
  const ativas = queue.filter(id => !duplas[id]?.inactive);
  return ativas.length >= 2 ? { dA: ativas[0], dB: ativas[1] } : null;
}

function findNextMatch() {
  if (forcedMatch) {
    const m = forcedMatch;
    forcedMatch = null;
    return m;
  }

  const n = nAtivas();

  if (n >= 6) {
    if (!rodadaInicialDone) {
      if (rodadaInicialIdx < rodadaInicialPairs.length)
        return rodadaInicialPairs[rodadaInicialIdx];
      rodadaInicialDone = true;
    }
    const ativas = queue.filter(id => !duplas[id]?.inactive);
    for (let i = 0; i < ativas.length; i++)
      for (let j = i+1; j < ativas.length; j++)
        if (pendingSet.has(pairKey(ativas[i], ativas[j])))
          return { dA: ativas[i], dB: ativas[j] };
    return null;
  }

  if (n === 5) {
    const ativas = queue.filter(id => !duplas[id]?.inactive);
    if (ativas.length >= 2) return { dA: ativas[0], dB: ativas[1] };
    return null;
  }

  if (n <= 4) {
    const ativas = queue.filter(id => !duplas[id]?.inactive);
    if (ativas.length >= 2) return { dA: ativas[0], dB: ativas[1] };
    return null;
  }

  return null;
}

function updateQueueAfterMatch(winner, loser) {
  const n = nAtivas();

  if (n >= 6) {
    queue = queue.filter(id => id !== winner && id !== loser);
    queue = [...queue, winner, loser];
    return;
  }

  if (n === 5) {
    const rest = queue.filter(id => id !== winner && id !== loser && !duplas[id]?.inactive);
    queue = [
      ...(rest[0] !== undefined ? [rest[0]] : []),
      ...(rest[1] !== undefined ? [rest[1]] : []),
      winner,
      ...(rest[2] !== undefined ? [rest[2]] : []),
      loser,
    ];
    return;
  }

  if (n <= 4) {
    const atLimit = streakLimit < 99 && duplas[winner].streak >= streakLimit;
    if (atLimit) {
      duplas[winner].streak = 0;
      const rest = queue.filter(id => id !== winner && id !== loser && !duplas[id]?.inactive);
      if (n === 4) {
        queue = [...rest, winner, loser];
      } else {
        queue = [rest[0] ?? loser, loser, winner].filter((v,i,a)=>a.indexOf(v)===i);
      }
    } else {
      const rest = queue.filter(id => id !== winner && id !== loser && !duplas[id]?.inactive);
      queue = [winner, ...rest, loser];
    }
  }
}

function previewNextMatchesF1(n = 3) {
  const results = [];
  let simDone  = rodadaInicialDone;
  let simIdx   = rodadaInicialIdx;
  let simQueue = [...queue];
  let simPend  = new Set(pendingSet);
  const nDup   = nAtivas();

  for (let step = 0; step < n; step++) {
    let found = null;

    if (nDup >= 6 && !simDone) {
      if (simIdx < rodadaInicialPairs.length) {
        found = rodadaInicialPairs[simIdx++];
        if (simIdx >= rodadaInicialPairs.length) simDone = true;
      } else simDone = true;
    }

    if (!found) {
      const ativas = simQueue.filter(id => !duplas[id]?.inactive);
      if (nDup >= 6) {
        outer:
        for (let i = 0; i < ativas.length; i++)
          for (let j = i+1; j < ativas.length; j++)
            if (simPend.has(pairKey(ativas[i], ativas[j]))) {
              found = { dA: ativas[i], dB: ativas[j] };
              break outer;
            }
      } else {
        if (ativas.length >= 2) found = { dA: ativas[0], dB: ativas[1] };
      }
    }

    if (!found) break;
    results.push(found);

    const {dA, dB} = found;
    simPend.delete(pairKey(dA, dB));
    simQueue = simQueue.filter(id => id !== dA && id !== dB);
    simQueue = [...simQueue, dA, dB];
  }
  return results;
}

// ══════════════════════════════════════════════════════════
//  CARREGAR PRÓXIMA PARTIDA
// ══════════════════════════════════════════════════════════
function loadNextMatch() {
  if (fase === 1) {
    const r = findNextMatch();
    if (!r) { showFase1End(); return; }
    setupMatch(r.dA, r.dB);
  } else {
    if (fase2Index >= fase2Matches.length) { showFase2Paused(); return; }
    const m = fase2Matches[fase2Index];
    setupMatch(m.dA, m.dB);
  }
}

function setupMatch(dA, dB) {
  currentMatch = { dA, dB, scoreA:0, scoreB:0 };
  sideSwapped = false;
  lastSwapAt  = -1;
  const d1 = duplas[dA], d2 = duplas[dB];

  if (fase === 1) {
    const pct = totalMatches > 0 ? Math.round(doneCount / totalMatches * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressTxt').textContent  = `Fase 1 · ${doneCount} de ${totalMatches} partidas`;
    document.getElementById('progressPct').textContent  = pct + '%';
    document.getElementById('faseTag').textContent      = '🏁 FASE 1 — Todos contra Todos';
    document.getElementById('faseTag').className        = 'fase-tag fase1';
    document.getElementById('pullBtn').style.display        = 'block';
    document.getElementById('escalacaoBtn').style.display   = 'block';
    document.getElementById('proximasCard').style.display = 'block';
    renderProximas();
  } else {
    const pct = fase2Matches.length > 0 ? Math.round(fase2Index / fase2Matches.length * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressTxt').textContent  = `Fase 2 · Partida ${fase2Index+1} de ${fase2Matches.length}`;
    document.getElementById('progressPct').textContent  = pct + '%';
    document.getElementById('faseTag').textContent      = '⚡ FASE 2 — Partidas Livres';
    document.getElementById('faseTag').className        = 'fase-tag fase2';
    document.getElementById('pullBtn').style.display      = 'none';
    document.getElementById('escalacaoBtn').style.display = 'none';
    renderProximasF2();
  }

  document.getElementById('matchNum').textContent = `Partida ${doneCount + 1}`;

  const ctx = [];
  if (d1.streak > 0 && streakLimit < 99) ctx.push(`${d1.p1}: ${d1.streak}✓`);
  if (d2.streak > 0 && streakLimit < 99) ctx.push(`${d2.p1}: ${d2.streak}✓`);
  document.getElementById('matchContext').textContent = ctx.join(' · ');

  const badges = document.getElementById('matchBadges');
  badges.innerHTML = '';
  if (streakLimit < 99) {
    [d1,d2].forEach(d => {
      if (d.streak > 0) {
        const sp = document.createElement('span');
        sp.className = 'badge ' + (d.streak >= streakLimit ? 'streak-warn' : 'streak-ok');
        sp.textContent = `${d.p1.split(' ')[0]}: ${d.streak}✓`;
        badges.appendChild(sp);
      }
    });
    const pp = document.createElement('span');
    pp.className = 'badge ' + (permMode==='leave' ? 'perm-leave' : 'perm-stay');
    pp.textContent = permMode==='leave' ? '🚪 Sai ao limite' : '🔥 Fica ao limite';
    badges.appendChild(pp);
  }

  document.getElementById('mnA').innerHTML = `<div class="pname">${d1.p1}</div><div class="pname">${d1.p2}</div>`;
  document.getElementById('mnB').innerHTML = `<div class="pname">${d2.p1}</div><div class="pname">${d2.p2}</div>`;
  document.getElementById('snA').textContent = '0';
  document.getElementById('snB').textContent = '0';

  setMatchReady();
  renderFila();
  renderRanking();
  saveState();
}

// ══════════════════════════════════════════════════════════
//  FINALIZAR PARTIDA
// ══════════════════════════════════════════════════════════
function _doOpenFinish() {
  if (!currentMatch) return;
  const d1 = duplas[currentMatch.dA], d2 = duplas[currentMatch.dB];
  document.getElementById('mfnA').textContent = `${d1.p1} & ${d1.p2}`;
  document.getElementById('mfnB').textContent = `${d2.p1} & ${d2.p2}`;
  document.getElementById('mfSA').value = currentMatch.scoreA;
  document.getElementById('mfSB').value = currentMatch.scoreB;
  document.getElementById('modalSub').textContent =
    `${fase===1?'Fase 1':'Fase 2'} · Partida ${doneCount+1} — confirme o placar:`;
  document.getElementById('modalFinish').classList.add('show');
  setTimeout(() => document.getElementById('mfSA').select(), 100);
}

function confirmFinish() {
  const sA = parseInt(document.getElementById('mfSA').value) || 0;
  const sB = parseInt(document.getElementById('mfSB').value) || 0;
  if (sA === sB) { alert('Placar não pode ser empate!'); return; }
  closeModal('modalFinish');

  const dur = stopMatchTimer();
  const {dA, dB} = currentMatch;
  const winner   = sA > sB ? dA : dB;
  const loser    = sA > sB ? dB : dA;
  const wSc = Math.max(sA,sB), lSc = Math.min(sA,sB);

  duplas[winner].v++; duplas[winner].j++; duplas[winner].pts += 3;
  duplas[winner].saldo += (wSc-lSc); duplas[winner].streak++;
  duplas[loser].d++;  duplas[loser].j++;
  duplas[loser].saldo -= (wSc-lSc);  duplas[loser].streak = 0;

  if (fase !== 1) fase2Index++;
  doneCount++;

  histItems.unshift({
    num: doneCount, fase: fase===1?'F1':'F2',
    duplaAId: dA, duplaBId: dB,
    p1a: duplas[dA].p1, p2a: duplas[dA].p2,
    p1b: duplas[dB].p1, p2b: duplas[dB].p2,
    sA, sB, winnerId: winner, duration: dur,
    arena: eventName || '',
  });
  renderHistorico();

  if (fase === 1) {
    pendingSet.delete(pairKey(dA, dB));
    const n = nAtivas();
    if (n >= 6 && !rodadaInicialDone) {
      rodadaInicialIdx++;
      if (rodadaInicialIdx >= rodadaInicialPairs.length) {
        rodadaInicialDone = true;
        const todos = duplas.filter(d => !d.inactive).map(d => d.id);
        const venc  = todos.filter(id => duplas[id].streak > 0);
        const perd  = todos.filter(id => duplas[id].streak === 0);
        queue = [...venc, ...perd];
      } else {
        queue = queue.filter(id => id !== dA && id !== dB);
        queue = [...queue, winner, loser];
      }
    } else {
      updateQueueAfterMatch(winner, loser);
    }
  }

  renderRanking();
  saveState();
  loadNextMatch();
}

// ══════════════════════════════════════════════════════════
//  TRANSIÇÕES DE FASE
// ══════════════════════════════════════════════════════════
function enterMatchArea() {
  document.getElementById('matchArea').style.display    = 'block';
  document.getElementById('fase1End').style.display     = 'none';
  document.getElementById('fase2Builder').style.display = 'none';
  document.getElementById('fase2Paused').style.display  = 'none';
  document.getElementById('torneioEnd').style.display   = 'none';
}

function showFase1End() {
  captureTorneioElapsed();
  document.getElementById('matchArea').style.display = 'none';
  document.getElementById('fase1End').style.display  = 'block';
  renderRankingInline('rankingF1');
  saveState();
}

function openFase2Builder() {
  fase = 2; fase2Matches = []; fase2Index = 0;
  document.getElementById('fase1End').style.display     = 'none';
  document.getElementById('fase2Builder').style.display = 'block';
  f2SelA = null; f2SelB = null;
  renderFase2Builder();
  saveState();
}

function startFase2() {
  if (fase2Matches.length === 0) { alert('Adicione pelo menos uma partida!'); return; }
  fase = 2; fase2Index = 0;
  document.getElementById('fase2Builder').style.display = 'none';
  enterMatchArea();
  startTorneioTimer();
  saveState();
  loadNextMatch();
}

function showFase2Paused() {
  captureTorneioElapsed();
  document.getElementById('matchArea').style.display   = 'none';
  document.getElementById('fase2Paused').style.display = 'block';
  document.getElementById('f2pDone').textContent  = fase2Index;
  document.getElementById('f2pTotal').textContent = fase2Matches.length;
  renderRankingInline('rankingF2Paused');
  renderHistorico();
  saveState();
}

function adicionarMaisPartidas() {
  fase2Matches = fase2Matches.slice(fase2Index);
  fase2Index   = 0;
  document.getElementById('fase2Paused').style.display  = 'none';
  document.getElementById('fase2Builder').style.display = 'block';
  f2SelA = null; f2SelB = null;
  renderFase2Builder();
  saveState();
}

function confirmarEncerrarTorneio() {
  if (!confirm('Encerrar o campeonato agora?\n\nO ranking e o histórico das partidas jogadas serão salvos normalmente.')) return;
  encerrarTorneio();
}

function encerrarTorneio() {
  const totalTime = stopTorneioTimer();
  stopMatchTimer();
  clearState();

  // Salvar no Supabase (assíncrono, não bloqueia a UI)
  salvarTorneioSupabase().then(ok => {
    const badge = document.getElementById('teSaveBadge');
    if (badge) {
      badge.textContent = ok ? '☁️ Salvo na nuvem' : '⚠️ Sem conexão — salvo só localmente';
      badge.className   = ok ? 'te-save-badge ok' : 'te-save-badge warn';
      badge.style.display = 'block';
    }
  });

  document.getElementById('matchArea').style.display    = 'none';
  document.getElementById('fase1End').style.display     = 'none';
  document.getElementById('fase2Builder').style.display = 'none';
  document.getElementById('fase2Paused').style.display  = 'none';
  document.getElementById('torneioEnd').style.display   = 'block';

  document.getElementById('torneioTimer').textContent = fmtHMS(totalTime);
  document.querySelector('.tt-label').textContent = '✅ Duração total';

  // ── Preencher tela de resultados ──
  const playerStats = buildPlayerStats();
  const sorted = playerStats.sort((a,b) =>
    b.pts!==a.pts ? b.pts-a.pts : b.saldo!==a.saldo ? b.saldo-a.saldo : b.v-a.v
  );

  // Info do evento
  const evInfo = document.getElementById('teEventInfo');
  if (eventName || eventDate) {
    const d = eventDate ? new Date(eventDate+'T12:00:00') : null;
    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const dateStr = d ? `${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}` : '';
    evInfo.textContent = [eventName, dateStr].filter(Boolean).join(' · ');
  } else {
    evInfo.style.display = 'none';
  }

  // Stats gerais
  const avgMs = histItems.length > 0
    ? histItems.reduce((s,h) => s+(h.duration||0), 0) / histItems.length : 0;
  document.getElementById('teTotal').textContent   = histItems.length;
  document.getElementById('teDuracao').textContent = fmtHMS(totalTime);
  document.getElementById('teMedia').textContent   = avgMs > 0 ? fmtMS(avgMs) : '--:--';

  // Pódio top 3 — mostra dupla se o jogador não trocou de parceiro
  const podioData = [
    { id:'podio1', nameId:'podio1Name', ptsId:'podio1Pts' },
    { id:'podio2', nameId:'podio2Name', ptsId:'podio2Pts' },
    { id:'podio3', nameId:'podio3Name', ptsId:'podio3Pts' },
  ];
  podioData.forEach((p, i) => {
    const player = sorted[i];
    if (player) {
      const duplasSemDuplicata = [...new Set(player.duplas)];
      const sempreNaMesmaDupla = duplasSemDuplicata.length === 1;
      if (sempreNaMesmaDupla) {
        const nomeDupla = duplasSemDuplicata[0];
        document.getElementById(p.nameId).innerHTML =
          nomeDupla.replace(' & ', '<br><span style="font-size:.7em;opacity:.5">&</span><br>');
      } else {
        document.getElementById(p.nameId).textContent = player.name;
      }
      document.getElementById(p.ptsId).textContent =
        `${player.pts}pts · ${player.v}V · saldo ${player.saldo>0?'+':''}${player.saldo}`;
      document.getElementById(p.id).style.display = 'flex';
    } else {
      document.getElementById(p.id).style.display = 'none';
    }
  });

  // Destaques
  const grid = document.getElementById('teDestaquesGrid');
  grid.innerHTML = '';

  const destaques = [];

  const mvp = sorted[0];
  if (mvp) destaques.push({ icon:'🏆', label:'Mais Vitórias', value: mvp.name, sub: `${mvp.v} vitórias` });

  const mSaldo = [...sorted].sort((a,b) => b.saldo-a.saldo)[0];
  if (mSaldo) destaques.push({ icon:'📈', label:'Maior Saldo', value: mSaldo.name, sub: `+${mSaldo.saldo} pontos` });

  const mJogos = [...sorted].sort((a,b) => b.j-a.j)[0];
  if (mJogos) destaques.push({ icon:'💪', label:'Mais Dedicado', value: mJogos.name, sub: `${mJogos.j} jogos disputados` });

  const lanterna = sorted[sorted.length - 1];
  if (lanterna && sorted.length > 1) destaques.push({ icon:'🏳️', label:'Lanterna do Dia', value: lanterna.name, sub: `${lanterna.pts}pts · ${lanterna.d}D` });

  const emocionante = [...histItems].sort((a,b) => Math.abs(a.sA-a.sB) - Math.abs(b.sA-b.sB))[0];
  if (emocionante) destaques.push({
    icon:'😱', label:'Partida Mais Emocionante',
    value: `${emocionante.p1a} & ${emocionante.p2a} × ${emocionante.p1b} & ${emocionante.p2b}`,
    sub: `${emocionante.sA} × ${emocionante.sB}`
  });

  const rapida = [...histItems].filter(h=>h.duration>0).sort((a,b)=>a.duration-b.duration)[0];
  if (rapida) destaques.push({
    icon:'⚡', label:'Partida Mais Rápida',
    value: `${rapida.p1a} & ${rapida.p2a} × ${rapida.p1b} & ${rapida.p2b}`,
    sub: `⏱ ${fmtMS(rapida.duration)} · ${rapida.sA}×${rapida.sB}`
  });

  const longa = [...histItems].filter(h=>h.duration>0).sort((a,b)=>b.duration-a.duration)[0];
  if (longa && longa !== rapida) destaques.push({
    icon:'🕐', label:'Partida Mais Longa',
    value: `${longa.p1a} & ${longa.p2a} × ${longa.p1b} & ${longa.p2b}`,
    sub: `⏱ ${fmtMS(longa.duration)} · ${longa.sA}×${longa.sB}`
  });

  destaques.forEach(d => {
    const card = document.createElement('div');
    card.className = 'te-destaque-card';
    card.innerHTML = `
      <div class="ted-icon">${d.icon}</div>
      <div class="ted-content">
        <div class="ted-label">${d.label}</div>
        <div class="ted-value">${d.value}</div>
        <div class="ted-sub">${d.sub}</div>
      </div>`;
    grid.appendChild(card);
  });

  // Ranking completo
  renderRankingTo(document.getElementById('teRankingBody'), sorted);

  // ── Winner overlay — todos os 1ºs colocados ──
  const positions = calcPositions(sorted);
  const campeoes = sorted.filter((_, i) => positions[i] === 1);
  const nomesCampeoes = campeoes.map(p => p.name).join(' & ');
  const statsCampeao = campeoes[0];

  document.getElementById('wNames').textContent = nomesCampeoes;
  document.getElementById('wStats').textContent =
    `${statsCampeao?.v} vitórias · ${statsCampeao?.pts} pts · saldo ${statsCampeao?.saldo > 0 ? '+' : ''}${statsCampeao?.saldo}`;
  document.getElementById('winnerOv').classList.add('show');
  launchConfetti();
}

function closeWinner() {
  document.getElementById('winnerOv').classList.remove('show');
  document.querySelectorAll('.cfp').forEach(c => c.remove());
  goTab(2);
}

// ══════════════════════════════════════════════════════════
//  FASE 2 — BUILDER MANUAL
// ══════════════════════════════════════════════════════════
let f2SelA = null, f2SelB = null;

function renderFase2Builder() {
  const list = document.getElementById('f2MatchList');
  list.innerHTML = '';
  fase2Matches.forEach((m, i) => {
    const d1 = duplas[m.dA], d2 = duplas[m.dB];
    const item = document.createElement('div');
    item.className = 'f2-match-item';
    item.innerHTML = `
      <div class="f2-match-num">${i+1}</div>
      <div class="f2-match-teams">
        <span class="f2ta">${d1.p1} & ${d1.p2}</span>
        <span class="f2tx">×</span>
        <span class="f2tb">${d2.p1} & ${d2.p2}</span>
      </div>
      <button class="f2-del" onclick="removeFase2Match(${i})">✕</button>`;
    list.appendChild(item);
  });
  if (fase2Matches.length === 0)
    list.innerHTML = '<div class="f2-empty">Nenhuma partida adicionada ainda</div>';

  const countEl = document.getElementById('f2MatchCount');
  if (countEl) countEl.textContent = fase2Matches.length;

  renderFase2Selector();
}

function renderFase2Selector() {
  const sel = document.getElementById('f2Selector');
  sel.innerHTML = '';
  duplas.filter(d => !d.inactive).forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'f2-dupla-btn'
      + (f2SelA===d.id ? ' sel-a' : f2SelB===d.id ? ' sel-b' : '');
    btn.textContent = `${d.p1} & ${d.p2}`;
    btn.onclick = () => selectF2Dupla(d.id);
    sel.appendChild(btn);
  });

  const preview = document.getElementById('f2Preview');
  if (f2SelA !== null && f2SelB !== null) {
    const d1 = duplas[f2SelA], d2 = duplas[f2SelB];
    preview.innerHTML = `
      <div class="f2-preview-inner">
        <span class="f2ta">${d1.p1} & ${d1.p2}</span>
        <span class="f2tx">×</span>
        <span class="f2tb">${d2.p1} & ${d2.p2}</span>
        <button class="f2-add-btn" onclick="addFase2Match()">+ Adicionar</button>
      </div>`;
  } else {
    preview.innerHTML = `<div class="f2-preview-hint">
      ${f2SelA===null ? 'Selecione a Dupla A (🟡)' : 'Agora selecione a Dupla B (🔵)'}
    </div>`;
  }
}

function selectF2Dupla(id) {
  if (f2SelA === null) { f2SelA = id; }
  else if (f2SelB === null && id !== f2SelA) { f2SelB = id; }
  else { f2SelA = id; f2SelB = null; }
  renderFase2Selector();
}

function addFase2Match() {
  if (f2SelA === null || f2SelB === null) return;
  fase2Matches.push({ dA: f2SelA, dB: f2SelB });
  f2SelA = null; f2SelB = null;
  saveState();
  renderFase2Builder();
}

function removeFase2Match(idx) {
  fase2Matches.splice(idx, 1);
  saveState();
  renderFase2Builder();
}

// ══════════════════════════════════════════════════════════
//  PUXAR JOGO — FASE 1
// ══════════════════════════════════════════════════════════
function openPullMatch() {
  const suggested = peekNextMatch();
  const list = document.getElementById('pullList');
  list.innerHTML = '';

  const allPairs = [];
  for (const key of pendingSet) {
    const [a,b] = key.split('-').map(Number);
    const maxWait = Math.max(wait[a]||0, wait[b]||0);
    const isSug   = suggested &&
      ((suggested.dA===a&&suggested.dB===b)||(suggested.dA===b&&suggested.dB===a));
    allPairs.push({ a, b, maxWait, isSug });
  }
  allPairs.sort((x,y) => x.isSug!==y.isSug?(x.isSug?-1:1):y.maxWait-x.maxWait);

  if (allPairs.length === 0) {
    populateCreateMatchSelects();
    document.getElementById('modalCreateMatch').classList.add('show');
    return;
  }

  allPairs.forEach(({a,b,maxWait,isSug}) => {
    const d1=duplas[a], d2=duplas[b];
    const item=document.createElement('div');
    item.className='pull-item'+(isSug?' suggested':'');
    let tc='normal', tt='pendente';
    if (isSug)                 { tc='sug';  tt='⭐ sugerido'; }
    else if (maxWait>=numDuplas-2) { tc='wait'; tt=`espera ${maxWait}j`; }
    else if (maxWait>0)        { tc='normal'; tt=`espera ${maxWait}j`; }
    item.innerHTML=`
      <div class="pull-teams">
        <span class="pta">${d1.p1} & ${d1.p2}</span>
        <span class="ptx">×</span>
        <span class="ptb">${d2.p1} & ${d2.p2}</span>
      </div>
      <span class="pull-tag ${tc}">${tt}</span>`;
    item.onclick=()=>pullMatch(a,b);
    list.appendChild(item);
  });
  document.getElementById('modalPull').classList.add('show');
}

let forcedMatch = null;
let escSelA = null;
let escSelB = null;

function populateCreateMatchSelects() {
  const selA = document.getElementById('createDuplaA');
  const selB = document.getElementById('createDuplaB');
  selA.innerHTML = '<option value="">Selecione...</option>';
  selB.innerHTML = '<option value="">Selecione...</option>';

  duplas.forEach((d, idx) => {
    if (d.inactive) return;
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${idx+1}) ${d.p1} & ${d.p2}`;
    selA.appendChild(opt);
    selB.appendChild(opt.cloneNode(true));
  });
}

function confirmCreateMatch() {
  const valA = document.getElementById('createDuplaA').value;
  const valB = document.getElementById('createDuplaB').value;

  if (valA === '' || valB === '') {
    alert('Selecione as duas duplas!');
    return;
  }

  const idA = parseInt(valA);
  const idB = parseInt(valB);

  if (idA === idB) {
    alert('Duplas devem ser diferentes!');
    return;
  }

  const dA = duplas[idA], dB = duplas[idB];
  const playersA = [dA.p1.trim().toLowerCase(), dA.p2.trim().toLowerCase()];
  const playersB = [dB.p1.trim().toLowerCase(), dB.p2.trim().toLowerCase()];
  if (playersA.some(p => playersB.includes(p))) {
    alert('Um mesmo jogador não pode estar nas duas duplas!');
    return;
  }

  if (!checkMatchAvailability(idA, idB)) {
    alert('Uma das duplas selecionadas já está em quadra!');
    return;
  }

  closeModal('modalCreateMatch');
  forcedMatch = { dA: idA, dB: idB };
  queue = [idA, idB, ...queue.filter(id => id !== idA && id !== idB)];
  loadNextMatch();
}

function checkMatchAvailability(idA, idB) {
  if (!currentMatch || !matchStarted) return true;
  return currentMatch.dA !== idA && currentMatch.dA !== idB &&
         currentMatch.dB !== idA && currentMatch.dB !== idB;
}

function pullMatch(dA, dB) {
  closeModal('modalPull');
  forcedMatch = { dA, dB };
  queue = [dA, dB, ...queue.filter(id => id !== dA && id !== dB)];
  if (!matchStarted) {
    loadNextMatch();
  } else {
    renderProximas();
    renderFila();
    saveState();
  }
}

// ══════════════════════════════════════════════════════════
//  ESCALAÇÃO LIVRE
// ══════════════════════════════════════════════════════════
function openEscalacao() {
  escSelA = null;
  escSelB = null;
  const grid = document.getElementById('escGrid');
  grid.innerHTML = '';
  duplas.forEach((d, idx) => {
    if (d.inactive) return;
    const card = document.createElement('div');
    card.className = 'esc-card';
    card.dataset.id = d.id;
    card.innerHTML = `
      <div class="esc-card-badge"></div>
      <div class="esc-card-num">Dupla ${idx + 1}</div>
      <div class="esc-card-names">${d.p1}<br>${d.p2}</div>`;
    card.onclick = () => escalacaoCardClick(d.id);
    grid.appendChild(card);
  });
  document.getElementById('escSub').textContent = 'Toque na 1ª dupla — ela será a Dupla A';
  document.getElementById('modalEscalacao').classList.add('show');
}

function escalacaoCardClick(id) {
  if (escSelA === null) {
    escSelA = id;
    updateEscalacaoCards();
    document.getElementById('escSub').textContent = 'Agora toque na 2ª dupla — ela será a Dupla B';
    return;
  }
  if (escSelA === id) {
    escSelA = null;
    updateEscalacaoCards();
    document.getElementById('escSub').textContent = 'Toque na 1ª dupla — ela será a Dupla A';
    return;
  }
  const dA = duplas[escSelA], dB = duplas[id];
  const playersA = [dA.p1.trim().toLowerCase(), dA.p2.trim().toLowerCase()];
  const playersB = [dB.p1.trim().toLowerCase(), dB.p2.trim().toLowerCase()];
  if (playersA.some(p => playersB.includes(p))) {
    alert('Um mesmo jogador não pode estar nas duas duplas!');
    return;
  }
  escSelB = id;
  updateEscalacaoCards();
  setTimeout(confirmEscalacao, 220);
}

function updateEscalacaoCards() {
  document.querySelectorAll('.esc-card').forEach(card => {
    const cid = parseInt(card.dataset.id);
    card.classList.remove('sel-a', 'sel-b');
    const badge = card.querySelector('.esc-card-badge');
    badge.textContent = '';
    if (cid === escSelA) { card.classList.add('sel-a'); badge.textContent = 'A'; }
    if (cid === escSelB) { card.classList.add('sel-b'); badge.textContent = 'B'; }
  });
}

function confirmEscalacao() {
  if (escSelA === null || escSelB === null) return;
  const idA = escSelA, idB = escSelB;
  escSelA = null; escSelB = null;
  closeModal('modalEscalacao');
  forcedMatch = { dA: idA, dB: idB };
  queue = [idA, idB, ...queue.filter(id => id !== idA && id !== idB)];
  if (!matchStarted) {
    loadNextMatch();
  } else {
    renderProximas();
    renderFila();
    saveState();
  }
}

// ══════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════
function renderFila() {
  const chips = document.getElementById('filaChips');
  chips.innerHTML = '';
  if (!currentMatch) return;
  const {dA, dB} = currentMatch;

  if (!rodadaInicialDone) {
    [dA, dB].forEach(id => {
      const d = duplas[id];
      const chip = document.createElement('div');
      chip.className = 'fila-chip em-quadra';
      chip.innerHTML = `<div class="fc-pos">⚽ em quadra</div><div class="fc-name">${d.p1}<br>${d.p2}</div>`;
      chips.appendChild(chip);
    });
    for (let i = rodadaInicialIdx + 1; i < rodadaInicialPairs.length; i++) {
      const par = rodadaInicialPairs[i];
      [par.dA, par.dB].forEach(id => {
        const d = duplas[id];
        const chip = document.createElement('div');
        chip.className = 'fila-chip';
        chip.innerHTML = `<div class="fc-pos">Jogo ${i+1} – aguarda</div><div class="fc-name">${d.p1}<br>${d.p2}</div>`;
        chips.appendChild(chip);
      });
    }
    const emJogo = new Set(rodadaInicialPairs.flatMap(p => [p.dA, p.dB]));
    duplas.filter(d => !d.inactive && !emJogo.has(d.id)).forEach(d => {
      const chip = document.createElement('div');
      chip.className = 'fila-chip urgente';
      chip.innerHTML = `<div class="fc-pos">aguarda rodada</div><div class="fc-name">${d.p1}<br>${d.p2}</div>`;
      chips.appendChild(chip);
    });
    return;
  }

  queue.forEach((id, idx) => {
    const d = duplas[id];
    if (!d || d.inactive) return;
    const onCourt = id === dA || id === dB;
    const chip = document.createElement('div');
    chip.className = 'fila-chip' + (onCourt ? ' em-quadra' : '');
    const pos = onCourt ? '⚽ em quadra' : `${idx + 1}º na fila`;
    chip.innerHTML = `
      <div class="fc-pos">${pos}</div>
      <div class="fc-name">${d.p1}<br>${d.p2}</div>`;
    chips.appendChild(chip);
  });
}

function renderProximas() {
  const previews = previewNextMatchesF1(3);
  const list = document.getElementById('proximasList');
  list.innerHTML = '';
  previews.forEach((m,i) => {
    const d1=duplas[m.dA], d2=duplas[m.dB];
    const isForced = i === 0 && forcedMatch &&
      ((forcedMatch.dA===m.dA && forcedMatch.dB===m.dB) ||
       (forcedMatch.dA===m.dB && forcedMatch.dB===m.dA));
    const item=document.createElement('div');
    item.className='prox-item' + (isForced ? ' prox-item--next' : '');
    item.innerHTML=`
      <div class="prox-num">${isForced ? '▶' : doneCount+2+i}</div>
      <div class="prox-teams">
        <span class="pa">${d1.p1} & ${d1.p2}</span>
        <span class="px">×</span>
        <span class="pb">${d2.p1} & ${d2.p2}</span>
      </div>${isForced ? '<span class="prox-badge-next">PRÓXIMO</span>' : ''}`;
    list.appendChild(item);
  });
  document.getElementById('proximasCard').style.display = previews.length ? 'block' : 'none';
}

function renderProximasF2() {
  const list = document.getElementById('proximasList');
  list.innerHTML = '';
  const rest = fase2Matches.slice(fase2Index+1, fase2Index+4);
  rest.forEach((m,i) => {
    const d1=duplas[m.dA], d2=duplas[m.dB];
    const item=document.createElement('div'); item.className='prox-item';
    item.innerHTML=`
      <div class="prox-num">${fase2Index+2+i}</div>
      <div class="prox-teams">
        <span class="pa">${d1.p1} & ${d1.p2}</span>
        <span class="px">×</span>
        <span class="pb">${d2.p1} & ${d2.p2}</span>
      </div>`;
    list.appendChild(item);
  });
  document.getElementById('proximasCard').style.display = rest.length ? 'block' : 'none';
}

function renderRanking() {
  const body = document.getElementById('rankingBody');
  if (body) renderRankingTo(body);
  if (rankView === 'player') renderPlayerRanking();
}

// ══════════════════════════════════════════════════════════
//  CARD INSTAGRAM — Canvas 1200×675
// ══════════════════════════════════════════════════════════
function gerarCardInstagram(opts = {}) {
  const duplasArr = opts.duplas != null ? opts.duplas : duplas;
  const rawDate   = opts.date || opts.criado_em || eventDate || '';
  const arenaStr  = (opts.arena != null ? opts.arena : eventName) || '';

  const W = 1200, H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Format date in Portuguese
  let displayDate = '';
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d)) {
      const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      displayDate = `${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
    } else {
      displayDate = rawDate;
    }
  }

  // Sort and compute dense ranking
  const sorted = [...duplasArr].sort((a, b) =>
    b.pts !== a.pts ? b.pts - a.pts : b.saldo !== a.saldo ? b.saldo - a.saldo : b.v - a.v
  );
  const positions = calcPositions(sorted);

  // Helper: find arena logo path from ARENAS_DEFAULT + custom
  function getArenaLogoPath(name) {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    const all = [...ARENAS_DEFAULT, ...loadCustomArenas()];
    const match = all.find(a => a.logo && (a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase())));
    return match ? match.logo : null;
  }

  // Helper: load image via fetch/blob, trying multiple paths in order
  function loadImg(paths, cb) {
    const [first, ...rest] = paths;
    if (!first) return cb(null);
    fetch(first)
      .then(r => { if (!r.ok) throw new Error('not ok'); return r.blob(); })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload  = () => { cb(img); URL.revokeObjectURL(url); };
        img.onerror = () => loadImg(rest, cb);
        img.src = url;
      })
      .catch(() => loadImg(rest, cb));
  }

  function draw(logoImg, arenaImg) {
    // Background
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, W, H);

    // Watermark — logo PNG centered at low opacity, or text fallback
    ctx.save();
    ctx.globalAlpha = 0.06;
    if (logoImg) {
      const wmH = 320;
      const wmW = logoImg.width * (wmH / logoImg.height);
      ctx.drawImage(logoImg, (W - wmW) / 2, (H - wmH) / 2, wmW, wmH);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 340px "Bebas Neue", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FTV', W / 2, H / 2);
    }
    ctx.restore();

    // Logo FTVScore (top-left)
    if (logoImg) {
      const lh = 80;
      const lw = logoImg.width * (lh / logoImg.height);
      ctx.drawImage(logoImg, 40, 20, lw, lh);
    } else {
      ctx.fillStyle = '#D4AF37';
      ctx.font = 'bold 28px "Bebas Neue", Impact, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('FTVScore', 40, 60);
    }

    // Title (center)
    ctx.fillStyle = '#D4AF37';
    ctx.font = 'bold 52px "Bebas Neue", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 CLASSIFICAÇÃO', W / 2, 60);

    // Arena logo + date (top-right)
    const rightX = W - 40;
    if (arenaImg) {
      const ah = 50;
      const aw = arenaImg.width * (ah / arenaImg.height);
      ctx.drawImage(arenaImg, rightX - aw, 10, aw, ah);
      if (displayDate) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '600 18px "Barlow Condensed", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayDate, rightX, 75);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '600 20px "Barlow Condensed", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const headerRight = [arenaStr, displayDate].filter(Boolean).join('  ·  ');
      if (headerRight) ctx.fillText(headerRight, rightX, 60);
    }

    // Header divider
    ctx.strokeStyle = 'rgba(212,175,55,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 115); ctx.lineTo(W - 40, 115); ctx.stroke();

    // Column x positions
    const COL_POS   = 70;
    const COL_NAME  = 115;
    const COL_J     = 735;
    const COL_V     = 815;
    const COL_D     = 895;
    const COL_SALDO = 985;
    const COL_PTS   = 1085;

    // Table header
    const TH_Y = 118, TH_H = 30;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(40, TH_Y, W - 80, TH_H);

    const thMid = TH_Y + TH_H / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '700 13px "Barlow Condensed", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center'; ctx.fillText('#',      COL_POS,   thMid);
    ctx.textAlign = 'left';   ctx.fillText('DUPLA',  COL_NAME,  thMid);
    ctx.textAlign = 'center'; ctx.fillText('J',      COL_J,     thMid);
                              ctx.fillText('V',      COL_V,     thMid);
                              ctx.fillText('D',      COL_D,     thMid);
                              ctx.fillText('SALDO',  COL_SALDO, thMid);
    ctx.fillStyle = 'rgba(212,175,55,0.7)';
                              ctx.fillText('PTS',    COL_PTS,   thMid);

    // Rows
    const ROW_Y0 = TH_Y + TH_H;
    const ROW_H  = 50;

    sorted.forEach((d, i) => {
      const ry = ROW_Y0 + i * ROW_H;
      if (ry + ROW_H > H - 55) return;
      const midY = ry + ROW_H / 2;
      const pos  = positions[i];

      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(40, ry, W - 80, ROW_H);
      }

      // Position / medal
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (pos <= 3) {
        ctx.font = '28px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pos === 1 ? '🥇' : pos === 2 ? '🥈' : '🥉', COL_POS, midY);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = 'bold 20px "Bebas Neue", Impact, sans-serif';
        ctx.fillText(pos, COL_POS, midY);
      }

      // Dupla name
      const nameStr = `${d.p1} / ${d.p2}`;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 21px "Bebas Neue", Impact, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(nameStr.length > 36 ? nameStr.slice(0, 34) + '…' : nameStr, COL_NAME, midY);

      // J
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 20px "Bebas Neue", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.j, COL_J, midY);

      // V (green)
      ctx.fillStyle = '#2ecc71';
      ctx.fillText(d.v, COL_V, midY);

      // D
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(d.d, COL_D, midY);

      // Saldo
      ctx.fillStyle = d.saldo >= 0 ? '#2ecc71' : '#e74c3c';
      ctx.fillText(d.saldo > 0 ? `+${d.saldo}` : String(d.saldo), COL_SALDO, midY);

      // Pts
      ctx.fillStyle = '#D4AF37';
      ctx.font = 'bold 22px "Bebas Neue", Impact, sans-serif';
      ctx.fillText(d.pts, COL_PTS, midY);

      // Row divider
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(40, ry + ROW_H); ctx.lineTo(W - 40, ry + ROW_H); ctx.stroke();
    });

    // Footer — @FTVSCORE in cyan + ftvscore.app.br
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00CED1';
    ctx.font = 'bold 28px "Bebas Neue", Impact, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('@FTVSCORE', W / 2, H - 36);

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '16px "Barlow Condensed", Arial, sans-serif';
    ctx.fillText('ftvscore.app.br', W / 2, H - 14);

    // Download
    const fileDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const link = document.createElement('a');
    link.download = `ftvscore-ranking-${fileDate}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  const arenaLogoPath = getArenaLogoPath(arenaStr);

  loadImg(['assets/logo.png', './assets/logo.png'], logoImg => {
    if (arenaLogoPath) {
      loadImg([arenaLogoPath], arenaImg => draw(logoImg, arenaImg));
    } else {
      draw(logoImg, null);
    }
  });
}

function calcPositions(sorted) {
  const pos = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && (sorted[i].pts !== sorted[i-1].pts || sorted[i].saldo !== sorted[i-1].saldo)) rank++;
    pos.push(rank);
  }
  return pos;
}
function posMedal(pos) { return pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':pos; }

function renderRankingTo(body, sortedOverride) {
  if (!body) return;
  body.innerHTML = '';
  const sorted = sortedOverride || [...duplas].sort((a,b)=>b.pts!==a.pts?b.pts-a.pts:b.saldo!==a.saldo?b.saldo-a.saldo:b.v-a.v);
  const positions = calcPositions(sorted);
  sorted.forEach((d,i) => {
    const pos=positions[i], medal=posMedal(pos);
    const sc=d.saldo>=0?'sp':'sn';
    const row=document.createElement('div'); row.className='rt-row';
    row.innerHTML=`
      <div class="rt-pos">${medal}</div>
      <div class="rt-name">${d.p1} / ${d.p2}${d.inactive?' <span class="gd-tag-out">fora</span>':''}</div>
      <div class="rt-cell">${d.j}</div>
      <div class="rt-cell v">${d.v}</div>
      <div class="rt-cell">${d.d}</div>
      <div class="rt-cell ${sc}">${d.saldo>0?'+':''}${d.saldo}</div>
      <div class="rt-cell pts">${d.pts}</div>`;
    body.appendChild(row);
  });
}

function renderRankingInline(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  const stats  = buildPlayerStats();
  const sorted = stats.sort((a,b)=>b.pts!==a.pts?b.pts-a.pts:b.saldo!==a.saldo?b.saldo-a.saldo:b.v-a.v);
  if (sorted.length === 0) return;
  const positions = calcPositions(sorted);
  sorted.forEach((p,i) => {
    const pos=positions[i], medal=posMedal(pos);
    const sc=p.saldo>=0?'sp':'sn';
    const row=document.createElement('div'); row.className='rt-row rt-row-player';
    row.innerHTML=`
      <div class="rt-pos">${medal}</div>
      <div class="rt-name-player">
        <div class="rtp-name">${p.name}</div>
        <div class="rtp-duplas">${p.duplas.join(' · ')}</div>
      </div>
      <div class="rt-cell">${p.j}</div>
      <div class="rt-cell v">${p.v}</div>
      <div class="rt-cell">${p.d}</div>
      <div class="rt-cell ${sc}">${p.saldo>0?'+':''}${p.saldo}</div>
      <div class="rt-cell pts">${p.pts}</div>`;
    el.appendChild(row);
  });
}

function renderHistorico() {
  const list = document.getElementById('histList');
  list.innerHTML = '';
  if (!histItems.length) {
    list.innerHTML = '<div class="empty-hist">Nenhuma partida jogada ainda</div>';
    return;
  }
  histItems.forEach(h => {
    const winA = h.sA > h.sB;
    const ts   = h.duration ? fmtMS(h.duration) : '';
    const item = document.createElement('div'); item.className='hist-item';
    item.innerHTML=`
      <div class="hist-n">
        <div>#${h.num}</div>
        <div class="hist-fase">${h.fase||'F1'}</div>
      </div>
      <div class="hist-teams">
        ${h.arena ? `<div class="hist-arena">🏟️ ${h.arena}</div>` : ''}
        <span class="ha" style="${winA?'':'opacity:.45'}">${h.p1a} & ${h.p2a}</span>
        <span class="hx">×</span>
        <span class="hb" style="${!winA?'':'opacity:.45'}">${h.p1b} & ${h.p2b}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
        <div class="hist-score">${h.sA} × ${h.sB}</div>
        ${ts?`<div class="hist-time">⏱ ${ts}</div>`:''}
      </div>`;
    list.appendChild(item);
  });
}

// ══════════════════════════════════════════════════════════
//  RANKING POR JOGADOR
// ══════════════════════════════════════════════════════════
function setRankView(view) {
  rankView = view;
  document.getElementById('rankViewPlayer').style.display = view==='player' ? 'block' : 'none';
  document.getElementById('rankViewDupla').style.display  = view==='dupla'  ? 'block' : 'none';
  document.getElementById('rankTogPlayer').classList.toggle('active', view==='player');
  document.getElementById('rankTogDupla').classList.toggle('active', view==='dupla');
  if (view==='player') renderPlayerRanking();
  if (view==='dupla')  renderRankingTo(document.getElementById('rankingBody'));
}

function buildPlayerStats() {
  const players = {};
  function get(name) {
    const key = name.trim().toLowerCase();
    if (!players[key]) players[key] = { name:name.trim(), j:0, v:0, d:0, saldo:0, pts:0, duplas:new Set() };
    return players[key];
  }
  histItems.forEach(h => {
    const winnerDupla = duplas.find(d => d.id === h.winnerId);
    const teamANames  = [h.p1a.trim().toLowerCase(), h.p2a.trim().toLowerCase()];
    const winnerIsA   = winnerDupla
      ? (winnerDupla.p1.trim().toLowerCase()===teamANames[0] || winnerDupla.p1.trim().toLowerCase()===teamANames[1])
      : h.sA > h.sB;
    const saldo = Math.abs(h.sA - h.sB);

    [h.p1a, h.p2a].forEach(n => {
      const p = get(n); p.j++; p.duplas.add(`${h.p1a} & ${h.p2a}`);
      if (winnerIsA) { p.v++; p.pts+=3; p.saldo+=saldo; } else { p.d++; p.saldo-=saldo; }
    });
    [h.p1b, h.p2b].forEach(n => {
      const p = get(n); p.j++; p.duplas.add(`${h.p1b} & ${h.p2b}`);
      if (!winnerIsA) { p.v++; p.pts+=3; p.saldo+=saldo; } else { p.d++; p.saldo-=saldo; }
    });
  });
  return Object.values(players).map(p => ({...p, duplas:[...p.duplas]}));
}

function renderPlayerRanking() {
  const stats  = buildPlayerStats();
  const sorted = stats.sort((a,b)=>b.pts!==a.pts?b.pts-a.pts:b.saldo!==a.saldo?b.saldo-a.saldo:b.v-a.v);
  const body   = document.getElementById('rankingPlayerBody');
  if (!body) return;
  body.innerHTML = '';
  if (sorted.length === 0) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:.8rem;letter-spacing:2px;text-transform:uppercase">Nenhuma partida jogada ainda</div>';
    return;
  }
  const positions2 = calcPositions(sorted);
  sorted.forEach((p,i) => {
    const pos=positions2[i], medal=posMedal(pos);
    const sc=p.saldo>=0?'sp':'sn';
    const row=document.createElement('div'); row.className='rt-row rt-row-player';
    row.innerHTML=`
      <div class="rt-pos">${medal}</div>
      <div class="rt-name-player">
        <div class="rtp-name">${p.name}</div>
        <div class="rtp-duplas">${p.duplas.join(' · ')}</div>
      </div>
      <div class="rt-cell">${p.j}</div>
      <div class="rt-cell v">${p.v}</div>
      <div class="rt-cell">${p.d}</div>
      <div class="rt-cell ${sc}">${p.saldo>0?'+':''}${p.saldo}</div>
      <div class="rt-cell pts">${p.pts}</div>`;
    body.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════
//  GERENCIAR DUPLAS
// ══════════════════════════════════════════════════════════
function renderGerenciarDuplas() {
  renderGdList();
  renderGdSwapGrid();
}

function renderGdList() {
  const list = document.getElementById('gdDuplasList');
  list.innerHTML = '';
  duplas.forEach(d => {
    const pendF1 = fase===1
      ? [...pendingSet].filter(k=>{const[a,b]=k.split('-').map(Number);return a===d.id||b===d.id;}).length
      : 0;
    const card = document.createElement('div');
    card.className = 'gd-card' + (d.inactive ? ' gd-inactive' : '');
    card.innerHTML = `
      <div class="gd-card-left">
        <div class="gd-names">
          <span class="gd-p1">${d.p1}</span>
          <span class="gd-amp">&amp;</span>
          <span class="gd-p2">${d.p2}</span>
          ${d.inactive ? '<span class="gd-tag-out">fora</span>' : ''}
        </div>
        <div class="gd-stats">
          ${d.j}J · ${d.v}V · ${d.d}D · ${d.pts}pts
          ${!d.inactive && pendF1>0 ? `<span class="gd-pend"> · ${pendF1} pend.</span>` : ''}
        </div>
      </div>
      <div class="gd-card-right">
        <button class="gd-btn-edit" onclick="openGdEdit(${d.id})">✏️</button>
      </div>`;
    list.appendChild(card);
  });
}

function openGdEdit(id) {
  gdEditId = id;
  const d  = duplas.find(x => x.id===id);
  document.getElementById('gdEditTitle').textContent = `${d.p1} & ${d.p2}`;
  document.getElementById('gdEditStats').textContent = `${d.j} jogos · ${d.v} vitórias · ${d.pts} pts`;
  document.getElementById('gdP1').value = d.p1;
  document.getElementById('gdP2').value = d.p2;
  document.getElementById('gdBtnRemove').style.display  = d.inactive ? 'none'  : 'block';
  document.getElementById('gdBtnRestore').style.display = d.inactive ? 'block' : 'none';
  document.getElementById('modalGdEdit').classList.add('show');
}

function gdSaveNames() {
  const d  = duplas.find(x => x.id===gdEditId);
  const p1 = document.getElementById('gdP1').value.trim();
  const p2 = document.getElementById('gdP2').value.trim();
  if (!p1||!p2) { alert('Preencha os dois nomes!'); return; }
  d.p1=p1; d.p2=p2;
  closeModal('modalGdEdit');
  afterGdChange();
}

function gdRemoveDupla() {
  const d = duplas.find(x=>x.id===gdEditId);
  if (!confirm(`Remover "${d.p1} & ${d.p2}" do torneio?\n\n✅ Histórico preservado.\n❌ Partidas pendentes canceladas.`)) return;
  d.inactive = true;
  for (const key of [...pendingSet]) {
    const [a,b]=key.split('-').map(Number);
    if (a===d.id||b===d.id) pendingSet.delete(key);
  }
  queue = queue.filter(id=>id!==d.id);
  closeModal('modalGdEdit');
  if (currentMatch && (currentMatch.dA===d.id||currentMatch.dB===d.id)) {
    stopMatchTimer(); currentMatch=null; enterMatchArea(); loadNextMatch();
  }
  afterGdChange();
}

function gdRestoreDupla() {
  const d = duplas.find(x=>x.id===gdEditId);
  if (!confirm(`Reativar "${d.p1} & ${d.p2}"?`)) return;
  d.inactive = false;
  if (fase===1) {
    duplas.forEach(other => {
      if (other.id===d.id||other.inactive) return;
      const key = d.id<other.id?`${d.id}-${other.id}`:`${other.id}-${d.id}`;
      const jaJogaram = histItems.some(h=>
        (h.duplaAId===d.id&&h.duplaBId===other.id)||(h.duplaAId===other.id&&h.duplaBId===d.id));
      if (!jaJogaram&&!pendingSet.has(key)) pendingSet.add(key);
    });
  }
  wait[d.id]=0; queue.push(d.id);
  closeModal('modalGdEdit');
  afterGdChange();
}

function openGdAdd() {
  document.getElementById('gdNewP1').value='';
  document.getElementById('gdNewP2').value='';
  renderGdFreeAgents();
  document.getElementById('modalGdAdd').classList.add('show');
}

function renderGdFreeAgents() {
  const active = new Set();
  duplas.filter(d=>!d.inactive).forEach(d=>{active.add(d.p1.toLowerCase());active.add(d.p2.toLowerCase());});
  const free = [...new Set(duplas.filter(d=>d.inactive)
    .flatMap(d=>[d.p1,d.p2])
    .filter(n=>!active.has(n.toLowerCase())))];
  const box = document.getElementById('gdFreeAgents');
  if (!free.length) { box.style.display='none'; return; }
  box.style.display='block';
  box.innerHTML=`
    <div class="gd-fa-label">👤 Jogadores sem dupla:</div>
    <div class="gd-fa-chips">${free.map(n=>`<button class="gd-fa-chip" onclick="gdFillPlayer('${n}')">${n}</button>`).join('')}</div>`;
}

function gdFillPlayer(name) {
  const p1=document.getElementById('gdNewP1');
  const p2=document.getElementById('gdNewP2');
  if (!p1.value.trim()) p1.value=name; else if (!p2.value.trim()) p2.value=name;
}

function gdConfirmAdd() {
  const p1=document.getElementById('gdNewP1').value.trim();
  const p2=document.getElementById('gdNewP2').value.trim();
  if (!p1||!p2) { alert('Preencha os dois nomes!'); return; }
  const newId = duplas.length>0 ? Math.max(...duplas.map(d=>d.id))+1 : 0;
  duplas.push({id:newId,p1,p2,j:0,v:0,d:0,saldo:0,pts:0,streak:0,inactive:false});
  wait[newId]=0;
  if (fase===1) {
    duplas.forEach(other=>{
      if (other.id===newId||other.inactive) return;
      const key=newId<other.id?`${newId}-${other.id}`:`${other.id}-${newId}`;
      pendingSet.add(key);
    });
    totalMatches=[...pendingSet].length+doneCount;
  }
  queue.push(newId);
  numDuplas=duplas.filter(d=>!d.inactive).length;
  closeModal('modalGdAdd');
  afterGdChange();
}

function renderGdSwapGrid() {
  const grid=document.getElementById('gdSwapGrid');
  grid.innerHTML='';
  duplas.filter(d=>!d.inactive).forEach(d=>{
    const grp=document.createElement('div'); grp.className='gd-swap-grp';
    grp.innerHTML=`<div class="gd-swap-grp-label">${d.p1} &amp; ${d.p2}</div>`;
    ['p1','p2'].forEach(slot=>{
      const name=d[slot];
      const isA=swapSelA&&swapSelA.duplaId===d.id&&swapSelA.slot===slot;
      const isB=swapSelB&&swapSelB.duplaId===d.id&&swapSelB.slot===slot;
      const btn=document.createElement('button');
      btn.className='gd-swap-player'+(isA?' sel-a':isB?' sel-b':'');
      btn.textContent=(isA?'🟡 ':isB?'🔵 ':'')+name;
      btn.onclick=()=>gdSelectSwap(d.id,slot,name);
      grp.appendChild(btn);
    });
    grid.appendChild(grp);
  });

  document.getElementById('gdSlotA').textContent=swapSelA?`🟡 ${swapSelA.name}`:'— selecione —';
  document.getElementById('gdSlotB').textContent=swapSelB?`🔵 ${swapSelB.name}`:'— selecione —';
  document.getElementById('gdSlotABox').classList.toggle('filled',!!swapSelA);
  document.getElementById('gdSlotBBox').classList.toggle('filled',!!swapSelB);

  const preview=document.getElementById('gdSwapPreview');
  const btnBox=document.getElementById('gdSwapBtns');
  if (swapSelA&&swapSelB) {
    preview.innerHTML=`
      <div class="gd-swap-preview-row">
        <span class="gd-sel-a">🟡 ${swapSelA.name}</span>
        <span class="gd-swap-x">↔</span>
        <span class="gd-sel-b">🔵 ${swapSelB.name}</span>
      </div>
      <div class="gd-swap-preview-sub">Escolha o que deseja fazer:</div>`;
    preview.style.display='block'; btnBox.style.display='flex';
  } else {
    preview.style.display='none'; btnBox.style.display='none';
  }
}

function gdSelectSwap(duplaId,slot,name) {
  if (swapSelA&&swapSelA.duplaId===duplaId&&swapSelA.slot===slot) { swapSelA=null; }
  else if (swapSelB&&swapSelB.duplaId===duplaId&&swapSelB.slot===slot) { swapSelB=null; }
  else if (!swapSelA) { swapSelA={duplaId,slot,name}; }
  else if (!swapSelB&&!(swapSelA.duplaId===duplaId&&swapSelA.slot===slot)) { swapSelB={duplaId,slot,name}; }
  else { swapSelA={duplaId,slot,name}; swapSelB=null; }
  renderGdSwapGrid();
}

function gdDoSwap() {
  if (!swapSelA||!swapSelB) return;
  const dA=duplas.find(x=>x.id===swapSelA.duplaId);
  const dB=duplas.find(x=>x.id===swapSelB.duplaId);
  if (!confirm(`Trocar "${swapSelA.name}" ↔ "${swapSelB.name}" entre as duplas existentes?`)) return;
  const tmp=dA[swapSelA.slot]; dA[swapSelA.slot]=dB[swapSelB.slot]; dB[swapSelB.slot]=tmp;
  swapSelA=null; swapSelB=null;
  afterGdChange();
}

function gdFormNovaDupla() {
  if (!swapSelA||!swapSelB) return;
  const dA=duplas.find(x=>x.id===swapSelA.duplaId);
  const dB=duplas.find(x=>x.id===swapSelB.duplaId);
  if (dA.id===dB.id) { alert('Selecione jogadores de duplas diferentes!'); return; }
  if (!confirm(`Formar nova dupla: "${swapSelA.name} & ${swapSelB.name}"?\n\n✅ Histórico de ambas duplas preservado.\n⏸ Duplas originais ficam inativas.`)) return;

  [dA,dB].forEach(d=>{
    d.inactive=true;
    queue=queue.filter(q=>q!==d.id);
    for (const key of [...pendingSet]) {
      const [a,b]=key.split('-').map(Number);
      if (a===d.id||b===d.id) pendingSet.delete(key);
    }
  });

  if (currentMatch&&([dA.id,dB.id].includes(currentMatch.dA)||[dA.id,dB.id].includes(currentMatch.dB))) {
    stopMatchTimer(); currentMatch=null;
  }

  const newId=Math.max(...duplas.map(d=>d.id))+1;
  duplas.push({id:newId,p1:swapSelA.name,p2:swapSelB.name,j:0,v:0,d:0,saldo:0,pts:0,streak:0,inactive:false});
  wait[newId]=0;
  if (fase===1) {
    duplas.forEach(other=>{
      if (other.id===newId||other.inactive) return;
      const key=newId<other.id?`${newId}-${other.id}`:`${other.id}-${newId}`;
      pendingSet.add(key);
    });
  }
  queue.push(newId);
  numDuplas=duplas.filter(d=>!d.inactive).length;
  swapSelA=null; swapSelB=null;
  afterGdChange();
  if (!currentMatch) { enterMatchArea(); loadNextMatch(); }
}

function afterGdChange() {
  saveState();
  renderGerenciarDuplas();
  renderRanking();
  renderFila();
  renderHistorico();
  if (currentMatch) {
    const d1=duplas[currentMatch.dA], d2=duplas[currentMatch.dB];
    if (d1) document.getElementById('mnA').innerHTML=`<div class="pname">${d1.p1}</div><div class="pname">${d1.p2}</div>`;
    if (d2) document.getElementById('mnB').innerHTML=`<div class="pname">${d2.p1}</div><div class="pname">${d2.p2}</div>`;
  }
}

// ══════════════════════════════════════════════════════════
//  CONFETTI
// ══════════════════════════════════════════════════════════
function launchConfetti() {
  const cols=['#f1c40f','#74b9ff','#2ecc71','#e74c3c','#a29bfe','#fd79a8'];
  for (let i=0;i<100;i++) {
    const c=document.createElement('div'); c.className='cfp';
    c.style.left=Math.random()*100+'vw';
    c.style.background=cols[~~(Math.random()*cols.length)];
    const s=5+Math.random()*9; c.style.width=s+'px'; c.style.height=s+'px';
    c.style.animationDuration=(1.4+Math.random()*2)+'s';
    c.style.animationDelay=(Math.random()*.8)+'s';
    document.body.appendChild(c);
    setTimeout(()=>c.remove(),4000);
  }
}

// ══════════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════════
function goTab(n) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+n).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab'+n).classList.add('active');
  if (n===2) setRankView(rankView);
  if (n===3) renderHistorico();
  if (n===4) { swapSelA=null; swapSelB=null; renderGerenciarDuplas(); }
  if (n===5) renderTorneiosAnteriores();
}

// ══════════════════════════════════════════════════════════
//  TELA 5 — TORNEIOS ANTERIORES (Supabase)
// ══════════════════════════════════════════════════════════
async function renderTorneiosAnteriores() {
  const loading = document.getElementById('thLoading');
  const empty   = document.getElementById('thEmpty');
  const list    = document.getElementById('thList');
  loading.style.display = 'block';
  empty.style.display   = 'none';
  list.style.display    = 'none';
  list.innerHTML        = '';

  const torneios = await buscarTorneiosSupabase();
  loading.style.display = 'none';

  if (!torneios.length) { empty.style.display = 'block'; return; }

  list.style.display = 'flex';
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  torneios.forEach(t => {
    const d    = new Date(t.criado_em);
    const data = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    const hora = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const ranking = (t.ranking || []).slice(0, 3);
    const podioHTML = ranking.map((p, i) => {
      const medals = ['🥇','🥈','🥉'];
      return `<span class="th-medal">${medals[i]} ${p.name} <small>${p.pts}pts</small></span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'th-card';
    card.innerHTML = `
      <div class="th-card-top">
        <div class="th-card-info">
          <div class="th-card-nome">${t.evento_nome || 'Torneio de FuteVôlei'}</div>
          <div class="th-card-data">📅 ${data} às ${hora}</div>
        </div>
        <div class="th-card-stats">
          <span>⚽ ${t.total_jogos} jogos</span>
          <span>⏱ ${fmtHMS(t.duracao_ms || 0)}</span>
        </div>
      </div>
      <div class="th-podio">${podioHTML}</div>
      <div class="th-card-hint">Toque para ver ranking completo</div>`;
    card.addEventListener('click', () => toggleTorneioDetalhe(card, t));
    list.appendChild(card);
  });
}

function toggleTorneioDetalhe(card, t) {
  const existing = card.querySelector('.th-detalhe');
  if (existing) { existing.remove(); card.querySelector('.th-card-hint').style.display='block'; return; }
  card.querySelector('.th-card-hint').style.display = 'none';

  const detalhe = document.createElement('div');
  detalhe.className = 'th-detalhe';

  const ranking = t.ranking || [];
  const rows = ranking.map((p, i) => {
    const sc  = p.saldo >= 0 ? 'sp' : 'sn';
    const pos = p.pos != null ? p.pos : i + 1;
    const medal = pos===1?'🥇':pos===2?'🥈':pos===3?'🥉':pos;
    return `<div class="rt-row rt-row-player">
      <div class="rt-pos">${medal}</div>
      <div class="rt-name-player">
        <div class="rtp-name">${p.name}</div>
        <div class="rtp-duplas">${(p.duplas||[]).join(' · ')}</div>
      </div>
      <div class="rt-cell">${p.j}</div>
      <div class="rt-cell v">${p.v}</div>
      <div class="rt-cell">${p.d}</div>
      <div class="rt-cell ${sc}">${p.saldo>0?'+':''}${p.saldo}</div>
      <div class="rt-cell pts">${p.pts}</div>
    </div>`;
  }).join('');

  const partidas = (t.partidas || []).slice().reverse();
  const partidasHTML = partidas.map(h => {
    const winA = h.sA > h.sB;
    const dur  = h.duration ? fmtMS(h.duration) : '';
    return `<div class="th-hist-item">
      <div class="th-hist-num">#${h.num}<br><small>${h.fase||'F1'}</small></div>
      <div class="th-hist-teams">
        <span class="${winA?'th-winner':'th-loser'}">${h.p1a} & ${h.p2a}</span>
        <span class="th-hist-x">×</span>
        <span class="${!winA?'th-winner':'th-loser'}">${h.p1b} & ${h.p2b}</span>
      </div>
      <div class="th-hist-right">
        <div class="th-hist-score">${h.sA} × ${h.sB}</div>
        ${dur ? `<div class="th-hist-dur">⏱ ${dur}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  detalhe.innerHTML = `
    <div class="th-detalhe-section-title">📊 Ranking</div>
    <div class="ranking-table">
      <div class="rt-head rt-row-player">
        <span>#</span><span>Jogador</span>
        <span>J</span><span>V</span><span>D</span><span>Saldo</span><span>Pts</span>
      </div>${rows}
    </div>
    ${partidas.length > 0 ? `
    <div class="th-detalhe-section-title" style="margin-top:14px;">📋 Partidas</div>
    <div class="th-hist-list">${partidasHTML}</div>
    ` : ''}`;

  // Botão card Instagram
  const instaBtn = document.createElement('button');
  instaBtn.className = 'th-insta-btn';
  instaBtn.textContent = '📸 Card Instagram';
  instaBtn.onclick = (e) => {
    e.stopPropagation();
    gerarCardInstagram({ duplas: t.duplas, date: t.evento_data || t.criado_em, arena: t.evento_nome || t.partidas?.[0]?.arena, criado_em: t.criado_em });
  };
  detalhe.appendChild(instaBtn);

  card.appendChild(detalhe);
}

function closeModal(id='modalFinish') {
  document.getElementById(id).classList.remove('show');
}

// ══════════════════════════════════════════════════════════
//  RESTAURAR DO LOCALSTORAGE
// ══════════════════════════════════════════════════════════
function restoreUI() {
  matchStarted = false;

  document.getElementById('cfgDate').value      = eventDate  || '';
  document.getElementById('cfgEventName').value = eventName  || '';
  document.getElementById('stepDuplas').textContent = numDuplas;
  stepDuplas(0);
  document.querySelectorAll('.tog-btn').forEach(b=>b.classList.toggle('sel',+b.dataset.s===streakLimit));
  document.getElementById('trocaLadoSim').classList.toggle('sel',  trocaLado);
  document.getElementById('trocaLadoNao').classList.toggle('sel', !trocaLado);
  stepDuplas(0);
  buildDuplasGrid();
  duplas.forEach((d,i)=>{
    const a=document.getElementById(`p1_${i}`); if(a) a.value=d.p1;
    const b=document.getElementById(`p2_${i}`); if(b) b.value=d.p2;
  });

  document.getElementById('torneioTimer').textContent = fmtHMS(torneioElapsed);
  startTorneioTimer();
  renderHistorico();
  renderRanking();
  goTab(1);
  renderEventBar();

  if (fase===1 && pendingSet.size===0 && totalMatches>0) {
    showFase1End();
  } else if (fase===2 && fase2Index>=fase2Matches.length) {
    showFase2Paused();
  } else {
    enterMatchArea();
    loadNextMatch();
  }
}

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
document.getElementById('modalFinish').addEventListener('click', e=>{
  if (e.target.id==='modalFinish') closeModal('modalFinish');
});
document.getElementById('modalPull').addEventListener('click', e=>{
  if (e.target.id==='modalPull') closeModal('modalPull');
});
document.getElementById('modalTrocaLado').addEventListener('click', e=>{
  if (e.target.id==='modalTrocaLado') recusarTrocaLado();
});
document.getElementById('modalCreateMatch').addEventListener('click', e=>{
  if (e.target.id==='modalCreateMatch') closeModal('modalCreateMatch');
});
document.getElementById('modalGdEdit').addEventListener('click', e=>{
  if (e.target.id==='modalGdEdit') closeModal('modalGdEdit');
});
document.getElementById('modalGdAdd').addEventListener('click', e=>{
  if (e.target.id==='modalGdAdd') closeModal('modalGdAdd');
});
document.getElementById('modalEscalacao').addEventListener('click', e=>{
  if (e.target.id==='modalEscalacao') closeModal('modalEscalacao');
});

if (loadState()) {
  restoreUI();
  document.getElementById('resetSection').style.display = 'block';
} else {
  buildDuplasGrid();
  document.getElementById('resetSection').style.display = 'none';
  document.getElementById('cfgDate').value = new Date().toISOString().split('T')[0];
}

// ══════════════════════════════════════════════════════════
//  ARENA PICKER
// ══════════════════════════════════════════════════════════
const ARENAS_KEY = 'ftv_arenas';

const ARENAS_DEFAULT = [
  { name: 'Futshow Arena',            city: 'Candeias',                          logo: 'assets/arena/futshow.png' },
  { name: 'Arena Prime Futevôlei',    city: 'Piedade, Jaboatão dos Guararapes',  logo: 'assets/arena/arena_prime.png' },
];

function loadCustomArenas() {
  try { return JSON.parse(localStorage.getItem(ARENAS_KEY)) || []; }
  catch { return []; }
}

function saveCustomArenas(list) {
  localStorage.setItem(ARENAS_KEY, JSON.stringify(list));
}

function renderArenaDropList() {
  const listEl = document.getElementById('arenaDropList');
  const custom = loadCustomArenas();
  listEl.innerHTML = '';

  function arenaLogoHTML(a) {
    if (a.logo) return `<img src="${a.logo}" class="arena-drop-logo" alt="">`;
    return `<span class="arena-drop-logo arena-drop-logo--fallback">🏟️</span>`;
  }

  // Arenas fixas — sem botão de deletar
  ARENAS_DEFAULT.forEach(a => {
    const row = document.createElement('div');
    row.className = 'arena-drop-row';
    const btn = document.createElement('button');
    btn.className = 'arena-drop-item';
    btn.innerHTML = `${arenaLogoHTML(a)}<span class="arena-drop-item-text">${a.name}<span class="arena-city">${a.city}</span></span>`;
    btn.onclick = () => selectArena(a.name);
    row.appendChild(btn);
    listEl.appendChild(row);
  });

  // Arenas customizadas — com botão de deletar
  custom.forEach((a, idx) => {
    const row = document.createElement('div');
    row.className = 'arena-drop-row';
    const btn = document.createElement('button');
    btn.className = 'arena-drop-item';
    btn.innerHTML = `${arenaLogoHTML(a)}<span class="arena-drop-item-text">${a.name}<span class="arena-city">${a.city}</span></span>`;
    btn.onclick = () => selectArena(a.name);
    const del = document.createElement('button');
    del.className = 'arena-drop-delete';
    del.title = 'Remover arena';
    del.textContent = '×';
    del.onclick = (e) => { e.stopPropagation(); deleteCustomArena(idx); };
    row.appendChild(btn);
    row.appendChild(del);
    listEl.appendChild(row);
  });
}

function deleteCustomArena(idx) {
  const list = loadCustomArenas();
  list.splice(idx, 1);
  saveCustomArenas(list);
  renderArenaDropList();
}

function toggleArenaDropdown(e) {
  e.stopPropagation();
  const drop = document.getElementById('arenaDropdown');
  const isOpen = drop.classList.contains('open');
  if (!isOpen) renderArenaDropList();
  drop.classList.toggle('open', !isOpen);
}

function closeArenaDropdown(e) {
  e.stopPropagation();
  document.getElementById('arenaDropdown').classList.remove('open');
}

function selectArena(name) {
  document.getElementById('cfgEventName').value = name;
  document.getElementById('arenaDropdown').classList.remove('open');
}

function openSuggestArena() {
  document.getElementById('arenaDropdown').classList.remove('open');
  document.getElementById('suggestArenaName').value = '';
  document.getElementById('suggestArenaCity').value = '';
  document.getElementById('modalSuggestArena').classList.add('show');
}

function saveSuggestArena() {
  const name = document.getElementById('suggestArenaName').value.trim();
  const city = document.getElementById('suggestArenaCity').value.trim();
  if (!name) { document.getElementById('suggestArenaName').focus(); return; }
  const list = loadCustomArenas();
  list.push({ name, city: city || '' });
  saveCustomArenas(list);
  closeModal('modalSuggestArena');
  reopenArenaDropdown();
}

function cancelSuggestArena() {
  closeModal('modalSuggestArena');
  reopenArenaDropdown();
}

function reopenArenaDropdown() {
  renderArenaDropList();
  document.getElementById('arenaDropdown').classList.add('open');
}

// Fecha dropdown ao clicar fora
document.addEventListener('click', () => {
  document.getElementById('arenaDropdown').classList.remove('open');
});
document.getElementById('modalSuggestArena').addEventListener('click', e => {
  if (e.target.id === 'modalSuggestArena') cancelSuggestArena();
});
document.getElementById('btnSuggestArenaClose').addEventListener('click', e => {
  e.stopPropagation();
  cancelSuggestArena();
});