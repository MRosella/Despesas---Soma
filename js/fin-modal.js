'use strict';

/* ============================================================
   Módulo Finanças — modais de transação, conta e cartão
   + editor de categorias do módulo (em Configurações).
   ============================================================ */

/* Preenche os selects do modal de transação: categorias (pelo tipo) e destino (contas/cartões). */
function populateFinSelects() {
  const tipo = $('fm-tipo') ? ($('fm-tipo').value || 'despesa') : 'despesa';
  const mc = $('fm-categoria');
  if (mc) {
    const cur = mc.value;
    const cats = finCategoriasPorTipo(tipo);
    mc.innerHTML = '<option value="">Selecione…</option>' + cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
    if (cats.indexOf(cur) >= 0) mc.value = cur;
  }
  const md = $('fm-destino');
  if (md) {
    const cur = md.value;
    const contas = (state.finContas || []).filter((c) => !c.arquivada);
    const cartoes = (state.finCartoes || []).filter((k) => !k.arquivado);
    let html = '<option value="">Selecione…</option>';
    if (contas.length) html += '<optgroup label="Contas">' + contas.map((c) => `<option value="c:${escapeHtml(c.id)}">${escapeHtml(c.nome)}</option>`).join('') + '</optgroup>';
    if (cartoes.length) html += '<optgroup label="Cartões">' + cartoes.map((k) => `<option value="k:${escapeHtml(k.id)}">${escapeHtml(k.nome)}</option>`).join('') + '</optgroup>';
    md.innerHTML = html;
    if (md.querySelector(`option[value="${cur}"]`)) md.value = cur;
  }
}

/* Checkbox "reembolsável" só faz sentido quando o destino é um cartão. */
function finToggleReembRow() {
  const row = $('fm-reembolsavel-row'); if (!row) return;
  const dest = $('fm-destino').value || '';
  const isPagamento = !!$('fm-pagamento-cartao').value;
  row.style.display = (dest.startsWith('k:') && !isPagamento) ? '' : 'none';
}

/* ---------------- Modal: transação ---------------- */
function openFinTxModal(id, prefill) {
  const isEdit = !!id;
  const t = isEdit ? (state.finTx || []).find((x) => x.id === id) : null;
  const e = t || prefill || {};
  $('fin-tx-title').textContent = isEdit ? 'Editar transação' : 'Nova transação';
  $('fm-id').value = isEdit ? id : '';
  $('fm-tipo').value = e.tipo === 'receita' ? 'receita' : 'despesa';
  $('fm-data').value = e.data || todayISO();
  $('fm-descricao').value = e.descricao || '';
  $('fm-valor').value = e.valor ? formatMoneyInput(e.valor) : '';
  $('fm-pagamento-cartao').value = e.pagamentoCartaoId || '';
  populateFinSelects();
  $('fm-categoria').value = e.categoria || '';
  $('fm-destino').value = e.cartaoId ? ('k:' + e.cartaoId) : (e.contaId ? ('c:' + e.contaId) : '');
  $('fm-reembolsavel').checked = !!e.reembolsavel;
  finToggleReembRow();
  $('fm-delete').style.display = isEdit ? '' : 'none';
  $('fin-tx-modal').classList.add('open');
  setTimeout(() => $('fm-descricao').focus(), 150);
}
function closeFinTxModal() { $('fin-tx-modal').classList.remove('open'); }

function saveFinTx() {
  const id = $('fm-id').value;
  const tipo = $('fm-tipo').value === 'receita' ? 'receita' : 'despesa';
  const data = $('fm-data').value;
  const descricao = $('fm-descricao').value.trim();
  const valor = parseMoney($('fm-valor').value);
  const categoria = $('fm-categoria').value;
  const dest = $('fm-destino').value || '';
  const pagamentoCartaoId = $('fm-pagamento-cartao').value || '';

  if (!data) { toast('Informe a data.'); return; }
  if (!descricao) { toast('Informe a descrição.'); return; }
  if (!valor) { toast('Informe um valor válido.'); return; }
  if (!categoria) { toast('Selecione a categoria.'); return; }
  if (!dest) { toast('Selecione a conta ou o cartão.'); return; }
  const contaId = dest.startsWith('c:') ? dest.slice(2) : '';
  const cartaoId = dest.startsWith('k:') ? dest.slice(2) : '';
  if (pagamentoCartaoId && !contaId) { toast('Pagamento de fatura sai de uma CONTA.'); return; }

  // aviso de possível duplicado (mesma data + valor + descrição)
  const cents = Math.round(valor * 100);
  const dup = (state.finTx || []).some((x) => x.id !== id && x.data === data &&
    Math.round((x.valor || 0) * 100) === cents &&
    (x.descricao || '').toLowerCase().trim() === descricao.toLowerCase());
  if (dup && !confirm('Já existe uma transação com a mesma data, valor e descrição. Salvar mesmo assim?')) return;

  const old = id ? (state.finTx || []).find((x) => x.id === id) : null;
  const entry = {
    id: id || uid(),
    data, descricao, valor, tipo, categoria, contaId, cartaoId,
    reembolsavel: cartaoId ? $('fm-reembolsavel').checked : false,
    pagamentoCartaoId,
    origemImport: (old && old.origemImport) || '',
    updatedAt: Date.now()
  };
  if (old) state.finTx[state.finTx.indexOf(old)] = entry;
  else { state.finTx.push(entry); lastAddedId = entry.id; setTimeout(() => { lastAddedId = null; }, 900); }
  state.finTx.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  touchDoc(); saveState(); renderFin();
  closeFinTxModal();
  toast(id ? 'Transação atualizada.' : 'Transação registrada.');
}

function deleteFinTx() {
  const id = $('fm-id').value; if (!id) return;
  const tx = (state.finTx || []).find((x) => x.id === id);
  const grupo = tx && tx.parcela && tx.parcela.grupo;
  const outras = grupo ? (state.finTx || []).filter((x) => x.id !== id && x.parcela && x.parcela.grupo === grupo) : [];
  const now = Date.now();
  if (outras.length && confirm('Esta é uma parcela. Excluir TAMBÉM as outras ' + outras.length + ' parcela(s) deste parcelamento?')) {
    for (const o of outras) state.tomb.finTx[o.id] = now;
    const ids = new Set([id].concat(outras.map((o) => o.id)));
    state.tomb.finTx[id] = now;
    state.finTx = state.finTx.filter((x) => !ids.has(x.id));
    touchDoc(); saveState(); renderFin();
    closeFinTxModal();
    toast((outras.length + 1) + ' parcelas excluídas.');
    return;
  }
  if (!confirm('Excluir esta transação?')) return;
  state.tomb.finTx[id] = now;
  state.finTx = state.finTx.filter((x) => x.id !== id);
  touchDoc(); saveState(); renderFin();
  closeFinTxModal();
  toast('Transação excluída.');
}

/* ---------------- Modal: conta ---------------- */
function openFinContaModal(id) {
  const c = id ? finContaById(id) : null;
  $('fin-conta-title').textContent = c ? 'Editar conta' : 'Nova conta';
  $('fc-id').value = c ? c.id : '';
  $('fc-nome').value = c ? c.nome : '';
  $('fc-instituicao').value = c ? (c.instituicao || '') : '';
  $('fc-tipo').value = c ? (c.tipo || 'corrente') : 'corrente';
  $('fc-saldo').value = c && c.saldoInicial ? formatMoneyInput(c.saldoInicial) : '';
  $('fc-delete').style.display = c ? '' : 'none';
  $('fin-conta-modal').classList.add('open');
  setTimeout(() => $('fc-nome').focus(), 150);
}
function closeFinContaModal() { $('fin-conta-modal').classList.remove('open'); }

function saveFinConta() {
  const id = $('fc-id').value;
  const nome = $('fc-nome').value.trim();
  if (!nome) { toast('Informe o nome da conta.'); return; }
  const entry = {
    id: id || uid(),
    nome,
    instituicao: $('fc-instituicao').value.trim(),
    tipo: $('fc-tipo').value || 'corrente',
    saldoInicial: parseMoney($('fc-saldo').value),
    arquivada: false,
    updatedAt: Date.now()
  };
  const old = id ? finContaById(id) : null;
  if (old) { entry.arquivada = !!old.arquivada; state.finContas[state.finContas.indexOf(old)] = entry; }
  else state.finContas.push(entry);
  touchDoc(); saveState(); renderFin();
  if (typeof populateFinSelects === 'function') populateFinSelects();
  closeFinContaModal();
  toast(id ? 'Conta atualizada.' : 'Conta criada.');
}

function deleteFinConta() {
  const id = $('fc-id').value; if (!id) return;
  const vinculadas = (state.finTx || []).filter((t) => t.contaId === id);
  const msg = vinculadas.length
    ? 'Esta conta tem ' + vinculadas.length + ' transação(ões). Excluir a conta APAGA também essas transações. Continuar?'
    : 'Excluir esta conta?';
  if (!confirm(msg)) return;
  const now = Date.now();
  for (const t of vinculadas) state.tomb.finTx[t.id] = now;
  state.finTx = state.finTx.filter((t) => t.contaId !== id);
  state.tomb.finContas[id] = now;
  state.finContas = state.finContas.filter((c) => c.id !== id);
  touchDoc(); saveState(); renderFin();
  closeFinContaModal();
  toast('Conta excluída.');
}

/* ---------------- Modal: cartão de crédito ---------------- */
function openFinCartaoModal(id) {
  const k = id ? finCartaoById(id) : null;
  $('fin-cartao-title').textContent = k ? 'Editar cartão' : 'Novo cartão';
  $('fk-id').value = k ? k.id : '';
  $('fk-nome').value = k ? k.nome : '';
  $('fk-bandeira').value = k ? (k.bandeira || '') : '';
  $('fk-limite').value = k && k.limite ? formatMoneyInput(k.limite) : '';
  $('fk-fechamento').value = k ? (k.diaFechamento || '') : '';
  $('fk-vencimento').value = k ? (k.diaVencimento || '') : '';
  $('fk-delete').style.display = k ? '' : 'none';
  $('fin-cartao-modal').classList.add('open');
  setTimeout(() => $('fk-nome').focus(), 150);
}
function closeFinCartaoModal() { $('fin-cartao-modal').classList.remove('open'); }

function saveFinCartao() {
  const id = $('fk-id').value;
  const nome = $('fk-nome').value.trim();
  if (!nome) { toast('Informe o nome do cartão.'); return; }
  const fech = Math.min(31, Math.max(1, parseInt($('fk-fechamento').value, 10) || 0));
  const venc = Math.min(31, Math.max(1, parseInt($('fk-vencimento').value, 10) || 0));
  if (!parseInt($('fk-fechamento').value, 10)) { toast('Informe o dia de fechamento (1 a 31).'); return; }
  if (!parseInt($('fk-vencimento').value, 10)) { toast('Informe o dia de vencimento (1 a 31).'); return; }
  const entry = {
    id: id || uid(),
    nome,
    bandeira: $('fk-bandeira').value.trim(),
    limite: parseMoney($('fk-limite').value),
    diaFechamento: fech,
    diaVencimento: venc,
    arquivado: false,
    updatedAt: Date.now()
  };
  const old = id ? finCartaoById(id) : null;
  if (old) { entry.arquivado = !!old.arquivado; state.finCartoes[state.finCartoes.indexOf(old)] = entry; }
  else state.finCartoes.push(entry);
  touchDoc(); saveState(); renderFin();
  closeFinCartaoModal();
  toast(id ? 'Cartão atualizado.' : 'Cartão criado.');
}

function deleteFinCartao() {
  const id = $('fk-id').value; if (!id) return;
  const vinculadas = (state.finTx || []).filter((t) => t.cartaoId === id || t.pagamentoCartaoId === id);
  const msg = vinculadas.length
    ? 'Este cartão tem ' + vinculadas.length + ' transação(ões)/pagamento(s). Excluir o cartão APAGA também essas transações. Continuar?'
    : 'Excluir este cartão?';
  if (!confirm(msg)) return;
  const now = Date.now();
  for (const t of vinculadas) state.tomb.finTx[t.id] = now;
  state.finTx = state.finTx.filter((t) => t.cartaoId !== id && t.pagamentoCartaoId !== id);
  state.tomb.finCartoes[id] = now;
  state.finCartoes = state.finCartoes.filter((k) => k.id !== id);
  if (finFaturaView && finFaturaView.cartaoId === id) finFaturaView = null;
  touchDoc(); saveState(); renderFin();
  closeFinCartaoModal();
  toast('Cartão excluído.');
}

/* ---------------- Ligações dos modais ---------------- */
function setupFinModals() {
  if (!$('fin-tx-modal')) return;
  $('fm-save').addEventListener('click', saveFinTx);
  $('fm-cancel').addEventListener('click', closeFinTxModal);
  $('fm-delete').addEventListener('click', deleteFinTx);
  $('fm-tipo').addEventListener('change', populateFinSelects);
  $('fm-destino').addEventListener('change', finToggleReembRow);
  maskCurrencyEl($('fm-valor'));

  $('fc-save').addEventListener('click', saveFinConta);
  $('fc-cancel').addEventListener('click', closeFinContaModal);
  $('fc-delete').addEventListener('click', deleteFinConta);
  maskCurrencyEl($('fc-saldo'));

  $('fk-save').addEventListener('click', saveFinCartao);
  $('fk-cancel').addEventListener('click', closeFinCartaoModal);
  $('fk-delete').addEventListener('click', deleteFinCartao);
  maskCurrencyEl($('fk-limite'));
}

/* ---------------- Editor de categorias do módulo (Configurações) ---------------- */
let finCatDraft = null;
function getFinCatDraft() { if (!finCatDraft) finCatDraft = finGetCategorias().map((c) => Object.assign({}, c)); return finCatDraft; }
function setFinCatStatus(msg, cls) { const s = $('fincat-status'); if (s) { s.textContent = msg || ''; s.className = 'sync-status' + (cls ? ' ' + cls : ''); } }

function renderFinCatEditor() {
  const box = $('fincat-list'); if (!box) return;
  const rows = getFinCatDraft();
  box.innerHTML = rows.map((c, i) => `
    <div class="cat-row" data-i="${i}">
      <input type="text" class="fincat-nome" data-i="${i}" value="${escapeHtml(c.nome)}" placeholder="Categoria" autocapitalize="words" />
      <select class="fincat-tipo" data-i="${i}">
        <option value="despesa"${c.tipo !== 'receita' ? ' selected' : ''}>Despesa</option>
        <option value="receita"${c.tipo === 'receita' ? ' selected' : ''}>Receita</option>
      </select>
      <button type="button" class="hist-btn danger fincat-del" data-i="${i}" aria-label="Remover categoria">✕</button>
    </div>`).join('');
}

function saveFinCatEditor() {
  const rows = getFinCatDraft();
  const seen = {}, out = [];
  for (const r of rows) {
    const nome = (r.nome || '').trim();
    if (!nome) continue;
    if (seen[nome]) { setFinCatStatus('Categoria repetida: ' + nome, 'err'); return; }
    seen[nome] = 1;
    out.push({ nome, tipo: r.tipo === 'receita' ? 'receita' : 'despesa' });
  }
  if (!out.length) { setFinCatStatus('Defina ao menos uma categoria.', 'err'); return; }
  state.finConfig = { categorias: out };
  touchProfile();
  saveState();
  finCatDraft = null;
  renderFinCatEditor();
  renderFin();
  setFinCatStatus('Categorias salvas.', 'ok');
}

/* ---------------- Arquivamento anual (Configurações) ---------------- */
function setupFinArquivoUI() {
  const sel = $('finarq-ano'); if (!sel) return;
  const setSt = (msg, cls) => { const s = $('finarq-status'); if (s) { s.textContent = msg || ''; s.className = 'sync-status' + (cls ? ' ' + cls : ''); } };
  const fill = () => {
    const anoAtual = todayISO().slice(0, 4);
    const anos = {};
    for (const t of (state.finTx || [])) { const a = (t.data || '').slice(0, 4); if (a && a < anoAtual) anos[a] = 1; }
    const keys = Object.keys(anos).sort();
    sel.innerHTML = keys.length ? keys.map((a) => `<option>${a}</option>`).join('') : '<option value="">—</option>';
    return keys.length;
  };
  fill();
  $('finarq-btn').addEventListener('click', () => {
    if (!fill()) { setSt('Nenhum ano anterior com transações para arquivar.', 'warn'); return; }
    const ano = sel.value; if (!ano) return;
    const n = (state.finTx || []).filter((t) => (t.data || '').startsWith(ano + '-')).length;
    if (!confirm('Arquivar ' + n + ' transação(ões) de ' + ano + '?\nUm backup .json será baixado; as transações saem do app (os totais do ano ficam guardados).')) return;
    const removidas = finArquivarAno(ano);
    if (!removidas.length) { setSt('Nada para arquivar em ' + ano + '.', 'warn'); return; }
    const blob = new Blob([JSON.stringify(removidas, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'financas-' + ano + '.json');
    renderFin();
    fill();
    setSt(removidas.length + ' transação(ões) de ' + ano + ' arquivada(s) — backup baixado.', 'ok');
  });
}

function setupFinCatUI() {
  const box = $('fincat-list'); if (!box) return;
  renderFinCatEditor();
  box.addEventListener('input', (e) => {
    const t = e.target, i = +t.dataset.i;
    if (isNaN(i) || !finCatDraft || !finCatDraft[i]) return;
    if (t.classList.contains('fincat-nome')) finCatDraft[i].nome = t.value;
    else if (t.classList.contains('fincat-tipo')) finCatDraft[i].tipo = t.value;
  });
  box.addEventListener('click', (e) => {
    const del = e.target.closest('.fincat-del'); if (!del) return;
    getFinCatDraft().splice(+del.dataset.i, 1); renderFinCatEditor(); setFinCatStatus('');
  });
  $('fincat-add').addEventListener('click', () => { getFinCatDraft().push({ nome: '', tipo: 'despesa' }); renderFinCatEditor(); });
  $('fincat-save').addEventListener('click', saveFinCatEditor);
  $('fincat-reset').addEventListener('click', () => {
    if (!confirm('Restaurar as categorias padrão de Finanças?')) return;
    finCatDraft = FIN_DEFAULT_CATEGORIAS.map((c) => Object.assign({}, c)); renderFinCatEditor(); setFinCatStatus('');
  });
}
