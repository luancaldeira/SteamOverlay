'use strict';

const $ = (sel) => document.querySelector(sel);
const app = $('#app');

let lastState = null;
let reqType = null; // resolved from settings on first state, then user-driven
let settingsOpen = false;
let readingShown = 0;
let readingAnim = null;
let bootKey = null;
let bootTimer = null;

const BANDS = ['b-ok', 'b-fair', 'b-warn', 'b-bad'];

// ---- helpers -------------------------------------------------------------
// Bandas alinhadas com verdictFor() em lib/compare.js, para que a cor nunca
// contradiga o texto do veredito.
function band(score) {
  if (score == null) return '';
  if (score >= 85) return 'ok';
  if (score >= 65) return 'fair';
  if (score >= 45) return 'warn';
  return 'bad';
}

function setBand(el, name) {
  el.classList.remove(...BANDS);
  if (name) el.classList.add(`b-${name}`);
}

function show(el, on) {
  if (el) el.hidden = !on;
}

// ---- cor extraída da arte -------------------------------------------------
// A arte da loja é a única coisa no app que muda a cada jogo. Em vez de
// decorar com ela, ela passa a mandar na paleta: a cor dominante do banner
// vira o acento da interface inteira. Cyberpunk fica amarelo, Doom vermelho,
// Hades roxo. Nenhum tema fixo consegue isso.
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

const HUE_BUCKETS = 24;
const BUCKET_DEG = 360 / HUE_BUCKETS;

// --alarm fica em ~4°. Uma arte dominada por vermelho (Hades, DOOM Eternal)
// pintaria um "92 · roda tranquilo" da mesma cor de "abaixo do requisito".
// Empurra a matiz para fora da faixa do alarme: vermelho vira laranja ou
// magenta, o que preserva o caráter da arte sem colidir com o sinal de erro.
function keepOffAlarm(h) {
  if (h >= 345) return 334;
  // 30 e não 20: os centros de balde alcançáveis são 8, 23, 38…, então o
  // corte em 20 deixava 23 passar — um banner mais vermelho virava laranja
  // enquanto um menos vermelho continuava vermelho-alaranjado
  if (h <= 30) return 32;
  return h;
}

function accentFromPixels(data) {
  const weight = new Array(HUE_BUCKETS).fill(0);
  const sat = new Array(HUE_BUCKETS).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // ignora cinzas, sombras e estouros: não dizem nada sobre a cor do jogo
    if (s < 0.2 || l < 0.14 || l > 0.9) continue;
    const b = Math.floor(h / BUCKET_DEG) % HUE_BUCKETS;
    const w = s * (1 - Math.abs(l - 0.5) * 1.1);
    weight[b] += w;
    sat[b] += s * w;
  }
  // A matiz é circular mas o histograma não: vermelho fica a cavalo do 0° e
  // cai metade no balde 0, metade no 23. Sem suavizar em anel, uma arte
  // vermelha perde para uma cor secundária que ficou inteira num balde só.
  const smooth = weight.map((w, i) => {
    const prev = weight[(i - 1 + HUE_BUCKETS) % HUE_BUCKETS];
    const next = weight[(i + 1) % HUE_BUCKETS];
    return w + 0.5 * (prev + next);
  });
  let best = -1;
  let bestW = 0;
  for (let i = 0; i < HUE_BUCKETS; i++) {
    if (smooth[i] > bestW) { bestW = smooth[i]; best = i; }
  }
  if (best < 0 || weight[best] < 4) return null;
  const h = keepOffAlarm(Math.round(best * BUCKET_DEG + BUCKET_DEG / 2));
  // normaliza para uma faixa sempre legível sobre fundo escuro — a arte
  // escolhe a matiz, o app garante o contraste
  // divide pelo peso cru do balde, não pelo suavizado: sat[] foi acumulado
  // com o peso cru e misturar os dois deslocaria a média para baixo
  const s = Math.round(Math.min(0.88, Math.max(0.58, sat[best] / weight[best])) * 100);
  return { h, s };
}

function extractAccent(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Tudo dentro do try: com drawImage fora dele, um contexto nulo (perda
      // do processo de GPU) lançava dentro do onload, a promise nunca
      // resolvia e o accentKey ficava travado para sempre.
      try {
        const W = 56;
        const H = 26;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, W, H);
        return resolve(accentFromPixels(ctx.getImageData(0, 0, W, H).data));
      } catch {
        return resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Luminância relativa de --void (#080b10), o fundo contra o qual o acento
// precisa se sustentar como texto.
const VOID_LUM = 0.00329;

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

function contrastOnVoid(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l);
  const lum = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  return (lum + 0.05) / (VOID_LUM + 0.05);
}

// HSL não é perceptualmente uniforme: no mesmo L=62%, amarelo dá 12:1 contra
// o fundo e azul puro dá 3.31:1 — reprova. Em vez de fixar a luminosidade,
// procura a mínima que atinge o alvo e só sobe quando a matiz exige. Amarelo
// segue vibrante em 62%, azul sobe para ~70%.
function accentLightness(h, s, target) {
  let lo = 30;
  let hi = 95;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrastOnVoid(h, s, mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.max(62, Math.ceil(hi));
}

function applyAccent(a) {
  if (!a) {
    ['--accent', '--accent-ink', '--tint'].forEach((p) => app.style.removeProperty(p));
    return;
  }
  const l = accentLightness(a.h, a.s, 4.6);
  app.style.setProperty('--accent', `hsl(${a.h} ${a.s}% ${l}%)`);
  // 8% deixava o texto do pill em 4.43:1 no pior azul; 5% folga o suficiente
  app.style.setProperty('--accent-ink', `hsl(${a.h} ${Math.round(a.s * 0.45)}% 5%)`);
  app.style.setProperty('--tint', `hsl(${a.h} 34% 7%)`);
}

let accentKey = null;
async function syncAccent(key, dataUrl) {
  if (key === accentKey) return;
  accentKey = key;
  if (!dataUrl) return applyAccent(null);
  const a = await extractAccent(dataUrl);
  if (accentKey === key) applyAccent(a);
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

// A troca de jogo é o único momento coreografado do app: em vez de seis
// transições disparando fora de sincronia, uma sequência escalonada. O guard
// por chave é obrigatório porque pushState() no main é frequente.
function bootIfNewGame(key) {
  if (key === bootKey) return;
  bootKey = key;
  if (!key) return;
  app.classList.remove('booting');
  void app.offsetWidth; // reflow: reinicia as animações
  app.classList.add('booting');
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => app.classList.remove('booting'), 950);
}

// Conta até o novo valor em vez de saltar, para que a troca de jogo leia como
// uma medição e não como um flicker.
function animateNumber(target) {
  const num = $('#read-num');
  // main.js empurra estado várias vezes por troca de jogo (a arte chega depois
  // dos requisitos), então repetir o mesmo valor não pode reanimar
  if (readingAnim === null && readingShown === target) {
    num.textContent = String(target);
    return;
  }
  if (readingAnim) cancelAnimationFrame(readingAnim);
  const from = readingShown;
  const t0 = performance.now();
  const dur = 480;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    // readingShown tem que acompanhar cada quadro: se só fosse gravado no fim,
    // uma animação interrompida faria a próxima partir do valor antigo e o
    // número saltaria para trás antes de seguir
    readingShown = Math.round(from + (target - from) * eased);
    num.textContent = String(readingShown);
    if (p < 1) readingAnim = requestAnimationFrame(step);
    else {
      readingAnim = null;
      readingShown = target;
    }
  };
  readingAnim = requestAnimationFrame(step);
}

function setReading(value) {
  const num = $('#read-num');
  const fill = $('#rule-fill');
  const needle = $('#rule-needle');
  setBand(app, band(value));
  if (value == null) {
    if (readingAnim) cancelAnimationFrame(readingAnim);
    readingAnim = null;
    readingShown = 0;
    num.textContent = '--';
    fill.style.setProperty('--v', '0%');
    needle.style.left = '0%';
    return;
  }
  const v = Math.max(0, Math.min(100, value));
  animateNumber(v);
  fill.style.setProperty('--v', `${v}%`);
  needle.style.left = `${v}%`;
}

function componentDetail(name, data) {
  if (name === 'ram') return `${data.userGB} GB · requer ${data.requiredGB} GB`;
  let text = `${data.userMatch} · requer ${data.requiredMatch}`;
  if (data.approx) text = `≈ ${text}`;
  if (data.vram) {
    text += ` · VRAM ${data.vram.userGB}/${data.vram.requiredGB} GB`;
  }
  return text;
}

function unidentifiedReason(data) {
  if (!data) return 'não identificado';
  if (data.reason === 'requirement-unmatched') return 'requisito não reconhecido';
  if (data.reason === 'user-unmatched') return 'seu componente fora da tabela';
  if (data.reason === 'user-unknown') return 'sua spec desconhecida';
  return 'não identificado';
}

// A barra não comunica "a nota" e sim a folga: o traço fixo em --datum (70%) é
// o requisito atendido exatamente, então dá para ver se sobra ou falta.
function setComponent(name, data) {
  const row = document.querySelector(`.comp[data-c="${name}"]`);
  const scoreEl = row.querySelector('.comp-score');
  const fill = row.querySelector('.bar-fill');
  const detail = row.querySelector('.comp-detail');
  detail.classList.remove('warn');

  if (!data || !data.identified) {
    row.classList.add('unidentified');
    setBand(row, '');
    scoreEl.textContent = '—';
    // --v em vez de width: os layouts horizontal e vertical leem o mesmo valor
    fill.style.setProperty('--v', '0%');
    detail.textContent = unidentifiedReason(data);
    detail.title = (data && data.required) || '';
    row.title = detail.title;
    return;
  }
  row.classList.remove('unidentified');
  const s = data.score;
  setBand(row, band(s));
  scoreEl.textContent = String(s);
  fill.style.setProperty('--v', `${s}%`);
  detail.textContent = componentDetail(name, data);
  detail.title = data.required || '';
  row.title = detail.title;
  if (data.vramCapped) {
    detail.classList.add('warn');
    // sem o guard, um `required` nulo deixava a dica começando com quebra de linha
    const aviso = 'VRAM insuficiente — nota limitada pela memória de vídeo.';
    detail.title = detail.title ? `${detail.title}\n${aviso}` : aviso;
    row.title = detail.title;
  }
}

// ---- faixa de leitura dos componentes ------------------------------------
// Os três detalhes ocupam a mesma linha e só um acende. Assim a comparação
// completa fica a um movimento de ponteiro em vez de ocupar três linhas
// permanentes — que era o que deixava a interface poluída.
const COMP_KEYS = ['gpu', 'cpu', 'ram'];
let defaultDetail = 'gpu';

function showDetail(key) {
  for (const el of document.querySelectorAll('.comp')) {
    el.classList.toggle('showing', el.dataset.c === key);
  }
}

function bottleneckOf(block) {
  let worstKey = null;
  let worstScore = Infinity;
  for (const key of COMP_KEYS) {
    const c = block.components[key];
    if (!c || !c.identified) continue;
    if (c.score < worstScore) {
      worstScore = c.score;
      worstKey = key;
    }
  }
  // nenhum identificado: mostra a GPU, cujo motivo de falha é o mais útil
  return worstKey || 'gpu';
}

function bindComponentReadout() {
  for (const el of document.querySelectorAll('.comp')) {
    // foco por teclado revela o mesmo que o ponteiro — informação escondida
    // atrás de hover precisa de um caminho acessível
    el.tabIndex = 0;
    el.addEventListener('mouseenter', () => showDetail(el.dataset.c));
    el.addEventListener('focus', () => showDetail(el.dataset.c));
    el.addEventListener('blur', () => showDetail(defaultDetail));
  }
  $('#components').addEventListener('mouseleave', () => showDetail(defaultDetail));
}

// Modo compacto esconde as barras, então o resumo de uma linha mantém a
// resposta "por que essa nota?" acessível sem abrir o app inteiro.
function renderDigest(block) {
  const wrap = $('#digest');
  wrap.textContent = '';
  for (const [key, label] of [['gpu', 'GPU'], ['cpu', 'CPU'], ['ram', 'RAM']]) {
    const c = block.components[key];
    const cell = document.createElement('div');
    cell.className = 'dg';
    if (c && c.identified) setBand(cell, band(c.score));
    const l = document.createElement('span');
    l.className = 'dg-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'dg-val';
    v.textContent = c && c.identified ? String(c.score) : '—';
    cell.append(l, v);
    wrap.appendChild(cell);
  }
}

// ✓ e ✗ não existem na Martian Mono — o navegador cai numa fonte de sistema e
// os glifos desalinham. Desenhados, ficam nítidos e do tamanho certo.
const MARKS = {
  ok: 'M1.5 5.2 4 7.6 8.5 2.4',
  bad: 'M2 2.4 8 8M8 2.4 2 8',
  unknown: 'M2.2 5.2h5.6',
};

function markSvg(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('class', 'chip-mark');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', MARKS[kind]);
  svg.appendChild(p);
  return svg;
}

function renderExtras(list) {
  const wrap = $('#extras');
  wrap.textContent = '';
  if (!list || list.length === 0) {
    show(wrap, false);
    return;
  }
  list.forEach((item, i) => {
    const el = document.createElement('span');
    el.className = 'chip' + (item.ok === true ? ' ok' : item.ok === false ? ' bad' : '') + (item.soft ? ' soft' : '');
    // "64 bits" é rótulo e requisito ao mesmo tempo — não imprimir duas vezes
    const what = item.required && item.required !== item.label ? ` ${item.required}` : '';
    el.appendChild(markSvg(item.ok === true ? 'ok' : item.ok === false ? 'bad' : 'unknown'));
    el.appendChild(document.createTextNode(`${item.label}${what}`));
    el.title = item.user ? `você: ${item.user}` : 'não foi possível verificar';
    el.style.animationDelay = `${420 + i * 25}ms`;
    wrap.appendChild(el);
  });
  show(wrap, true);
}

function setSections({ art, artSlot, head, reading, toggle, components, extras, message, bare }) {
  show($('#art'), art);
  // `has-art` reserva os 108px do cabeçalho. Ele segue o slot, não a imagem
  // decodificada: a arte chega num push posterior ao dos requisitos, e
  // amarrá-lo ao data URL fazia o layout inteiro descer 98px no meio do
  // caminho, empurrando os chips para fora da janela.
  app.classList.toggle('has-art', artSlot === undefined ? !!art : !!artSlot);
  show($('#head'), head);
  app.classList.toggle('has-reading', !!reading);
  if (!reading) setBand(app, '');
  show($('#toggle'), toggle);
  show($('#components'), components);
  show($('#digest'), components);
  show($('#extras'), extras);
  show($('#message'), message);
  $('#message').classList.toggle('bare', !!bare);
  // Estado sem contexto de jogo: centraliza a mensagem e apaga o resto.
  app.classList.toggle('state-only', !head);
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

// Ficha da máquina. Sem jogo aberto o app tinha 400px de vazio; as specs já
// estão em state.specs e são a coisa mais útil que ele sabe nesse momento.
function rigRows(s) {
  const rows = [];
  if (s.gpuDisplay || s.gpu) {
    rows.push(['GPU', s.gpuDisplay || s.gpu, s.gpuVramMB ? `${Math.round(s.gpuVramMB / 1024)} GB VRAM` : '']);
  }
  if (s.cpuDisplay || s.cpu) {
    const bits = [];
    if (s.cpuCores) bits.push(`${s.cpuCores}C${s.cpuThreads ? `/${s.cpuThreads}T` : ''}`);
    if (s.cpuGHz) bits.push(`${s.cpuGHz} GHz`);
    rows.push(['CPU', s.cpuDisplay || s.cpu, bits.join(' · ')]);
  }
  if (s.ramGB) rows.push(['RAM', `${s.ramGB} GB`, '']);
  const os = [];
  if (s.windowsVersion) os.push(`Windows ${s.windowsVersion}`);
  if (s.directX) os.push(`DirectX ${s.directX}`);
  if (s.arch) os.push(s.arch);
  if (os.length) rows.push(['SO', os.join(' · '), '']);
  if (s.freeDiskGB) rows.push(['DISCO', `${Math.round(s.freeDiskGB)} GB livres`, '']);
  return rows;
}

function rigSheet(specs) {
  const rows = rigRows(specs);
  if (rows.length === 0) return null;
  const box = document.createElement('div');
  box.className = 'rig';
  const title = document.createElement('div');
  title.className = 'rig-title';
  title.textContent = 'SUA MÁQUINA';
  box.appendChild(title);
  for (const [key, val, sub] of rows) {
    const row = document.createElement('div');
    row.className = 'rig-row';
    const k = document.createElement('span');
    k.className = 'rig-key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'rig-val';
    v.textContent = val;
    if (sub) {
      const s = document.createElement('i');
      s.className = 'rig-sub';
      s.textContent = sub;
      v.appendChild(s);
    }
    row.append(k, v);
    box.appendChild(row);
  }
  return box;
}

// Instrumento em repouso. É a tela mais vista do app — ela leva a agulha
// varrendo a escala em vez de uma linha de texto cinza.
function renderIdle(text, specs) {
  const msgEl = $('#message');
  msgEl.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'idle';
  const scan = document.createElement('div');
  scan.className = 'idle-scan';
  const label = document.createElement('div');
  label.className = 'idle-text';
  label.textContent = text;
  wrap.append(scan, label);
  const sheet = specs ? rigSheet(specs) : null;
  if (sheet) wrap.appendChild(sheet);
  msgEl.appendChild(wrap);
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
    parts.push(
      state.clickThroughShortcut
        ? `Click-through ligado — ${state.clickThroughShortcut.replace('CommandOrControl', 'Ctrl')} desliga.`
        : 'Com click-through ligado, desligue pelo menu da bandeja.'
    );
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
  // Ao fechar é preciso repintar: enquanto o painel esteve aberto o estado
  // pode ter mudado várias vezes sem que nada fosse renderizado.
  if (!on && lastState) render(lastState);
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

  const blank = { art: false, head: false, reading: false, toggle: false, components: false, extras: false };

  if (settingsOpen) {
    $('#set-hint').textContent = settingsHint(state);
    // Não apagar as seções aqui: `.settings-open` no CSS já esconde todas, e
    // marcá-las com [hidden] deixava o corpo vazio depois de fechar o painel.
    return;
  }

  // 1. iniciando / specs ainda não prontas
  if (state.mode === 'starting' || !state.specs) {
    bootIfNewGame(null);
    syncAccent(null, null);
    setSections({ ...blank, message: true, bare: true });
    renderIdle('detectando specs da máquina…', null);
    return;
  }

  // 2. estados de ambiente sem jogo
  if (state.mode === 'no-steam' || state.mode === 'setup') {
    bootIfNewGame(null);
    syncAccent(null, null);
    setSections({ ...blank, message: true });
    msgEl.innerHTML = messageHtml(state);
    return;
  }

  // 3. cdp / fallback, nenhum jogo aberto
  if (!state.game) {
    bootIfNewGame(null);
    syncAccent(null, null);
    setSections({ ...blank, message: true, bare: true });
    renderIdle('aguardando jogo na Steam…', state.specs);
    return;
  }

  // jogo presente -> cabeçalho
  $('#game-name').textContent = state.game.title || `App ${state.game.appid}`;
  const srcTag =
    state.game.source === 'fallback'
      ? ' · fallback'
      : state.game.kind === 'library'
        ? ' · biblioteca'
        : '';
  $('#game-sub').textContent = `APPID ${state.game.appid}${srcTag}`;

  const hasArt = !!state.artwork;
  // O slot da arte é reservado assim que existe um jogo e a preferência está
  // ligada — a imagem em si chega num push posterior. Amarrar o espaço à
  // imagem decodificada fazia o layout descer 98px no meio do caminho.
  const artSlot = !!(state.settings ? state.settings.showArtwork : true);
  if (hasArt) $('#art-img').src = state.artwork;
  // a arte chega depois do jogo, então a chave inclui se ela já veio
  syncAccent(`${state.game.appid}:${hasArt ? 1 : 0}`, state.artwork);

  // 4. carregando requisitos
  if (state.loadingReq) {
    setSections({ ...blank, art: hasArt, artSlot, head: true, message: true, bare: true });
    // sem isto o contador do próximo jogo partiria da nota do jogo anterior
    setReading(null);
    renderIdle('carregando requisitos…', null);
    return;
  }

  // 5. erro / requisitos indisponíveis
  const errors = {
    network: ['SEM CONEXÃO', 'Não deu para consultar a Steam. Verifique a internet.'],
    'no-windows': ['SEM VERSÃO WINDOWS', 'Este título não é distribuído para Windows.'],
    unavailable: ['REQUISITOS INDISPONÍVEIS', 'Este jogo não expõe requisitos de PC (Windows) na loja.'],
  };
  const err = errors[state.requirementsError] || (!state.comparison ? errors.unavailable : null);
  if (err) {
    setSections({ ...blank, art: hasArt, artSlot, head: true, message: true });
    msgEl.innerHTML = `<h4>${err[0]}</h4>${err[1]}`;
    setReading(null);
    show(retryBtn, true);
    return;
  }

  // 6. comparação completa
  const cmp = state.comparison;
  // respeita o toggle, mas cai para o bloco existente se o escolhido faltar
  let type = reqType;
  if (!cmp[type]) type = cmp.recommended ? 'recommended' : 'minimum';
  const block = cmp[type];

  document.querySelectorAll('.seg').forEach((b) => {
    const t = b.dataset.req;
    b.classList.toggle('active', t === type);
    b.disabled = !cmp[t];
    b.style.opacity = cmp[t] ? '1' : '0.35';
  });

  const extras = (state.extras && state.extras[type]) || [];
  setSections({
    art: hasArt,
    artSlot,
    head: true,
    // sem nota, a régua sai de cena: agulha em 0% com "--" lia igual a uma
    // nota 0 ("abaixo do requisito") e contradizia o veredito
    reading: block.overall != null,
    toggle: true,
    components: true,
    extras: extras.length > 0,
    message: false,
  });

  setReading(block.overall);
  const verdictEl = $('#verdict');
  verdictEl.textContent = block.verdict || '';
  if (block.approx) {
    const tag = document.createElement('span');
    tag.className = 'approx-tag';
    tag.textContent = 'ESTIMADO';
    tag.title = 'algum componente foi inferido por família, não por medição direta';
    verdictEl.appendChild(tag);
  }

  setComponent('gpu', block.components.gpu);
  setComponent('cpu', block.components.cpu);
  setComponent('ram', block.components.ram);
  // Sem ponteiro, a faixa de leitura mostra o gargalo — a menor nota é a
  // resposta mais útil para "o que está me segurando".
  defaultDetail = bottleneckOf(block);
  if (!$('#components').matches(':hover')) showDetail(defaultDetail);
  renderDigest(block);
  renderExtras(extras);

  bootIfNewGame(`${state.game.source}:${state.game.appid}`);
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
    // o push de estado re-renderiza na mensagem de "reinicie a Steam"
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

bindComponentReadout();

window.api.onState((state) => render(state));

// pintura inicial antes do primeiro push, depois reconcilia com o estado real
render({ mode: 'starting', specs: null, game: null });
window.api.getState().then((s) => s && render(s));
