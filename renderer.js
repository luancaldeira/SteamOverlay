'use strict';

const $ = (sel) => document.querySelector(sel);
const app = $('#app');

let lastState = null;
let reqType = null; // resolved from settings on first state, then user-driven
let settingsOpen = false;
let gaugeShown = 0;
let gaugeAnim = null;

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
  modeEl.title =
    state.mode === 'cdp'
      ? `detecção automática ativa (porta ${state.cdpPort || '?'})`
      : 'modo de detecção';
}

// Count up/down to the new value instead of snapping, so a game switch reads as
// a measurement rather than a flicker.
function animateGauge(target) {
  if (gaugeAnim) cancelAnimationFrame(gaugeAnim);
  const num = $('#gauge-num');
  const from = gaugeShown;
  const to = target;
  const t0 = performance.now();
  const dur = 420;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = from + (to - from) * eased;
    num.textContent = String(Math.round(v));
    if (p < 1) gaugeAnim = requestAnimationFrame(step);
    else {
      gaugeAnim = null;
      gaugeShown = to;
    }
  };
  gaugeAnim = requestAnimationFrame(step);
}

function setGauge(value) {
  const num = $('#gauge-num');
  const arc = $('#gauge-value');
  const needle = $('#needle');
  if (value == null) {
    if (gaugeAnim) cancelAnimationFrame(gaugeAnim);
    gaugeAnim = null;
    gaugeShown = 0;
    num.textContent = '--';
    arc.setAttribute('stroke-dasharray', '0 100');
    needle.style.transform = 'rotate(0deg)';
    return;
  }
  const v = Math.max(0, Math.min(100, value));
  animateGauge(v);
  arc.setAttribute('stroke-dasharray', `${v} 100`);
  arc.style.stroke = band(v).color;
  needle.style.transform = `rotate(${(v / 100) * 180}deg)`;
}

function componentDetail(name, data) {
  if (name === 'ram') return `${data.userGB} GB  ·  requer ${data.requiredGB} GB`;
  let text = `${data.userMatch}  ·  requer ${data.requiredMatch}`;
  if (data.approx) text = `≈ ${text}`;
  if (data.vram) {
    text += `  ·  VRAM ${data.vram.userGB}/${data.vram.requiredGB} GB`;
  }
  return text;
}

function setComponent(name, data) {
  const row = document.querySelector(`.comp[data-c="${name}"]`);
  const scoreEl = row.querySelector('.comp-score');
  const fill = row.querySelector('.bar-fill');
  const detail = row.querySelector('.comp-detail');
  detail.classList.remove('warn');

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
    detail.title = (data && data.required) || '';
    return;
  }
  row.classList.remove('unidentified');
  const s = data.score;
  scoreEl.textContent = String(s);
  fill.style.width = `${s}%`;
  fill.style.background = band(s).color;
  detail.textContent = componentDetail(name, data);
  detail.title = data.required || '';
  if (data.vramCapped) {
    detail.classList.add('warn');
    detail.title = `${detail.title}\nVRAM insuficiente — nota limitada pela memória de vídeo.`;
  }
}

function renderExtras(list) {
  const wrap = $('#extras');
  wrap.textContent = '';
  if (!list || list.length === 0) {
    show(wrap, false);
    return;
  }
  for (const item of list) {
    const el = document.createElement('span');
    el.className = 'chip' + (item.ok === true ? ' ok' : item.ok === false ? ' bad' : '') + (item.soft ? ' soft' : '');
    const mark = item.ok === true ? '✓' : item.ok === false ? '✗' : '·';
    // "64 bits" is both the label and the requirement — don't print it twice
    const what = item.required && item.required !== item.label ? ` ${item.required}` : '';
    el.textContent = `${mark} ${item.label}${what}`;
    el.title = item.user ? `você: ${item.user}` : 'não foi possível verificar';
    wrap.appendChild(el);
  }
  show(wrap, true);
}

function setSections({ art, game, toggle, gauge, components, extras, message }) {
  show($('#art'), art);
  show($('#game'), game);
  show($('#toggle'), toggle);
  show($('#gauge-wrap'), gauge);
  show($('#components'), components);
  show($('#extras'), extras);
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

// ---- settings ------------------------------------------------------------
function syncSettings(prefs) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);
}

function settingsHint(state) {
  const parts = [];
  parts.push(
    state.shortcut
      ? `Atalho global: ${state.shortcut.replace('CommandOrControl', 'Ctrl')}`
      : 'Nenhum atalho global disponível — use o ícone da bandeja.'
  );
  if (state.settings && state.settings.clickThrough) {
    parts.push('Com click-through ligado, desligue pelo menu da bandeja.');
  }
  parts.push(`v${state.version || '?'}`);
  return parts.join('  ·  ');
}

function toggleSettings(on) {
  settingsOpen = on;
  app.classList.toggle('settings-open', on);
  show($('#settings'), on);
  $('#btn-settings').classList.toggle('on', on);
  if (on && lastState) $('#set-hint').textContent = settingsHint(lastState);
}

// ---- main render ---------------------------------------------------------
function render(state) {
  lastState = state;
  setMode(state);

  if (state.settings) {
    if (reqType === null) reqType = state.settings.reqType;
    syncSettings(state.settings);
  }
  show($('#stale-badge'), !!state.stale);

  const msgEl = $('#message');
  const retryBtn = $('#btn-retry');
  show(retryBtn, false);

  const blank = { art: false, game: false, toggle: false, gauge: false, components: false, extras: false };

  if (settingsOpen) {
    $('#set-hint').textContent = settingsHint(state);
    setSections({ ...blank, message: false });
    return;
  }

  // 1. starting / specs not ready
  if (state.mode === 'starting' || !state.specs) {
    setSections({ ...blank, message: true });
    msgEl.innerHTML = `<h4>INICIANDO</h4>Detectando specs da máquina…`;
    return;
  }

  // 2. environment states without a game
  if (state.mode === 'no-steam' || state.mode === 'setup') {
    setSections({ ...blank, message: true });
    msgEl.innerHTML = messageHtml(state);
    return;
  }

  // 3. cdp / fallback, no game open
  if (!state.game) {
    setSections({ ...blank, message: true });
    msgEl.innerHTML = `<div class="idle">aguardando jogo na Steam…</div>`;
    return;
  }

  // game present -> header
  $('#game-name').textContent = state.game.title || `App ${state.game.appid}`;
  const srcTag =
    state.game.source === 'fallback'
      ? '  ·  fallback'
      : state.game.kind === 'library'
        ? '  ·  biblioteca'
        : '';
  $('#game-sub').textContent = `APPID ${state.game.appid}${srcTag}`;

  const hasArt = !!state.artwork;
  if (hasArt) $('#art-img').src = state.artwork;

  // 4. loading requirements
  if (state.loadingReq) {
    setSections({ ...blank, art: hasArt, game: true, message: true });
    msgEl.innerHTML = `<div class="idle">carregando requisitos…</div>`;
    return;
  }

  // 5. requirements error / unavailable
  if (state.requirementsError === 'network') {
    setSections({ ...blank, art: hasArt, game: true, message: true });
    msgEl.innerHTML = `<h4>SEM CONEXÃO</h4>Não deu para consultar a Steam. Verifique a internet.`;
    show(retryBtn, true);
    return;
  }
  if (state.requirementsError === 'no-windows') {
    setSections({ ...blank, art: hasArt, game: true, message: true });
    msgEl.innerHTML = `<h4>SEM VERSÃO WINDOWS</h4>Este título não é distribuído para Windows.`;
    show(retryBtn, true);
    return;
  }
  if (state.requirementsError === 'unavailable' || !state.comparison) {
    setSections({ ...blank, art: hasArt, game: true, message: true });
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

  const extras = (state.extras && state.extras[type]) || [];
  setSections({
    art: hasArt,
    game: true,
    toggle: true,
    gauge: true,
    components: true,
    extras: extras.length > 0,
    message: false,
  });

  setGauge(block.overall);
  const verdictEl = $('#verdict');
  verdictEl.textContent = block.verdict || '';
  if (block.approx) {
    const tag = document.createElement('span');
    tag.className = 'approx-tag';
    tag.textContent = 'ESTIMADO';
    tag.title = 'algum componente foi inferido por família, não por medição direta';
    verdictEl.appendChild(tag);
  }
  verdictEl.style.color = block.overall == null ? 'var(--fg-dim)' : band(block.overall).color;

  setComponent('gpu', block.components.gpu);
  setComponent('cpu', block.components.cpu);
  setComponent('ram', block.components.ram);
  renderExtras(extras);
}

// ---- events --------------------------------------------------------------
document.querySelectorAll('.seg').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    reqType = btn.dataset.req;
    window.api.setSettings({ reqType });
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

$('#settings').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'data') window.api.openDataFolder();
  else if (btn.dataset.act === 'close') toggleSettings(false);
});

$('#set-opacity').addEventListener('input', (e) => {
  const pct = Number(e.target.value);
  $('#set-opacity-val').textContent = `${pct}%`;
  window.api.setSettings({ opacity: pct / 100 });
});
$('#set-ontop').addEventListener('change', (e) => window.api.setSettings({ alwaysOnTop: e.target.checked }));
$('#set-click').addEventListener('change', (e) => window.api.setSettings({ clickThrough: e.target.checked }));
$('#set-compact').addEventListener('change', (e) => window.api.setSettings({ compact: e.target.checked }));
$('#set-art').addEventListener('change', (e) => window.api.setSettings({ showArtwork: e.target.checked }));
$('#set-autostart').addEventListener('change', (e) => window.api.setSettings({ autoStart: e.target.checked }));
$('#set-reqtype').addEventListener('change', (e) => {
  reqType = e.target.value;
  window.api.setSettings({ reqType });
  if (lastState) render(lastState);
});

$('#btn-settings').addEventListener('click', () => toggleSettings(!settingsOpen));
$('#btn-retry').addEventListener('click', () => window.api.retry());
$('#btn-hide').addEventListener('click', () => window.api.hide());
$('#btn-quit').addEventListener('click', () => window.api.quit());

window.api.onState((state) => render(state));

// initial paint before the first push, then reconcile with the real state
render({ mode: 'starting', specs: null, game: null });
window.api.getState().then((s) => s && render(s));
