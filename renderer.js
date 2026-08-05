'use strict';

const $ = (sel) => document.querySelector(sel);
const app = $('#app');

let lastState = null;
let reqType = 'recommended'; // user toggle, persisted across updates

// ---- helpers -------------------------------------------------------------
function band(score) {
  if (score == null) return { color: 'var(--fg-faint)' };
  if (score >= 85) return { color: 'var(--green)' };
  if (score >= 65) return { color: 'var(--lime)' };
  if (score >= 45) return { color: 'var(--amber)' };
  return { color: 'var(--red)' };
}

function show(el, on) {
  if (el) el.hidden = !on;
}

function setMode(state) {
  const modeEl = $('#mode');
  const txt = $('#mode-text');
  modeEl.className = 'mode ' + (state.mode || '');
  const labels = {
    starting: 'INICIANDO',
    cdp: 'CDP',
    fallback: 'FALLBACK',
    setup: 'SETUP',
    'no-steam': 'STEAM OFF',
  };
  txt.textContent = labels[state.mode] || '—';
}

function setGauge(value) {
  const num = $('#gauge-num');
  const arc = $('#gauge-value');
  const needle = $('#needle');
  const verdict = $('#verdict');
  if (value == null) {
    num.textContent = '--';
    arc.setAttribute('stroke-dasharray', '0 100');
    needle.style.transform = 'rotate(0deg)';
    return;
  }
  const v = Math.max(0, Math.min(100, value));
  num.textContent = String(Math.round(v));
  arc.setAttribute('stroke-dasharray', `${v} 100`);
  arc.style.stroke = band(v).color;
  needle.style.transform = `rotate(${(v / 100) * 180}deg)`;
  void verdict; // verdict set by caller
}

function setComponent(name, data) {
  const row = document.querySelector(`.comp[data-c="${name}"]`);
  const scoreEl = row.querySelector('.comp-score');
  const fill = row.querySelector('.bar-fill');
  const detail = row.querySelector('.comp-detail');

  if (!data || !data.identified) {
    row.classList.add('unidentified');
    scoreEl.textContent = '—';
    fill.style.width = '0%';
    fill.style.background = 'var(--fg-faint)';
    let reason = 'não identificado';
    if (data && data.reason === 'requirement-unmatched') reason = 'requisito não reconhecido';
    else if (data && data.reason === 'user-unmatched') reason = 'seu componente fora da tabela';
    else if (data && data.reason === 'user-unknown') reason = 'sua spec desconhecida';
    detail.textContent = reason;
    return;
  }
  row.classList.remove('unidentified');
  const s = data.score;
  scoreEl.textContent = String(s);
  fill.style.width = `${s}%`;
  fill.style.background = band(s).color;

  if (name === 'ram') {
    detail.textContent = `${data.userGB} GB  ·  requer ${data.requiredGB} GB`;
  } else {
    detail.textContent = `${data.userMatch}  ·  requer ${data.requiredMatch}`;
  }
}

function setSections({ game, toggle, gauge, components, message }) {
  show($('#game'), game);
  show($('#toggle'), toggle);
  show($('#gauge-wrap'), gauge);
  show($('#components'), components);
  show($('#message'), message);
  app.classList.toggle('state-only', !gauge && !components);
}

function messageHtml(state) {
  if (state.mode === 'no-steam') {
    return `<h4>STEAM FECHADA</h4>Abra o app desktop da Steam e navegue até a página de um jogo.`;
  }
  if (state.mode === 'setup') {
    if (!state.flagExists) {
      return (
        `<h4>ATIVAR DETECÇÃO AUTOMÁTICA</h4>` +
        `O debug do CEF da Steam está desligado. Clique para criar o arquivo-flag ` +
        `<code>.cef-enable-remote-debugging</code> na pasta da Steam e depois reinicie a Steam.` +
        `<div><button class="msg-btn" data-act="enable">Ativar debug</button></div>`
      );
    }
    return (
      `<h4>REINICIE A STEAM</h4>` +
      `Arquivo-flag criado. Feche a Steam completamente (bandeja do sistema também) e abra de novo ` +
      `para ligar o debug de detecção.` +
      `<div><button class="msg-btn ghost" data-act="folder">Abrir pasta da Steam</button></div>`
    );
  }
  return '';
}

// ---- main render ---------------------------------------------------------
function render(state) {
  lastState = state;
  setMode(state);

  const msgEl = $('#message');
  const retryBtn = $('#btn-retry');
  show(retryBtn, false);

  // 1. starting / specs not ready
  if (state.mode === 'starting' || !state.specs) {
    setSections({ game: false, toggle: false, gauge: false, components: false, message: true });
    msgEl.innerHTML = `<h4>INICIANDO</h4>Detectando specs da máquina…`;
    return;
  }

  // 2. environment states without a game
  if (state.mode === 'no-steam' || state.mode === 'setup') {
    setSections({ game: false, toggle: false, gauge: false, components: false, message: true });
    msgEl.innerHTML = messageHtml(state);
    return;
  }

  // 3. cdp / fallback, no game open
  if (!state.game) {
    setSections({ game: false, toggle: false, gauge: false, components: false, message: true });
    msgEl.innerHTML = `<div class="idle">aguardando jogo na Steam…</div>`;
    return;
  }

  // game present -> header
  $('#game-name').textContent = state.game.title || `App ${state.game.appid}`;
  $('#game-sub').textContent = `APPID ${state.game.appid}` + (state.game.source === 'fallback' ? '  ·  fallback' : '');

  // 4. loading requirements
  if (state.loadingReq) {
    setSections({ game: true, toggle: false, gauge: false, components: false, message: true });
    msgEl.innerHTML = `<div class="idle">carregando requisitos…</div>`;
    return;
  }

  // 5. requirements error / unavailable
  if (state.requirementsError === 'network') {
    setSections({ game: true, toggle: false, gauge: false, components: false, message: true });
    msgEl.innerHTML = `<h4>SEM CONEXÃO</h4>Não deu para buscar a página da loja. Verifique a internet.`;
    show(retryBtn, true);
    return;
  }
  if (state.requirementsError === 'unavailable' || !state.comparison) {
    setSections({ game: true, toggle: false, gauge: false, components: false, message: true });
    msgEl.innerHTML = `<h4>REQUISITOS INDISPONÍVEIS</h4>Este jogo não expõe requisitos de PC (Windows) na loja.`;
    show(retryBtn, true);
    return;
  }

  // 6. full comparison
  const cmp = state.comparison;
  // pick block: honor toggle, but fall back if selected block is missing
  let type = reqType;
  if (!cmp[type]) type = cmp.recommended ? 'recommended' : 'minimum';
  const block = cmp[type];

  // toggle availability
  document.querySelectorAll('.seg').forEach((b) => {
    const t = b.dataset.req;
    b.classList.toggle('active', t === type);
    b.disabled = !cmp[t];
    b.style.opacity = cmp[t] ? '1' : '0.35';
  });

  setSections({ game: true, toggle: true, gauge: true, components: true, message: false });

  setGauge(block.overall);
  $('#verdict').textContent = block.verdict || '';
  $('#verdict').style.color = block.overall == null ? 'var(--fg-dim)' : band(block.overall).color;

  setComponent('gpu', block.components.gpu);
  setComponent('cpu', block.components.cpu);
  setComponent('ram', block.components.ram);
}

// ---- events --------------------------------------------------------------
document.querySelectorAll('.seg').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    reqType = btn.dataset.req;
    if (lastState) render(lastState);
  });
});

$('#message').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'enable') {
    btn.disabled = true;
    btn.textContent = 'criando…';
    await window.api.enableDebug();
    // state push will re-render into the "restart Steam" message
  } else if (act === 'folder') {
    window.api.openSteamFolder();
  }
});

$('#btn-retry').addEventListener('click', () => window.api.retry());
$('#btn-hide').addEventListener('click', () => window.api.hide());
$('#btn-quit').addEventListener('click', () => window.api.quit());

window.api.onState((state) => render(state));

// initial paint before first state arrives
render({ mode: 'starting', specs: null, game: null });
