'use strict';

/* ============================================================
   Módulo Finanças — lógica pura (sem DOM)
   Contas, cartões de crédito, faturas por competência e saldos.
   Tudo aqui é testável em tests/logic.html.
   ============================================================ */

/* ---------------- Datas / meses ---------------- */
function finDiasNoMes(y, m) { return new Date(y, m, 0).getDate(); }   // m = 1..12

function finMonthAdd(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const FIN_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function finMesLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return FIN_MESES[m - 1] + '/' + y;
}

/* Dia efetivo num mês: min(dia, dias do mês) — resolve fechamento dia 31 em fevereiro etc. */
function finDiaEfetivoISO(ym, dia) {
  const [y, m] = ym.split('-').map(Number);
  const d = Math.min(dia || 1, finDiasNoMes(y, m));
  return ym + '-' + String(d).padStart(2, '0');
}

/* ---------------- Getters ---------------- */
function finContaById(id) { return (state.finContas || []).find((c) => c.id === id) || null; }
function finCartaoById(id) { return (state.finCartoes || []).find((c) => c.id === id) || null; }
function finGetCategorias() {
  return (state.finConfig && Array.isArray(state.finConfig.categorias) && state.finConfig.categorias.length)
    ? state.finConfig.categorias : FIN_DEFAULT_CATEGORIAS;
}
function finCategoriasPorTipo(tipo) { return finGetCategorias().filter((c) => c.tipo === tipo).map((c) => c.nome); }
/* Lançamentos de reembolso corporativo p/ cruzar com importação: inclui os abertos (state.reembolso)
   E os já arquivados no histórico (state.history[].reembolso) — um mês fechado não deve ficar invisível. */
function finReembolsoPool() {
  const arquivados = (state.history || []).reduce((acc, h) => acc.concat(h.reembolso || []), []);
  return (state.reembolso || []).concat(arquivados);
}

/* ---------------- Competência da fatura ----------------
   Compra até o dia efetivo de fechamento entra na fatura que fecha
   naquele mês; depois, na do mês seguinte. Retorna 'YYYY-MM' (mês do fechamento). */
function finCompetencia(cartao, dataISO) {
  if (!dataISO) return '';
  const ym = dataISO.slice(0, 7);
  const fechamento = finDiaEfetivoISO(ym, cartao.diaFechamento);
  return dataISO <= fechamento ? ym : finMonthAdd(ym, 1);
}

/* Vencimento da fatura de uma competência: mesmo mês se venc > fechamento, senão mês seguinte. */
function finVencimentoISO(cartao, competencia) {
  const ymV = (cartao.diaVencimento || 1) > (cartao.diaFechamento || 1) ? competencia : finMonthAdd(competencia, 1);
  return finDiaEfetivoISO(ymV, cartao.diaVencimento);
}

/* ---------------- Faturas de um cartão ----------------
   Agrupa as transações do cartão por competência e retorna array ordenado de:
   {competencia, fechamentoISO, vencimentoISO, itens[], total, totalPessoal,
    totalReembolsavel, pagamentos, status:'aberta'|'fechada'|'paga'}
   Pagamentos (tx com contaId + pagamentoCartaoId) abatem a fatura cujo
   VENCIMENTO cai no mês da data do pagamento (fallback: fechada mais recente não paga). */
function finFaturasDoCartao(cartao, txs, hojeISO) {
  const hoje = hojeISO || todayISO();
  const porComp = {};
  const fatura = (comp) => porComp[comp] || (porComp[comp] = {
    competencia: comp,
    fechamentoISO: finDiaEfetivoISO(comp, cartao.diaFechamento),
    vencimentoISO: finVencimentoISO(cartao, comp),
    itens: [], total: 0, totalPessoal: 0, totalReembolsavel: 0, pagamentos: 0, status: 'aberta'
  });
  const pagamentos = [];
  for (const tx of (txs || [])) {
    if (tx.cartaoId === cartao.id) {
      const f = fatura(finCompetencia(cartao, tx.data));
      f.itens.push(tx);
      const sinal = tx.tipo === 'receita' ? -1 : 1;   // estorno no cartão abate a fatura
      f.total += sinal * (tx.valor || 0);
      if (tx.reembolsavel) f.totalReembolsavel += sinal * (tx.valor || 0);
      else f.totalPessoal += sinal * (tx.valor || 0);
    } else if (tx.pagamentoCartaoId === cartao.id && tx.contaId) {
      pagamentos.push(tx);
    }
  }
  // pagamento entra na fatura com vencimento no mês da data do pagamento
  const list = Object.values(porComp);
  const porVencMes = {};
  for (const f of list) porVencMes[f.vencimentoISO.slice(0, 7)] = f;
  const sobras = [];
  for (const p of pagamentos) {
    const f = porVencMes[(p.data || '').slice(0, 7)];
    if (f) f.pagamentos += p.valor || 0; else sobras.push(p);
  }
  list.sort((x, y) => x.competencia.localeCompare(y.competencia));
  for (const f of list) {
    if (hoje > f.fechamentoISO) f.status = 'fechada';
  }
  // fallback: pagamento sem fatura no mês do vencimento abate a fechada mais recente não paga
  for (const p of sobras) {
    let alvo = null;
    for (const f of list) {
      if (f.status !== 'aberta' && f.pagamentos < f.total - 0.01 && f.fechamentoISO <= p.data) alvo = f;
    }
    if (alvo) alvo.pagamentos += p.valor || 0;
  }
  for (const f of list) {
    if (f.status === 'fechada' && Math.round(f.pagamentos * 100) >= Math.round(f.total * 100) - 1 && f.total > 0) f.status = 'paga';
    f.itens.sort((x, y) => (x.data || '').localeCompare(y.data || ''));
  }
  return list;
}

/* Fatura de um cartão numa competência específica (ou casca vazia). */
function finFaturaDe(cartao, txs, competencia, hojeISO) {
  const todas = finFaturasDoCartao(cartao, txs, hojeISO);
  return todas.find((f) => f.competencia === competencia) || {
    competencia,
    fechamentoISO: finDiaEfetivoISO(competencia, cartao.diaFechamento),
    vencimentoISO: finVencimentoISO(cartao, competencia),
    itens: [], total: 0, totalPessoal: 0, totalReembolsavel: 0, pagamentos: 0,
    status: (hojeISO || todayISO()) > finDiaEfetivoISO(competencia, cartao.diaFechamento) ? 'fechada' : 'aberta'
  };
}

/* ---------------- Saldo de conta ----------------
   saldoInicial + receitas − despesas (pagamentos de fatura inclusos como despesa). */
function finSaldoConta(conta, txs) {
  let s = conta.saldoInicial || 0;
  for (const tx of (txs || [])) {
    if (tx.contaId !== conta.id) continue;
    s += (tx.tipo === 'receita' ? 1 : -1) * (tx.valor || 0);
  }
  return Math.round(s * 100) / 100;
}

/* ---------------- Resumos do mês (dashboard) ----------------
   Transações do mês 'YYYY-MM': receitas × despesas e gastos por categoria.
   Pagamentos de fatura ficam de fora (o gasto real já está nos itens do cartão). */
function finResumoMes(txs, ym) {
  const out = { receitas: 0, despesas: 0, porCategoria: {} };
  for (const tx of (txs || [])) {
    if ((tx.data || '').slice(0, 7) !== ym) continue;
    if (tx.pagamentoCartaoId) continue;
    if (tx.tipo === 'receita') out.receitas += tx.valor || 0;
    else {
      out.despesas += tx.valor || 0;
      const c = tx.categoria || 'Outros';
      out.porCategoria[c] = (out.porCategoria[c] || 0) + (tx.valor || 0);
    }
  }
  return out;
}

/* ---------------- Deduplicação de importação ---------------- */
/* Normaliza descrição p/ comparação: minúsculas, sem acento, espaços colapsados. */
function finNormDesc(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ');
}
function finDedupKey(tx) {
  return (tx.data || '') + '|' + Math.round((tx.valor || 0) * 100) + '|' + finNormDesc(tx.descricao);
}

/* Marca nas linhas importadas as que já existem no destino (mesma data+valor+descrição). */
function finMarcarDuplicados(rows, txs, destino) {
  const existentes = new Set();
  for (const tx of (txs || [])) {
    if (destino && destino.contaId && tx.contaId !== destino.contaId) continue;
    if (destino && destino.cartaoId && tx.cartaoId !== destino.cartaoId) continue;
    existentes.add(finDedupKey(tx));
  }
  for (const r of (rows || [])) {
    r.dup = existentes.has(finDedupKey(r));
    if (r.dup) r.incluir = false;
  }
  return rows;
}

/* ---------------- Cruzamento com o reembolso corporativo ----------------
   Marca nas linhas importadas (despesas de cartão) as que casam com um lançamento
   de reembolso já feito (mesmos centavos + data dentro de ±toleranciaDias).
   Pré-marca reembolsavel=true e reembMatch=true (a UI mostra e o usuário confere). */
function finDiffDias(aISO, bISO) {
  const a = new Date(aISO + 'T00:00:00'), b = new Date(bISO + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return Infinity;
  return Math.abs(Math.round((a - b) / 86400000));
}
function finMatchReembolsaveis(rows, reembList, toleranciaDias) {
  const tol = (toleranciaDias == null) ? 5 : toleranciaDias;
  const alvos = (reembList || []).filter((e) => e && e.data && e.valor)
    .map((e) => ({ cents: Math.round((e.valor || 0) * 100), data: e.data }));
  for (const r of (rows || [])) {
    if (r.tipo === 'receita') continue;
    const cents = Math.round((r.valor || 0) * 100);
    const hit = alvos.some((a) => a.cents === cents && finDiffDias(a.data, r.data) <= tol);
    if (hit) { r.reembolsavel = true; r.reembMatch = true; }
  }
  return rows;
}

/* ---------------- Parcelamentos ----------------
   Chave estável de uma série de parcelas num destino (cartão): base+total normalizados. */
function finParcelaGrupoBase(destino, base, total) {
  return (destino && destino.cartaoId ? destino.cartaoId : '') + '|' + finNormDesc(base) + '|' + (total || 0);
}
/* True se já existe no estado a parcela nº n dessa série (dedupe ao reimportar o mês seguinte). */
function finParcelaJaExiste(txs, destino, base, total, n) {
  const chave = finParcelaGrupoBase(destino, base, total);
  return (txs || []).some((t) => t && t.parcela && t.parcela.atual === n &&
    finParcelaGrupoBase({ cartaoId: t.cartaoId }, t.parcela.base, t.parcela.total) === chave);
}
/* Gera os objetos das parcelas FUTURAS (atual+1..total) de uma linha parcelada.
   Cada uma: data deslocada +1 mês por passo (dia clampado), descricao "base (n/total)",
   mesmo valor/categoria/cartão, e parcela {atual:n,total,grupo,base}. Sem id (o caller atribui). */
function finParcelasFuturas(row, destino, grupo) {
  const out = [];
  const p = row && row.parcela;
  if (!p || !(p.total > 1) || !(p.atual >= 1) || !(destino && destino.cartaoId)) return out;
  const base = p.base || row.descricao || '';
  const dia = parseInt((row.data || '').slice(8, 10), 10) || 1;
  for (let n = p.atual + 1; n <= p.total; n++) {
    const ym = finMonthAdd((row.data || '').slice(0, 7), n - p.atual);
    out.push({
      data: finDiaEfetivoISO(ym, dia),
      descricao: base + ' (' + n + '/' + p.total + ')',
      valor: row.valor,
      tipo: 'despesa',
      categoria: row.categoria || '',
      contaId: '',
      cartaoId: destino.cartaoId,
      reembolsavel: !!row.reembolsavel,
      pagamentoCartaoId: '',
      origemImport: 'parcela',
      parcela: { atual: n, total: p.total, grupo: grupo, base: base }
    });
  }
  return out;
}

/* ---------------- Meses da fatura (visão multi-mês) ----------------
   Lista ordenada da competência corrente até a última competência com transação
   (cobre parcelas futuras), com mínimo de horizonteMin meses:
   [{competencia, total, temParcela, status}]. */
function finFaturaMeses(cartao, txs, hojeISO, horizonteMin) {
  const min = horizonteMin || 6;
  const hoje = hojeISO || todayISO();
  const faturas = finFaturasDoCartao(cartao, txs, hoje);
  const porComp = {};
  for (const f of faturas) porComp[f.competencia] = f;
  const inicio = finCompetencia(cartao, hoje);
  let fim = inicio;
  for (const f of faturas) { if (f.competencia > fim && f.total !== 0) fim = f.competencia; }
  // garante o horizonte mínimo
  let horizonteFim = inicio;
  for (let i = 1; i < min; i++) horizonteFim = finMonthAdd(horizonteFim, 1);
  if (horizonteFim > fim) fim = horizonteFim;
  const out = [];
  let comp = inicio;
  while (comp <= fim) {
    const f = porComp[comp];
    out.push({
      competencia: comp,
      total: f ? f.total : 0,
      temParcela: !!(f && f.itens.some((t) => t.parcela)),
      status: f ? f.status : ((hoje > finDiaEfetivoISO(comp, cartao.diaFechamento)) ? 'fechada' : 'aberta')
    });
    comp = finMonthAdd(comp, 1);
  }
  return out;
}

/* ---------------- Arquivamento anual ----------------
   Remove do estado as transações de um ano (com lápides p/ propagar no sync)
   e guarda os agregados em state.finArquivo[ano]. Retorna as tx removidas
   (para o chamador exportar em arquivo antes). */
function finArquivarAno(ano) {
  const pref = String(ano) + '-';
  const doAno = (state.finTx || []).filter((t) => (t.data || '').startsWith(pref));
  if (!doAno.length) return [];
  const agg = { receitas: 0, despesas: 0, porCategoria: {} };
  for (const tx of doAno) {
    if (tx.tipo === 'receita') agg.receitas += tx.valor || 0;
    else {
      agg.despesas += tx.valor || 0;
      const c = tx.categoria || 'Outros';
      agg.porCategoria[c] = (agg.porCategoria[c] || 0) + (tx.valor || 0);
    }
  }
  agg.receitas = Math.round(agg.receitas * 100) / 100;
  agg.despesas = Math.round(agg.despesas * 100) / 100;
  for (const c in agg.porCategoria) agg.porCategoria[c] = Math.round(agg.porCategoria[c] * 100) / 100;
  const now = Date.now();
  for (const tx of doAno) state.tomb.finTx[tx.id] = now;
  state.finTx = state.finTx.filter((t) => !(t.data || '').startsWith(pref));
  state.finArquivo[String(ano)] = agg;
  touchProfile();
  saveState();
  return doAno;
}
