'use strict';
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

function santanderFileBase(src) {
  const D = src || state;
  const nome = (D.funcionario || 'Funcionario').trim().replace(/\s+/g, '_');
  const ref = D.dataSolicitacao || (D.archivedAt ? new Date(D.archivedAt).toISOString().slice(0, 10) : todayISO());
  return `Prestacao_Contas_Cartao_${nome}_${ref}`;
}

/* Nome e cargo FIXOS no Excel/PDF do cartão Santander (não vêm do campo "Funcionário"). */
const SANTANDER_NOME = 'Murilo Rosella';
const SANTANDER_CARGO = 'Piloto de Aeronaves';

/* ---------------- Excel exclusivo do Cartão Santander (modelo "Despesas Cartão.xlsx") ----------------
   Layout: info E4=Nome(fixo), E5=Cargo(fixo), E6=Período, E7=Data de Entrega (serial), E8=Total(=J{total});
   tabela cabeçalho linha 16, dados 17.. (capac. 18 → linhas 17-34), linha de total 35 (J=SUM). Colunas:
   B=DATA, C:F=ESTABELECIMENTO, G:I=DESCRIÇÃO, J=VALOR, K=JUSTIFICATIVA. Os dados do cartão = tabela `alelo`. */
async function buildSantanderXlsx(src) {
  const D = src || state;
  const buf = await fetch('template-santander.xlsx', { cache: 'no-store' }).then((r) => r.arrayBuffer());
  const files = fflate.unzipSync(new Uint8Array(buf));
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const parser = new DOMParser();
  const ser = new XMLSerializer();

  const doc = parser.parseFromString(dec.decode(files['xl/worksheets/sheet1.xml']), 'application/xml');
  const draw = files['xl/drawings/drawing1.xml'] ? parser.parseFromString(dec.decode(files['xl/drawings/drawing1.xml']), 'application/xml') : null;
  const sheetData = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];

  const n = D.alelo.length;
  const CAP = 18;                          // linhas 17..34
  const extra = Math.max(0, n - CAP);
  const totalRowBase = 35;
  const totalRow = totalRowBase + extra;

  function allCells() { return Array.from(doc.getElementsByTagNameNS(MAIN, 'c')); }
  function getCell(ref) { for (const c of allCells()) if (c.getAttribute('r') === ref) return c; return null; }
  function clearCell(c) { while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute('t'); c.removeAttribute('cm'); }
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
    const v = doc.createElementNS(MAIN, 'v'); v.textContent = String(value); c.appendChild(v);
  }
  function setFormula(ref, formula, cached) {
    const c = getCell(ref); if (!c) return;
    clearCell(c);
    const f = doc.createElementNS(MAIN, 'f'); f.textContent = formula;
    const v = doc.createElementNS(MAIN, 'v'); v.textContent = String(cached);
    c.appendChild(f); c.appendChild(v);
  }
  function getRow(nn) { for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) if (r.getAttribute('r') === String(nn)) return r; return null; }
  function shiftRows(fromRow, amount) {
    if (amount === 0) return;
    for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) {
      const rn = parseInt(r.getAttribute('r'), 10);
      if (rn >= fromRow) {
        r.setAttribute('r', String(rn + amount));
        for (const c of Array.from(r.getElementsByTagNameNS(MAIN, 'c'))) {
          const ref = c.getAttribute('r'); c.setAttribute('r', colOf(ref) + (rowOf(ref) + amount));
        }
      }
    }
    for (const mc of Array.from(doc.getElementsByTagNameNS(MAIN, 'mergeCell'))) {
      mc.setAttribute('ref', mc.getAttribute('ref').split(':').map((p) => { const rn = rowOf(p); return rn >= fromRow ? colOf(p) + (rn + amount) : p; }).join(':'));
    }
    for (const dv of Array.from(doc.getElementsByTagNameNS(MAIN, 'dataValidation'))) {
      const sq = dv.getAttribute('sqref'); if (!sq) continue;
      dv.setAttribute('sqref', sq.split(/\s+/).map((rng) => rng.split(':').map((p) => { const rn = rowOf(p); return rn >= fromRow ? colOf(p) + (rn + amount) : p; }).join(':')).join(' '));
    }
    if (draw) { const b0 = fromRow - 1; for (const re of Array.from(draw.getElementsByTagNameNS(XDR, 'row'))) { const v = parseInt(re.textContent, 10); if (v >= b0) re.textContent = String(v + amount); } }
  }
  const ROW_STYLES = { A: '41', B: '42', C: '43', D: '44', E: '44', F: '45', G: '46', H: '44', I: '45', J: '47', K: '48', L: '49' };
  function makeDataRow(rownum) {
    const r = doc.createElementNS(MAIN, 'row');
    r.setAttribute('r', String(rownum));
    r.setAttribute('ht', '21.75'); r.setAttribute('customHeight', '1'); r.setAttribute('spans', '1:12');
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      const c = doc.createElementNS(MAIN, 'c'); c.setAttribute('r', col + rownum); c.setAttribute('s', ROW_STYLES[col]); r.appendChild(c);
    }
    return r;
  }
  function addMerge(ref) {
    const mcs = doc.getElementsByTagNameNS(MAIN, 'mergeCells')[0]; if (!mcs) return;
    const mc = doc.createElementNS(MAIN, 'mergeCell'); mc.setAttribute('ref', ref); mcs.appendChild(mc);
    mcs.setAttribute('count', String(mcs.getElementsByTagNameNS(MAIN, 'mergeCell').length));
  }

  // ---- expansão: insere `extra` linhas de dados antes da linha de total ----
  if (extra > 0) {
    shiftRows(totalRowBase, extra);
    const tRow = getRow(totalRow);
    for (let i = 0; i < extra; i++) {
      const rr = totalRowBase + i;        // 35..34+extra
      sheetData.insertBefore(makeDataRow(rr), tRow);
      addMerge('C' + rr + ':F' + rr);
      addMerge('G' + rr + ':I' + rr);
    }
  }

  // ---- cabeçalho ----
  setText('E4', SANTANDER_NOME);           // Nome (fixo)
  setText('E5', SANTANDER_CARGO);          // Cargo (fixo)
  setText('E6', computeSantanderPeriodo(D));   // Período Prestação (automático)
  setNum('E7', dateToSerial(todayISO()));      // Data de Entrega = data de geração (serial/data)

  // ---- lançamentos (tabela `alelo`) ----
  D.alelo.forEach((e, i) => {
    const r = 17 + i;
    setText('B' + r, fmtDateBR(e.data));   // DATA
    setText('C' + r, e.estabelecimento);   // ESTABELECIMENTO (C:F)
    setText('G' + r, e.descricao);         // DESCRIÇÃO DA DESPESA (G:I)
    setNum('J' + r, e.valor);              // VALOR
    setText('K' + r, e.justificativa);     // JUSTIFICATIVA | FINALIDADE
  });

  // ---- total ----
  const sum = Math.round(sumOf(D.alelo) * 100) / 100;
  setFormula('J' + totalRow, `SUM(J17:J${totalRow - 1})`, sum);
  setFormula('E8', 'J' + totalRow, sum);

  // ---- serializar ----
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const stripDecl = (s) => s.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
  files['xl/worksheets/sheet1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(doc)));
  if (draw) files['xl/drawings/drawing1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(draw)));
  if (files['xl/calcChain.xml']) {
    delete files['xl/calcChain.xml'];
    if (files['[Content_Types].xml']) {
      let ct = dec.decode(files['[Content_Types].xml']);
      ct = ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
      files['[Content_Types].xml'] = enc.encode(ct);
    }
  }
  return fflate.zipSync(files);
}

/* Confere lançamentos incompletos antes de exportar/arquivar. Retorna true p/ prosseguir. */
function validateBeforeExport(D, sections) {
  const issues = [];
  const tag = (e) => fmtDateBR(e.data) || '(sem data)';
  if (sections.reembolso) for (const e of (D.reembolso || [])) {
    const miss = [];
    if (!e.data) miss.push('data');
    if (!e.valor) miss.push('valor');
    if (!e.categoria) miss.push('categoria');
    if (miss.length) issues.push('Reembolso ' + tag(e) + ': sem ' + miss.join(', '));
  }
  if (sections.alelo) for (const e of (D.alelo || [])) {
    const miss = [];
    if (!e.data) miss.push('data');
    if (!e.valor) miss.push('valor');
    if (!e.estabelecimento) miss.push('estabelecimento');
    if (!e.justificativa) miss.push('justificativa');
    if (miss.length) issues.push('Cartão ' + tag(e) + ': sem ' + miss.join(', '));
  }
  if (!issues.length) return true;
  const list = issues.slice(0, 12).join('\n') + (issues.length > 12 ? '\n…e mais ' + (issues.length - 12) : '');
  return confirm('Alguns lançamentos estão incompletos:\n\n' + list + '\n\nExportar mesmo assim?');
}

async function exportExcel(src, sections) {
  const inc = sections || { reembolso: true, alelo: true };
  const base = src || state;
  const has = (inc.reembolso && base.reembolso.length) || (inc.alelo && base.alelo.length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  if (!validateBeforeExport(base, inc)) return;
  const santander = !!inc.alelo && !inc.reembolso;   // só cartão → formato exclusivo (Prestação de Contas)
  try {
    toast('Gerando Excel…');
    const D = filteredDoc(base, inc);
    const bytes = santander ? await buildSantanderXlsx(D) : await buildXlsx(D);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fname = (santander ? santanderFileBase(D) : reportFileBase(D)) + '.xlsx';
    await shareOrDownload(blob, fname, santander ? 'Prestação de Contas - Cartão Santander' : 'Relatório de Despesas (Excel)');
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
  updateExportHint();
  $('export-modal').classList.add('open');
}
function updateExportHint() {
  const h = $('exp-hint-santander'); if (!h) return;
  const only = $('exp-alelo').checked && !$('exp-reembolso').checked;
  h.style.display = only ? '' : 'none';
  const p = $('exp-periodo');   // pré-visualização do Período Prestação (automático), só p/ cartão
  if (p) {
    if (only) {
      const per = computeSantanderPeriodo(exportCtx.src || state);
      p.innerHTML = per ? ('Período Prestação: <b>' + escapeHtml(per) + '</b>') : 'Período Prestação: <b>—</b> (sem lançamentos com data)';
      p.style.display = '';
    } else { p.style.display = 'none'; }
  }
}
function closeExportModal() { $('export-modal').classList.remove('open'); }
function confirmExport() {
  const sections = { reembolso: $('exp-reembolso').checked, alelo: $('exp-alelo').checked };
  if (!sections.reembolso && !sections.alelo) { toast('Selecione ao menos uma seção.'); return; }
  closeExportModal();
  if (exportCtx.kind === 'excel') exportExcel(exportCtx.src, sections);
  else exportPDF(exportCtx.src, sections);
}

