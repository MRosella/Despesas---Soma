'use strict';
/* ---------------- Renderização ---------------- */
function render() {
  // nao sobrescreve o campo que o usuario esta editando agora (um render disparado
  // pelo sync no meio da digitacao apagaria o que foi digitado)
  const setVal = (id, v) => { const el = $(id); if (el && el !== document.activeElement) el.value = v || ''; };
  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v || ''; };
  const setMoney = (id, v) => { const el = $(id); if (el) el.textContent = formatMoney(v); };
  const rm = state.reportMonths || {};

  for (const mod of MODULOS) {
    const t = mod.key;
    const p = perfilDe(t);
    setVal('reportMonth-' + t, rm[t]);

    if (mod.header === 'reembolso') {
      setVal('funcionario-' + t, p.funcionario);
      setVal('dataSolicitacao-' + t, p.dataSolicitacao);
      setVal('referente-' + t, p.referente);
    }
    if (mod.header === 'prestacao') {
      setTxt('sant-nome-' + t, mod.assinante);
      setTxt('sant-cargo-' + t, mod.assinanteCargo);
      setTxt('sant-entrega-' + t, fmtDateBR(todayISO()));
    }
    if (mod.periodo) {
      setVal('sant-periodo-inicio-' + t, p.santPeriodo.start);
      setVal('sant-periodo-fim-' + t, p.santPeriodo.end);
    }
    if (mod.bank) {
      for (const k of ['nome', 'cpf', 'banco', 'agencia', 'conta', 'pix']) setVal('bk-' + k + '-' + t, p.bank[k]);
    }

    const ul = $('list-' + t);
    if (ul) renderList(t, ul);
    const s = sumOf(state[t] || []);
    setMoney('sum-' + t, s); setMoney('tot-' + t, s);
    renderCatSummary(t, 'cat-summary-' + t);
    setTxt('rtab-badge-' + t, (state[t] || []).length ? ((state[t] || []).length + ' · ' + formatMoney(s)) : '');
  }

  renderReports();
  if (typeof renderPending === 'function') renderPending();
  if (typeof updateGdPending === 'function') updateGdPending();
}

/* ---------------- Histórico de meses ---------------- */
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
/* junta os lançamentos de TODAS as tabelas de um documento/snapshot */
function allEntriesOf(src) {
  let all = [];
  for (const t of TABELAS) all = all.concat(src[t] || []);
  return all;
}
function monthLabelFor(src) {
  let iso = src.dataSolicitacao;
  if (!iso && src.perfis) { for (const t of TABELAS) { const d = (src.perfis[t] || {}).dataSolicitacao; if (d) { iso = d; break; } } }
  if (!iso) {
    const datas = allEntriesOf(src).map((e) => e.data).filter(Boolean).sort();
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
function computeSantanderPeriodo(src, key) {
  const D = src || state;
  const t = key || 'alelo';
  const maxData = (list) => (list || []).map((e) => e && e.data).filter(Boolean).sort().pop() || '';
  const minData = (list) => (list || []).map((e) => e && e.data).filter(Boolean).sort().shift() || '';
  const end = maxData(D[t]);
  let start = '';
  for (const h of (D.history || [])) {   // history vem do mais novo p/ o mais antigo
    if (h && (h[t] || []).length) { start = maxData(h[t]); break; }
  }
  if (!start) start = minData(D[t]);
  if (!start && !end) return '';
  if (!start) start = end;
  if (!end) return fmtDateBR(start);
  return fmtDateBR(start) + ' a ' + fmtDateBR(end);
}

/* Texto final do Período Prestação usado no Excel/PDF: prioriza as datas escolhidas pelo
   usuário (`state.perfis[tabela].santPeriodo`); sem escolha, cai no cálculo automático acima. */
function santanderPeriodoText(src, key) {
  const D = src || state;
  const t = key || 'alelo';
  const perfil = D.perfis && D.perfis[t];
  const sp = (perfil && perfil.santPeriodo) || D.santPeriodo || {};
  if (sp.start && sp.end) return fmtDateBR(sp.start) + ' a ' + fmtDateBR(sp.end);
  if (sp.start || sp.end) return fmtDateBR(sp.start || sp.end);
  return computeSantanderPeriodo(D, t);
}

function yearOf(h) {
  let iso = h.dataSolicitacao;
  if (!iso) {
    iso = allEntriesOf(h).map((e) => e.data).filter(Boolean).sort()[0] || '';
  }
  if (iso) return iso.slice(0, 4);
  if (h.archivedAt) return String(new Date(h.archivedAt).getFullYear());
  return '—';
}

/* Um snapshot pertence à aba `tab` se foi arquivado como aquela tabela (`h.table`)
   ou, em snapshots legados sem `table`, se tem lançamentos naquela tabela. */
function histBelongsTo(h, tab) {
  if (h.table) return h.table === tab;
  return (h[tab] || []).length > 0;
}

/* Relatórios mensais — dividido por tipo (Reembolso | Cartão Santander), navegação por ano */
function renderReports() {
  for (const t of TABELAS) renderReportsPanel(t, 'reports-tree-' + t, 'reports-empty-' + t);
}

function renderReportsPanel(tab, treeId, emptyId) {
  const tree = $(treeId); const empty = $(emptyId);
  if (!tree) return;
  const hist = (state.history || []).filter((h) => histBelongsTo(h, tab));
  if (!hist.length) { tree.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const byYear = {};
  for (const h of hist) { const y = yearOf(h); (byYear[y] = byYear[y] || []).push(h); }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  let html = '';
  for (const y of years) {
    const items = byYear[y].sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    const yTotal = items.reduce((s, h) => s + sumOf(h[tab] || []), 0);
    html += `<details class="card rep-year" open>
      <summary><span class="rep-year-lbl">${escapeHtml(y)}</span><span class="rep-year-meta">${items.length} mês(es) · ${formatMoney(yTotal)}</span></summary>
      <ul class="hist-list">`;
    for (const h of items) {
      const qtd = (h[tab] || []).length;
      const total = sumOf(h[tab] || []);
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
  // snapshot por tabela (item v30) reabre só a tabela dele; sem marca, reabre as legadas
  const tabs = h.table ? [h.table] : TABELAS.filter((t) => (h[t] || []).length);
  if (!tabs.length) { toast('Este relatório arquivado está vazio.'); return; }
  if (tabs.some((t) => (state[t] || []).length)) {
    if (!confirm('Reabrir este mês vai SUBSTITUIR os lançamentos atuais (que não foram arquivados). Continuar?')) return;
  }
  const now = Date.now();
  for (const t of tabs) {
    for (const e of (state[t] || [])) state.tomb[t][e.id] = now;
    // novos ids p/ não colidir com o snapshot nem com lápides antigas
    state[t] = (h[t] || []).map((e) => Object.assign({}, e, { id: uid(), updatedAt: now }));
  }
  if (!state.reportMonths) state.reportMonths = mapPorTabela(() => '');
  for (const t of tabs) {
    const p = perfilDe(t);
    p.funcionario = h.funcionario || p.funcionario;
    p.dataSolicitacao = h.dataSolicitacao || '';
    p.referente = h.referente || p.referente;
    p.bank = Object.assign(perfilVazio().bank, h.bank || {});
    if (MOD[t] && MOD[t].periodo) p.santPeriodo = Object.assign({ start: '', end: '' }, h.santPeriodo || {});
    state.reportMonths[t] = h.reportMonth || '';   // restaura o mês só da(s) tabela(s) reaberta(s)
  }
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
  const campos = (MOD[tabela] || {}).campos || {};   // campos próprios do módulo (ex.: cartão) também são copiados
  for (const k in campos) if (campos[k]) copy[k] = e[k] || '';
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

