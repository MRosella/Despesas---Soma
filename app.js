'use strict';

/* ============================================================
   Lançamentos de Despesas — Soma Urbanismo
   Armazena lançamentos no celular e gera o relatório
   em Excel (idêntico ao modelo) e PDF.
   ============================================================ */

const STORE_KEY = 'despesas-soma-v1';
const SYNC_KEY = 'despesas-soma-sync-v1';
const LASTSYNC_KEY = 'despesas-soma-lastsync-v1';
const APP_VERSION = 'v24';   // manter igual ao CACHE em sw.js
const LOCK_KEY = 'despesas-soma-lock-v1';
const THEME_KEY = 'despesas-soma-theme-v1';
const EMPRESA = 'Soma Urbanismo S/A';

/* Categorias e limites — padrão de fábrica. A configuração efetiva fica em
   state.config.categorias (editável em Configurações e sincronizada como o perfil). */
const DEFAULT_CATEGORIAS = [
  { nome: 'Café da Manha', limite: 30, grupo: 'Alimentação' },
  { nome: 'Almoço', limite: 70, grupo: 'Alimentação' },
  { nome: 'Café da Tarde', limite: 30, grupo: 'Alimentação' },
  { nome: 'Jantar', limite: 70, grupo: 'Alimentação' },
  { nome: 'Combustível', limite: 0, grupo: 'Combustível' },
  { nome: 'Pedágio', limite: 0, grupo: 'Pedágio' },
  { nome: 'Outras Despesas', limite: 0, grupo: 'Outras Despesas' }
];

function normalizeCatConfig(cfg) {
  const arr = (cfg && Array.isArray(cfg.categorias)) ? cfg.categorias : null;
  const list = (arr && arr.length)
    ? arr.map((c) => ({ nome: String(c.nome || '').trim(), limite: +c.limite || 0, grupo: (c.grupo || c.nome || '').trim() }))
         .filter((c) => c.nome)
    : DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c));
  return { categorias: list.length ? list : DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)) };
}
function getCatConfig() { return (state.config && Array.isArray(state.config.categorias) && state.config.categorias.length) ? state.config.categorias : DEFAULT_CATEGORIAS; }
function getCategorias() { return getCatConfig().map((c) => c.nome); }
function catByName(nome) { return getCatConfig().find((c) => c.nome === nome) || null; }
function limiteDaCategoria(nome) { const c = catByName(nome); return (c && c.limite) ? c.limite : 0; }
function grupoDaCategoria(nome) { const c = catByName(nome); return (c && c.grupo) || nome || ''; }
/* Texto de observação de limites para o PDF — agrupa categorias por valor de limite. */
function limitsObsText() {
  const byLim = {};
  getCatConfig().forEach((c) => { if (c.limite > 0) (byLim[c.limite] = byLim[c.limite] || []).push(c.nome); });
  const parts = Object.keys(byLim).map((l) => byLim[l].join(' e ') + ': ' + formatMoney(+l) + ' cada');
  return parts.length ? ('Os valores máximos reembolsáveis são — ' + parts.join('; ') + '.') : '';
}

/* ---------------- Estado ---------------- */
function emptyState() {
  return {
    funcionario: '',
    dataSolicitacao: '',
    referente: '',
    reportMonth: '',                      // mês de referência (YYYY-MM): pasta única dos comprovantes no Drive
    bank: { nome: '', cpf: '', banco: '', agencia: '', conta: '', pix: '' },
    reembolso: [],
    alelo: [],
    history: [],                          // meses arquivados (snapshots)
    histTomb: {},                         // lápides do histórico: id -> ts
    driveFolderId: '',                    // (legado) pasta única dos comprovantes; migra p/ a raiz de reembolso
    driveFolders: { reembolso: '', alelo: '' },  // pastas raiz separadas no Drive (sincronizadas)
    config: { categorias: DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)) },  // categorias + limites
    tomb: { reembolso: {}, alelo: {} },   // lápides: id -> updatedAt (deleções)
    meta: { updatedAt: 0, profileUpdatedAt: 0 }
  };
}

let state = loadState();
let applyingRemote = false;   // true enquanto aplicamos dados vindos da nuvem

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const base = emptyState();
    const st = Object.assign(base, s, {
      bank: Object.assign(base.bank, s.bank || {}),
      tomb: Object.assign(base.tomb, s.tomb || {}),
      meta: Object.assign(base.meta, s.meta || {})
    });
    st.tomb.reembolso = st.tomb.reembolso || {};
    st.tomb.alelo = st.tomb.alelo || {};
    st.history = Array.isArray(st.history) ? st.history : [];
    st.histTomb = st.histTomb || {};
    st.driveFolderId = st.driveFolderId || '';
    st.driveFolders = Object.assign({ reembolso: '', alelo: '' }, st.driveFolders || {});
    if (!st.driveFolders.reembolso && st.driveFolderId) st.driveFolders.reembolso = st.driveFolderId;   // migração: raiz legada vira a de reembolso
    st.config = normalizeCatConfig(st.config);
    // migração: garante updatedAt nas entradas e relógio do doc se for estado antigo
    for (const t of ['reembolso', 'alelo']) {
      st[t] = (st[t] || []).map((e) => e.updatedAt ? e : Object.assign({}, e, { updatedAt: Date.now() }));
    }
    if (!s.meta) st.meta = { updatedAt: Date.now(), profileUpdatedAt: Date.now() };
    return st;
  } catch (e) {
    return emptyState();
  }
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  if (!applyingRemote) { setDirty(true); scheduleSync(); }
}

function touchDoc() { state.meta.updatedAt = Date.now(); }
function touchProfile() { const t = Date.now(); state.meta.updatedAt = t; state.meta.profileUpdatedAt = t; }

/* ---------------- Utilidades ---------------- */
const $ = (id) => document.getElementById(id);

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function formatMoney(n) { return brl.format(n || 0); }

function parseMoney(s) {
  if (typeof s === 'number') return s;
  s = (s || '').toString().trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function fmtDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dateToSerial(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const base = Date.UTC(1899, 11, 30);
  return Math.round((ms - base) / 86400000);
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function sumOf(list) { return list.reduce((a, e) => a + (e.valor || 0), 0); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- Ícones (SVG inline, estilo Lucide) ---------------- */
const ICONS = {
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
};
function icon(name, size) {
  const p = ICONS[name]; if (!p) return '';
  const s = size || 20;
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function setupIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (el._icon === name) return;
    const sz = parseInt(el.getAttribute('data-size') || '', 10) || 20;
    el.innerHTML = icon(name, sz);
    el._icon = name;
  });
}

let lastAddedId = null;   // destaca o item recém-criado

/* ---------------- Renderização ---------------- */
function render() {
  $('funcionario').value = state.funcionario;
  $('dataSolicitacao').value = state.dataSolicitacao;
  $('referente').value = state.referente;
  if ($('reportMonth')) $('reportMonth').value = state.reportMonth || '';
  $('bk-nome').value = state.bank.nome;
  $('bk-cpf').value = state.bank.cpf;
  $('bk-banco').value = state.bank.banco;
  $('bk-agencia').value = state.bank.agencia;
  $('bk-conta').value = state.bank.conta;
  $('bk-pix').value = state.bank.pix;

  renderList('reembolso', $('list-reembolso'));
  renderList('alelo', $('list-alelo'));

  const s1 = sumOf(state.reembolso), s2 = sumOf(state.alelo);
  $('sum-reembolso').textContent = formatMoney(s1);
  $('sum-alelo').textContent = formatMoney(s2);
  $('total-geral').textContent = formatMoney(s1 + s2);

  renderCatSummary();
  renderReports();
  if (typeof updateGdPending === 'function') updateGdPending();
}

/* ---------------- Histórico de meses ---------------- */
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function monthLabelFor(src) {
  let iso = src.dataSolicitacao;
  if (!iso) {
    const all = (src.reembolso || []).concat(src.alelo || []);
    const datas = all.map((e) => e.data).filter(Boolean).sort();
    iso = datas[0] || '';
  }
  if (iso) {
    const [y, m] = iso.split('-');
    return (MESES_ABREV[parseInt(m, 10) - 1] || '') + '/' + y;
  }
  return new Date().toLocaleDateString('pt-BR');
}

function yearOf(h) {
  let iso = h.dataSolicitacao;
  if (!iso) {
    const all = (h.reembolso || []).concat(h.alelo || []);
    iso = all.map((e) => e.data).filter(Boolean).sort()[0] || '';
  }
  if (iso) return iso.slice(0, 4);
  if (h.archivedAt) return String(new Date(h.archivedAt).getFullYear());
  return '—';
}

/* Relatórios mensais — navegação por ano e mês */
function renderReports() {
  const tree = $('reports-tree'); const empty = $('reports-empty');
  if (!tree) return;
  if (!state.history.length) { tree.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const byYear = {};
  for (const h of state.history) { const y = yearOf(h); (byYear[y] = byYear[y] || []).push(h); }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  let html = '';
  for (const y of years) {
    const items = byYear[y].sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    const yTotal = items.reduce((s, h) => s + sumOf(h.reembolso || []) + sumOf(h.alelo || []), 0);
    html += `<details class="card rep-year" open>
      <summary><span class="rep-year-lbl">${escapeHtml(y)}</span><span class="rep-year-meta">${items.length} mês(es) · ${formatMoney(yTotal)}</span></summary>
      <ul class="hist-list">`;
    for (const h of items) {
      const qtd = (h.reembolso || []).length + (h.alelo || []).length;
      const total = sumOf(h.reembolso || []) + sumOf(h.alelo || []);
      html += `<li class="hist-item" data-id="${h.id}">
        <div class="hist-main">
          <div class="hist-label">${escapeHtml(h.label || 'Mês')}</div>
          <div class="hist-meta">${qtd} lançamento(s) · ${formatMoney(total)}</div>
        </div>
        <div class="hist-actions">
          <button class="hist-btn" data-act="xls">Excel</button>
          <button class="hist-btn" data-act="pdf">PDF</button>
          <button class="hist-btn" data-act="open">Reabrir</button>
          <button class="hist-btn danger" data-act="del" title="Excluir do histórico">✕</button>
        </div></li>`;
    }
    html += '</ul></details>';
  }
  tree.innerHTML = html;

  tree.querySelectorAll('.hist-item').forEach((li) => {
    const id = li.dataset.id;
    const get = () => state.history.find((x) => x.id === id);
    li.querySelector('[data-act=xls]').addEventListener('click', () => openExportChooser('excel', get()));
    li.querySelector('[data-act=pdf]').addEventListener('click', () => openExportChooser('pdf', get()));
    li.querySelector('[data-act=open]').addEventListener('click', () => reopenHistory(id));
    li.querySelector('[data-act=del]').addEventListener('click', () => deleteHistory(id));
  });
}

function reopenHistory(id) {
  const h = state.history.find((x) => x.id === id); if (!h) return;
  if (state.reembolso.length || state.alelo.length) {
    if (!confirm('Reabrir este mês vai SUBSTITUIR os lançamentos atuais (que não foram arquivados). Continuar?')) return;
  }
  const now = Date.now();
  for (const t of ['reembolso', 'alelo']) { for (const e of state[t]) state.tomb[t][e.id] = now; }
  state.funcionario = h.funcionario || state.funcionario;
  state.dataSolicitacao = h.dataSolicitacao || '';
  state.referente = h.referente || state.referente;
  state.reportMonth = h.reportMonth || '';
  state.bank = Object.assign(emptyState().bank, h.bank || {});
  // novos ids p/ não colidir com o snapshot nem com lápides antigas
  state.reembolso = (h.reembolso || []).map((e) => Object.assign({}, e, { id: uid(), updatedAt: now }));
  state.alelo = (h.alelo || []).map((e) => Object.assign({}, e, { id: uid(), updatedAt: now }));
  touchProfile(); touchDoc();
  saveState(); render();
  showView('lancamentos');
  toast('Mês reaberto para edição.');
}

function deleteHistory(id) {
  if (!confirm('Excluir este mês do histórico? Não dá para desfazer.')) return;
  state.history = state.history.filter((h) => h.id !== id);
  state.histTomb[id] = Date.now();
  touchDoc();
  saveState(); render();
  toast('Mês removido do histórico.');
}

/* Resumo por categoria — SOMENTE para visualização no app (não vai p/ Excel/PDF) */
function renderCatSummary() {
  const card = $('cat-summary-card'); const box = $('cat-summary');
  if (!card || !box) return;
  const all = state.reembolso.concat(state.alelo);
  if (!all.length) { card.style.display = 'none'; box.innerHTML = ''; return; }
  const map = {};
  for (const e of all) { const c = e.categoria || '—'; map[c] = (map[c] || 0) + (e.valor || 0); }
  const arr = Object.keys(map).map((c) => [c, map[c]]).sort((a, b) => b[1] - a[1]);
  box.innerHTML = arr.map(([cat, val]) =>
    `<span class="cat-chip"><span class="cc-name">${escapeHtml(cat)}</span><span class="cc-val">${formatMoney(val)}</span></span>`
  ).join('');
  card.style.display = '';
}

function emptyStateEl() {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.innerHTML = `<span class="empty-ic" data-icon="receipt" data-size="40"></span>
    <div class="empty-title">Nenhum lançamento ainda</div>
    <div class="empty-sub">Toque em “Adicionar” para registrar o primeiro.</div>`;
  return li;
}

function renderList(tabela, ul) {
  const all = state[tabela].slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));   // exibe mais recente no topo (estado/relatório seguem cronológicos)
  ul.innerHTML = '';
  if (!all.length) { ul.appendChild(emptyStateEl()); setupIcons(ul); return; }

  for (const e of all) {
    const over = limitExcedido(e);
    const li = document.createElement('li');
    li.className = 'entry' + (e.id === lastAddedId ? ' added' : '') + (over ? ' over-limit' : '');
    li.dataset.id = e.id;
    li.dataset.tabela = tabela;
    li.innerHTML = `
      <div class="e-main">
        <div class="e-desc">${escapeHtml(e.descricao || '(sem descrição)')}</div>
        <div class="e-meta"><span class="cat-tag">${escapeHtml(e.categoria || '—')}</span>${fmtDateBR(e.data)}${e.foto ? ' <img class="e-thumb" data-eid="' + escapeHtml(e.id) + '" alt="comprovante" hidden> <span class="e-clip" data-icon="paperclip" data-size="14" title="Comprovante anexado"></span>' : ''}</div>
      </div>
      <div class="e-val">${formatMoney(e.valor)}</div>
      <div class="e-quick">
        <button class="qbtn" data-q="dup" title="Duplicar" aria-label="Duplicar lançamento" data-icon="copy" data-size="18"></button>
        <button class="qbtn danger" data-q="del" title="Excluir" aria-label="Excluir lançamento" data-icon="trash-2" data-size="18"></button>
      </div>`;
    li.addEventListener('click', (ev) => { if (!ev.target.closest('.e-quick') && !ev.target.closest('.e-clip') && !ev.target.closest('.e-thumb')) openModal(tabela, e.id); });
    li.querySelector('[data-q=dup]').addEventListener('click', () => quickDuplicate(tabela, e.id));
    li.querySelector('[data-q=del]').addEventListener('click', () => quickDelete(tabela, e.id));
    const clip = li.querySelector('.e-clip'); if (clip) clip.addEventListener('click', (ev) => { ev.stopPropagation(); viewPhoto(e.foto, e.id); });
    const thumb = li.querySelector('.e-thumb'); if (thumb) thumb.addEventListener('click', (ev) => { ev.stopPropagation(); viewPhoto(e.foto, e.id); });
    ul.appendChild(li);
  }
  setupIcons(ul);
  hydrateThumbs(ul);
}

/* mostra as miniaturas locais (IndexedDB) nos itens que têm comprovante */
async function hydrateThumbs(ul) {
  const imgs = ul.querySelectorAll('img.e-thumb[data-eid]');
  for (const img of imgs) {
    try {
      const url = await idbGet('thumb_' + img.dataset.eid);
      if (url) { img.src = url; img.hidden = false; const clip = img.nextElementSibling; if (clip && clip.classList.contains('e-clip')) clip.style.display = 'none'; }
    } catch (e) { /* mantém o clipe como fallback */ }
  }
}

/* limite de reembolso por categoria (apenas aviso visual) */
function limitExcedido(e) {
  const lim = limiteDaCategoria(e.categoria);
  return lim ? (e.valor || 0) > lim : false;
}

function quickDuplicate(tabela, id) {
  const e = state[tabela].find((x) => x.id === id); if (!e) return;
  const now = Date.now();
  const copy = { id: uid(), data: todayISO(), descricao: e.descricao, categoria: e.categoria, valor: e.valor, updatedAt: now };
  state[tabela].push(copy);
  state[tabela].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  lastAddedId = copy.id;
  touchDoc(); saveState(); render();
  setTimeout(() => { lastAddedId = null; }, 900);
  toast('Lançamento duplicado.');
}

async function quickDelete(tabela, id) {
  const entry = state[tabela].find((x) => x.id === id);
  const temFoto = !!(entry && entry.foto);
  const msg = temFoto
    ? 'Excluir este lançamento? O comprovante anexado também será removido do Google Drive.'
    : 'Excluir este lançamento?';
  if (!confirm(msg)) return;
  if (entry) { try { await purgeEntryPhoto(entry); } catch (e) { console.error(e); } }   // apaga foto no Drive/fila/miniatura
  state[tabela] = state[tabela].filter((x) => x.id !== id);
  state.tomb[tabela][id] = Date.now();
  touchDoc(); saveState(); render();
  toast('Lançamento excluído.');
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Modal de lançamento ---------------- */
function openModal(tabela, id, prefill) {
  $('m-tabela').value = tabela;
  $('m-id').value = id || '';
  const isEdit = !!id;
  $('modal-title').textContent = isEdit ? 'Editar lançamento' : 'Novo lançamento';
  $('m-delete').style.display = isEdit ? 'block' : 'none';
  $('m-duplicate').style.display = isEdit ? 'block' : 'none';

  let entry = { data: todayISO(), descricao: '', categoria: '', valor: '' };
  if (isEdit) entry = state[tabela].find((e) => e.id === id) || entry;
  else if (prefill) entry = Object.assign({ data: todayISO() }, prefill);

  $('m-data').value = entry.data || todayISO();
  $('m-descricao').value = entry.descricao || '';
  $('m-categoria').value = entry.categoria || '';
  $('m-valor').value = entry.valor ? formatMoneyInput(entry.valor) : '';
  updateCatHint();

  resetModalPhoto(isEdit ? (entry.foto || null) : null);
  renderModalPhoto();

  $('modal').classList.add('open');
  setTimeout(() => $('m-descricao').focus(), 150);
}

function closeModal() { $('modal').classList.remove('open'); }

/* ---- comprovante no modal ---- */
let modalPhoto = { mode: 'keep', existing: null, blob: null, dataUrl: null, w: 0, h: 0 };
function resetModalPhoto(existing) { modalPhoto = { mode: 'keep', existing: existing || null, blob: null, dataUrl: null, w: 0, h: 0 }; }
function renderModalPhoto() {
  const attach = $('m-foto-attach'), prev = $('m-foto-preview');
  if (!attach || !prev) return;
  const has = modalPhoto.mode === 'new' || (modalPhoto.mode === 'keep' && modalPhoto.existing);
  attach.style.display = has ? 'none' : '';
  prev.style.display = has ? '' : 'none';
  const thumb = $('m-foto-thumb');
  if (modalPhoto.mode === 'new') {
    if (modalPhoto.kind === 'pdf') {
      thumb.style.display = 'none';
      $('m-foto-label').textContent = 'PDF pronto para enviar';
    } else {
      thumb.src = modalPhoto.dataUrl; thumb.style.display = '';
      $('m-foto-label').textContent = 'Comprovante pronto para enviar';
    }
    $('m-foto-view').style.display = 'none';
  } else if (modalPhoto.existing) {
    thumb.style.display = 'none';
    $('m-foto-label').textContent = modalPhoto.existing.pending ? 'Comprovante anexado (envio pendente)' : 'Comprovante anexado';
    $('m-foto-view').style.display = '';
  }
}
async function onPhotoSelected(file) {
  if (!file) return;
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      modalPhoto = { mode: 'new', kind: 'pdf', existing: modalPhoto.existing, blob: file, dataUrl: null, w: 0, h: 0 };
      renderModalPhoto();
      if (aiConfigured()) await runReceiptOcr();
      return;
    }
    toast('Processando imagem…');
    const { blob, w, h } = await compressImage(file);
    modalPhoto = { mode: 'new', kind: 'img', existing: modalPhoto.existing, blob, dataUrl: await blobToDataUrl(blob), w, h };
    renderModalPhoto();
    if (aiConfigured()) await runReceiptOcr();
  } catch (e) { console.error(e); toast('Erro no arquivo: ' + e.message); }
}
async function applyModalPhoto(entry) {
  if (modalPhoto.mode === 'keep') return;
  if (modalPhoto.mode === 'remove') { entry.foto = null; idbDel('thumb_' + entry.id).catch(() => {}); return; }   // só desvincula (não apaga do Drive)
  saveThumb(entry.id, modalPhoto.blob);   // miniatura local p/ a lista (não sincroniza)
  const name = receiptFileName(entry);
  const tabela = $('m-tabela').value;     // raiz do Drive depende da tabela (reembolso / cartão)
  if (gdConfigured() && gdConnected()) {
    try {
      toast('Enviando comprovante ao Drive…');
      const fid = await gdUpload(modalPhoto.blob, name, reportFolderDateISO() || entry.data, tabela);
      entry.foto = { id: fid, name, w: modalPhoto.w, h: modalPhoto.h };
      return;
    } catch (e) { console.error(e); }
  }
  const localId = uid();
  await idbPut('p_' + localId, { blob: modalPhoto.blob, name, data: entry.data, tabela });
  entry.foto = { pending: localId, name, w: modalPhoto.w, h: modalPhoto.h };
  if (gdConfigured()) toast('Comprovante salvo localmente; será enviado ao Drive ao conectar.');
  else toast('Comprovante salvo localmente. Configure o Google Drive para enviá-lo.');
}

/* Repetir último lançamento da seção (despesas recorrentes) */
function repeatLast(tabela) {
  const list = state[tabela];
  if (!list.length) { toast('Nenhum lançamento para repetir nesta seção.'); return; }
  const last = list[list.length - 1];
  openModal(tabela, null, { data: todayISO(), descricao: last.descricao, categoria: last.categoria, valor: last.valor });
}

/* Duplicar: abre um NOVO lançamento com os mesmos dados do que está no modal */
function duplicateInModal() {
  const tabela = $('m-tabela').value;
  openModal(tabela, null, {
    data: $('m-data').value || todayISO(),
    descricao: $('m-descricao').value,
    categoria: $('m-categoria').value,
    valor: parseMoney($('m-valor').value)
  });
}

/* ---------------- Máscaras de entrada ---------------- */
function formatMoneyInput(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function maskCurrencyEl(el) {
  if (!el) return;
  el.setAttribute('inputmode', 'numeric');
  el.addEventListener('input', () => {
    const digits = el.value.replace(/\D/g, '');
    if (!digits) { el.value = ''; return; }
    el.value = (parseInt(digits, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
}
function maskCpfEl(el) {
  if (!el) return;
  el.setAttribute('inputmode', 'numeric');
  el.addEventListener('input', () => {
    const d = el.value.replace(/\D/g, '').slice(0, 11);
    let out = d;
    if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    else if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    else if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
    el.value = out;
  });
}

function updateCatHint() {
  const lim = limiteDaCategoria($('m-categoria').value);
  $('m-cat-hint').textContent = lim ? ('Limite de reembolso: ' + formatMoney(lim)) : '';
}

async function saveEntry() {
  const tabela = $('m-tabela').value;
  const id = $('m-id').value;
  const data = $('m-data').value;
  const descricao = $('m-descricao').value.trim();
  const categoria = $('m-categoria').value;
  const valor = parseMoney($('m-valor').value);

  if (!data) { toast('Informe a data da compra.'); return; }
  if (!descricao) { toast('Informe a descrição.'); return; }
  if (!categoria) { toast('Selecione a categoria.'); return; }
  if (!valor) { toast('Informe um valor válido.'); return; }

  // aviso de possível duplicado (mesma data + categoria + valor de outro lançamento)
  const cents = Math.round(valor * 100);
  const dup = state[tabela].some((x) => x.id !== id && x.data === data && x.categoria === categoria && Math.round((x.valor || 0) * 100) === cents);
  if (dup && !confirm('Já existe um lançamento com a mesma data, categoria e valor. Adicionar mesmo assim?')) return;

  const now = Date.now();
  let entry;
  if (id) {
    entry = state[tabela].find((x) => x.id === id);
    if (entry) Object.assign(entry, { data, descricao, categoria, valor, updatedAt: now });
  } else {
    entry = { id: uid(), data, descricao, categoria, valor, updatedAt: now };
    state[tabela].push(entry);
    lastAddedId = entry.id;
  }
  if (entry) { try { await applyModalPhoto(entry); } catch (e) { console.error(e); } }
  touchDoc();
  state[tabela].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  saveState();
  render();
  closeModal();
  setTimeout(() => { lastAddedId = null; }, 900);
}

async function deleteEntry() {
  const tabela = $('m-tabela').value;
  const id = $('m-id').value;
  if (!id) return;
  const entry = state[tabela].find((e) => e.id === id);
  const temFoto = !!(entry && entry.foto);
  const msg = temFoto
    ? 'Excluir este lançamento? O comprovante anexado também será removido do Google Drive.'
    : 'Excluir este lançamento?';
  if (!confirm(msg)) return;
  if (entry) { try { await purgeEntryPhoto(entry); } catch (e) { console.error(e); } }   // apaga foto no Drive/fila/miniatura
  state[tabela] = state[tabela].filter((e) => e.id !== id);
  state.tomb[tabela][id] = Date.now();   // lápide p/ propagar a deleção na sincronização
  touchDoc();
  saveState();
  render();
  closeModal();
}

/* ---------------- Geração do Excel (idêntico ao modelo) ---------------- */
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const XMLNS_XML = 'http://www.w3.org/XML/1998/namespace';

function colOf(ref) { return ref.match(/[A-Z]+/)[0]; }
function rowOf(ref) { return parseInt(ref.match(/\d+/)[0], 10); }

async function buildXlsx(src) {
  const D = src || state;
  const buf = await fetch('template.xlsx', { cache: 'no-store' }).then((r) => r.arrayBuffer());
  const files = fflate.unzipSync(new Uint8Array(buf));
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  const parser = new DOMParser();
  const ser = new XMLSerializer();

  const doc = parser.parseFromString(dec.decode(files['xl/worksheets/sheet1.xml']), 'application/xml');
  const draw = parser.parseFromString(dec.decode(files['xl/drawings/drawing1.xml']), 'application/xml');
  const sheetData = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];

  const n1 = D.reembolso.length;
  const n2 = D.alelo.length;
  const extra1 = Math.max(0, n1 - 7);
  const extra2 = Math.max(0, n2 - 7);

  // ---- helpers de manipulação ----
  function allCells() { return Array.from(doc.getElementsByTagNameNS(MAIN, 'c')); }
  function getCell(ref) {
    for (const c of allCells()) if (c.getAttribute('r') === ref) return c;
    return null;
  }
  function clearCell(c) {
    while (c.firstChild) c.removeChild(c.firstChild);
    c.removeAttribute('t');
    c.removeAttribute('cm');
  }
  function setText(ref, value) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    if (value == null || value === '') return;
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(MAIN, 'is');
    const t = doc.createElementNS(MAIN, 't');
    t.setAttributeNS(XMLNS_XML, 'xml:space', 'preserve');
    t.textContent = String(value);
    is.appendChild(t); c.appendChild(is);
  }
  function setNum(ref, value) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    if (value == null || value === '') return;
    const v = doc.createElementNS(MAIN, 'v');
    v.textContent = String(value);
    c.appendChild(v);
  }
  function setFormula(ref, formula, cached) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    const f = doc.createElementNS(MAIN, 'f');
    f.textContent = formula;
    const v = doc.createElementNS(MAIN, 'v');
    v.textContent = String(cached);
    c.appendChild(f); c.appendChild(v);
  }

  function shiftRows(fromRow, amount) {
    if (amount === 0) return;
    for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) {
      const rn = parseInt(r.getAttribute('r'), 10);
      if (rn >= fromRow) {
        r.setAttribute('r', String(rn + amount));
        for (const c of Array.from(r.getElementsByTagNameNS(MAIN, 'c'))) {
          const ref = c.getAttribute('r');
          c.setAttribute('r', colOf(ref) + (rowOf(ref) + amount));
        }
      }
    }
    for (const mc of Array.from(doc.getElementsByTagNameNS(MAIN, 'mergeCell'))) {
      mc.setAttribute('ref', mc.getAttribute('ref').split(':').map((p) => {
        const rn = rowOf(p); return rn >= fromRow ? colOf(p) + (rn + amount) : p;
      }).join(':'));
    }
    for (const dv of Array.from(doc.getElementsByTagNameNS(MAIN, 'dataValidation'))) {
      const sq = dv.getAttribute('sqref'); if (!sq) continue;
      dv.setAttribute('sqref', sq.split(/\s+/).map((rng) =>
        rng.split(':').map((p) => { const rn = rowOf(p); return rn >= fromRow ? colOf(p) + (rn + amount) : p; }).join(':')
      ).join(' '));
    }
    // desenhos flutuantes (âncoras em base 0)
    const b0 = fromRow - 1;
    for (const re of Array.from(draw.getElementsByTagNameNS(XDR, 'row'))) {
      const v = parseInt(re.textContent, 10);
      if (v >= b0) re.textContent = String(v + amount);
    }
  }

  function makeDataRow(rownum) {
    const r = doc.createElementNS(MAIN, 'row');
    r.setAttribute('r', String(rownum));
    r.setAttribute('spans', '1:5');
    const styles = { A: '1', B: '11', C: '12', D: '13', E: '22' };
    for (const col of ['A', 'B', 'C', 'D', 'E']) {
      const c = doc.createElementNS(MAIN, 'c');
      c.setAttribute('r', col + rownum);
      c.setAttribute('s', styles[col]);
      r.appendChild(c);
    }
    return r;
  }
  function getRow(n) {
    for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row')))
      if (r.getAttribute('r') === String(n)) return r;
    return null;
  }
  function insertRowsBefore(subRowNum, firstNewNum, count) {
    const subRow = getRow(subRowNum);
    for (let i = 0; i < count; i++) {
      sheetData.insertBefore(makeDataRow(firstNewNum + i), subRow);
    }
  }

  // ---- expansão de linhas (só quando > 7 por seção) ----
  // Tabela 1: linhas 9..15, subtotal 16. Tabela 2: 20..26, subtotal 27. Total: 29.
  shiftRows(16, extra1);
  if (extra1 > 0) insertRowsBefore(16 + extra1, 16, extra1);

  const t2SubBase = 27 + extra1;
  shiftRows(t2SubBase, extra2);
  if (extra2 > 0) insertRowsBefore(t2SubBase + extra2, 20 + extra1, extra2);

  // ---- posições finais ----
  const t1First = 9;
  const t1Rows = Math.max(n1, 7);
  const t1Last = t1First + t1Rows - 1;
  const t1Sub = t1Last + 1;

  const t2First = 20 + extra1;
  const t2Rows = Math.max(n2, 7);
  const t2Last = t2First + t2Rows - 1;
  const t2Sub = t2Last + 1;

  const totalRow = 29 + extra1 + extra2;
  const shiftAll = extra1 + extra2;

  // ---- cabeçalho ----
  setText('C4', EMPRESA);
  if (D.dataSolicitacao) setNum('E4', dateToSerial(D.dataSolicitacao));
  setText('C5', D.funcionario);
  setText('E5', D.referente);

  // ---- lançamentos tabela 1 ----
  D.reembolso.forEach((e, i) => {
    const r = t1First + i;
    if (e.data) setNum('B' + r, dateToSerial(e.data));
    setText('C' + r, e.descricao);
    setText('D' + r, e.categoria);
    setNum('E' + r, e.valor);
  });
  // ---- lançamentos tabela 2 ----
  D.alelo.forEach((e, i) => {
    const r = t2First + i;
    if (e.data) setNum('B' + r, dateToSerial(e.data));
    setText('C' + r, e.descricao);
    setText('D' + r, e.categoria);
    setNum('E' + r, e.valor);
  });

  // ---- subtotais e total (fórmulas + valores em cache) ----
  const s1 = Math.round(sumOf(D.reembolso) * 100) / 100;
  const s2 = Math.round(sumOf(D.alelo) * 100) / 100;
  setFormula('E' + t1Sub, `SUM(E${t1First}:E${t1Last})`, s1);
  setFormula('E' + t2Sub, `SUM(E${t2First}:E${t2Last})`, s2);
  setFormula('E' + totalRow, `E${t1Sub}+E${t2Sub}`, Math.round((s1 + s2) * 100) / 100);

  // ---- dados bancários ----
  setText('C' + (33 + shiftAll), D.bank.nome);
  setText('E' + (33 + shiftAll), D.bank.banco);
  setText('C' + (34 + shiftAll), D.bank.cpf);
  setText('E' + (34 + shiftAll), D.bank.agencia);
  setText('C' + (35 + shiftAll), D.bank.conta);
  setText('E' + (35 + shiftAll), D.bank.pix);

  // ---- dimensão ----
  const dim = doc.getElementsByTagNameNS(MAIN, 'dimension')[0];
  if (dim) dim.setAttribute('ref', 'A1:R' + (41 + shiftAll));

  // ---- serializar de volta ----
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const stripDecl = (s) => s.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
  files['xl/worksheets/sheet1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(doc)));
  files['xl/drawings/drawing1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(draw)));

  // remover calcChain (Excel recalcula sozinho; evita aviso de reparo)
  delete files['xl/calcChain.xml'];
  if (files['[Content_Types].xml']) {
    let ct = dec.decode(files['[Content_Types].xml']);
    ct = ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    files['[Content_Types].xml'] = enc.encode(ct);
  }

  return fflate.zipSync(files);
}

function reportFileBase(src) {
  const D = src || state;
  const nome = (D.funcionario || 'Funcionario').trim().replace(/\s+/g, '_');
  const ref = D.dataSolicitacao || (D.archivedAt ? new Date(D.archivedAt).toISOString().slice(0, 10) : todayISO());
  return `Relatorio_Despesas_${nome}_${ref}`;
}

/* Filtra um documento para conter só as seções escolhidas (não-selecionada = vazia) */
function filteredDoc(src, sections) {
  const D = src || state;
  return Object.assign({}, D, {
    reembolso: sections.reembolso ? D.reembolso : [],
    alelo: sections.alelo ? D.alelo : []
  });
}

function santanderFileBase(src) {
  const D = src || state;
  const nome = (D.funcionario || 'Funcionario').trim().replace(/\s+/g, '_');
  const ref = D.dataSolicitacao || (D.archivedAt ? new Date(D.archivedAt).toISOString().slice(0, 10) : todayISO());
  return `Prestacao_Contas_Cartao_${nome}_${ref}`;
}

/* ---------------- Excel exclusivo do Cartão Santander (modelo "Despesas Cartão.xlsx") ----------------
   Layout: info E4=Nome, E6=Período, E7=Data de Entrega (serial), E8=Total(=J{total}); tabela cabeçalho
   linha 16, dados 17.. (capac. 18 → linhas 17-34), linha de total 35 (J=SUM). Colunas: B=DATA,
   C:F=ESTABELECIMENTO, G:I=DESCRIÇÃO, J=VALOR, K=JUSTIFICATIVA. Os dados do cartão = tabela `alelo`. */
async function buildSantanderXlsx(src) {
  const D = src || state;
  const buf = await fetch('template-santander.xlsx', { cache: 'no-store' }).then((r) => r.arrayBuffer());
  const files = fflate.unzipSync(new Uint8Array(buf));
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const parser = new DOMParser();
  const ser = new XMLSerializer();

  const doc = parser.parseFromString(dec.decode(files['xl/worksheets/sheet1.xml']), 'application/xml');
  const draw = files['xl/drawings/drawing1.xml'] ? parser.parseFromString(dec.decode(files['xl/drawings/drawing1.xml']), 'application/xml') : null;
  const sheetData = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];

  const n = D.alelo.length;
  const CAP = 18;                          // linhas 17..34
  const extra = Math.max(0, n - CAP);
  const totalRowBase = 35;
  const totalRow = totalRowBase + extra;

  function allCells() { return Array.from(doc.getElementsByTagNameNS(MAIN, 'c')); }
  function getCell(ref) { for (const c of allCells()) if (c.getAttribute('r') === ref) return c; return null; }
  function clearCell(c) { while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute('t'); c.removeAttribute('cm'); }
  function setText(ref, value) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    if (value == null || value === '') return;
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(MAIN, 'is');
    const t = doc.createElementNS(MAIN, 't');
    t.setAttributeNS(XMLNS_XML, 'xml:space', 'preserve');
    t.textContent = String(value);
    is.appendChild(t); c.appendChild(is);
  }
  function setNum(ref, value) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    if (value == null || value === '') return;
    const v = doc.createElementNS(MAIN, 'v'); v.textContent = String(value); c.appendChild(v);
  }
  function setFormula(ref, formula, cached) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    const f = doc.createElementNS(MAIN, 'f'); f.textContent = formula;
    const v = doc.createElementNS(MAIN, 'v'); v.textContent = String(cached);
    c.appendChild(f); c.appendChild(v);
  }
  function getRow(nn) { for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) if (r.getAttribute('r') === String(nn)) return r; return null; }
  function shiftRows(fromRow, amount) {
    if (amount === 0) return;
    for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) {
      const rn = parseInt(r.getAttribute('r'), 10);
      if (rn >= fromRow) {
        r.setAttribute('r', String(rn + amount));
        for (const c of Array.from(r.getElementsByTagNameNS(MAIN, 'c'))) {
          const ref = c.getAttribute('r'); c.setAttribute('r', colOf(ref) + (rowOf(ref) + amount));
        }
      }
    }
    for (const mc of Array.from(doc.getElementsByTagNameNS(MAIN, 'mergeCell'))) {
      mc.setAttribute('ref', mc.getAttribute('ref').split(':').map((p) => { const rn = rowOf(p); return rn >= fromRow ? colOf(p) + (rn + amount) : p; }).join(':'));
    }
    for (const dv of Array.from(doc.getElementsByTagNameNS(MAIN, 'dataValidation'))) {
      const sq = dv.getAttribute('sqref'); if (!sq) continue;
      dv.setAttribute('sqref', sq.split(/\s+/).map((rng) => rng.split(':').map((p) => { const rn = rowOf(p); return rn >= fromRow ? colOf(p) + (rn + amount) : p; }).join(':')).join(' '));
    }
    if (draw) { const b0 = fromRow - 1; for (const re of Array.from(draw.getElementsByTagNameNS(XDR, 'row'))) { const v = parseInt(re.textContent, 10); if (v >= b0) re.textContent = String(v + amount); } }
  }
  const ROW_STYLES = { A: '41', B: '42', C: '43', D: '44', E: '44', F: '45', G: '46', H: '44', I: '45', J: '47', K: '48', L: '49' };
  function makeDataRow(rownum) {
    const r = doc.createElementNS(MAIN, 'row');
    r.setAttribute('r', String(rownum));
    r.setAttribute('ht', '21.75'); r.setAttribute('customHeight', '1'); r.setAttribute('spans', '1:12');
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      const c = doc.createElementNS(MAIN, 'c'); c.setAttribute('r', col + rownum); c.setAttribute('s', ROW_STYLES[col]); r.appendChild(c);
    }
    return r;
  }
  function addMerge(ref) {
    const mcs = doc.getElementsByTagNameNS(MAIN, 'mergeCells')[0]; if (!mcs) return;
    const mc = doc.createElementNS(MAIN, 'mergeCell'); mc.setAttribute('ref', ref); mcs.appendChild(mc);
    mcs.setAttribute('count', String(mcs.getElementsByTagNameNS(MAIN, 'mergeCell').length));
  }

  // ---- expansão: insere `extra` linhas de dados antes da linha de total ----
  if (extra > 0) {
    shiftRows(totalRowBase, extra);
    const tRow = getRow(totalRow);
    for (let i = 0; i < extra; i++) {
      const rr = totalRowBase + i;        // 35..34+extra
      sheetData.insertBefore(makeDataRow(rr), tRow);
      addMerge('C' + rr + ':F' + rr);
      addMerge('G' + rr + ':I' + rr);
    }
  }

  // ---- cabeçalho ----
  setText('E4', D.funcionario);            // Nome
  setText('E6', D.referente);              // Período Prestação
  if (D.dataSolicitacao) setNum('E7', dateToSerial(D.dataSolicitacao));   // Data de Entrega (serial/data)

  // ---- lançamentos (tabela `alelo`) ----
  D.alelo.forEach((e, i) => {
    const r = 17 + i;
    setText('B' + r, fmtDateBR(e.data));   // DATA
    setText('G' + r, e.descricao);         // DESCRIÇÃO DA DESPESA (C:F Estabelecimento e K Justificativa ficam em branco)
    setNum('J' + r, e.valor);              // VALOR
  });

  // ---- total ----
  const sum = Math.round(sumOf(D.alelo) * 100) / 100;
  setFormula('J' + totalRow, `SUM(J17:J${totalRow - 1})`, sum);
  setFormula('E8', 'J' + totalRow, sum);

  // ---- serializar ----
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const stripDecl = (s) => s.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
  files['xl/worksheets/sheet1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(doc)));
  if (draw) files['xl/drawings/drawing1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(draw)));
  if (files['xl/calcChain.xml']) {
    delete files['xl/calcChain.xml'];
    if (files['[Content_Types].xml']) {
      let ct = dec.decode(files['[Content_Types].xml']);
      ct = ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
      files['[Content_Types].xml'] = enc.encode(ct);
    }
  }
  return fflate.zipSync(files);
}

async function exportExcel(src, sections) {
  const inc = sections || { reembolso: true, alelo: true };
  const base = src || state;
  const has = (inc.reembolso && base.reembolso.length) || (inc.alelo && base.alelo.length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  const santander = !!inc.alelo && !inc.reembolso;   // só cartão → formato exclusivo (Prestação de Contas)
  try {
    toast('Gerando Excel…');
    const D = filteredDoc(base, inc);
    const bytes = santander ? await buildSantanderXlsx(D) : await buildXlsx(D);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fname = (santander ? santanderFileBase(D) : reportFileBase(D)) + '.xlsx';
    await shareOrDownload(blob, fname, santander ? 'Prestação de Contas - Cartão Santander' : 'Relatório de Despesas (Excel)');
  } catch (e) {
    console.error(e);
    toast('Erro ao gerar Excel: ' + e.message);
  }
}

/* Compartilha o arquivo (WhatsApp/e-mail/etc.) se o aparelho suportar;
   senão, faz o download normal. */
async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      toast('Pronto para enviar.');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // usuário cancelou
      // qualquer outro erro: cai para download
    }
  }
  downloadBlob(blob, filename);
  toast('Arquivo salvo.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

/* ---- caixa de seleção do que exportar (Reembolso / Alelo / ambos) ---- */
let exportCtx = { kind: 'excel', src: null };
function openExportChooser(kind, src) {
  const D = src || state;
  const nR = (D.reembolso || []).length, nA = (D.alelo || []).length;
  if (nR === 0 && nA === 0) { toast('Adicione ao menos um lançamento.'); return; }
  exportCtx = { kind, src: D };
  $('export-title').textContent = 'Exportar ' + (kind === 'excel' ? 'Excel' : 'PDF');
  $('exp-c-reembolso').textContent = nR + ' lançamento(s) · ' + formatMoney(sumOf(D.reembolso || []));
  $('exp-c-alelo').textContent = nA + ' lançamento(s) · ' + formatMoney(sumOf(D.alelo || []));
  $('exp-reembolso').checked = nR > 0;
  $('exp-alelo').checked = nA > 0;
  updateExportHint();
  $('export-modal').classList.add('open');
}
function updateExportHint() {
  const h = $('exp-hint-santander'); if (!h) return;
  const only = $('exp-alelo').checked && !$('exp-reembolso').checked;
  h.style.display = only ? '' : 'none';
}
function closeExportModal() { $('export-modal').classList.remove('open'); }
function confirmExport() {
  const sections = { reembolso: $('exp-reembolso').checked, alelo: $('exp-alelo').checked };
  if (!sections.reembolso && !sections.alelo) { toast('Selecione ao menos uma seção.'); return; }
  closeExportModal();
  if (exportCtx.kind === 'excel') exportExcel(exportCtx.src, sections);
  else exportPDF(exportCtx.src, sections);
}

/* ---------------- Geração do PDF (impressão) ---------------- */
function buildPrintTable(title, list, minRows) {
  let rows = '';
  const n = Math.max(list.length, minRows);
  for (let i = 0; i < n; i++) {
    const e = list[i];
    rows += `<tr>
      <td class="c-data">${e ? fmtDateBR(e.data) : ''}</td>
      <td>${e ? escapeHtml(e.descricao) : ''}</td>
      <td class="c-cat">${e ? escapeHtml(e.categoria) : ''}</td>
      <td class="c-val">${e ? formatMoney(e.valor) : ''}</td>
    </tr>`;
  }
  const sub = sumOf(list);
  return `
    <div class="p-section">${title}</div>
    <table class="p-tbl">
      <thead><tr>
        <th class="c-data">DATA DA COMPRA</th><th>DESCRIÇÃO</th>
        <th class="c-cat">CATEGORIA</th><th class="c-val">VALOR</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="p-subtotal">
          <td colspan="3" class="sub-lbl">${title === 'DESPESAS PARA REEMBOLSO' ? 'SUBTOTAL DESPESAS PARA REEMBOLSO:' : 'SUBTOTAL DESPESAS CARTÃO SANTANDER - SOMA:'}</td>
          <td class="sub-val">${formatMoney(sub)}</td>
        </tr>
      </tbody>
    </table>`;
}

function buildPrint(src, sections) {
  const D = src || state;
  const inc = sections || { reembolso: true, alelo: true };
  const s1 = inc.reembolso ? sumOf(D.reembolso) : 0;
  const s2 = inc.alelo ? sumOf(D.alelo) : 0;
  const b = D.bank;
  const root = $('print-root');
  root.innerHTML = `
    <div class="p-top">
      <div class="p-logo"><img src="assets/soma-logo.png" alt="Soma"></div>
      <div class="p-title">RELATÓRIO DE DESPESAS PARA REEMBOLSO</div>
    </div>
    <table class="p-info">
      <tr><td class="lab">Empresa:</td><td class="val">${EMPRESA}</td>
          <td class="lab">Data da Solicitação:</td><td class="val">${fmtDateBR(D.dataSolicitacao)}</td></tr>
      <tr><td class="lab">Funcionário:</td><td class="val">${escapeHtml(D.funcionario)}</td>
          <td class="lab">Reembolso Referente à:</td><td class="val">${escapeHtml(D.referente)}</td></tr>
    </table>
    ${inc.reembolso ? buildPrintTable('DESPESAS PARA REEMBOLSO', D.reembolso, 5) : ''}
    ${inc.alelo ? buildPrintTable('DESPESAS CARTÃO SANTANDER - SOMA', D.alelo, 5) : ''}
    <div class="p-total"><span>TOTAL DOS GASTOS</span><span>${formatMoney(s1 + s2)}</span></div>
    <div class="p-bank-title">Dados Bancários (Se Aplicável)</div>
    <table class="p-bank">
      <tr><td class="lab">Nome:</td><td>${escapeHtml(b.nome)}</td><td class="lab">Banco:</td><td>${escapeHtml(b.banco)}</td></tr>
      <tr><td class="lab">CPF:</td><td>${escapeHtml(b.cpf)}</td><td class="lab">Agência:</td><td>${escapeHtml(b.agencia)}</td></tr>
      <tr><td class="lab">Conta:</td><td>${escapeHtml(b.conta)}</td><td class="lab">Chave Pix:</td><td>${escapeHtml(b.pix)}</td></tr>
    </table>
    <div class="p-obs">
      <b>Observações:</b> ${limitsObsText()}
      Enviar junto a este relatório os cupons das despesas. Em caso de gasto reembolsável,
      informar os dados da conta bancária para o recebimento.
    </div>`;
}

/* PDF exclusivo do Cartão Santander — replica o conteúdo do modelo "Prestação de Contas". */
function buildSantanderPrint(src) {
  const D = src || state;
  const list = D.alelo || [];
  const total = sumOf(list);
  const minRows = 8;
  let rows = '';
  const nrows = Math.max(list.length, minRows);
  for (let i = 0; i < nrows; i++) {
    const e = list[i];
    rows += `<tr>
      <td class="c-data">${e ? fmtDateBR(e.data) : ''}</td>
      <td></td>
      <td>${e ? escapeHtml(e.descricao) : ''}</td>
      <td class="c-val">${e ? formatMoney(e.valor) : ''}</td>
      <td></td>
    </tr>`;
  }
  const root = $('print-root');
  root.innerHTML = `
    <div class="p-top">
      <div class="p-logo"><img src="assets/soma-logo.png" alt="Soma"></div>
      <div class="p-title">PRESTAÇÃO DE CONTAS — CARTÃO DE CRÉDITO</div>
    </div>
    <table class="p-info">
      <tr><td class="lab">Nome:</td><td class="val">${escapeHtml(D.funcionario)}</td>
          <td class="lab">Data de Entrega:</td><td class="val">${fmtDateBR(D.dataSolicitacao)}</td></tr>
      <tr><td class="lab">Período Prestação:</td><td class="val">${escapeHtml(D.referente)}</td>
          <td class="lab">Total das Despesas:</td><td class="val">${formatMoney(total)}</td></tr>
    </table>
    <div class="p-obs" style="margin:8px 0">
      <b>Anexar:</b> Comprovante do cartão de crédito (fatura) · Notas fiscais ou recibos de
      todas as despesas · Relatório de viagem (se aplicável).
    </div>
    <table class="p-tbl">
      <thead><tr>
        <th class="c-data">DATA</th><th>ESTABELECIMENTO</th>
        <th>DESCRIÇÃO DA DESPESA</th><th class="c-val">VALOR</th>
        <th>JUSTIFICATIVA / FINALIDADE</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="p-subtotal">
          <td colspan="3" class="sub-lbl">TOTAL DAS DESPESAS:</td>
          <td class="sub-val">${formatMoney(total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <div class="p-obs">
      Declaro que os valores acima referem-se a despesas realizadas exclusivamente para fins
      profissionais, conforme as normas da empresa/instituição. Solicitar inclusão de CNPJ na
      emissão da nota fiscal. <b>Toda despesa sem o respectivo comprovante fiscal será
      considerada indevida, sujeita à restituição por parte do colaborador.</b>
    </div>`;
}

async function exportPDF(src, sections) {
  const inc = sections || { reembolso: true, alelo: true };
  const D = src || state;
  const has = (inc.reembolso && D.reembolso.length) || (inc.alelo && D.alelo.length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  const santander = !!inc.alelo && !inc.reembolso;   // só cartão → formato exclusivo
  try {
    toast('Gerando PDF…');
    const blob = await generatePdfBlob(D, inc, santander);
    const fname = (santander ? santanderFileBase(D) : reportFileBase(D)) + '.pdf';
    await shareOrDownload(blob, fname, santander ? 'Prestação de Contas - Cartão Santander' : 'Relatório de Despesas (PDF)');
  } catch (e) {
    console.error(e);
    toast('Erro ao gerar PDF: ' + e.message);
  }
}

/* Gera um PDF de verdade (arquivo) a partir do mesmo layout do relatório,
   capturado com html2canvas e montado com jsPDF (A4 retrato, multipágina). */
async function generatePdfBlob(src, sections, santander) {
  if (santander) buildSantanderPrint(src || state);
  else buildPrint(src || state, sections);
  const root = $('print-root');
  const prevStyle = root.getAttribute('style') || '';
  // torna o layout capturável fora da tela
  root.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:800px;background:#f8f4f2;padding:24px;';

  // espera o logo carregar para não sair em branco
  const img = root.querySelector('.p-logo img');
  if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; });

  try {
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#f8f4f2', useCORS: true });
    const imgData = canvas.toDataURL('image/jpeg', 0.96);
    const jsPDF = window.jspdf.jsPDF;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pageW - margin * 2;
    const imgH = canvas.height * (imgW / canvas.width);
    const usableH = pageH - margin * 2;

    let heightLeft = imgH;
    let position = margin;
    pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
    heightLeft -= usableH;
    while (heightLeft > 0) {
      position = margin - (imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
      heightLeft -= usableH;
    }

    // anexa comprovantes (Drive ou fila local) como páginas finais
    const inc = sections || { reembolso: true, alelo: true };
    const D = src || state;
    const fotos = [];
    if (inc.reembolso) fotos.push(...(D.reembolso || []));
    if (inc.alelo) fotos.push(...(D.alelo || []));
    for (const e of fotos) {
      if (!e.foto) continue;
      if (e.foto.id && !gdConnected()) continue;   // evita pedir login no meio da exportação
      let blob = null;
      try { blob = await getPhotoBlob(e.foto); } catch (er) { console.error(er); }
      if (!blob) continue;
      try {
        const durl = await blobToDataUrl(blob);
        const props = pdf.getImageProperties(durl);
        pdf.addPage();
        pdf.setFontSize(10);
        pdf.text('Comprovante — ' + (e.descricao || '') + ' (' + fmtDateBR(e.data) + ')', margin, margin + 4);
        const availW = pageW - margin * 2, availH = pageH - margin * 2 - 8;
        let iw = availW, ih = props.height * (availW / props.width);
        if (ih > availH) { ih = availH; iw = props.width * (availH / props.height); }
        pdf.addImage(durl, 'JPEG', margin + (availW - iw) / 2, margin + 8, iw, ih);
      } catch (er) { console.error('Falha ao anexar comprovante', er); }
    }

    return pdf.output('blob');
  } finally {
    root.setAttribute('style', prevStyle);
    root.style.display = 'none';
  }
}

/* ============================================================
   Sincronização entre dispositivos (repositório PRIVADO no GitHub)
   Lê/grava um único arquivo dados.json via API do GitHub.
   O token fica salvo só neste aparelho (localStorage).
   ============================================================ */
const GH_API = 'https://api.github.com';
const DATA_PATH = 'dados.json';

function loadSyncCfg() {
  try { return Object.assign({ repo: '', token: '' }, JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')); }
  catch (e) { return { repo: '', token: '' }; }
}
function saveSyncCfg(cfg) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (e) {} }
function isSyncConfigured() { const c = loadSyncCfg(); return !!(c.repo && c.token); }

// "sujo" = há alterações locais ainda não enviadas ao servidor (ex.: feitas offline)
const DIRTY_KEY = 'despesas-soma-dirty-v1';
function setDirty(v) { try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch (e) {} updateSyncIndicator(); }
function isDirty() { try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch (e) { return false; } }

// horário da última sincronização bem-sucedida (para o rodapé)
function setLastSync(ts) { try { localStorage.setItem(LASTSYNC_KEY, String(ts)); } catch (e) {} }
function getLastSync() { try { return localStorage.getItem(LASTSYNC_KEY); } catch (e) { return null; } }

function updateFooter() {
  const v = $('ft-version'); if (v) v.textContent = 'App ' + APP_VERSION;
  const v2 = $('ft-version2'); if (v2) v2.textContent = 'Plane it • ' + APP_VERSION;
  const ls = $('ft-lastsync'); if (!ls) return;
  const t = getLastSync();
  const txt = t ? new Date(Number(t)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  ls.textContent = 'Última sincronização: ' + txt;
}

function setSyncStatus(msg, kind) {
  const el = $('sy-status'); if (!el) return;
  el.textContent = msg;
  el.className = 'sync-status' + (kind ? ' ' + kind : '');
}

// ícone no cabeçalho: ✓ sincronizado · ⟳ pendente/sincronizando · ⚠ offline
function updateSyncIndicator() {
  const el = $('sync-ind'); if (!el) return;
  if (!isSyncConfigured()) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.classList.remove('ok', 'pending', 'offline', 'spin');
  if (!navigator.onLine) {
    el.innerHTML = icon('alert-triangle', 20); el.classList.add('offline');
    el.title = 'Offline — sincroniza ao reconectar';
  } else if (syncing) {
    el.innerHTML = icon('refresh-cw', 20); el.classList.add('pending', 'spin');
    el.title = 'Sincronizando…';
  } else if (isDirty()) {
    el.innerHTML = icon('refresh-cw', 20); el.classList.add('pending');
    el.title = 'Alterações pendentes — toque para sincronizar';
  } else {
    el.innerHTML = icon('check', 20); el.classList.add('ok');
    el.title = 'Sincronizado — toque para sincronizar agora';
  }
}

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

// base64 <-> UTF-8 (btoa/atob não lidam com acentos sozinhos)
function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64DecodeUtf8(b64) {
  const bin = atob((b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGetFile(cfg) {
  const url = `${GH_API}/repos/${cfg.repo}/contents/${DATA_PATH}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.token), cache: 'no-store' });
  if (res.status === 404) return { exists: false, sha: null, data: null };
  if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
  const j = await res.json();
  return { exists: true, sha: j.sha, data: JSON.parse(b64DecodeUtf8(j.content)) };
}

async function ghPutFile(cfg, dataObj, sha) {
  const url = `${GH_API}/repos/${cfg.repo}/contents/${DATA_PATH}`;
  const body = {
    message: 'Atualiza lançamentos — ' + new Date().toISOString(),
    content: b64EncodeUtf8(JSON.stringify(dataObj, null, 2))
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (res.status === 409) { const e = new Error('conflito'); e.conflict = true; throw e; }
  if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
  return (await res.json()).content.sha;
}

async function ghCheckRepo(cfg) {
  const res = await fetch(`${GH_API}/repos/${cfg.repo}`, { headers: ghHeaders(cfg.token), cache: 'no-store' });
  if (res.status === 404) throw new Error('Repositório não encontrado (confira usuário/repo e se o token tem acesso).');
  if (res.status === 401) throw new Error('Token inválido ou expirado.');
  if (!res.ok) throw new Error('GitHub ' + res.status);
  const j = await res.json();
  if (!j.private) throw new Error('ATENÇÃO: esse repositório é PÚBLICO. Use um repositório privado para seus dados.');
  if (!(j.permissions && (j.permissions.push || j.permissions.admin))) {
    throw new Error('O token não tem permissão de escrita (Contents: Read and write) nesse repositório.');
  }
  return j;
}

/* ---- documento sincronizado (snapshot + merge) ---- */
function currentDoc() {
  return {
    funcionario: state.funcionario,
    dataSolicitacao: state.dataSolicitacao,
    referente: state.referente,
    reportMonth: state.reportMonth || '',
    bank: Object.assign({}, state.bank),
    reembolso: state.reembolso.map((e) => Object.assign({}, e)),
    alelo: state.alelo.map((e) => Object.assign({}, e)),
    history: state.history.map((h) => JSON.parse(JSON.stringify(h))),
    histTomb: Object.assign({}, state.histTomb),
    driveFolderId: state.driveFolderId || '',
    driveFolders: Object.assign({ reembolso: '', alelo: '' }, state.driveFolders || {}),
    config: { categorias: getCatConfig().map((c) => Object.assign({}, c)) },
    tomb: {
      reembolso: Object.assign({}, state.tomb.reembolso),
      alelo: Object.assign({}, state.tomb.alelo)
    },
    meta: Object.assign({ updatedAt: 0, profileUpdatedAt: 0 }, state.meta)
  };
}

function applyDoc(doc) {
  applyingRemote = true;
  const base = emptyState();
  state.funcionario = doc.funcionario || '';
  state.dataSolicitacao = doc.dataSolicitacao || '';
  state.referente = doc.referente || '';
  state.reportMonth = doc.reportMonth || '';
  state.bank = Object.assign(base.bank, doc.bank || {});
  state.reembolso = doc.reembolso || [];
  state.alelo = doc.alelo || [];
  state.history = Array.isArray(doc.history) ? doc.history : [];
  state.histTomb = doc.histTomb || {};
  state.driveFolderId = doc.driveFolderId || '';
  state.driveFolders = Object.assign({ reembolso: '', alelo: '' }, doc.driveFolders || {});
  if (!state.driveFolders.reembolso && state.driveFolderId) state.driveFolders.reembolso = state.driveFolderId;
  state.config = normalizeCatConfig(doc.config);
  state.tomb = {
    reembolso: (doc.tomb && doc.tomb.reembolso) || {},
    alelo: (doc.tomb && doc.tomb.alelo) || {}
  };
  state.meta = Object.assign({ updatedAt: 0, profileUpdatedAt: 0 }, doc.meta || {});
  saveState();
  render();
  catDraft = null;
  populateCategorySelects();
  renderCatEditor();
  applyingRemote = false;
}

function mergeTable(t, a, b, outTomb) {
  const PURGE = Date.now() - 180 * 24 * 3600 * 1000;   // descarta lápides > 180 dias
  const tomb = {};
  for (const src of [a, b]) {
    const tm = (src.tomb && src.tomb[t]) || {};
    for (const id in tm) if (tm[id] >= PURGE) tomb[id] = Math.max(tomb[id] || 0, tm[id]);
  }
  const map = {};
  for (const src of [a, b]) {
    for (const e of (src[t] || [])) {
      const cur = map[e.id];
      if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) map[e.id] = e;
    }
  }
  const list = [];
  for (const id in map) {
    const e = map[id];
    if (tomb[id] && tomb[id] >= (e.updatedAt || 0)) continue;   // deletado
    list.push(e);
  }
  outTomb[t] = tomb;
  list.sort((x, y) => (x.data || '').localeCompare(y.data || ''));
  return list;
}

function mergeHistory(a, b) {
  const PURGE = Date.now() - 365 * 24 * 3600 * 1000;   // lápides de histórico: 1 ano
  const tomb = {};
  for (const src of [a, b]) {
    const tm = src.histTomb || {};
    for (const id in tm) if (tm[id] >= PURGE) tomb[id] = Math.max(tomb[id] || 0, tm[id]);
  }
  const map = {};
  for (const src of [a, b]) for (const h of (src.history || [])) if (!map[h.id]) map[h.id] = h;
  const list = [];
  for (const id in map) { if (tomb[id]) continue; list.push(map[id]); }
  list.sort((x, y) => (y.archivedAt || 0) - (x.archivedAt || 0));   // mais recente primeiro
  return { list, tomb };
}

function mergeDocs(a, b) {
  const pa = (a.meta && a.meta.profileUpdatedAt) || 0;
  const pb = (b.meta && b.meta.profileUpdatedAt) || 0;
  const p = pb > pa ? b : a;   // perfil/banco: o mais recente vence
  const out = {
    funcionario: p.funcionario || '',
    dataSolicitacao: p.dataSolicitacao || '',
    referente: p.referente || '',
    reportMonth: p.reportMonth || '',
    bank: Object.assign({}, p.bank || {}),
    config: normalizeCatConfig(p.config),
    tomb: { reembolso: {}, alelo: {} }
  };
  out.reembolso = mergeTable('reembolso', a, b, out.tomb);
  out.alelo = mergeTable('alelo', a, b, out.tomb);
  const mh = mergeHistory(a, b);
  out.history = mh.list;
  out.histTomb = mh.tomb;
  out.driveFolderId = a.driveFolderId || b.driveFolderId || '';   // id da pasta do Drive (estável)
  const fa = a.driveFolders || {}, fb = b.driveFolders || {};      // raízes separadas: prefere id não-vazio
  out.driveFolders = {
    reembolso: fa.reembolso || fb.reembolso || a.driveFolderId || b.driveFolderId || '',
    alelo: fa.alelo || fb.alelo || ''
  };
  out.meta = {
    updatedAt: Math.max((a.meta && a.meta.updatedAt) || 0, (b.meta && b.meta.updatedAt) || 0),
    profileUpdatedAt: Math.max(pa, pb)
  };
  return out;
}

/* ---- orquestração: puxar -> mesclar -> empurrar ---- */
let syncing = false;

function scheduleSync() {
  if (!isSyncConfigured()) return;
  clearTimeout(scheduleSync._t);
  scheduleSync._t = setTimeout(() => { syncNow(true); }, 2500);
}

async function syncNow(silent) {
  const cfg = loadSyncCfg();
  if (!cfg.repo || !cfg.token) { if (!silent) setSyncStatus('Configure o repositório e o token.', 'warn'); return; }
  if (!navigator.onLine) {
    setSyncStatus(isDirty()
      ? 'Offline — alterações pendentes serão enviadas assim que a conexão voltar.'
      : 'Offline — sincroniza quando a conexão voltar.', 'warn');
    updateSyncIndicator();
    return;
  }
  if (syncing) return;
  syncing = true;
  updateSyncIndicator();
  setSyncStatus('Sincronizando…');
  try {
    const remote = await ghGetFile(cfg);
    let merged, sha;
    if (!remote.exists) { merged = currentDoc(); sha = null; }
    else { merged = mergeDocs(currentDoc(), remote.data); sha = remote.sha; }

    applyDoc(merged);

    const changed = !remote.exists || JSON.stringify(merged) !== JSON.stringify(remote.data);
    if (changed) {
      try {
        await ghPutFile(cfg, merged, sha);
      } catch (e) {
        if (e.conflict) {   // outro dispositivo gravou no meio: refaz a mescla
          const r2 = await ghGetFile(cfg);
          const m2 = mergeDocs(currentDoc(), r2.data);
          applyDoc(m2);
          await ghPutFile(cfg, m2, r2.sha);
        } else { throw e; }
      }
    }
    setDirty(false);   // local e servidor consistentes
    setLastSync(Date.now());
    updateFooter();
    setSyncStatus('Sincronizado • ' + new Date().toLocaleString('pt-BR'), 'ok');
  } catch (e) {
    console.error(e);
    // mantém o estado "sujo": tenta de novo ao reconectar / reabrir
    setSyncStatus('Erro: ' + e.message + (isDirty() ? ' (alterações pendentes mantidas)' : ''), 'err');
  } finally {
    syncing = false;
    updateSyncIndicator();
  }
}

function setupSyncUI() {
  const cfg = loadSyncCfg();
  if ($('sy-repo')) $('sy-repo').value = cfg.repo || '';
  if ($('sy-token')) $('sy-token').value = cfg.token || '';
  if (!isSyncConfigured()) setSyncStatus('Não configurado.', '');
  else if (!navigator.onLine) setSyncStatus(isDirty()
    ? 'Offline — alterações pendentes serão enviadas ao reconectar.'
    : 'Offline.', 'warn');
  else setSyncStatus('Configurado. Toque em “Sincronizar agora”.', '');

  function persist() {
    saveSyncCfg({ repo: ($('sy-repo').value || '').trim(), token: ($('sy-token').value || '').trim() });
    updateSyncIndicator();
  }
  $('sy-repo').addEventListener('change', persist);
  $('sy-token').addEventListener('change', persist);

  $('sy-test').addEventListener('click', async () => {
    persist();
    const c = loadSyncCfg();
    if (!c.repo || !c.token) { setSyncStatus('Preencha o repositório e o token.', 'warn'); return; }
    setSyncStatus('Verificando conexão…');
    try { await ghCheckRepo(c); setSyncStatus('Conectado ✓ Repositório privado acessível.', 'ok'); }
    catch (e) { setSyncStatus('Erro: ' + e.message, 'err'); }
  });

  $('sy-now').addEventListener('click', () => { persist(); syncNow(false); });

  $('sy-clear').addEventListener('click', () => {
    if (!confirm('Apagar o token e o repositório salvos neste aparelho?\n(Os lançamentos locais permanecem.)')) return;
    try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
    $('sy-repo').value = ''; $('sy-token').value = '';
    setSyncStatus('Desconectado deste aparelho.', '');
    updateSyncIndicator();
    toast('Sincronização desativada neste aparelho.');
  });
}

/* ============================================================
   Bloqueio do app (biometria via WebAuthn / PIN) — config local
   ============================================================ */
function loadLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); } catch (e) { return {}; } }
function saveLock(l) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch (e) {} }
function lockEnabled() { const l = loadLock(); return !!(l.bio || l.pin); }

function randBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
function abToB64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function b64ToAb(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer; }
async function sha256B64(str) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return abToB64(buf); }

async function enableBio() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    toast('Este aparelho/navegador não suporta biometria aqui.'); return false;
  }
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: randBytes(32),
      rp: { name: 'Despesas Soma', id: location.hostname },
      user: { id: randBytes(16), name: 'usuario-despesas', displayName: 'Usuário' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000, attestation: 'none'
    } });
    const l = loadLock(); l.bio = { credId: abToB64(cred.rawId) }; saveLock(l);
    return true;
  } catch (e) { console.error(e); toast('Não foi possível ativar a biometria.'); return false; }
}
async function unlockBio() {
  const l = loadLock(); if (!l.bio) throw new Error('sem biometria');
  await navigator.credentials.get({ publicKey: {
    challenge: randBytes(32),
    allowCredentials: [{ type: 'public-key', id: b64ToAb(l.bio.credId) }],
    userVerification: 'required', timeout: 60000, rpId: location.hostname
  } });
  return true;   // se não lançou exceção, a verificação passou
}
async function setPin(pin) { const l = loadLock(); l.pin = { hash: await sha256B64('despesas-soma|' + pin) }; saveLock(l); }
async function checkPin(pin) { const l = loadLock(); if (!l.pin) return false; return (await sha256B64('despesas-soma|' + pin)) === l.pin.hash; }

function maybeLock() { if (lockEnabled()) showLock(); }

function showLock() {
  if ($('lock-screen')) return;
  const l = loadLock();
  const div = document.createElement('div');
  div.id = 'lock-screen'; div.className = 'lock-screen';
  div.innerHTML = `
    <div class="lock-card">
      <img src="assets/soma-logo.png" alt="" class="lock-logo">
      <h3>App bloqueado</h3>
      <p>Autentique-se para acessar seus dados.</p>
      ${l.bio ? '<button class="btn btn-pdf" id="lock-bio">Desbloquear com biometria</button>' : ''}
      ${l.pin ? '<div class="lock-pin"><input type="password" inputmode="numeric" id="lock-pin-input" placeholder="PIN" maxlength="12"><button class="btn btn-excel" id="lock-pin-ok">Entrar</button></div>' : ''}
      <p class="lock-msg" id="lock-msg"></p>` + '</div>';
  document.body.appendChild(div);
  document.body.classList.add('locked');

  async function tryBio() {
    try { await unlockBio(); hideLock(); }
    catch (e) { $('lock-msg').textContent = 'Falha na biometria. Tente de novo' + (l.pin ? ' ou use o PIN.' : '.'); }
  }
  if (l.bio) { $('lock-bio').addEventListener('click', tryBio); setTimeout(tryBio, 350); }
  if (l.pin) {
    const ok = async () => { if (await checkPin($('lock-pin-input').value)) hideLock(); else $('lock-msg').textContent = 'PIN incorreto.'; };
    $('lock-pin-ok').addEventListener('click', ok);
    $('lock-pin-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok(); });
  }
}
function hideLock() { const d = $('lock-screen'); if (d) d.remove(); document.body.classList.remove('locked'); maybePromptDrive(); }

function refreshSecStatus() {
  const l = loadLock();
  const bio = $('sec-bio'); if (bio) bio.textContent = l.bio ? 'Desativar biometria' : 'Ativar biometria';
  const st = $('sec-status'); if (st) {
    st.textContent = lockEnabled()
      ? 'Bloqueio ATIVO' + (l.bio ? ' · biometria' : '') + (l.pin ? ' · PIN' : '')
      : 'Bloqueio desativado.';
    st.className = 'sync-status' + (lockEnabled() ? ' ok' : '');
  }
}
function setupSecurityUI() {
  refreshSecStatus();
  if (!$('sec-bio')) return;
  $('sec-bio').addEventListener('click', async () => {
    const cur = loadLock();
    if (cur.bio) { delete cur.bio; saveLock(cur); refreshSecStatus(); toast('Biometria desativada.'); }
    else if (await enableBio()) { refreshSecStatus(); toast('Biometria ativada.'); }
  });
  $('sec-pin-set').addEventListener('click', async () => {
    const pin = ($('sec-pin').value || '').trim();
    const cur = loadLock();
    if (cur.pin && !pin) { delete cur.pin; saveLock(cur); refreshSecStatus(); toast('PIN removido.'); return; }
    if (!/^\d{4,12}$/.test(pin)) { toast('Use um PIN de 4 a 12 dígitos.'); return; }
    await setPin(pin); $('sec-pin').value = ''; refreshSecStatus(); toast('PIN definido.');
  });
}

/* ============================================================
   Backup / Restauração (arquivo JSON) + cópia versionada no Git
   ============================================================ */
async function exportBackup() {
  try {
    const json = JSON.stringify(currentDoc(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    await shareOrDownload(blob, 'backup-despesas-' + todayISO() + '.json', 'Backup de Despesas');
    const st = $('bk-status');
    if (isSyncConfigured() && navigator.onLine) {
      try { await ghPutBackup(loadSyncCfg(), json); if (st) { st.textContent = 'Backup salvo (local + cópia versionada no Git).'; st.className = 'sync-status ok'; } }
      catch (e) { console.error(e); if (st) { st.textContent = 'Backup local salvo. (Falha ao gravar cópia no Git.)'; st.className = 'sync-status warn'; } }
    } else if (st) { st.textContent = 'Backup local salvo.'; st.className = 'sync-status ok'; }
  } catch (e) { console.error(e); toast('Erro ao exportar backup: ' + e.message); }
}
async function ghPutBackup(cfg, jsonStr) {
  const path = 'backups/backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  const url = `${GH_API}/repos/${cfg.repo}/contents/${path}`;
  const body = { message: 'Backup ' + new Date().toISOString(), content: b64EncodeUtf8(jsonStr) };
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('GitHub ' + res.status);
}
function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || (!imported.reembolso && !imported.history)) { toast('Arquivo de backup inválido.'); return; }
      if (!confirm('Importar este backup e MESCLAR com os dados atuais?\n(Lançamentos mais recentes prevalecem; nada é perdido.)')) return;
      const merged = mergeDocs(currentDoc(), imported);
      applyDoc(merged);
      setDirty(true); scheduleSync();
      const st = $('bk-status'); if (st) { st.textContent = 'Backup importado e mesclado.'; st.className = 'sync-status ok'; }
      toast('Backup importado.');
    } catch (e) { console.error(e); toast('Não foi possível ler o arquivo: ' + e.message); }
  };
  reader.readAsText(file);
}
function setupBackupUI() {
  if (!$('bk-export')) return;
  $('bk-export').addEventListener('click', exportBackup);
  $('bk-import-btn').addEventListener('click', () => $('bk-import').click());
  $('bk-import').addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) importBackupFile(e.target.files[0]); e.target.value = ''; });
}

/* ---------------- Navegação (menu lateral + telas) ---------------- */
const VIEW_TITLES = { lancamentos: 'Lançamentos', relatorios: 'Relatórios mensais', config: 'Configurações' };

function openDrawer() { $('drawer').classList.add('open'); $('drawer-backdrop').classList.add('show'); }
function closeDrawer() { $('drawer').classList.remove('open'); $('drawer-backdrop').classList.remove('show'); }

function showView(name) {
  if (!VIEW_TITLES[name]) name = 'lancamentos';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = (v.id !== 'view-' + name); });
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  const ab = $('action-bar'); if (ab) ab.style.display = (name === 'lancamentos') ? '' : 'none';
  const nm = $('btn-new-month'); if (nm) nm.style.display = (name === 'lancamentos') ? '' : 'none';
  const ht = $('header-title'); if (ht) ht.textContent = VIEW_TITLES[name];
  if (name === 'relatorios') renderReports();
  window.scrollTo(0, 0);
}

function setupNav() {
  $('menu-toggle').addEventListener('click', openDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => { showView(b.dataset.view); closeDrawer(); }));
  showView('lancamentos');
}

/* Preenche os <select> de categoria (modal e filtro) a partir da config.
   Preserva a seleção atual quando a categoria ainda existir. */
function populateCategorySelects() {
  const cats = getCategorias();
  const opts = cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  const mc = $('m-categoria');
  if (mc) { const cur = mc.value; mc.innerHTML = '<option value="">Selecione…</option>' + opts; if (cats.indexOf(cur) >= 0) mc.value = cur; }
}

/* ---------------- Editor de categorias e limites ---------------- */
let catDraft = null;
function getCatDraft() { if (!catDraft) catDraft = getCatConfig().map((c) => Object.assign({}, c)); return catDraft; }
function setCatStatus(msg, cls) { const s = $('cat-status'); if (s) { s.textContent = msg || ''; s.className = 'sync-status' + (cls ? ' ' + cls : ''); } }
function renderCatEditor() {
  const box = $('cat-list'); if (!box) return;
  const rows = getCatDraft();
  box.innerHTML = rows.map((c, i) => `
    <div class="cat-row" data-i="${i}">
      <input type="text" class="cat-nome" data-i="${i}" value="${escapeHtml(c.nome)}" placeholder="Categoria" autocapitalize="words" />
      <input type="number" class="cat-lim" data-i="${i}" inputmode="decimal" min="0" step="0.01" value="${c.limite ? c.limite : ''}" placeholder="Limite R$" />
      <button type="button" class="hist-btn danger cat-del" data-i="${i}" aria-label="Remover categoria">✕</button>
    </div>`).join('');
}
function saveCatEditor() {
  const rows = getCatDraft();
  const seen = {}, out = [];
  for (const r of rows) {
    const nome = (r.nome || '').trim();
    if (!nome) continue;
    if (seen[nome]) { setCatStatus('Categoria repetida: ' + nome, 'err'); return; }
    seen[nome] = 1;
    out.push({ nome, limite: +r.limite || 0, grupo: (r.grupo || '').trim() || nome });
  }
  if (!out.length) { setCatStatus('Defina ao menos uma categoria.', 'err'); return; }
  state.config = { categorias: out };
  touchProfile();
  saveState();
  catDraft = null;
  populateCategorySelects();
  updateCatHint();
  render();
  renderCatEditor();
  setCatStatus('Categorias salvas.', 'ok');
}
function setupCatUI() {
  const box = $('cat-list'); if (!box) return;
  renderCatEditor();
  box.addEventListener('input', (e) => {
    const t = e.target, i = +t.dataset.i;
    if (isNaN(i) || !catDraft || !catDraft[i]) return;
    if (t.classList.contains('cat-nome')) catDraft[i].nome = t.value;
    else if (t.classList.contains('cat-lim')) catDraft[i].limite = +t.value || 0;
  });
  box.addEventListener('click', (e) => {
    const del = e.target.closest('.cat-del'); if (!del) return;
    getCatDraft().splice(+del.dataset.i, 1); renderCatEditor(); setCatStatus('');
  });
  $('cat-add').addEventListener('click', () => { getCatDraft().push({ nome: '', limite: 0, grupo: '' }); renderCatEditor(); });
  $('cat-save').addEventListener('click', saveCatEditor);
  $('cat-reset').addEventListener('click', () => {
    if (!confirm('Restaurar as categorias e limites padrão?')) return;
    catDraft = DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)); renderCatEditor(); setCatStatus('');
  });
}

/* ============================================================
   Leitura automática do comprovante (OCR via Google Gemini)
   ============================================================ */
const AI_KEY = 'despesas-soma-ai-v1';
const GEMINI_MODEL = 'gemini-2.5-flash';   // visão + JSON estruturado, barato
function loadAi() { try { return Object.assign({ key: '', enabled: true }, JSON.parse(localStorage.getItem(AI_KEY) || '{}')); } catch (e) { return { key: '', enabled: true }; } }
function saveAi(c) { try { localStorage.setItem(AI_KEY, JSON.stringify(c)); } catch (e) {} }
function aiConfigured() { const a = loadAi(); return !!a.key && a.enabled !== false; }

/* descrição padronizada: "Despesa de {Grupo} durante viagem a {Cidade}/{UF}" */
function buildDescricao(category, city, uf) {
  const grupo = grupoDaCategoria(category);
  const local = (city || '') + (uf ? ('/' + uf) : '');
  const head = grupo ? ('Despesa de ' + grupo) : 'Despesa';
  return local ? `${head} durante viagem a ${local}` : `${head} durante viagem`;
}

async function ocrReceipt(blob, mime) {
  const a = loadAi();
  if (!a.key) throw new Error('Chave do Gemini não configurada.');
  const b64 = String(await blobToDataUrl(blob)).split(',')[1];
  const mimeType = mime || blob.type || 'image/jpeg';   // Gemini lê imagem ou PDF
  const cats = getCategorias();
  const prompt = [
    'Você é um leitor de cupons fiscais e notas fiscais brasileiras (NF/NFC-e/cupom).',
    'Extraia da imagem os campos pedidos. Responda SOMENTE no JSON do schema.',
    '- nfNumber: número da nota/cupom (apenas dígitos; null se não houver).',
    '- date: data de emissão no formato AAAA-MM-DD (null se ilegível).',
    '- city / uf: cidade e UF do estabelecimento emissor (ex.: "Porto Seguro", "BA").',
    '- total: valor total pago, em reais, como número (ponto decimal).',
    '- category: escolha UMA destas categorias exatas: ' + cats.join(' | ') + '.',
    '  Refeições => a categoria de refeição correspondente; posto de combustível => Combustível;',
    '  pedágio => Pedágio; o restante => Outras Despesas.'
  ].join('\n');
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: b64 } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0,
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          nfNumber: { type: 'STRING', nullable: true },
          date: { type: 'STRING', nullable: true },
          city: { type: 'STRING', nullable: true },
          uf: { type: 'STRING', nullable: true },
          total: { type: 'NUMBER', nullable: true },
          category: { type: 'STRING', enum: cats, nullable: true }
        }
      }
    }
  };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(a.key);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j.error && j.error.message) m = j.error.message; } catch (e) {} throw new Error(m); }
  const j = await r.json();
  const c = j && j.candidates && j.candidates[0];
  const txt = c && c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text;
  if (!txt) throw new Error('Resposta vazia da IA.');
  const data = JSON.parse(txt);
  return {
    nfNumber: data.nfNumber ? String(data.nfNumber).replace(/\D/g, '') : '',
    dateISO: (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '',
    city: (data.city || '').trim(),
    uf: (data.uf || '').trim().toUpperCase(),
    total: (typeof data.total === 'number' && isFinite(data.total)) ? data.total : null,
    category: cats.indexOf(data.category) >= 0 ? data.category : ''
  };
}

/* preenche o modal só nos campos ainda vazios (não sobrescreve o que o usuário digitou) */
function fillFromOcr(ocr) {
  const dEl = $('m-data');
  if (ocr.dateISO && (!dEl.value || dEl.value === todayISO())) dEl.value = ocr.dateISO;
  const cEl = $('m-categoria');
  if (ocr.category && !cEl.value) { cEl.value = ocr.category; updateCatHint(); }
  const descEl = $('m-descricao');
  if (!descEl.value.trim()) descEl.value = buildDescricao(ocr.category, ocr.city, ocr.uf);
  const vEl = $('m-valor');
  if (ocr.total != null && !vEl.value.trim()) vEl.value = formatMoneyInput(ocr.total);
}
async function runReceiptOcr() {
  try {
    toast('Lendo comprovante…');
    const ocr = await ocrReceipt(modalPhoto.blob, modalPhoto.blob && modalPhoto.blob.type);
    modalPhoto.ocr = { nfNumber: ocr.nfNumber, dateISO: ocr.dateISO, city: ocr.city, uf: ocr.uf };
    fillFromOcr(ocr);
    toast('Comprovante lido — confira os campos.');
  } catch (e) { console.error(e); toast('Não consegui ler o comprovante: ' + e.message); }
}

/* nome do arquivo no Drive: "NF {nº} {DD.MM}" com os dados que houver */
function sanitizeFileName(s) { return String(s || '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function ddmm(iso) { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (m[2] + '.' + m[1]) : ''; }
function ddmmaaaa(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (m[3] + '.' + m[2] + '.' + m[1]) : ''; }
function receiptExt() { return (modalPhoto && modalPhoto.kind === 'pdf') ? '.pdf' : '.jpg'; }
function receiptFileName(entry) {
  const ext = receiptExt();
  const o = modalPhoto.ocr || {};
  const num = o.nfNumber || '';
  const ocrD = ddmm(o.dateISO);
  // com nº da NF: usa a data da NF ou, na falta, a data do lançamento
  if (num) return sanitizeFileName('NF ' + num + ((ocrD || ddmm(entry.data)) ? ' ' + (ocrD || ddmm(entry.data)) : '')) + ext;
  // sem nº, mas com data da NF detectada: "NF DD.MM"
  if (ocrD) return sanitizeFileName('NF ' + ocrD) + ext;
  // sem leitura da IA: usa a data digitada manualmente — "NF DD.MM.AAAA"
  return sanitizeFileName('NF ' + ddmmaaaa(entry.data || todayISO())) + ext;
}

function setAiStatus(msg, cls) { const s = $('ai-status'); if (s) { s.textContent = msg || ''; s.className = 'sync-status' + (cls ? ' ' + cls : ''); } }
function setupAiUI() {
  if (!$('ai-key')) return;
  const a = loadAi();
  $('ai-key').value = a.key || '';
  if ($('ai-enabled')) $('ai-enabled').checked = a.enabled !== false;
  const persist = () => saveAi({ key: ($('ai-key').value || '').trim(), enabled: $('ai-enabled') ? $('ai-enabled').checked : true });
  $('ai-key').addEventListener('change', () => { persist(); setAiStatus(aiConfigured() ? 'Pronto para ler comprovantes ✓' : 'Cole a chave para ativar.', aiConfigured() ? 'ok' : ''); });
  if ($('ai-enabled')) $('ai-enabled').addEventListener('change', () => { persist(); setAiStatus(aiConfigured() ? 'Leitura ativada ✓' : 'Leitura desativada.', aiConfigured() ? 'ok' : 'warn'); });
  if ($('ai-clear')) $('ai-clear').addEventListener('click', () => { saveAi({ key: '', enabled: true }); $('ai-key').value = ''; if ($('ai-enabled')) $('ai-enabled').checked = true; setAiStatus('Chave removida deste aparelho.', 'warn'); });
  setAiStatus(aiConfigured() ? 'Pronto para ler comprovantes ✓' : 'Não configurado.', aiConfigured() ? 'ok' : '');
}

/* ============================================================
   Comprovantes no Google Drive (escopo drive.file) + fila offline
   ============================================================ */
const GDRIVE_KEY = 'despesas-soma-gdrive-v1';
const GDDEL_KEY = 'despesas-soma-gddel-v1';   // fila de fileIds a excluir no Drive (retry ao reconectar)
const GD_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GD_FOLDER_NAME = 'Comprovantes - Despesas Soma';                 // raiz do reembolso (= nome legado, mantém os antigos)
const GD_FOLDER_SANTANDER = 'Comprovantes Cartao Santander - Despesas Soma';
const GD_ROOT_NAMES = { reembolso: GD_FOLDER_NAME, alelo: GD_FOLDER_SANTANDER };
let gdAccess = { token: '', exp: 0 };
let gdTokenClient = null;
let gdGisLoading = null;
let gdPending = null;

function loadGd() { try { return Object.assign({ clientId: '', folderId: '' }, JSON.parse(localStorage.getItem(GDRIVE_KEY) || '{}')); } catch (e) { return { clientId: '', folderId: '' }; } }
function saveGd(c) { try { localStorage.setItem(GDRIVE_KEY, JSON.stringify(c)); } catch (e) {} }
function gdConfigured() { return !!loadGd().clientId; }
function gdConnected() { return !!gdAccess.token && Date.now() < gdAccess.exp; }

function gdLoadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gdGisLoading) return gdGisLoading;
  gdGisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar o Google (você está online?).'));
    document.head.appendChild(s);
  });
  return gdGisLoading;
}

function gdInitClient(cfg) {
  gdTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.clientId,
    scope: GD_SCOPE,
    callback: (resp) => {
      if (resp && resp.access_token) {
        gdAccess = { token: resp.access_token, exp: Date.now() + ((resp.expires_in || 3600) - 60) * 1000 };
        if (gdPending) gdPending.resolve(resp.access_token);
      } else if (gdPending) { gdPending.reject(new Error('Autorização não concedida.')); }
      gdPending = null;
    }
  });
}

async function gdGetToken(interactive) {
  if (gdConnected()) return gdAccess.token;
  const cfg = loadGd();
  if (!cfg.clientId) throw new Error('Configure o Client ID do Google.');
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  await gdLoadGis();
  if (!gdTokenClient) gdInitClient(cfg);
  return new Promise((resolve, reject) => {
    gdPending = { resolve, reject };
    try { gdTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' }); }
    catch (e) { gdPending = null; reject(e); }
  });
}

async function gdEmail() {
  const t = await gdGetToken(false);
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('Drive ' + r.status);
  return (await r.json()).user.emailAddress;
}

function setDriveFolder(tabela, id) {
  if (!state.driveFolders) state.driveFolders = { reembolso: '', alelo: '' };
  if (state.driveFolders[tabela] === id) return;
  state.driveFolders[tabela] = id;
  if (tabela === 'reembolso') state.driveFolderId = id;   // mantém o campo legado coerente
  touchDoc(); saveState();                                 // propaga via dados.json
}

/* Raiz separada por tabela: 'reembolso' e 'alelo' (cartão Santander). */
async function gdEnsureFolder(tabela) {
  tabela = tabela || 'reembolso';
  // 1) id sincronizado entre dispositivos tem prioridade
  const known = state.driveFolders && state.driveFolders[tabela];
  if (known) return known;
  // 2) reembolso: aproveita o id legado / cache local (antes da separação de pastas)
  if (tabela === 'reembolso') {
    const legacy = state.driveFolderId || (loadGd().folderId || '');
    if (legacy) { setDriveFolder('reembolso', legacy); return legacy; }
  }
  // 3) procura por nome; se não achar, cria — e guarda o id (sincronizado)
  const name = GD_ROOT_NAMES[tabela] || GD_FOLDER_NAME;
  const t = await gdGetToken(false);
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  let r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', { headers: { Authorization: 'Bearer ' + t } });
  let j = await r.json();
  let id = j.files && j.files[0] && j.files[0].id;
  if (!id) {
    r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
    j = await r.json(); id = j.id;
  }
  setDriveFolder(tabela, id);
  return id;
}

/* Subpastas Ano/Mês dentro da pasta raiz (organiza os comprovantes por período). */
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const gdFolderCache = new Map();   // "pai|nome" -> id (evita queries repetidas na mesma sessão)

async function gdFindOrCreateChild(parentId, name, token) {
  const ck = parentId + '|' + name;
  if (gdFolderCache.has(ck)) return gdFolderCache.get(ck);
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`;
  let r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', { headers: { Authorization: 'Bearer ' + token } });
  let j = await r.json();
  let id = j.files && j.files[0] && j.files[0].id;
  if (!id) {
    r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    j = await r.json(); id = j.id;
  }
  gdFolderCache.set(ck, id);
  return id;
}

async function gdEnsureMonthFolder(dateISO, tabela) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateISO || '');
  const root = await gdEnsureFolder(tabela);
  if (!m) return root;   // sem data válida → cai na raiz (comportamento antigo)
  const ano = m[1], mesNome = MESES[parseInt(m[2], 10) - 1];
  if (!mesNome) return root;
  const t = await gdGetToken(false);
  const anoId = await gdFindOrCreateChild(root, ano, t);
  return await gdFindOrCreateChild(anoId, mesNome, t);
}

async function gdUpload(blob, name, dateISO, tabela) {
  const t = await gdGetToken(false);
  const folderId = dateISO ? await gdEnsureMonthFolder(dateISO, tabela) : await gdEnsureFolder(tabela);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', blob);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: form
  });
  if (!r.ok) throw new Error('Upload Drive ' + r.status);
  return (await r.json()).id;
}

async function gdDownloadBlob(fileId) {
  const t = await gdGetToken(false);
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('Download Drive ' + r.status);
  return await r.blob();
}

/* mês de referência do relatório → pasta única no Drive (vazio = organiza por data do lançamento) */
function reportFolderDateISO() { return state.reportMonth ? state.reportMonth + '-01' : null; }

/* ---- exclusão de comprovantes no Drive (com fila p/ retry offline) ---- */
function loadGdDel() { try { const a = JSON.parse(localStorage.getItem(GDDEL_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function saveGdDel(a) { try { localStorage.setItem(GDDEL_KEY, JSON.stringify(a)); } catch (e) {} }
function queueGdDelete(id) { if (!id) return; const a = loadGdDel(); if (!a.includes(id)) { a.push(id); saveGdDel(a); } }
function unqueueGdDelete(id) { saveGdDel(loadGdDel().filter((x) => x !== id)); }

async function gdDeleteFile(fileId) {
  const t = await gdGetToken(false);
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok && r.status !== 404 && r.status !== 403) throw new Error('Excluir Drive ' + r.status);   // 404/403 = já removido/sem acesso → tratar como ok
  return true;
}

async function flushGdDeletions(report) {
  const fila = loadGdDel();
  if (!fila.length) return { sent: 0, failed: 0 };
  if (!gdConfigured() || !gdConnected()) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (const id of fila) {
    try { await gdDeleteFile(id); unqueueGdDelete(id); sent++; }
    catch (err) { console.error('Falha ao excluir no Drive', err); failed++; }
  }
  if (report && sent) toast(sent + ' comprovante(s) removido(s) do Drive.');
  updateGdPending();
  return { sent, failed };
}

/* remove vínculos da foto: miniatura local, pendente offline e arquivo no Drive (ou enfileira) */
async function purgeEntryPhoto(entry) {
  if (!entry) return;
  idbDel('thumb_' + entry.id).catch(() => {});
  const foto = entry.foto;
  if (!foto) return;
  if (foto.pending) { idbDel('p_' + foto.pending).catch(() => {}); return; }
  if (foto.id) {
    if (gdConnected()) {
      try { await gdDeleteFile(foto.id); return; }
      catch (e) { console.error(e); }   // falhou → cai na fila
    }
    queueGdDelete(foto.id);
  }
}

/* ---- IndexedDB (fila de fotos pendentes / offline) ---- */
let _idb = null;
function idb() {
  if (_idb) return _idb;
  _idb = new Promise((resolve, reject) => {
    const req = indexedDB.open('despesas-soma', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('photos'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idb;
}
async function idbPut(key, val) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('photos', 'readonly'); const r = tx.objectStore('photos').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbDel(key) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

/* ---- Compressão de imagem (canvas) ---- */
function compressImage(file, maxDim, quality) {
  maxDim = maxDim || 1400; quality = quality || 0.72;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => blob ? resolve({ blob, w, h }) : reject(new Error('Falha ao processar imagem')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* ---- miniatura local (IndexedDB, não sincroniza) p/ a lista ---- */
async function saveThumb(entryId, blob) {
  try {
    const t = await compressImage(blob, 160, 0.6);
    await idbPut('thumb_' + entryId, await blobToDataUrl(t.blob));
  } catch (e) { /* miniatura é opcional */ }
}

/* ---- obtém o blob da foto de um lançamento (Drive ou fila local) ---- */
async function getPhotoBlob(foto) {
  if (!foto) return null;
  if (foto.pending) { const rec = await idbGet('p_' + foto.pending); return rec ? rec.blob : null; }
  if (foto.id) return await gdDownloadBlob(foto.id);
  return null;
}

/* ---- envia fotos que ficaram pendentes (offline) quando reconectar ---- */
function countPendingPhotos() {
  let n = 0;
  for (const t of ['reembolso', 'alelo']) for (const e of state[t]) if (e.foto && e.foto.pending) n++;
  return n;
}
/* pendências do Drive = fotos a enviar + exclusões a propagar (gate do pop-up) */
function countPendingDrive() { return countPendingPhotos() + loadGdDel().length; }
function updateGdPending() {
  const b = $('gd-flush'); if (!b) return;
  const env = countPendingPhotos(), del = loadGdDel().length;
  if ((env > 0 || del > 0) && gdConfigured()) {
    b.style.display = '';
    b.textContent = del > 0
      ? 'Sincronizar Drive (' + env + ' envio(s), ' + del + ' exclusão(ões))'
      : 'Enviar ' + env + ' comprovante(s) pendente(s)';
  } else b.style.display = 'none';
}

async function flushPendingPhotos(report) {
  if (!gdConfigured() || !gdConnected()) { if (report) setGdStatus('Conecte o Google para enviar os pendentes.', 'warn'); return { sent: 0, failed: 0 }; }
  let sent = 0, failed = 0, lastErr = '';
  for (const tabela of ['reembolso', 'alelo']) {
    for (const e of state[tabela]) {
      if (e.foto && e.foto.pending) {
        try {
          const rec = await idbGet('p_' + e.foto.pending);
          if (!rec) { e.foto = null; continue; }
          const id = await gdUpload(rec.blob, rec.name, reportFolderDateISO() || e.data || rec.data, tabela);
          await idbDel('p_' + e.foto.pending);
          e.foto = { id, name: rec.name, w: e.foto.w, h: e.foto.h };
          e.updatedAt = Date.now();
          sent++;
        } catch (err) { console.error('Falha ao enviar foto pendente', err); failed++; lastErr = err.message; }
      }
    }
  }
  if (sent) { touchDoc(); saveState(); render(); }
  if (report) {
    if (failed) setGdStatus('Enviados: ' + sent + ' · falharam: ' + failed + ' (' + lastErr + ')', 'err');
    else if (sent) setGdStatus(sent + ' comprovante(s) enviado(s) ao Drive ✓', 'ok');
    else setGdStatus('Nenhum comprovante pendente.', 'ok');
  } else if (sent) { toast(sent + ' comprovante(s) enviado(s) ao Drive.'); }
  updateGdPending();
  return { sent, failed };
}

async function viewPhoto(foto, entryId) {
  try {
    toast('Abrindo comprovante…');
    const blob = await getPhotoBlob(foto);
    if (!blob) { toast('Comprovante não encontrado.'); return; }
    if (entryId) { idbGet('thumb_' + entryId).then((t) => { if (!t) saveThumb(entryId, blob); }); }   // cacheia miniatura (ex.: foto vinda de outro aparelho)
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { console.error(e); toast('Erro ao abrir: ' + e.message); }
}

function setupGDriveUI() {
  const cfg = loadGd();
  if ($('gd-client')) $('gd-client').value = cfg.clientId || '';
  refreshGdStatus();
  if (!$('gd-connect')) return;
  $('gd-client').addEventListener('change', () => {
    const c = loadGd(); c.clientId = ($('gd-client').value || '').trim();
    if (c.clientId !== loadGd().clientId) c.folderId = '';   // troca de projeto reseta pasta
    saveGd(c); refreshGdStatus();
  });
  $('gd-connect').addEventListener('click', () => gdConnectFlow());
  $('gd-flush').addEventListener('click', async () => {
    const c = loadGd();
    if (!c.clientId) { setGdStatus('Cole o Client ID primeiro.', 'warn'); return; }
    setGdStatus('Enviando comprovantes pendentes…');
    try {
      await gdGetToken(true);
      await gdEnsureFolder();
      await flushPendingPhotos(true);
      await flushGdDeletions(true);
    } catch (e) { console.error(e); setGdStatus('Erro: ' + e.message, 'err'); }
  });
  updateGdPending();
  $('gd-clear').addEventListener('click', () => {
    if (!confirm('Desconectar o Google Drive deste aparelho?')) return;
    gdAccess = { token: '', exp: 0 };
    const c = loadGd(); localStorage.removeItem(GDRIVE_KEY);
    $('gd-client').value = '';
    refreshGdStatus();
    toast('Google Drive desconectado.');
  });
}
function setGdStatus(msg, kind) { const el = $('gd-status'); if (el) { el.textContent = msg; el.className = 'sync-status' + (kind ? ' ' + kind : ''); } }
function refreshGdStatus() {
  updateGdPending();
  if (!gdConfigured()) { setGdStatus('Não configurado.', ''); return; }
  setGdStatus(gdConnected() ? 'Conectado ✓' : 'Configurado. Toque em “Conectar Google”.', gdConnected() ? 'ok' : '');
}

/* ---- Conexão do Drive: fluxo único + reconexão silenciosa + popup ao abrir ---- */
async function gdConnectFlow() {
  const c = loadGd();
  if (!c.clientId) { setGdStatus('Cole o Client ID primeiro.', 'warn'); return false; }
  setGdStatus('Conectando ao Google…');
  try {
    await gdGetToken(true);
    const email = await gdEmail();
    await gdEnsureFolder();
    setGdStatus('Conectado como ' + email + ' ✓', 'ok');
    await flushPendingPhotos(true);
    await flushGdDeletions(true);
    return true;
  } catch (e) { console.error(e); setGdStatus('Erro: ' + e.message, 'err'); return false; }
}

async function gdSilentReconnect() {
  if (!gdConfigured() || !navigator.onLine || gdConnected()) return gdConnected();
  try {
    // sem UI: só funciona se a sessão Google ainda vale; timeout evita travar se o callback não vier
    await Promise.race([
      gdGetToken(false),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
    ]);
    await gdEnsureFolder();
    refreshGdStatus();
    await flushPendingPhotos(false);
    await flushGdDeletions(false);
    return true;
  } catch (e) { return false; }
}

function showDriveConnectNotice() {
  if ($('gd-connect-notice')) return;
  const pend = countPendingDrive();
  const div = document.createElement('div');
  div.id = 'gd-connect-notice';
  div.className = 'offline-notice';
  div.innerHTML = `
    <div class="offline-card">
      <div class="offline-icon">☁️</div>
      <h3>Conecte ao Google Drive</h3>
      <p>É preciso conectar para enviar seus comprovantes ao Drive.${pend ? ' Você tem <b>' + pend + '</b> comprovante(s) aguardando envio.' : ''}</p>
      <div class="notice-actions">
        <button class="btn btn-excel" id="gd-notice-connect">Conectar agora</button>
        <button class="btn btn-ghost" id="gd-notice-later">Agora não</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  $('gd-notice-later').addEventListener('click', () => div.remove());
  $('gd-notice-connect').addEventListener('click', async () => {
    $('gd-notice-connect').disabled = true;
    const ok = await gdConnectFlow();
    if (ok) { div.remove(); toast('Google Drive conectado.'); }
    else { $('gd-notice-connect').disabled = false; toast('Não foi possível conectar. Tente de novo.'); }
  });
}

async function maybePromptDrive() {
  if (!gdConfigured() || !navigator.onLine || gdConnected()) return;
  const ok = await gdSilentReconnect();                  // sem UI; já envia/expurga pendentes se a sessão valer
  if (ok) return;
  if (countPendingDrive() > 0) showDriveConnectNotice();  // só incomoda se há comprovante a enviar/excluir
}

/* ---------------- Modo escuro ---------------- */
function currentTheme() {
  const p = localStorage.getItem(THEME_KEY);
  if (p === 'dark' || p === 'light') return p;
  return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme() {
  const t = currentTheme();
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('theme-toggle');
  if (btn) { btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 22); btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#201a17' : '#b3262d');
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme();
}
function setupTheme() {
  applyTheme();
  if ($('theme-toggle')) $('theme-toggle').addEventListener('click', toggleTheme);
  if (window.matchMedia) {
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme();   // segue o sistema só sem escolha manual
      });
    } catch (e) {}
  }
}

/* ---------------- Persistência de campos ---------------- */
function bindField(id, getter, setter) {
  const el = $(id);
  el.addEventListener('input', () => { setter(el.value); touchProfile(); saveState(); });
  el.addEventListener('change', () => { setter(el.value); touchProfile(); saveState(); render(); });
}

function newMonth() {
  const tem = state.reembolso.length || state.alelo.length;
  const msg = tem
    ? 'Arquivar o mês atual e começar um novo?\nOs lançamentos atuais vão para o Histórico (você pode reabrir/reexportar depois).'
    : 'Iniciar um novo mês?';
  if (!confirm(msg)) return;
  const now = Date.now();
  // arquiva snapshot do mês atual
  if (tem) {
    state.history.unshift({
      id: uid(),
      archivedAt: now,
      label: monthLabelFor(state),
      funcionario: state.funcionario,
      dataSolicitacao: state.dataSolicitacao,
      referente: state.referente,
      reportMonth: state.reportMonth || '',
      bank: Object.assign({}, state.bank),
      reembolso: state.reembolso.map((e) => Object.assign({}, e)),
      alelo: state.alelo.map((e) => Object.assign({}, e))
    });
  }
  for (const t of ['reembolso', 'alelo']) {
    for (const e of state[t]) state.tomb[t][e.id] = now;   // lápides p/ a sincronização
    state[t] = [];
  }
  state.dataSolicitacao = '';
  state.reportMonth = '';
  touchProfile();
  saveState();
  render();
  toast(tem ? 'Mês arquivado no histórico.' : 'Pronto para um novo mês.');
}

/* copia os dados bancários formatados (p/ colar no e-mail de reembolso) */
async function copyBankData() {
  const b = state.bank || {};
  const linhas = [
    ['Nome', b.nome], ['CPF', b.cpf], ['Banco', b.banco],
    ['Agência', b.agencia], ['Conta', b.conta], ['Chave Pix', b.pix]
  ].filter((x) => (x[1] || '').trim());
  if (!linhas.length) { toast('Preencha os dados bancários primeiro.'); return; }
  const txt = linhas.map((x) => x[0] + ': ' + x[1]).join('\n');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
    else { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('Dados bancários copiados.');
  } catch (e) { console.error(e); toast('Não foi possível copiar.'); }
}

/* ---------------- Inicialização ---------------- */
function init() {
  maybeLock();
  render();

  maskCurrencyEl($('m-valor'));
  maskCpfEl($('bk-cpf'));

  bindField('funcionario', null, (v) => state.funcionario = v);
  bindField('dataSolicitacao', null, (v) => state.dataSolicitacao = v);
  bindField('referente', null, (v) => state.referente = v);
  if ($('reportMonth')) bindField('reportMonth', null, (v) => state.reportMonth = v);
  bindField('bk-nome', null, (v) => state.bank.nome = v);
  bindField('bk-cpf', null, (v) => state.bank.cpf = v);
  bindField('bk-banco', null, (v) => state.bank.banco = v);
  bindField('bk-agencia', null, (v) => state.bank.agencia = v);
  bindField('bk-conta', null, (v) => state.bank.conta = v);
  bindField('bk-pix', null, (v) => state.bank.pix = v);
  if ($('bk-copy')) $('bk-copy').addEventListener('click', copyBankData);

  document.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => openModal(btn.dataset.add, null)));
  document.querySelectorAll('[data-repeat]').forEach((btn) =>
    btn.addEventListener('click', () => repeatLast(btn.dataset.repeat)));

  $('m-save').addEventListener('click', saveEntry);
  $('m-cancel').addEventListener('click', closeModal);
  $('m-delete').addEventListener('click', deleteEntry);
  $('m-duplicate').addEventListener('click', duplicateInModal);
  $('m-categoria').addEventListener('change', updateCatHint);
  $('m-foto-attach').addEventListener('click', () => $('m-foto-file').click());
  $('m-foto-change').addEventListener('click', () => $('m-foto-import').click());
  if ($('m-foto-importbtn')) $('m-foto-importbtn').addEventListener('click', () => $('m-foto-import').click());
  $('m-foto-file').addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; onPhotoSelected(f); });
  if ($('m-foto-import')) $('m-foto-import').addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; onPhotoSelected(f); });
  $('m-foto-view').addEventListener('click', () => viewPhoto(modalPhoto.existing));
  $('m-foto-remove').addEventListener('click', () => { modalPhoto = { mode: 'remove', existing: modalPhoto.existing, blob: null, dataUrl: null, w: 0, h: 0 }; renderModalPhoto(); });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

  $('btn-excel').addEventListener('click', () => openExportChooser('excel', state));
  $('btn-pdf').addEventListener('click', () => openExportChooser('pdf', state));
  $('btn-new-month').addEventListener('click', newMonth);

  $('exp-cancel').addEventListener('click', closeExportModal);
  $('exp-confirm').addEventListener('click', confirmExport);
  $('exp-reembolso').addEventListener('change', updateExportHint);
  $('exp-alelo').addEventListener('change', updateExportHint);
  $('export-modal').addEventListener('click', (e) => { if (e.target === $('export-modal')) closeExportModal(); });

  setupIcons();
  populateCategorySelects();
  setupNav();
  setupTheme();
  setupServiceWorker();
  setupConnectivity();
  setupSyncUI();
  setupSecurityUI();
  setupBackupUI();
  setupGDriveUI();
  setupCatUI();
  setupAiUI();
  updateFooter();
  updateSyncIndicator();
  $('sync-ind').addEventListener('click', () => syncNow(false));

  // sincronização inicial ao abrir (puxa o que houver de outro dispositivo)
  if (isSyncConfigured() && navigator.onLine) syncNow(true);

  // ao voltar a ficar online, envia o que ficou pendente offline (o merge decide
  // se o mais recente é do servidor ou deste aparelho)
  window.addEventListener('online', () => {
    if (isSyncConfigured()) {
      if (isDirty()) toast('Conexão restaurada — enviando lançamentos…');
      syncNow(true);
    }
    flushPendingPhotos();
    flushGdDeletions(false);
  });

  // ao voltar para o app (reabrir/trazer ao foco), sincroniza para pegar a
  // versão mais recente e enviar pendências
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (isSyncConfigured() && navigator.onLine) syncNow(true);
    maybePromptDrive();
  });

  // popup de conexão do Drive ao abrir (se houver bloqueio, dispara após o desbloqueio)
  if (!lockEnabled()) maybePromptDrive();
}

/* ---------------- Auto-atualização (Service Worker) ---------------- */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

  navigator.serviceWorker.register('sw.js').then((reg) => {
    // procura nova versão ao abrir e periodicamente
    reg.update();
    setInterval(() => reg.update(), 60000);

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Atualizando para a versão mais recente…');
        }
      });
    });
  }).catch(() => {});

  // quando o novo Service Worker assume o controle, recarrega 1x p/ aplicar
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  // ao voltar para o app, checa se há atualização
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((r) => { if (r) r.update(); });
    }
  });
}

/* ---------------- Aviso de offline ---------------- */
function setupConnectivity() {
  if (!navigator.onLine) showOfflineNotice();
  window.addEventListener('offline', () => { showOfflineNotice(); updateSyncIndicator(); });
  window.addEventListener('online', () => { const n = $('offline-notice'); if (n) n.remove(); updateSyncIndicator(); maybePromptDrive(); });
}

function showOfflineNotice() {
  if ($('offline-notice')) return;
  const div = document.createElement('div');
  div.id = 'offline-notice';
  div.className = 'offline-notice';
  div.innerHTML = `
    <div class="offline-card">
      <div class="offline-icon">📡</div>
      <h3>Você está offline</h3>
      <p>O app pode não estar na versão mais recente. Conecte-se à internet para
         garantir a atualização automática e a sincronização dos lançamentos.</p>
      <button class="btn btn-pdf" id="offline-ok">Entendi</button>
    </div>`;
  document.body.appendChild(div);
  $('offline-ok').addEventListener('click', () => div.remove());
}

document.addEventListener('DOMContentLoaded', init);
