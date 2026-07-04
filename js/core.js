'use strict';

/* ============================================================
   Lançamentos de Despesas — Soma Urbanismo
   Armazena lançamentos no celular e gera o relatório
   em Excel (idêntico ao modelo) e PDF.
   ============================================================ */

const STORE_KEY = 'despesas-soma-v1';
const SYNC_KEY = 'despesas-soma-sync-v1';
const LASTSYNC_KEY = 'despesas-soma-lastsync-v1';
const APP_VERSION = 'v51';   // manter igual ao CACHE em sw.js
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

/* Categorias do módulo Finanças (controle pessoal) — separadas das corporativas acima.
   Configuração efetiva em state.finConfig.categorias (editável, sincroniza como perfil). */
const FIN_DEFAULT_CATEGORIAS = [
  { nome: 'Alimentação', tipo: 'despesa', icone: 'utensils', cor: '#e74c3c', subcategorias: [] },
  { nome: 'Mercado', tipo: 'despesa', icone: 'shopping-cart', cor: '#27ae60', subcategorias: [] },
  { nome: 'Transporte', tipo: 'despesa', icone: 'car', cor: '#2980b9', subcategorias: [] },
  { nome: 'Moradia', tipo: 'despesa', icone: 'home', cor: '#8e44ad', subcategorias: [] },
  { nome: 'Contas & Serviços', tipo: 'despesa', icone: 'file-text', cor: '#16a085', subcategorias: [] },
  { nome: 'Saúde', tipo: 'despesa', icone: 'heart-pulse', cor: '#e84393', subcategorias: [] },
  { nome: 'Educação', tipo: 'despesa', icone: 'graduation-cap', cor: '#2c3e50', subcategorias: [] },
  { nome: 'Lazer', tipo: 'despesa', icone: 'gamepad-2', cor: '#f39c12', subcategorias: [] },
  { nome: 'Assinaturas', tipo: 'despesa', icone: 'repeat', cor: '#9b59b6', subcategorias: [] },
  { nome: 'Vestuário', tipo: 'despesa', icone: 'shirt', cor: '#e67e22', subcategorias: [] },
  { nome: 'Viagem', tipo: 'despesa', icone: 'send', cor: '#1abc9c', subcategorias: [] },
  { nome: 'Pets', tipo: 'despesa', icone: 'paw-print', cor: '#d35400', subcategorias: [] },
  { nome: 'Impostos & Taxas', tipo: 'despesa', icone: 'landmark', cor: '#7f8c8d', subcategorias: [] },
  { nome: 'Trabalho', tipo: 'despesa', icone: 'briefcase', cor: '#34495e', subcategorias: [] },
  { nome: 'Pagamento de fatura', tipo: 'despesa', icone: 'credit-card', cor: '#c0392b', subcategorias: [] },
  { nome: 'Outros', tipo: 'despesa', icone: 'more-horizontal', cor: '#95a5a6', subcategorias: [] },
  { nome: 'Salário', tipo: 'receita', icone: 'banknote', cor: '#2ecc71', subcategorias: [] },
  { nome: 'Freelance', tipo: 'receita', icone: 'laptop', cor: '#3498db', subcategorias: [] },
  { nome: 'Rendimentos', tipo: 'receita', icone: 'trending-up', cor: '#00b894', subcategorias: [] },
  { nome: 'Reembolso', tipo: 'receita', icone: 'refresh-cw', cor: '#0984e3', subcategorias: [] },
  { nome: 'Outras receitas', tipo: 'receita', icone: 'plus-circle', cor: '#6ab04c', subcategorias: [] }
];

/* Paleta de cores e ícones oferecidos no editor de categorias de Finanças. */
const FIN_CAT_COLORS = [
  '#e74c3c', '#e84393', '#e67e22', '#f39c12', '#f1c40f', '#2ecc71', '#27ae60', '#1abc9c',
  '#16a085', '#3498db', '#2980b9', '#0984e3', '#9b59b6', '#8e44ad', '#34495e', '#95a5a6'
];
const FIN_CAT_ICON_CHOICES = [
  'utensils', 'shopping-cart', 'car', 'home', 'file-text', 'heart-pulse', 'graduation-cap',
  'gamepad-2', 'shirt', 'send', 'paw-print', 'briefcase', 'landmark', 'credit-card', 'wallet',
  'receipt', 'banknote', 'laptop', 'trending-up', 'plus-circle', 'repeat', 'refresh-cw',
  'calendar', 'camera', 'settings', 'more-horizontal'
];

function normalizeFinConfig(cfg) {
  const arr = (cfg && Array.isArray(cfg.categorias)) ? cfg.categorias : null;
  const list = (arr && arr.length)
    ? arr.map((c) => ({
        nome: String(c.nome || '').trim(),
        tipo: c.tipo === 'receita' ? 'receita' : 'despesa',
        icone: String(c.icone || '').trim(),
        cor: String(c.cor || '').trim(),
        subcategorias: Array.from(new Set((Array.isArray(c.subcategorias) ? c.subcategorias : [])
          .map((s) => String(s || '').trim()).filter(Boolean)))
      })).filter((c) => c.nome)
    : FIN_DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c));
  return { categorias: list.length ? list : FIN_DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)) };
}

/* ---------------- Estado ---------------- */
function emptyState() {
  return {
    funcionario: '',
    dataSolicitacao: '',
    referente: '',
    reportMonths: { reembolso: '', alelo: '' },  // mês de referência (YYYY-MM) por relatório: pasta dos comprovantes no Drive
    santPeriodo: { start: '', end: '' },  // Período de Prestação do Cartão Santander (datas ISO escolhidas pelo usuário)
    bank: { nome: '', cpf: '', banco: '', agencia: '', conta: '', pix: '' },
    reembolso: [],
    alelo: [],
    history: [],                          // meses arquivados (snapshots)
    histTomb: {},                         // lápides do histórico: id -> ts
    driveFolderId: '',                    // (legado) pasta única dos comprovantes; migra p/ a raiz de reembolso
    driveFolders: { reembolso: '', alelo: '' },  // pastas raiz separadas no Drive (sincronizadas)
    config: { categorias: DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)) },  // categorias + limites
    finContas: [],                        // finanças pessoais: contas {id,nome,instituicao,tipo,saldoInicial,arquivada,updatedAt}
    finCartoes: [],                       // cartões de crédito {id,nome,bandeira,limite,diaFechamento,diaVencimento,arquivado,updatedAt}
    finTx: [],                            // transações {id,data,descricao,valor,tipo,categoria,contaId,cartaoId,reembolsavel,pagamentoCartaoId,origemImport,updatedAt, parcela?:{atual,total,grupo,base}}
    finConfig: { categorias: FIN_DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)) },  // categorias do módulo Finanças
    finArquivo: {},                       // agregados de anos arquivados: {'2025':{receitas,despesas,porCategoria}}
    tomb: { reembolso: {}, alelo: {}, finContas: {}, finCartoes: {}, finTx: {} },   // lápides: id -> updatedAt (deleções)
    pending: [],                          // comprovantes no Drive sem lançamento (revisar manualmente)
    driveKnown: {},                       // fileIds já vistos pela varredura (não reprocessa)
    driveDismissed: {},                   // fileIds descartados pelo usuário (não reaparecem)
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
      meta: Object.assign(base.meta, s.meta || {}),
      santPeriodo: Object.assign(base.santPeriodo, s.santPeriodo || {})
    });
    st.tomb.reembolso = st.tomb.reembolso || {};
    st.tomb.alelo = st.tomb.alelo || {};
    st.history = Array.isArray(st.history) ? st.history : [];
    st.histTomb = st.histTomb || {};
    st.driveFolderId = st.driveFolderId || '';
    st.driveFolders = Object.assign({ reembolso: '', alelo: '' }, st.driveFolders || {});
    if (!st.driveFolders.reembolso && st.driveFolderId) st.driveFolders.reembolso = st.driveFolderId;   // migração: raiz legada vira a de reembolso
    st.reportMonths = Object.assign({ reembolso: '', alelo: '' }, st.reportMonths || {});
    if (typeof s.reportMonth === 'string' && s.reportMonth) {   // migração: mês único legado → ambos os relatórios
      if (!st.reportMonths.reembolso) st.reportMonths.reembolso = s.reportMonth;
      if (!st.reportMonths.alelo) st.reportMonths.alelo = s.reportMonth;
    }
    delete st.reportMonth;
    st.pending = Array.isArray(st.pending) ? st.pending : [];
    st.driveKnown = st.driveKnown || {};
    st.driveDismissed = st.driveDismissed || {};
    st.config = normalizeCatConfig(st.config);
    // migração: módulo Finanças (estados antigos não têm esses ramos)
    st.finConfig = normalizeFinConfig(st.finConfig);
    st.finArquivo = st.finArquivo || {};
    for (const t of ['finContas', 'finCartoes', 'finTx']) {
      st[t] = Array.isArray(st[t]) ? st[t] : [];
      st.tomb[t] = st.tomb[t] || {};
    }
    // migração: garante updatedAt nas entradas e relógio do doc se for estado antigo
    for (const t of ['reembolso', 'alelo', 'finContas', 'finCartoes', 'finTx']) {
      st[t] = (st[t] || []).map((e) => e.updatedAt ? e : Object.assign({}, e, { updatedAt: Date.now() }));
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
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  /* ícones das categorias do módulo Finanças (finConfig.categorias[].icone) */
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  car: '<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>',
  'heart-pulse': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/><path d="M3.22 8.5h1.5l1.3-2 1.94 4 1.3-2h9.5"/>',
  'graduation-cap': '<path d="M21.42 10.92 12 5.5 2.58 10.92a1 1 0 0 0 0 1.75l9.42 5.83 9.42-5.83a1 1 0 0 0 0-1.75Z"/><path d="M22 10v6"/><path d="M6 12.5V17c0 1.1 2.7 3 6 3s6-1.9 6-3v-4.5"/>',
  'gamepad-2': '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>',
  send: '<path d="M2 12 20 4l-7 18-3-8-8-2Z"/>',
  'paw-print': '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="15" r="2"/><path d="M9 10a5 5 0 0 0-5 5v3.5a3.5 3.5 0 0 0 6.84 1.05A4.5 4.5 0 0 1 15 16.5v-3a5 5 0 0 0-5-5Z"/>',
  briefcase: '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01"/><path d="M18 12h.01"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m-1 0h18l1.28 2.55a1 1 0 0 1-.9 1.45H2.62a1 1 0 0 1-.9-1.45Z"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'plus-circle': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>'
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

