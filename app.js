'use strict';

/* ============================================================
   Lançamentos de Despesas — Soma Urbanismo
   Armazena lançamentos no celular e gera o relatório
   em Excel (idêntico ao modelo) e PDF.
   ============================================================ */

const STORE_KEY = 'despesas-soma-v1';
const SYNC_KEY = 'despesas-soma-sync-v1';
const LASTSYNC_KEY = 'despesas-soma-lastsync-v1';
const APP_VERSION = 'v14';   // manter igual ao CACHE em sw.js
const LOCK_KEY = 'despesas-soma-lock-v1';
const THEME_KEY = 'despesas-soma-theme-v1';
const EMPRESA = 'Soma Urbanismo S/A';

const CATEGORIAS = ['Café da Manha', 'Almoço', 'Café da Tarde', 'Jantar', 'Combustível', 'Pedágio', 'Outras Despesas'];

/* ---------------- Estado ---------------- */
function emptyState() {
  return {
    funcionario: '',
    dataSolicitacao: '',
    referente: '',
    bank: { nome: '', cpf: '', banco: '', agencia: '', conta: '', pix: '' },
    reembolso: [],
    alelo: [],
    history: [],                          // meses arquivados (snapshots)
    histTomb: {},                         // lápides do histórico: id -> ts
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

/* ---------------- Renderização ---------------- */
function render() {
  $('funcionario').value = state.funcionario;
  $('dataSolicitacao').value = state.dataSolicitacao;
  $('referente').value = state.referente;
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

function renderList(tabela, ul) {
  const list = state[tabela];
  ul.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty-list';
    li.textContent = 'Nenhum lançamento ainda.';
    ul.appendChild(li);
    return;
  }
  for (const e of list) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.dataset.id = e.id;
    li.dataset.tabela = tabela;
    li.innerHTML = `
      <div class="e-main">
        <div class="e-desc">${escapeHtml(e.descricao || '(sem descrição)')}</div>
        <div class="e-meta"><span class="cat-tag">${escapeHtml(e.categoria || '—')}</span>${fmtDateBR(e.data)}</div>
      </div>
      <div class="e-val">${formatMoney(e.valor)}</div>`;
    li.addEventListener('click', () => openModal(tabela, e.id));
    ul.appendChild(li);
  }
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

  $('modal').classList.add('open');
  setTimeout(() => $('m-descricao').focus(), 150);
}

function closeModal() { $('modal').classList.remove('open'); }

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
  const cat = $('m-categoria').value;
  let hint = '';
  if (cat === 'Almoço' || cat === 'Jantar') hint = 'Limite de reembolso: R$ 70,00';
  else if (cat === 'Café da Manha' || cat === 'Café da Tarde') hint = 'Limite de reembolso: R$ 30,00';
  $('m-cat-hint').textContent = hint;
}

function saveEntry() {
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

  const now = Date.now();
  if (id) {
    const e = state[tabela].find((x) => x.id === id);
    if (e) Object.assign(e, { data, descricao, categoria, valor, updatedAt: now });
  } else {
    state[tabela].push({ id: uid(), data, descricao, categoria, valor, updatedAt: now });
  }
  touchDoc();
  state[tabela].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  saveState();
  render();
  closeModal();
}

function deleteEntry() {
  const tabela = $('m-tabela').value;
  const id = $('m-id').value;
  if (!id) return;
  if (!confirm('Excluir este lançamento?')) return;
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

async function exportExcel(src, sections) {
  const inc = sections || { reembolso: true, alelo: true };
  const base = src || state;
  const has = (inc.reembolso && base.reembolso.length) || (inc.alelo && base.alelo.length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  try {
    toast('Gerando Excel…');
    const D = filteredDoc(base, inc);
    const bytes = await buildXlsx(D);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await shareOrDownload(blob, reportFileBase(D) + '.xlsx', 'Relatório de Despesas (Excel)');
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
  $('export-modal').classList.add('open');
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
          <td colspan="3" class="sub-lbl">${title === 'DESPESAS PARA REEMBOLSO' ? 'SUBTOTAL DESPESAS PARA REEMBOLSO:' : 'SUBTOTAL DESPESAS PARA CARTÃO ALELO:'}</td>
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
    ${inc.alelo ? buildPrintTable('DESPESAS CARTÃO ALELO', D.alelo, 5) : ''}
    <div class="p-total"><span>TOTAL DOS GASTOS</span><span>${formatMoney(s1 + s2)}</span></div>
    <div class="p-bank-title">Dados Bancários (Se Aplicável)</div>
    <table class="p-bank">
      <tr><td class="lab">Nome:</td><td>${escapeHtml(b.nome)}</td><td class="lab">Banco:</td><td>${escapeHtml(b.banco)}</td></tr>
      <tr><td class="lab">CPF:</td><td>${escapeHtml(b.cpf)}</td><td class="lab">Agência:</td><td>${escapeHtml(b.agencia)}</td></tr>
      <tr><td class="lab">Conta:</td><td>${escapeHtml(b.conta)}</td><td class="lab">Chave Pix:</td><td>${escapeHtml(b.pix)}</td></tr>
    </table>
    <div class="p-obs">
      <b>Observações:</b> Para despesas com alimentação, os valores máximos reembolsáveis por refeição são —
      Almoço e Jantar: R$ 70,00 cada; Café da manhã e da tarde: R$ 30,00 cada.
      Enviar junto a este relatório os cupons das despesas. Em caso de gasto reembolsável,
      informar os dados da conta bancária para o recebimento.
    </div>`;
}

async function exportPDF(src, sections) {
  const inc = sections || { reembolso: true, alelo: true };
  const D = src || state;
  const has = (inc.reembolso && D.reembolso.length) || (inc.alelo && D.alelo.length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  try {
    toast('Gerando PDF…');
    const blob = await generatePdfBlob(D, inc);
    await shareOrDownload(blob, reportFileBase(D) + '.pdf', 'Relatório de Despesas (PDF)');
  } catch (e) {
    console.error(e);
    toast('Erro ao gerar PDF: ' + e.message);
  }
}

/* Gera um PDF de verdade (arquivo) a partir do mesmo layout do relatório,
   capturado com html2canvas e montado com jsPDF (A4 retrato, multipágina). */
async function generatePdfBlob(src, sections) {
  buildPrint(src || state, sections);
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
    el.textContent = '⚠'; el.classList.add('offline');
    el.title = 'Offline — sincroniza ao reconectar';
  } else if (syncing) {
    el.textContent = '⟳'; el.classList.add('pending', 'spin');
    el.title = 'Sincronizando…';
  } else if (isDirty()) {
    el.textContent = '⟳'; el.classList.add('pending');
    el.title = 'Alterações pendentes — toque para sincronizar';
  } else {
    el.textContent = '✓'; el.classList.add('ok');
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
    bank: Object.assign({}, state.bank),
    reembolso: state.reembolso.map((e) => Object.assign({}, e)),
    alelo: state.alelo.map((e) => Object.assign({}, e)),
    history: state.history.map((h) => JSON.parse(JSON.stringify(h))),
    histTomb: Object.assign({}, state.histTomb),
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
  state.bank = Object.assign(base.bank, doc.bank || {});
  state.reembolso = doc.reembolso || [];
  state.alelo = doc.alelo || [];
  state.history = Array.isArray(doc.history) ? doc.history : [];
  state.histTomb = doc.histTomb || {};
  state.tomb = {
    reembolso: (doc.tomb && doc.tomb.reembolso) || {},
    alelo: (doc.tomb && doc.tomb.alelo) || {}
  };
  state.meta = Object.assign({ updatedAt: 0, profileUpdatedAt: 0 }, doc.meta || {});
  saveState();
  render();
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
    bank: Object.assign({}, p.bank || {}),
    tomb: { reembolso: {}, alelo: {} }
  };
  out.reembolso = mergeTable('reembolso', a, b, out.tomb);
  out.alelo = mergeTable('alelo', a, b, out.tomb);
  const mh = mergeHistory(a, b);
  out.history = mh.list;
  out.histTomb = mh.tomb;
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
function hideLock() { const d = $('lock-screen'); if (d) d.remove(); document.body.classList.remove('locked'); }

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
  if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
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
  touchProfile();
  saveState();
  render();
  toast(tem ? 'Mês arquivado no histórico.' : 'Pronto para um novo mês.');
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
  bindField('bk-nome', null, (v) => state.bank.nome = v);
  bindField('bk-cpf', null, (v) => state.bank.cpf = v);
  bindField('bk-banco', null, (v) => state.bank.banco = v);
  bindField('bk-agencia', null, (v) => state.bank.agencia = v);
  bindField('bk-conta', null, (v) => state.bank.conta = v);
  bindField('bk-pix', null, (v) => state.bank.pix = v);

  document.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => openModal(btn.dataset.add, null)));
  document.querySelectorAll('[data-repeat]').forEach((btn) =>
    btn.addEventListener('click', () => repeatLast(btn.dataset.repeat)));

  $('m-save').addEventListener('click', saveEntry);
  $('m-cancel').addEventListener('click', closeModal);
  $('m-delete').addEventListener('click', deleteEntry);
  $('m-duplicate').addEventListener('click', duplicateInModal);
  $('m-categoria').addEventListener('change', updateCatHint);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

  $('btn-excel').addEventListener('click', () => openExportChooser('excel', state));
  $('btn-pdf').addEventListener('click', () => openExportChooser('pdf', state));
  $('btn-new-month').addEventListener('click', newMonth);

  $('exp-cancel').addEventListener('click', closeExportModal);
  $('exp-confirm').addEventListener('click', confirmExport);
  $('export-modal').addEventListener('click', (e) => { if (e.target === $('export-modal')) closeExportModal(); });

  setupNav();
  setupTheme();
  setupServiceWorker();
  setupConnectivity();
  setupSyncUI();
  setupSecurityUI();
  setupBackupUI();
  updateFooter();
  updateSyncIndicator();
  $('sync-ind').addEventListener('click', () => syncNow(false));

  // sincronização inicial ao abrir (puxa o que houver de outro dispositivo)
  if (isSyncConfigured() && navigator.onLine) syncNow(true);

  // ao voltar a ficar online, envia o que ficou pendente offline (o merge decide
  // se o mais recente é do servidor ou deste aparelho)
  window.addEventListener('online', () => {
    if (!isSyncConfigured()) return;
    if (isDirty()) toast('Conexão restaurada — enviando lançamentos…');
    syncNow(true);
  });

  // ao voltar para o app (reabrir/trazer ao foco), sincroniza para pegar a
  // versão mais recente e enviar pendências
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isSyncConfigured() && navigator.onLine) syncNow(true);
  });
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
  window.addEventListener('online', () => { const n = $('offline-notice'); if (n) n.remove(); updateSyncIndicator(); });
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
