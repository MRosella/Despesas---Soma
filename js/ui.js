'use strict';
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

/* ---------------- Abas dos relatórios (Reembolso | Cartão Santander) ---------------- */
const REPORT_TAB_KEY = 'despesas-soma-tab-v1';
function showReportTab(tab) {
  if (tab !== 'reembolso' && tab !== 'alelo') tab = 'reembolso';
  document.querySelectorAll('.report-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  document.querySelectorAll('.rtab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  try { localStorage.setItem(REPORT_TAB_KEY, tab); } catch (e) { console.warn('salvar aba ativa falhou', e); }
}
function setupReportTabs() {
  document.querySelectorAll('.rtab').forEach((b) => b.addEventListener('click', () => showReportTab(b.dataset.tab)));
  let saved = 'reembolso';
  try { saved = localStorage.getItem(REPORT_TAB_KEY) || 'reembolso'; } catch (e) {}
  showReportTab(saved);
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

