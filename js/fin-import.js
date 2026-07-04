'use strict';

/* ============================================================
   Módulo Finanças — importação de extrato/fatura
   (PDF/imagem via Gemini; CSV/OFX com parser local) + revisão.
   Fluxo: escolher destino + arquivo → extrair transações →
   revisar/editar/marcar → confirmar cria as finTx.
   ============================================================ */

let finImportDraft = null;   // {destino:{contaId|cartaoId}, rows:[{data,descricao,valor,tipo,categoria,reembolsavel,incluir,dup}]}

/* ---------------- IA: extrato/fatura em PDF ou imagem ----------------
   Sem cache: reenviar o mesmo arquivo (ex.: fatura atualizada, categorias mudaram)
   deve sempre reanalisar. O dedupe de transações já evita duplicar lançamentos. */
async function ocrStatement(blob, mime) {
  return ocrStatementRaw(blob, mime);
}

async function ocrStatementRaw(blob, mime) {
  if (blob.size > 15 * 1024 * 1024) throw new Error('Arquivo muito grande para a IA (máx. ~15 MB). Exporte em CSV/OFX no app do banco.');
  const b64 = String(await blobToDataUrl(blob)).split(',')[1];
  const mimeType = mime || blob.type || 'application/pdf';
  const catsDesp = (typeof finCategoriasPorTipo === 'function') ? finCategoriasPorTipo('despesa') : [];
  const catsRec = (typeof finCategoriasPorTipo === 'function') ? finCategoriasPorTipo('receita') : [];
  const prompt = [
    'Você é um leitor de faturas de cartão de crédito e extratos bancários brasileiros.',
    'Extraia TODAS as transações/lançamentos do documento. Responda SOMENTE no JSON do schema.',
    '- docType: "fatura_cartao" se for fatura de cartão de crédito, "extrato_conta" se for extrato bancário.',
    '- Para cada transação: date (AAAA-MM-DD; deduza o ano pelo contexto do documento),',
    '  description (descrição/estabelecimento como aparece), amount (valor em reais, número POSITIVO),',
    '  kind: "debito" para gastos/saídas/compras, "credito" para receitas/entradas/estornos/pagamentos recebidos.',
    '- category: classifique a transação escolhendo EXATAMENTE UMA das categorias abaixo (não invente outras).',
    '  Categorias de despesa: ' + (catsDesp.join(', ') || '(nenhuma)') + '.',
    '  Categorias de receita: ' + (catsRec.join(', ') || '(nenhuma)') + '.',
    '  Se não tiver certeza, deixe category vazio.',
    '- installmentCurrent / installmentTotal: quando a linha indicar PARCELAMENTO (ex.: "PARC 02/12",',
    '  "2/12", "2 DE 12", "PARCELA 2 DE 12"), preencha o número da parcela atual e o total de parcelas.',
    '  Se não for parcelado, deixe ambos nulos. amount deve ser o valor DA PARCELA (mensal), não o total da compra.',
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
                kind: { type: 'STRING', enum: ['debito', 'credito'], nullable: true },
                category: { type: 'STRING', nullable: true },
                installmentCurrent: { type: 'NUMBER', nullable: true },
                installmentTotal: { type: 'NUMBER', nullable: true }
              }
            }
          }
        }
      }
    }
  );
  const stripParc = (s) => String(s || '').replace(/\bparc(ela)?\b\.?/gi, '')
    .replace(/\b\d{1,2}\s*(\/|de)\s*\d{1,2}\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  // casa a categoria da IA com a lista mesmo se vier com acento/maiúscula/espaço diferente
  const acharCategoria = (catIA, lista) => {
    const alvo = finNormDesc(catIA);
    if (!alvo) return '';
    return lista.find((c) => finNormDesc(c) === alvo) || '';
  };
  const txs = (data.transacoes || [])
    .filter((t) => t && typeof t.amount === 'number' && isFinite(t.amount) && t.amount !== 0)
    .map((t) => {
      const tipo = t.kind === 'credito' ? 'receita' : 'despesa';
      const descricao = (t.description || '').trim();
      const catValidas = tipo === 'receita' ? catsRec : catsDesp;
      const row = {
        data: (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) ? t.date : '',
        descricao,
        valor: Math.round(Math.abs(t.amount) * 100) / 100,
        tipo,
        categoria: acharCategoria(t.category, catValidas)
      };
      const atual = Math.round(t.installmentCurrent || 0);
      const total = Math.round(t.installmentTotal || 0);
      if (total > 1 && atual >= 1 && atual <= total) {
        row.parcela = { atual, total, base: stripParc(descricao) || descricao };
      }
      return row;
    });
  return { docType: data.docType || '', transacoes: txs };
}

/* ---------------- Parsers locais (sem IA) ---------------- */
/* Núcleo comum (CSV e XLSX): recebe uma matriz de células (linha 0 = cabeçalho quando houver),
   acha as colunas por heurística e devolve transações.
   Aceita valores "1.234,56" / "-50,00" (negativo = débito), datas DD/MM/AAAA, AAAA-MM-DD
   ou serial do Excel (número). */
function finRowsFromMatrix(matrix) {
  if (!matrix || !matrix.length) return [];
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const head = (matrix[0] || []).map(norm);
  const findCol = (...keys) => head.findIndex((h) => keys.some((k) => h.indexOf(k) >= 0));
  let iData = findCol('data', 'date');
  let iDesc = findCol('descri', 'histor', 'lancamento', 'estabelecimento', 'memo', 'title');
  let iVal = findCol('valor', 'amount', 'montante', 'value');
  const temHeader = iData >= 0 && iVal >= 0;
  const start = temHeader ? 1 : 0;
  if (!temHeader) { iData = 0; iDesc = 1; iVal = 2; }   // fallback: posição fixa data;descricao;valor
  const out = [];
  for (let i = start; i < matrix.length; i++) {
    const cols = matrix[i] || [];
    if (cols.filter((c) => String(c || '').trim()).length < 2) continue;
    const dataISO = finParseDataBR(cols[iData]) || finExcelSerialToISO(cols[iData]);
    const raw = String(cols[iVal] || '').trim();
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

/* CSV: detecta separador, respeita aspas e vira matriz p/ finRowsFromMatrix. */
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
  return finRowsFromMatrix(lines.map(split));
}

/* Serial de data do Excel (número de dias desde 1899-12-30) → ISO. Só aceita a faixa
   ~1954..2119 pra não confundir com valores monetários. String de data comum devolve ''. */
function finExcelSerialToISO(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4,6}(\.\d+)?$/.test(s)) return '';
  const n = Number(s);
  if (!isFinite(n) || n < 20000 || n > 80000) return '';
  const d = new Date(Math.round((n - 25569) * 86400000));   // 25569 = serial de 1970-01-01
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/* XLSX (planilha do Excel/LibreOffice): descompacta com fflate e lê a 1ª aba.
   Sem dependência nova — usa fflate (unzipSync/strFromU8) já incluído. .xls binário antigo NÃO é suportado. */
function finParseXlsx(u8) {
  const files = fflate.unzipSync(u8);
  const dec = (name) => (files[name] ? fflate.strFromU8(files[name]) : '');
  const unesc = (str) => String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const textOf = (xml) => {   // concatena todos os <t> de um bloco (rich text vem quebrado)
    let acc = '', m; const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    while ((m = re.exec(xml))) acc += m[1];
    return unesc(acc);
  };
  // sharedStrings (células de texto referenciam por índice)
  const shared = [];
  const ssXml = dec('xl/sharedStrings.xml');
  if (ssXml) { let m; const re = /<si>([\s\S]*?)<\/si>/g; while ((m = re.exec(ssXml))) shared.push(textOf(m[1])); }
  // 1ª planilha
  let sheetKey = 'xl/worksheets/sheet1.xml';
  if (!files[sheetKey]) sheetKey = Object.keys(files).find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n)) || sheetKey;
  const sheet = dec(sheetKey);
  if (!sheet) return [];
  const colIdx = (ref) => {   // "B12" → 1
    const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const matrix = [];
  let rm; const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  while ((rm = rowRe.exec(sheet))) {
    const cells = [];
    let cm; const cRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1], inner = cm[2] || '';
      const col = colIdx((/r="([A-Z]+\d+)"/.exec(attrs) || [])[1] || '');
      if (col < 0) continue;
      const t = (/t="([^"]+)"/.exec(attrs) || [])[1] || '';
      let val = '';
      if (t === 'inlineStr') val = textOf(inner);
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        val = vm ? vm[1] : '';
        if (t === 's') val = shared[+val] || '';
        else val = unesc(val);
      }
      cells[col] = val;
    }
    matrix.push(cells);
  }
  return finRowsFromMatrix(matrix);
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
    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.type === 'text/csv') {
      finImpStatus('Lendo CSV…');
      rows = finParseCsv(await file.text());
    } else if (name.endsWith('.ofx')) {
      finImpStatus('Lendo OFX…');
      rows = finParseOfx(await file.text());
    } else if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || (file.type || '').indexOf('spreadsheetml') >= 0) {
      finImpStatus('Lendo planilha…');
      rows = finParseXlsx(new Uint8Array(await file.arrayBuffer()));
    } else if (name.endsWith('.xls')) {
      finImpStatus('Formato .xls antigo não é suportado. Abra a planilha e salve como .xlsx ou CSV.', 'warn'); return;
    } else {
      if (!aiConfigured()) { finImpStatus('Para PDF/imagem, configure a chave da IA (Gemini) em Configurações — ou use CSV/OFX.', 'warn'); return; }
      finImpStatus('Enviando para a IA — pode levar alguns segundos…');
      const res = await ocrStatement(file, file.type);
      rows = res.transacoes;
    }
    if (!rows.length) { finImpStatus('Nenhuma transação encontrada no arquivo.', 'warn'); return; }
    finImportDraft = {
      destino,
      rows: rows.map((r) => {
        const merged = Object.assign({
          categoria: '',
          reembolsavel: false,
          incluir: true,
          dup: false
        }, r);   // preserva categoria/parcela vindos da IA
        // categoria aprendida de correções manuais anteriores tem prioridade sobre a sugestão da IA/CSV
        const aprendida = finAprenderCategoria(merged.descricao, merged.tipo);
        if (aprendida) merged.categoria = aprendida;
        return merged;
      })
    };
    const drows = finImportDraft.rows;
    finMarcarDuplicados(drows, state.finTx || [], destino);
    // cruza com o reembolso corporativo (só faz sentido em cartão; inclui meses já arquivados) e dedupe de parcelas já lançadas
    if (destino.cartaoId) finMatchReembolsaveis(drows, finReembolsoPool());
    for (const r of drows) {
      if (r.parcela && finParcelaJaExiste(state.finTx || [], destino, r.parcela.base, r.parcela.total, r.parcela.atual)) {
        r.dup = true; r.incluir = false;
      }
    }
    const dups = drows.filter((r) => r.dup).length;
    const casados = drows.filter((r) => r.reembMatch).length;
    finImpStatus(rows.length + ' transação(ões) encontrada(s)'
      + (dups ? ' — ' + dups + ' já existente(s) desmarcada(s)' : '')
      + (casados ? ' · ' + casados + ' casada(s) com reembolso' : '')
      + '. Revise abaixo.', 'ok');
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
    const futuras = r.parcela ? (r.parcela.total - r.parcela.atual) : 0;
    return `
    <div class="fin-rev-row${r.dup ? ' dup' : ''}" data-i="${i}">
      <input type="checkbox" class="frv-inc" data-i="${i}"${r.incluir ? ' checked' : ''} />
      <div class="frv-desc">${escapeHtml(r.descricao)}
        ${r.parcela ? `<span class="frv-parc">parcela ${r.parcela.atual}/${r.parcela.total}${futuras > 0 ? ' · +' + futuras + ' futura' + (futuras > 1 ? 's' : '') : ''}</span>` : ''}
      </div>
      <div class="frv-val${r.tipo === 'receita' ? ' receita' : ''}">${r.tipo === 'receita' ? '+' : ''}${formatMoney(r.valor)}</div>
      <div class="frv-meta">
        ${fmtDateBR(r.data)}
        <select class="frv-cat" data-i="${i}">
          <option value="">Categoria…</option>
          ${cats.map((c) => `<option${r.categoria === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        ${isCartao && r.tipo !== 'receita' ? `<label class="${r.reembMatch ? 'frv-reemb-match' : ''}"><input type="checkbox" class="frv-reemb" data-i="${i}"${r.reembolsavel ? ' checked' : ''} /> ↩ reemb.${r.reembMatch ? ' <span class="frv-match">casado</span>' : ''}</label>` : ''}
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
  let futurasCriadas = 0;
  for (const r of sel) {
    const catFinal = r.categoria || (r.tipo === 'receita' ? 'Outras receitas' : 'Outros');
    const tx = {
      id: uid(),
      data: r.data || todayISO(),
      descricao: r.descricao,
      valor: r.valor,
      tipo: r.tipo,
      categoria: catFinal,
      contaId: d.contaId || '',
      cartaoId: d.cartaoId || '',
      reembolsavel: !!(d.cartaoId && r.reembolsavel),
      pagamentoCartaoId: '',
      origemImport: 'import',
      updatedAt: now
    };
    // parcela: grava a atual e projeta as futuras (uma por mês), sem duplicar as já lançadas
    if (d.cartaoId && r.parcela && r.parcela.total > 1) {
      const grupo = uid();
      tx.parcela = { atual: r.parcela.atual, total: r.parcela.total, grupo, base: r.parcela.base };
      const rowParc = Object.assign({}, r, { categoria: catFinal, valor: r.valor });
      for (const fp of finParcelasFuturas(rowParc, d, grupo)) {
        if (finParcelaJaExiste(state.finTx, d, fp.parcela.base, fp.parcela.total, fp.parcela.atual)) continue;
        fp.id = uid(); fp.updatedAt = now;
        state.finTx.push(fp);
        futurasCriadas++;
      }
    }
    state.finTx.push(tx);
  }
  state.finTx.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  finImportDraft = null;
  touchDoc(); saveState(); renderFin(); renderFinReview();
  finImpStatus('');
  toast(sel.length + ' transação(ões) importada(s)'
    + (futurasCriadas ? ' · ' + futurasCriadas + ' parcela(s) futura(s)' : '')
    + (ignoradas ? ' · ' + ignoradas + ' ignorada(s)' : '') + '.');
}

/* Limpa TODAS as transações de Finanças (recomeçar após import ruim). Cria lápides p/ o sync
   propagar a deleção; não mexe em contas/cartões/categorias. */
function finLimparTransacoes() {
  const n = (state.finTx || []).length;
  if (!n) { toast('Não há transações para limpar.'); return; }
  if (!confirm('Apagar TODAS as ' + n + ' transação(ões) de Finanças? Contas, cartões e categorias são mantidos. Esta ação não pode ser desfeita.')) return;
  if (!confirm('Confirme novamente: apagar as ' + n + ' transação(ões)?')) return;
  const now = Date.now();
  state.tomb = state.tomb || {};
  state.tomb.finTx = state.tomb.finTx || {};
  for (const t of state.finTx) state.tomb.finTx[t.id] = now;
  state.finTx = [];
  finImportDraft = null;
  touchDoc(); saveState(); renderFin(); renderFinReview();
  finImpStatus('');
  toast(n + ' transação(ões) apagada(s).');
}

function setupFinImportUI() {
  if (!$('fin-imp-file')) return;
  populateFinImpDestino();
  const limpar = $('fin-imp-limpar');
  if (limpar) limpar.addEventListener('click', finLimparTransacoes);
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
