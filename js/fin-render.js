'use strict';

/* ============================================================
   Módulo Finanças — renderização (dashboard, transações,
   contas & cartões, fatura) e abas próprias (.ftab/.fin-panel).
   ============================================================ */

const FIN_TAB_KEY = 'despesas-soma-fintab-v1';
let finMesAtivo = todayISO().slice(0, 7);   // 'YYYY-MM' exibido no Resumo/Transações
let finFaturaView = null;                    // {cartaoId, competencia} da fatura aberta
let finTxFiltro = 'todas';                   // todas | receitas | despesas | reembolsaveis
let finFatFiltro = 'todas';                  // todas | pessoais | reembolsaveis

function finDestinoNome(tx) {
  if (tx.cartaoId) { const k = finCartaoById(tx.cartaoId); return k ? k.nome : 'Cartão'; }
  if (tx.contaId) { const c = finContaById(tx.contaId); return c ? c.nome : 'Conta'; }
  return '';
}

const FIN_TIPO_CONTA = { corrente: 'Conta corrente', poupanca: 'Poupança', dinheiro: 'Dinheiro', investimento: 'Investimento' };

function finEmptyLi(msg) {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.innerHTML = `<span class="empty-ic" data-icon="wallet" data-size="40"></span>
    <div class="empty-title">${escapeHtml(msg)}</div>`;
  return li;
}

function renderFin() {
  if (!$('fin-tab-dashboard')) return;
  const lbl = $('fin-mes-label'); if (lbl) lbl.textContent = finMesLabel(finMesAtivo);
  renderFinDashboard();
  renderFinTransacoes();
  renderFinContasCartoes();
  renderFinFatura();
}

/* ---------------- Resumo (dashboard) ---------------- */
function renderFinDashboard() {
  const contas = (state.finContas || []).filter((c) => !c.arquivada);
  const cartoes = (state.finCartoes || []).filter((k) => !k.arquivado);
  const txs = state.finTx || [];

  // contas + saldo total
  const ulC = $('fin-dash-contas');
  if (ulC) {
    ulC.innerHTML = '';
    if (!contas.length) ulC.appendChild(finEmptyLi('Nenhuma conta cadastrada — adicione na aba Contas.'));
    let total = 0;
    for (const c of contas) {
      const saldo = finSaldoConta(c, txs);
      total += saldo;
      const li = document.createElement('li');
      li.className = 'entry';
      li.innerHTML = `
        <div class="e-main">
          <div class="e-desc">${escapeHtml(c.nome)}</div>
          <div class="e-meta">${escapeHtml(c.instituicao || FIN_TIPO_CONTA[c.tipo] || '')}</div>
        </div>
        <div class="e-val" style="color:${saldo < 0 ? 'var(--red)' : 'var(--ok)'}">${formatMoney(saldo)}</div>`;
      li.addEventListener('click', () => openFinContaModal(c.id));
      ulC.appendChild(li);
    }
    const st = $('fin-saldo-total'); if (st) st.textContent = formatMoney(total);
    setupIcons(ulC);
  }

  // cartões: fatura do mês ativo com totais pessoal × reembolsável
  const ulK = $('fin-dash-cartoes');
  if (ulK) {
    ulK.innerHTML = '';
    if (!cartoes.length) ulK.appendChild(finEmptyLi('Nenhum cartão cadastrado — adicione na aba Contas.'));
    for (const k of cartoes) {
      const f = finFaturaDe(k, txs, finMesAtivo);
      const li = document.createElement('li');
      li.className = 'entry';
      li.innerHTML = `
        <div class="e-main">
          <div class="e-desc">${escapeHtml(k.nome)}</div>
          <div class="e-meta">
            <span class="fin-tag-status ${f.status}">${f.status}</span>
            venc. ${fmtDateBR(f.vencimentoISO)}
            ${f.totalReembolsavel ? '<span class="fin-tag-reemb">↩ ' + formatMoney(f.totalReembolsavel) + '</span>' : ''}
          </div>
        </div>
        <div class="e-val">${formatMoney(f.total)}</div>`;
      li.addEventListener('click', () => openFinFatura(k.id, finMesAtivo));
      ulK.appendChild(li);
    }
  }

  // receitas × despesas + gastos por categoria do mês
  const res = finResumoMes(txs, finMesAtivo);
  const rxd = $('fin-rxd');
  if (rxd) {
    const saldoMes = res.receitas - res.despesas;
    rxd.innerHTML = `
      <div class="frx"><span class="lab">Receitas</span><span class="val pos">${formatMoney(res.receitas)}</span></div>
      <div class="frx"><span class="lab">Despesas</span><span class="val neg">${formatMoney(res.despesas)}</span></div>
      <div class="frx"><span class="lab">Saldo</span><span class="val ${saldoMes >= 0 ? 'pos' : 'neg'}">${formatMoney(saldoMes)}</span></div>`;
  }
  const box = $('fin-cat-summary');
  if (box) {
    const arr = Object.keys(res.porCategoria).map((c) => [c, res.porCategoria[c]]).sort((a, b) => b[1] - a[1]);
    box.innerHTML = arr.length
      ? arr.map(([cat, val]) => `<span class="cat-chip"><span class="cc-name">${escapeHtml(cat)}</span><span class="cc-val">${formatMoney(val)}</span></span>`).join('')
      : '<span class="cat-empty">Sem despesas neste mês.</span>';
  }
  const gt = $('fin-gastos-total'); if (gt) gt.textContent = formatMoney(res.despesas);
}

/* ---------------- Transações ---------------- */
function finTxLi(t) {
  const li = document.createElement('li');
  li.className = 'entry' + (t.id === lastAddedId ? ' added' : '');
  li.innerHTML = `
    <div class="e-main">
      <div class="e-desc">${escapeHtml(t.descricao || '(sem descrição)')}</div>
      <div class="e-meta">
        <span class="cat-tag">${escapeHtml(t.categoria || '—')}</span>
        ${fmtDateBR(t.data)} · ${escapeHtml(finDestinoNome(t))}
        ${t.reembolsavel ? '<span class="fin-tag-reemb">↩ reembolsável</span>' : ''}
      </div>
    </div>
    <div class="e-val" style="color:${t.tipo === 'receita' ? 'var(--ok)' : 'inherit'}">${t.tipo === 'receita' ? '+' : ''}${formatMoney(t.valor)}</div>
    <div class="e-quick">
      <button class="qbtn danger" data-q="del" title="Excluir" aria-label="Excluir transação" data-icon="trash-2" data-size="18"></button>
    </div>`;
  li.addEventListener('click', (ev) => { if (!ev.target.closest('.e-quick')) openFinTxModal(t.id); });
  li.querySelector('[data-q=del]').addEventListener('click', () => quickDeleteFinTx(t.id));
  return li;
}

function finTxGroupHead(icon, titulo, soma) {
  const li = document.createElement('li');
  li.className = 'fin-txgroup';
  li.innerHTML = `<span class="tg-name"><span class="tg-ic" data-icon="${icon}" data-size="16"></span>${escapeHtml(titulo)}</span>
    <span class="tg-sum">${formatMoney(soma)}</span>`;
  return li;
}

function renderFinTransacoes() {
  const ul = $('fin-tx-list'); if (!ul) return;
  let list = (state.finTx || []).filter((t) => (t.data || '').slice(0, 7) === finMesAtivo);
  if (finTxFiltro === 'receitas') list = list.filter((t) => t.tipo === 'receita');
  else if (finTxFiltro === 'despesas') list = list.filter((t) => t.tipo !== 'receita');
  else if (finTxFiltro === 'reembolsaveis') list = list.filter((t) => t.reembolsavel);
  list.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  // separa transações da conta × transações em cartões
  const contasTx = list.filter((t) => !t.cartaoId);
  const cartoesTx = list.filter((t) => t.cartaoId);
  const somaGrupo = (arr) => arr.reduce((s, t) => s + (t.tipo === 'receita' ? 1 : -1) * (t.valor || 0), 0);

  ul.innerHTML = '';
  if (!list.length) { ul.appendChild(finEmptyLi('Nenhuma transação neste mês.')); }
  if (contasTx.length) {
    ul.appendChild(finTxGroupHead('wallet', 'Contas', somaGrupo(contasTx)));
    for (const t of contasTx) ul.appendChild(finTxLi(t));
  }
  if (cartoesTx.length) {
    ul.appendChild(finTxGroupHead('credit-card', 'Cartões', somaGrupo(cartoesTx)));
    for (const t of cartoesTx) ul.appendChild(finTxLi(t));
  }
  setupIcons(ul);

  const net = somaGrupo(list);
  const s = $('fin-tx-sum');
  if (s) { s.textContent = formatMoney(net); s.style.color = ''; }
}

function quickDeleteFinTx(id) {
  const t = (state.finTx || []).find((x) => x.id === id);
  if (!t) return;
  const grupo = t.parcela && t.parcela.grupo;
  const outras = grupo ? (state.finTx || []).filter((x) => x.id !== id && x.parcela && x.parcela.grupo === grupo) : [];
  const now = Date.now();
  if (outras.length && confirm('Esta é uma parcela. Excluir TAMBÉM as outras ' + outras.length + ' parcela(s) deste parcelamento?')) {
    const ids = new Set([id].concat(outras.map((o) => o.id)));
    ids.forEach((x) => { state.tomb.finTx[x] = now; });
    state.finTx = state.finTx.filter((x) => !ids.has(x.id));
    touchDoc(); saveState(); renderFin();
    toast((outras.length + 1) + ' parcelas excluídas.');
    return;
  }
  if (!confirm('Excluir a transação "' + (t.descricao || '') + '" (' + formatMoney(t.valor) + ')?')) return;
  state.tomb.finTx[id] = now;
  state.finTx = state.finTx.filter((x) => x.id !== id);
  touchDoc(); saveState(); renderFin();
  toast('Transação excluída.');
}

/* ---------------- Contas & Cartões ---------------- */
function renderFinContasCartoes() {
  const txs = state.finTx || [];
  const ulC = $('fin-contas-list');
  if (ulC) {
    ulC.innerHTML = '';
    const contas = (state.finContas || []).filter((c) => !c.arquivada);
    if (!contas.length) ulC.appendChild(finEmptyLi('Nenhuma conta ainda.'));
    for (const c of contas) {
      const saldo = finSaldoConta(c, txs);
      const li = document.createElement('li');
      li.className = 'entry';
      li.innerHTML = `
        <div class="e-main">
          <div class="e-desc">${escapeHtml(c.nome)}</div>
          <div class="e-meta">${escapeHtml(c.instituicao || '')} · ${escapeHtml(FIN_TIPO_CONTA[c.tipo] || c.tipo || '')}</div>
        </div>
        <div class="e-val" style="color:${saldo < 0 ? 'var(--red)' : 'var(--ok)'}">${formatMoney(saldo)}</div>`;
      li.addEventListener('click', () => openFinContaModal(c.id));
      ulC.appendChild(li);
    }
    setupIcons(ulC);
  }

  const ulK = $('fin-cartoes-list');
  if (ulK) {
    ulK.innerHTML = '';
    const cartoes = (state.finCartoes || []).filter((k) => !k.arquivado);
    if (!cartoes.length) ulK.appendChild(finEmptyLi('Nenhum cartão ainda.'));
    for (const k of cartoes) {
      const f = finFaturaDe(k, txs, finCompetencia(k, todayISO()));
      const li = document.createElement('li');
      li.className = 'entry';
      li.innerHTML = `
        <div class="e-main">
          <div class="e-desc">${escapeHtml(k.nome)}</div>
          <div class="e-meta">${escapeHtml(k.bandeira || '')} · fecha dia ${k.diaFechamento} · vence dia ${k.diaVencimento}${k.limite ? ' · limite ' + formatMoney(k.limite) : ''}</div>
        </div>
        <div class="e-val">${formatMoney(f.total)}</div>
        <div class="e-quick">
          <button class="qbtn" data-q="edit" title="Editar cartão" aria-label="Editar cartão" data-icon="settings" data-size="18"></button>
        </div>`;
      li.addEventListener('click', (ev) => { if (!ev.target.closest('.e-quick')) openFinFatura(k.id, finCompetencia(k, todayISO())); });
      li.querySelector('[data-q=edit]').addEventListener('click', () => openFinCartaoModal(k.id));
      ulK.appendChild(li);
    }
    setupIcons(ulK);
  }
}

/* ---------------- Fatura do cartão ---------------- */
function openFinFatura(cartaoId, competencia) {
  finFaturaView = { cartaoId, competencia };
  showFinTab('contas');
  renderFinFatura();
  const box = $('fin-fatura-box');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFinFatura() {
  const box = $('fin-fatura-box'); if (!box) return;
  if (!finFaturaView) { box.style.display = 'none'; return; }
  const k = finCartaoById(finFaturaView.cartaoId);
  if (!k) { finFaturaView = null; box.style.display = 'none'; return; }
  box.style.display = '';
  const f = finFaturaDe(k, state.finTx || [], finFaturaView.competencia);

  renderFinFatStrip(k);
  $('fin-fatura-title').textContent = 'Fatura — ' + k.nome;
  $('fin-fat-label').textContent = finMesLabel(f.competencia);
  $('fin-fatura-total').textContent = formatMoney(f.total);
  const restante = Math.max(0, Math.round((f.total - f.pagamentos) * 100) / 100);
  $('fin-fatura-info').innerHTML = `
    <span class="fin-tag-status ${f.status}">${f.status}</span>
    fecha <b>${fmtDateBR(f.fechamentoISO)}</b> · vence <b>${fmtDateBR(f.vencimentoISO)}</b>
    ${f.pagamentos ? ' · pago ' + formatMoney(f.pagamentos) : ''}
    <div class="fin-fatura-split">
      <span class="fsp">Pessoal<b>${formatMoney(f.totalPessoal)}</b></span>
      <span class="fsp">↩ Reembolsável<b>${formatMoney(f.totalReembolsavel)}</b></span>
      <span class="fsp">Em aberto<b>${formatMoney(restante)}</b></span>
    </div>`;

  let itens = f.itens;
  if (finFatFiltro === 'pessoais') itens = itens.filter((t) => !t.reembolsavel);
  else if (finFatFiltro === 'reembolsaveis') itens = itens.filter((t) => t.reembolsavel);

  const ul = $('fin-fatura-list');
  ul.innerHTML = '';
  if (!itens.length) ul.appendChild(finEmptyLi('Nenhuma compra nesta fatura.'));
  for (const t of itens.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''))) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="e-main">
        <div class="e-desc">${escapeHtml(t.descricao || '(sem descrição)')}</div>
        <div class="e-meta">
          <span class="cat-tag">${escapeHtml(t.categoria || '—')}</span>
          ${fmtDateBR(t.data)}
          ${t.reembolsavel ? '<span class="fin-tag-reemb">↩ reembolsável</span>' : ''}
        </div>
      </div>
      <div class="e-val">${formatMoney(t.valor)}</div>`;
    li.addEventListener('click', () => openFinTxModal(t.id));
    ul.appendChild(li);
  }
  setupIcons(ul);
}

/* Tira horizontal de meses: total projetado de cada fatura (destaca meses com parcela). */
function renderFinFatStrip(cartao) {
  const box = $('fin-fat-strip'); if (!box) return;
  const meses = finFaturaMeses(cartao, state.finTx || [], todayISO());
  const ativa = finFaturaView ? finFaturaView.competencia : '';
  box.innerHTML = meses.map((m) => `
    <button type="button" class="fin-fat-chip${m.competencia === ativa ? ' active' : ''}${m.temParcela ? ' parc' : ''}" data-comp="${m.competencia}">
      <span class="ffc-mes">${escapeHtml(finMesLabel(m.competencia))}</span>
      <span class="ffc-val">${formatMoney(m.total)}</span>
      <span class="ffc-tags"><span class="fin-tag-status ${m.status}">${m.status}</span>${m.temParcela ? '<span class="ffc-parc">⇢ parcelas</span>' : ''}</span>
    </button>`).join('');
  const on = box.querySelector('.fin-fat-chip.active');
  if (on) on.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

/* ---------------- Abas próprias ---------------- */
function showFinTab(tab) {
  const valid = ['dashboard', 'transacoes', 'contas', 'importar'];
  if (valid.indexOf(tab) < 0) tab = 'dashboard';
  document.querySelectorAll('.fin-panel').forEach((p) => p.classList.toggle('active', p.dataset.fpanel === tab));
  document.querySelectorAll('.ftab').forEach((b) => {
    const on = b.dataset.ftab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const nav = $('fin-month-nav');
  if (nav) nav.style.display = (tab === 'dashboard' || tab === 'transacoes') ? '' : 'none';
  try { localStorage.setItem(FIN_TAB_KEY, tab); } catch (e) { /* sem storage */ }
}

function setupFinTabs() {
  document.querySelectorAll('.ftab').forEach((b) => b.addEventListener('click', () => showFinTab(b.dataset.ftab)));
  let saved = 'dashboard';
  try { saved = localStorage.getItem(FIN_TAB_KEY) || 'dashboard'; } catch (e) { /* sem storage */ }
  showFinTab(saved);
}

/* ---------------- Ligações da tela ---------------- */
function setupFinUI() {
  if (!$('fin-tab-dashboard')) return;
  $('fin-mes-prev').addEventListener('click', () => { finMesAtivo = finMonthAdd(finMesAtivo, -1); renderFin(); });
  $('fin-mes-next').addEventListener('click', () => { finMesAtivo = finMonthAdd(finMesAtivo, 1); renderFin(); });

  const bindChips = (boxId, attr, set) => {
    const box = $(boxId); if (!box) return;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.fchip'); if (!b) return;
      set(b.dataset[attr]);
      box.querySelectorAll('.fchip').forEach((x) => x.classList.toggle('active', x === b));
      renderFin();
    });
  };
  bindChips('fin-tx-filtros', 'ffiltro', (v) => { finTxFiltro = v; });
  bindChips('fin-fat-filtros', 'ffat', (v) => { finFatFiltro = v; });

  $('fin-tx-add').addEventListener('click', () => openFinTxModal(null));
  $('fin-conta-add').addEventListener('click', () => openFinContaModal(null));
  $('fin-cartao-add').addEventListener('click', () => openFinCartaoModal(null));

  const strip = $('fin-fat-strip');
  if (strip) strip.addEventListener('click', (e) => {
    const b = e.target.closest('.fin-fat-chip'); if (!b || !finFaturaView) return;
    finFaturaView.competencia = b.dataset.comp; renderFinFatura();
  });
  $('fin-fat-prev').addEventListener('click', () => { if (finFaturaView) { finFaturaView.competencia = finMonthAdd(finFaturaView.competencia, -1); renderFinFatura(); } });
  $('fin-fat-next').addEventListener('click', () => { if (finFaturaView) { finFaturaView.competencia = finMonthAdd(finFaturaView.competencia, 1); renderFinFatura(); } });
  $('fin-fat-close').addEventListener('click', () => { finFaturaView = null; renderFinFatura(); });
  $('fin-fat-pagar').addEventListener('click', () => {
    if (!finFaturaView) return;
    const k = finCartaoById(finFaturaView.cartaoId); if (!k) return;
    const f = finFaturaDe(k, state.finTx || [], finFaturaView.competencia);
    const restante = Math.max(0, Math.round((f.total - f.pagamentos) * 100) / 100);
    openFinTxModal(null, {
      tipo: 'despesa', data: todayISO(), valor: restante,
      descricao: 'Pagamento fatura ' + k.nome + ' — ' + finMesLabel(f.competencia),
      categoria: 'Pagamento de fatura', pagamentoCartaoId: k.id
    });
  });
}
