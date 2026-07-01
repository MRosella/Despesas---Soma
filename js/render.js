'use strict';
/* ---------------- Renderização ---------------- */
function render() {
  $('funcionario').value = state.funcionario;
  $('dataSolicitacao').value = state.dataSolicitacao;
  $('referente').value = state.referente;
  const rm = state.reportMonths || {};
  if ($('reportMonth-reembolso')) $('reportMonth-reembolso').value = rm.reembolso || '';
  if ($('reportMonth-alelo')) $('reportMonth-alelo').value = rm.alelo || '';
  $('bk-nome').value = state.bank.nome;
  $('bk-cpf').value = state.bank.cpf;
  $('bk-banco').value = state.bank.banco;
  $('bk-agencia').value = state.bank.agencia;
  $('bk-conta').value = state.bank.conta;
  $('bk-pix').value = state.bank.pix;

  // cabeçalho do Cartão Santander: tudo fixo/automático (read-only)
  if ($('sant-nome') && typeof SANTANDER_NOME === 'string') $('sant-nome').textContent = SANTANDER_NOME;
  if ($('sant-cargo') && typeof SANTANDER_CARGO === 'string') $('sant-cargo').textContent = SANTANDER_CARGO;
  const sp = state.santPeriodo || {};
  if ($('sant-periodo-inicio')) $('sant-periodo-inicio').value = sp.start || '';
  if ($('sant-periodo-fim')) $('sant-periodo-fim').value = sp.end || '';
  if ($('sant-entrega')) $('sant-entrega').textContent = fmtDateBR(todayISO());

  renderList('reembolso', $('list-reembolso'));
  renderList('alelo', $('list-alelo'));

  const s1 = sumOf(state.reembolso), s2 = sumOf(state.alelo);
  const setMoney = (id, v) => { const el = $(id); if (el) el.textContent = formatMoney(v); };
  setMoney('sum-reembolso', s1); setMoney('tot-reembolso', s1);
  setMoney('sum-alelo', s2); setMoney('tot-alelo', s2);

  renderCatSummary('reembolso', 'cat-summary-reembolso');
  renderCatSummary('alelo', 'cat-summary-alelo');
  renderReports();
  if (typeof renderPending === 'function') renderPending();
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

/* "Período Prestação" automático do Cartão Santander (fallback/sugestão, usado quando o
   usuário ainda não escolheu as datas): vai do último lançamento do relatório Santander
   anterior (snapshot mais recente do histórico com `alelo`) até o último lançamento do
   relatório atual. Sem histórico, usa o 1º lançamento atual. */
function computeSantanderPeriodo(src) {
  const D = src || state;
  const maxData = (list) => (list || []).map((e) => e && e.data).filter(Boolean).sort().pop() || '';
  const minData = (list) => (list || []).map((e) => e && e.data).filter(Boolean).sort().shift() || '';
  const end = maxData(D.alelo);
  let start = '';
  for (const h of (D.history || [])) {   // history vem do mais novo p/ o mais antigo
    if (h && (h.alelo || []).length) { start = maxData(h.alelo); break; }
  }
  if (!start) start = minData(D.alelo);
  if (!start && !end) return '';
  if (!start) start = end;
  if (!end) return fmtDateBR(start);
  return fmtDateBR(start) + ' a ' + fmtDateBR(end);
}

/* Texto final do Período Prestação usado no Excel/PDF: prioriza as datas escolhidas pelo
   usuário (`state.santPeriodo`); sem escolha, cai no cálculo automático acima. */
function santanderPeriodoText(src) {
  const D = src || state;
  const sp = D.santPeriodo || {};
  if (sp.start && sp.end) return fmtDateBR(sp.start) + ' a ' + fmtDateBR(sp.end);
  if (sp.start || sp.end) return fmtDateBR(sp.start || sp.end);
  return computeSantanderPeriodo(D);
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
  // snapshot por tabela (item v30) reabre só a tabela dele; sem marca, reabre as duas (legado)
  const tabs = h.table ? [h.table] : ['reembolso', 'alelo'];
  if (tabs.some((t) => state[t].length)) {
    if (!confirm('Reabrir este mês vai SUBSTITUIR os lançamentos atuais (que não foram arquivados). Continuar?')) return;
  }
  const now = Date.now();
  for (const t of tabs) {
    for (const e of state[t]) state.tomb[t][e.id] = now;
    // novos ids p/ não colidir com o snapshot nem com lápides antigas
    state[t] = (h[t] || []).map((e) => Object.assign({}, e, { id: uid(), updatedAt: now }));
  }
  state.funcionario = h.funcionario || state.funcionario;
  state.dataSolicitacao = h.dataSolicitacao || '';
  state.referente = h.referente || state.referente;
  if (!state.reportMonths) state.reportMonths = { reembolso: '', alelo: '' };
  for (const t of tabs) state.reportMonths[t] = h.reportMonth || '';   // restaura o mês só da(s) tabela(s) reaberta(s)
  if (tabs.includes('alelo')) state.santPeriodo = Object.assign({ start: '', end: '' }, h.santPeriodo || {});
  state.bank = Object.assign(emptyState().bank, h.bank || {});
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

/* Resumo por categoria de UMA tabela — SOMENTE para visualização no app (não vai p/ Excel/PDF) */
function renderCatSummary(tabela, boxId) {
  const box = $(boxId); if (!box) return;
  const list = state[tabela] || [];
  if (!list.length) { box.innerHTML = '<span class="cat-empty">Sem lançamentos.</span>'; return; }
  const map = {};
  for (const e of list) { const c = e.categoria || '—'; map[c] = (map[c] || 0) + (e.valor || 0); }
  const arr = Object.keys(map).map((c) => [c, map[c]]).sort((a, b) => b[1] - a[1]);
  box.innerHTML = arr.map(([cat, val]) =>
    `<span class="cat-chip"><span class="cc-name">${escapeHtml(cat)}</span><span class="cc-val">${formatMoney(val)}</span></span>`
  ).join('');
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

