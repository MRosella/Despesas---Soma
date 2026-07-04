'use strict';

/* ============================================================
   Módulo Finanças — importação de extrato/fatura
   (PDF/imagem via Gemini; CSV/OFX com parser local) + revisão.
   Fluxo: escolher destino + arquivo → extrair transações →
   revisar/editar/marcar → confirmar cria as finTx.
   ============================================================ */

let finImportDraft = null;   // {destino:{contaId|cartaoId}, rows:[{data,descricao,valor,tipo,categoria,reembolsavel,incluir,dup}]}

/* ---------------- IA: extrato/fatura em PDF ou imagem ----------------
   Wrapper com cache por hash (mesmo arquivo não regasta o Gemini), igual ao ocrReceipt. */
async function ocrStatement(blob, mime) {
  let hash = '';
  try { hash = await blobSha256(blob); } catch (e) { console.warn('hash do extrato falhou', e); }
  if (hash) {
    try { const hit = await idbGet('ocrstmt_' + hash); if (hit && hit.res) return hit.res; }
    catch (e) { console.warn('leitura do cache de extrato falhou', e); }
  }
  const res = await ocrStatementRaw(blob, mime);
  if (hash && res && res.transacoes && res.transacoes.length) {
    try { await idbPut('ocrstmt_' + hash, { res, at: Date.now() }); }
    catch (e) { console.warn('gravacao do cache de extrato falhou', e); }
  }
  return res;
}

async function ocrStatementRaw(blob, mime) {
  if (blob.size > 15 * 1024 * 1024) throw new Error('Arquivo muito grande para a IA (máx. ~15 MB). Exporte em CSV/OFX no app do banco.');
  const b64 = String(await blobToDataUrl(blob)).split(',')[1];
  const mimeType = mime || blob.type || 'application/pdf';
  const prompt = [
    'Você é um leitor de faturas de cartão de crédito e extratos bancários brasileiros.',
    'Extraia TODAS as transações/lançamentos do documento. Responda SOMENTE no JSON do schema.',
    '- docType: "fatura_cartao" se for fatura de cartão de crédito, "extrato_conta" se for extrato bancário.',
    '- Para cada transação: date (AAAA-MM-DD; deduza o ano pelo contexto do documento),',
    '  description (descrição/estabelecimento como aparece), amount (valor em reais, número POSITIVO),',
    '  kind: "debito" para gastos/saídas/compras, "credito" para receitas/entradas/estornos/pagamentos recebidos.',
    'Ignore linhas de saldo, subtotais, totais, limites, juros informativos e cabeçalhos.',
    'Em fatura de cartão, ignore a linha "pagamento recebido" da fatura anterior apenas se for repetição do resumo; se for lançamento real, inclua como credito.'
  ].join('\n');
  const data = await geminiCall(
    [{ inline_data: { mime_type: mimeType, data: b64 } }, { text: prompt }],
    {
      temperature: 0,
      maxOutputTokens: 32768,   // faturas longas estouram o padrão
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          docType: { type: 'STRING', enum: ['fatura_cartao', 'extrato_conta'], nullable: true },
          transacoes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                date: { type: 'STRING', nullable: true },
                description: { type: 'STRING', nullable: true },
                amount: { type: 'NUMBER', nullable: true },
                kind: { type: 'STRING', enum: ['debito', 'credito'], nullable: true }
              }
            }
          }
        }
      }
    }
  );
  const txs = (data.transacoes || [])
    .filter((t) => t && typeof t.amount === 'number' && isFinite(t.amount) && t.amount !== 0)
    .map((t) => ({
      data: (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) ? t.date : '',
      descricao: (t.description || '').trim(),
      valor: Math.round(Math.abs(t.amount) * 100) / 100,
      tipo: t.kind === 'credito' ? 'receita' : 'despesa'
    }));
  return { docType: data.docType || '', transacoes: txs };
}

/* ---------------- Parsers locais (sem IA) ---------------- */
/* CSV: detecta separador e acha as colunas por heurística de cabeçalho.
   Aceita valores "1.234,56" / "-50,00" (negativo = débito) e datas DD/MM/AAAA ou AAAA-MM-DD. */
function finParseCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].indexOf('\t') >= 0 ? '\t'
    : ((lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',');
  const split = (l) => {   // respeita aspas
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim().replace(/^"|"$/g, ''));
  };
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const head = split(lines[0]).map(norm);
  const findCol = (...keys) => head.findIndex((h) => keys.some((k) => h.indexOf(k) >= 0));
  let iData = findCol('data', 'date');
  let iDesc = findCol('descri', 'histor', 'lancamento', 'estabelecimento', 'memo', 'title');
  let iVal = findCol('valor', 'amount', 'montante', 'value');
  const temHeader = iData >= 0 && iVal >= 0;
  const start = temHeader ? 1 : 0;
  if (!temHeader) { iData = 0; iDesc = 1; iVal = 2; }   // fallback: posição fixa data;descricao;valor
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const cols = split(lines[i]);
    if (cols.length < 2) continue;
    const dataISO = finParseDataBR(cols[iData]);
    const raw = (cols[iVal] || '').trim();
    if (!dataISO || !raw) continue;
    const neg = raw.indexOf('-') >= 0;
    const valor = parseMoney(raw.replace('-', ''));
    if (!valor) continue;
    out.push({
      data: dataISO,
      descricao: (iDesc >= 0 ? cols[iDesc] : '') || '(sem descrição)',
      valor,
      tipo: neg ? 'despesa' : 'receita'
    });
  }
  // extratos costumam usar sinal; fatura de cartão às vezes lista tudo positivo (gasto).
  // Se NADA veio negativo, assume que são gastos (débito) — mais comum em fatura.
  if (out.length && out.every((t) => t.tipo === 'receita')) out.forEach((t) => { t.tipo = 'despesa'; });
  return out;
}

function finParseDataBR(s) {
  s = (s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{2})[\/.-](\d{2})[\/.-](\d{4})/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = /^(\d{2})[\/.-](\d{2})[\/.-](\d{2})$/.exec(s);   // DD/MM/AA
  if (m) return '20' + m[3] + '-' + m[2] + '-' + m[1];
  return '';
}

/* OFX: blocos <STMTTRN> com DTPOSTED (AAAAMMDD...), TRNAMT (sinal = débito/crédito), MEMO/NAME. */
function finParseOfx(text) {
  const out = [];
  const blocks = String(text || '').split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const tag = (name) => {
      const m = new RegExp('<' + name + '>([^<\\r\\n]*)', 'i').exec(b);
      return m ? m[1].trim() : '';
    };
    const dt = tag('DTPOSTED');
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(dt);
    const dataISO = m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
    const amtRaw = tag('TRNAMT').replace(',', '.');
    const amt = parseFloat(amtRaw);
    if (!dataISO || !isFinite(amt) || !amt) continue;
    out.push({
      data: dataISO,
      descricao: tag('MEMO') || tag('NAME') || '(sem descrição)',
      valor: Math.round(Math.abs(amt) * 100) / 100,
      tipo: amt < 0 ? 'despesa' : 'receita'
    });
  }
  return out;
}

/* ---------------- Fluxo da tela Importar ---------------- */
function finImpStatus(msg, cls) { const s = $('fin-imp-status'); if (s) { s.textContent = msg || ''; s.className = 'sync-status' + (cls ? ' ' + cls : ''); } }

function populateFinImpDestino() {
  const sel = $('fin-imp-destino'); if (!sel) return;
  const cur = sel.value;
  const contas = (state.finContas || []).filter((c) => !c.arquivada);
  const cartoes = (state.finCartoes || []).filter((k) => !k.arquivado);
  let html = '<option value="">Selecione…</option>';
  if (cartoes.length) html += '<optgroup label="Cartões (fatura)">' + cartoes.map((k) => `<option value="k:${escapeHtml(k.id)}">${escapeHtml(k.nome)}</option>`).join('') + '</optgroup>';
  if (contas.length) html += '<optgroup label="Contas (extrato)">' + contas.map((c) => `<option value="c:${escapeHtml(c.id)}">${escapeHtml(c.nome)}</option>`).join('') + '</optgroup>';
  sel.innerHTML = html;
  if (sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
}

async function onFinImportFile(file) {
  if (!file) return;
  const dest = $('fin-imp-destino').value || '';
  if (!dest) { finImpStatus('Escolha primeiro ONDE lançar (conta ou cartão).', 'warn'); return; }
  const destino = dest.startsWith('k:') ? { cartaoId: dest.slice(2) } : { contaId: dest.slice(2) };
  const name = (file.name || '').toLowerCase();
  try {
    let rows = [];
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      finImpStatus('Lendo CSV…');
      rows = finParseCsv(await file.text());
    } else if (name.endsWith('.ofx')) {
      finImpStatus('Lendo OFX…');
      rows = finParseOfx(await file.text());
    } else {
      if (!aiConfigured()) { finImpStatus('Para PDF/imagem, configure a chave da IA (Gemini) em Configurações — ou use CSV/OFX.', 'warn'); return; }
      finImpStatus('Enviando para a IA — pode levar alguns segundos…');
      const res = await ocrStatement(file, file.type);
      rows = res.transacoes;
    }
    if (!rows.length) { finImpStatus('Nenhuma transação encontrada no arquivo.', 'warn'); return; }
    const catPadrao = '';
    finImportDraft = {
      destino,
      rows: rows.map((r) => Object.assign({}, r, {
        categoria: catPadrao,
        reembolsavel: false,
        incluir: true,
        dup: false
      }))
    };
    finMarcarDuplicados(finImportDraft.rows, state.finTx || [], destino);
    const dups = finImportDraft.rows.filter((r) => r.dup).length;
    finImpStatus(rows.length + ' transação(ões) encontrada(s)' + (dups ? ' — ' + dups + ' já existente(s) desmarcada(s)' : '') + '. Revise abaixo.', 'ok');
    renderFinReview();
  } catch (e) {
    console.error(e);
    finImpStatus('Erro ao ler o arquivo: ' + (e.message || e), 'err');
  }
}

function renderFinReview() {
  const card = $('fin-review-card'); if (!card) return;
  if (!finImportDraft) { card.style.display = 'none'; return; }
  card.style.display = '';
  const isCartao = !!finImportDraft.destino.cartaoId;
  const catsD = finCategoriasPorTipo('despesa');
  const catsR = finCategoriasPorTipo('receita');
  const box = $('fin-review-list');
  box.innerHTML = finImportDraft.rows.map((r, i) => {
    const cats = r.tipo === 'receita' ? catsR : catsD;
    return `
    <div class="fin-rev-row${r.dup ? ' dup' : ''}" data-i="${i}">
      <input type="checkbox" class="frv-inc" data-i="${i}"${r.incluir ? ' checked' : ''} />
      <div class="frv-desc">${escapeHtml(r.descricao)}</div>
      <div class="frv-val${r.tipo === 'receita' ? ' receita' : ''}">${r.tipo === 'receita' ? '+' : ''}${formatMoney(r.valor)}</div>
      <div class="frv-meta">
        ${fmtDateBR(r.data)}
        <select class="frv-cat" data-i="${i}">
          <option value="">Categoria…</option>
          ${cats.map((c) => `<option${r.categoria === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        ${isCartao && r.tipo !== 'receita' ? `<label><input type="checkbox" class="frv-reemb" data-i="${i}"${r.reembolsavel ? ' checked' : ''} /> ↩ reemb.</label>` : ''}
        ${r.dup ? '<span class="frv-dup">já existe</span>' : ''}
      </div>
    </div>`;
  }).join('');
  const cnt = $('fin-review-count');
  if (cnt) cnt.textContent = finImportDraft.rows.filter((r) => r.incluir).length + '/' + finImportDraft.rows.length;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function confirmFinImport() {
  if (!finImportDraft) return;
  const sel = finImportDraft.rows.filter((r) => r.incluir);
  if (!sel.length) { toast('Nenhuma transação marcada.'); return; }
  const semCat = sel.filter((r) => !r.categoria).length;
  if (semCat && !confirm(semCat + ' transação(ões) sem categoria (ficarão como "Outros"). Importar mesmo assim?')) return;
  const d = finImportDraft.destino;
  const now = Date.now();
  const ignoradas = finImportDraft.rows.length - sel.length;
  for (const r of sel) {
    state.finTx.push({
      id: uid(),
      data: r.data || todayISO(),
      descricao: r.descricao,
      valor: r.valor,
      tipo: r.tipo,
      categoria: r.categoria || (r.tipo === 'receita' ? 'Outras receitas' : 'Outros'),
      contaId: d.contaId || '',
      cartaoId: d.cartaoId || '',
      reembolsavel: !!(d.cartaoId && r.reembolsavel),
      pagamentoCartaoId: '',
      origemImport: 'import',
      updatedAt: now
    });
  }
  state.finTx.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  finImportDraft = null;
  touchDoc(); saveState(); renderFin(); renderFinReview();
  finImpStatus('');
  toast(sel.length + ' transação(ões) importada(s)' + (ignoradas ? ' · ' + ignoradas + ' ignorada(s)' : '') + '.');
}

function setupFinImportUI() {
  if (!$('fin-imp-file')) return;
  populateFinImpDestino();
  $('fin-imp-btn').addEventListener('click', () => { populateFinImpDestino(); $('fin-imp-file').click(); });
  $('fin-imp-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';   // permite escolher o mesmo arquivo de novo
    onFinImportFile(f);
  });
  $('fin-rev-all').addEventListener('click', () => { if (finImportDraft) { finImportDraft.rows.forEach((r) => { r.incluir = true; }); renderFinReview(); } });
  $('fin-rev-none').addEventListener('click', () => { if (finImportDraft) { finImportDraft.rows.forEach((r) => { r.incluir = false; }); renderFinReview(); } });
  $('fin-rev-cancel').addEventListener('click', () => { finImportDraft = null; renderFinReview(); finImpStatus(''); });
  $('fin-rev-confirm').addEventListener('click', confirmFinImport);
  const box = $('fin-review-list');
  box.addEventListener('change', (e) => {
    const t = e.target, i = +t.dataset.i;
    if (!finImportDraft || isNaN(i) || !finImportDraft.rows[i]) return;
    const r = finImportDraft.rows[i];
    if (t.classList.contains('frv-inc')) {
      r.incluir = t.checked;
      const cnt = $('fin-review-count');
      if (cnt) cnt.textContent = finImportDraft.rows.filter((x) => x.incluir).length + '/' + finImportDraft.rows.length;
      const row = t.closest('.fin-rev-row'); if (row) row.classList.toggle('dup', r.dup && !r.incluir);
    } else if (t.classList.contains('frv-cat')) r.categoria = t.value;
    else if (t.classList.contains('frv-reemb')) r.reembolsavel = t.checked;
  });
}
