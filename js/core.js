'use strict';

/* ============================================================
   Lançamentos de Despesas — Soma Urbanismo
   Armazena lançamentos no celular e gera o relatório
   em Excel (idêntico ao modelo) e PDF.
   ============================================================ */

const STORE_KEY = 'despesas-soma-v1';
const SYNC_KEY = 'despesas-soma-sync-v1';
const LASTSYNC_KEY = 'despesas-soma-lastsync-v1';
const APP_VERSION = 'v64';   // manter igual ao CACHE em sw.js
const LOCK_KEY = 'despesas-soma-lock-v1';
const THEME_KEY = 'despesas-soma-theme-v1';
/* Empresa, logo, cores e pastas ficam por MÓDULO em js/modules.js (MODULOS/MOD). */

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

/* ---------------- Estado ----------------
   Tudo que é "por relatório" é indexado pela chave do módulo (js/modules.js):
   perfis / reportMonths / driveFolders / tomb + a própria lista de lançamentos. */
function emptyState() {
  const st = {
    perfis: mapPorTabela(() => perfilVazio()),   // cabeçalho + dados bancários + período POR módulo
    reportMonths: mapPorTabela(() => ''),        // mês de referência (YYYY-MM): pasta dos comprovantes no Drive
    history: [],                          // meses arquivados (snapshots)
    histTomb: {},                         // lápides do histórico: id -> ts
    driveFolderId: '',                    // (legado) pasta única dos comprovantes; migra p/ a raiz de reembolso
    driveFolders: mapPorTabela(() => ''), // pastas raiz separadas no Drive (sincronizadas)
    config: { categorias: DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)) },  // categorias + limites
    tomb: mapPorTabela(() => ({})),       // lápides: id -> updatedAt (deleções)
    pending: [],                          // comprovantes no Drive sem lançamento (revisar manualmente)
    driveKnown: {},                       // fileIds já vistos pela varredura (não reprocessa)
    driveDismissed: {},                   // fileIds descartados pelo usuário (não reaparecem)
    meta: { updatedAt: 0, profileUpdatedAt: 0 }
  };
  for (const t of TABELAS) st[t] = [];    // listas de lançamentos
  return st;
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
      tomb: Object.assign(base.tomb, s.tomb || {}),
      meta: Object.assign(base.meta, s.meta || {})
    });
    st.history = Array.isArray(st.history) ? st.history : [];
    st.histTomb = st.histTomb || {};
    st.driveFolderId = st.driveFolderId || '';
    st.driveFolders = Object.assign(mapPorTabela(() => ''), st.driveFolders || {});
    if (!st.driveFolders[TABELA_PADRAO] && st.driveFolderId) st.driveFolders[TABELA_PADRAO] = st.driveFolderId;   // migração: raiz legada vira a de reembolso
    st.reportMonths = Object.assign(mapPorTabela(() => ''), st.reportMonths || {});
    if (typeof s.reportMonth === 'string' && s.reportMonth) {   // migração: mês único legado → os relatórios que já existiam
      for (const t of ['reembolso', 'alelo']) if (!st.reportMonths[t]) st.reportMonths[t] = s.reportMonth;
    }
    delete st.reportMonth;
    // perfis por módulo; migração do cabeçalho/banco/período que ficavam na raiz
    st.perfis = Object.assign(mapPorTabela(() => perfilVazio()), st.perfis || {});
    for (const t of TABELAS) st.perfis[t] = normalizePerfil(st.perfis[t]);
    if (!s.perfis) {
      const p = st.perfis[TABELA_PADRAO];
      p.funcionario = s.funcionario || '';
      p.dataSolicitacao = s.dataSolicitacao || '';
      p.referente = s.referente || '';
      p.bank = Object.assign(p.bank, s.bank || {});
      if (st.perfis.alelo) {
        st.perfis.alelo.funcionario = s.funcionario || '';   // o cartão usava o mesmo funcionário
        st.perfis.alelo.santPeriodo = Object.assign(st.perfis.alelo.santPeriodo, s.santPeriodo || {});
      }
    }
    delete st.funcionario; delete st.dataSolicitacao; delete st.referente;
    delete st.bank; delete st.santPeriodo;
    st.pending = Array.isArray(st.pending) ? st.pending : [];
    st.driveKnown = st.driveKnown || {};
    st.driveDismissed = st.driveDismissed || {};
    st.config = normalizeCatConfig(st.config);
    // migração: garante updatedAt nas entradas e relógio do doc se for estado antigo
    for (const t of TABELAS) {
      st.tomb[t] = st.tomb[t] || {};
      st[t] = (Array.isArray(st[t]) ? st[t] : []).map((e) => e.updatedAt ? e : Object.assign({}, e, { updatedAt: Date.now() }));
    }
    if (!s.meta) st.meta = { updatedAt: Date.now(), profileUpdatedAt: Date.now() };
    return st;
  } catch (e) {
    return emptyState();
  }
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn('saveState falhou (localStorage cheio/indisponível)', e); }
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
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  'credit-card': '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  landmark: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>'
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

