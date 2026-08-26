'use strict';
/* ---------------- Geração do Excel (idêntico ao modelo) ----------------
   Dois layouts, escolhidos pelo módulo (js/modules.js):
   - layout 'reembolso'  → template.xlsx, 1 ou 2 blocos de despesas + dados bancários
   - layout 'prestacao'  → template-santander.xlsx, Prestação de Contas (cartão)
   Logo e cores do modelo são trocados por módulo (applyBrandToXlsx). */
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const XMLNS_XML = 'http://www.w3.org/XML/1998/namespace';

function colOf(ref) { return ref.match(/[A-Z]+/)[0]; }
function rowOf(ref) { return parseInt(ref.match(/\d+/)[0], 10); }

/* ---- ferramentas de manipulação da planilha (compartilhadas pelos dois builders) ---- */
function sheetTools(doc, sheetData, draw) {
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
  function getRow(n) {
    for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) if (r.getAttribute('r') === String(n)) return r;
    return null;
  }
  function mergeList() { return Array.from(doc.getElementsByTagNameNS(MAIN, 'mergeCell')); }
  function refreshMergeCount() {
    const mcs = doc.getElementsByTagNameNS(MAIN, 'mergeCells')[0]; if (!mcs) return;
    mcs.setAttribute('count', String(mcs.getElementsByTagNameNS(MAIN, 'mergeCell').length));
  }
  function addMerge(ref) {
    const mcs = doc.getElementsByTagNameNS(MAIN, 'mergeCells')[0]; if (!mcs) return;
    const mc = doc.createElementNS(MAIN, 'mergeCell'); mc.setAttribute('ref', ref); mcs.appendChild(mc);
    refreshMergeCount();
  }
  /* desloca linhas a partir de `fromRow` (amount pode ser negativo) */
  function shiftRows(fromRow, amount) {
    if (!amount) return;
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
    for (const mc of mergeList()) {
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
    if (draw) {
      const b0 = fromRow - 1;
      for (const re of Array.from(draw.getElementsByTagNameNS(XDR, 'row'))) {
        const v = parseInt(re.textContent, 10);
        if (v >= b0) re.textContent = String(v + amount);
      }
    }
  }
  /* apaga um intervalo de linhas — e tudo que estiver inteiramente dentro dele */
  function removeRows(from, count) {
    if (count <= 0) return;
    const to = from + count - 1;
    for (const r of Array.from(sheetData.getElementsByTagNameNS(MAIN, 'row'))) {
      const rn = parseInt(r.getAttribute('r'), 10);
      if (rn >= from && rn <= to) r.parentNode.removeChild(r);
    }
    for (const mc of mergeList()) {
      const p = mc.getAttribute('ref').split(':');
      const a = rowOf(p[0]), b = rowOf(p[p.length - 1]);
      if (a >= from && b <= to) mc.parentNode.removeChild(mc);
    }
    refreshMergeCount();
    for (const dv of Array.from(doc.getElementsByTagNameNS(MAIN, 'dataValidation'))) {
      const sq = dv.getAttribute('sqref'); if (!sq) continue;
      const keep = sq.split(/\s+/).filter((rng) => {
        const p = rng.split(':'); const a = rowOf(p[0]), b = rowOf(p[p.length - 1]);
        return !(a >= from && b <= to);
      });
      if (!keep.length) { dv.parentNode.removeChild(dv); continue; }
      dv.setAttribute('sqref', keep.join(' '));
    }
    // formas/imagens que COMEÇAM dentro do intervalo somem junto (âncoras em base 0)
    if (draw) {
      for (const tag of ['twoCellAnchor', 'oneCellAnchor']) {
        for (const an of Array.from(draw.getElementsByTagNameNS(XDR, tag))) {
          const fr = an.getElementsByTagNameNS(XDR, 'from')[0];
          if (!fr) continue;
          const rw = fr.getElementsByTagNameNS(XDR, 'row')[0];
          if (!rw) continue;
          const v = parseInt(rw.textContent, 10) + 1;   // base 0 -> linha da planilha
          if (v >= from && v <= to) an.parentNode.removeChild(an);
        }
      }
    }
    shiftRows(to + 1, -count);
  }
  return { getCell, setText, setNum, setFormula, getRow, addMerge, shiftRows, removeRows };
}

async function loadTemplateFiles(name) {
  const buf = await fetch(name, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('modelo ' + name + ' não encontrado (' + r.status + ')');
    return r.arrayBuffer();
  });
  return fflate.unzipSync(new Uint8Array(buf));
}

/* remove o calcChain (o Excel recalcula sozinho; evita o aviso de "reparo") */
function dropCalcChain(files, dec, enc) {
  if (!files['xl/calcChain.xml']) return;
  delete files['xl/calcChain.xml'];
  if (files['[Content_Types].xml']) {
    let ct = dec.decode(files['[Content_Types].xml']);
    ct = ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    files['[Content_Types].xml'] = enc.encode(ct);
  }
}

/* ---------------- Identidade visual do módulo dentro do .xlsx ----------------
   `excelColors` troca as cores do modelo (styles.xml usa rgb="FFxxxxxx";
   drawing1.xml usa val="xxxxxx"); `excelLogo` troca a imagem do cabeçalho
   (xl/media/image3.png), preservando a proporção original (letterbox). */
function recolorHex(text, map, prefixed) {
  const re = prefixed ? /rgb="FF([0-9A-Fa-f]{6})"/g : /val="([0-9A-Fa-f]{6})"/g;
  return text.replace(re, (m, hex) => {
    const to = map[hex.toUpperCase()];
    if (!to) return m;
    return prefixed ? 'rgb="FF' + to + '"' : 'val="' + to + '"';
  });
}

function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

/* redesenha o logo do módulo centralizado numa tela w x h (mantém a proporção) */
async function logoBytesFor(url, w, h) {
  const blob = await fetch(url, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('logo ' + url + ' não encontrado (' + r.status + ')');
    return r.blob();
  });
  const durl = await blobToDataUrl(blob);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('logo inválido'));
    i.src = durl;
  });
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const k = Math.min(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const out = await new Promise((res) => cv.toBlob(res, 'image/png'));
  return new Uint8Array(await out.arrayBuffer());
}

async function applyBrandToXlsx(files, mod, dec, enc) {
  if (!mod) return;
  if (mod.excelColors) {
    for (const part of ['xl/styles.xml', 'xl/theme/theme1.xml']) {
      if (files[part]) files[part] = enc.encode(recolorHex(dec.decode(files[part]), mod.excelColors, true));
    }
    if (files['xl/drawings/drawing1.xml']) {
      files['xl/drawings/drawing1.xml'] = enc.encode(recolorHex(dec.decode(files['xl/drawings/drawing1.xml']), mod.excelColors, false));
    }
  }
  if (mod.excelLogo && mod.logo) {
    const alvo = files['xl/media/image3.png'];
    const dim = pngSize(alvo) || { w: 354, h: 368 };
    try { files['xl/media/image3.png'] = await logoBytesFor(mod.logo, dim.w, dim.h); }
    catch (e) { console.warn('logo do Excel não trocado:', e.message); }
  }
}

/* ---------------- Relatório de despesas (template.xlsx) ----------------
   Blocos vêm de mod.blocos: 2 blocos = Reembolso + Cartão na mesma planilha;
   1 bloco = o 2º bloco (linhas 18..28) é REMOVIDO e sobra uma tabela só. */
async function buildXlsx(src, mod) {
  mod = mod || MOD[TABELA_PADRAO];
  const D = src || state;
  const blocos = (mod.blocos && mod.blocos.length) ? mod.blocos : [TABELA_PADRAO];
  const single = blocos.length < 2;

  const files = await loadTemplateFiles(mod.template || 'template.xlsx');
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const parser = new DOMParser();
  const ser = new XMLSerializer();

  const doc = parser.parseFromString(dec.decode(files['xl/worksheets/sheet1.xml']), 'application/xml');
  const draw = parser.parseFromString(dec.decode(files['xl/drawings/drawing1.xml']), 'application/xml');
  const sheetData = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];
  const T = sheetTools(doc, sheetData, draw);

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
  function insertRowsBefore(subRowNum, firstNewNum, count) {
    const subRow = T.getRow(subRowNum);
    for (let i = 0; i < count; i++) sheetData.insertBefore(makeDataRow(firstNewNum + i), subRow);
  }

  // ---- uma tabela só: apaga título + cabeçalho + dados + subtotal do 2º bloco (18..28) ----
  if (single) T.removeRows(18, 11);
  const BASE = single ? { total: 18, bank: 22, dim: 30 } : { total: 29, bank: 33, dim: 41 };

  const list1 = D[blocos[0]] || [];
  const list2 = single ? [] : (D[blocos[1]] || []);
  const n1 = list1.length, n2 = list2.length;
  const extra1 = Math.max(0, n1 - 7);
  const extra2 = Math.max(0, n2 - 7);

  // ---- expansão de linhas (só quando > 7 por seção) ----
  // Tabela 1: linhas 9..15, subtotal 16. Tabela 2 (quando existe): 20..26, subtotal 27.
  T.shiftRows(16, extra1);
  if (extra1 > 0) insertRowsBefore(16 + extra1, 16, extra1);
  if (!single) {
    const t2SubBase = 27 + extra1;
    T.shiftRows(t2SubBase, extra2);
    if (extra2 > 0) insertRowsBefore(t2SubBase + extra2, 20 + extra1, extra2);
  }

  // ---- posições finais ----
  const t1First = 9;
  const t1Rows = Math.max(n1, 7);
  const t1Last = t1First + t1Rows - 1;
  const t1Sub = t1Last + 1;

  const t2First = 20 + extra1;
  const t2Rows = Math.max(n2, 7);
  const t2Last = t2First + t2Rows - 1;
  const t2Sub = t2Last + 1;

  const shiftAll = extra1 + extra2;
  const totalRow = BASE.total + shiftAll;

  // ---- cabeçalho ----
  T.setText('C4', mod.empresa);
  if (D.dataSolicitacao) T.setNum('E4', dateToSerial(D.dataSolicitacao));
  if (mod.rotuloFuncionario) T.setText('B5', mod.rotuloFuncionario);   // 'Funcionario' -> 'Prestador' (SA)
  T.setText('C5', D.funcionario);
  T.setText('E5', D.referente);
  T.setText('B7', mod.tituloTabela);

  // ---- lançamentos ----
  const escreve = (list, first) => list.forEach((e, i) => {
    const r = first + i;
    if (e.data) T.setNum('B' + r, dateToSerial(e.data));
    T.setText('C' + r, e.descricao);
    T.setText('D' + r, e.categoria);
    T.setNum('E' + r, e.valor);
  });
  escreve(list1, t1First);
  if (!single) escreve(list2, t2First);

  // ---- subtotais e total (fórmulas + valores em cache) ----
  const s1 = Math.round(sumOf(list1) * 100) / 100;
  const s2 = Math.round(sumOf(list2) * 100) / 100;
  T.setText('B' + t1Sub, mod.subtotalLabel);
  T.setFormula('E' + t1Sub, 'SUM(E' + t1First + ':E' + t1Last + ')', s1);
  if (single) {
    T.setFormula('E' + totalRow, 'E' + t1Sub, s1);
  } else {
    T.setFormula('E' + t2Sub, 'SUM(E' + t2First + ':E' + t2Last + ')', s2);
    T.setFormula('E' + totalRow, 'E' + t1Sub + '+E' + t2Sub, Math.round((s1 + s2) * 100) / 100);
  }

  // ---- dados bancários ----
  const b = D.bank || {};
  const bk = BASE.bank + shiftAll;
  T.setText('C' + bk, b.nome);
  T.setText('E' + bk, b.banco);
  T.setText('C' + (bk + 1), b.cpf);
  T.setText('E' + (bk + 1), b.agencia);
  T.setText('C' + (bk + 2), b.conta);
  T.setText('E' + (bk + 2), b.pix);

  // ---- dimensão ----
  const dim = doc.getElementsByTagNameNS(MAIN, 'dimension')[0];
  if (dim) dim.setAttribute('ref', 'A1:R' + (BASE.dim + shiftAll));

  // ---- serializar de volta ----
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const stripDecl = (s) => s.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
  files['xl/worksheets/sheet1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(doc)));
  files['xl/drawings/drawing1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(draw)));
  await applyBrandToXlsx(files, mod, dec, enc);
  dropCalcChain(files, dec, enc);
  return fflate.zipSync(files);
}

/* Nome-base dos arquivos gerados (Excel/PDF) — o prefixo vem do módulo e é
   reconhecido por isGeneratedArtifact (drive-scan.js) para não reprocessar. */
function fileBaseOf(src, mod) {
  const D = src || state;
  const m = mod || MOD[TABELA_PADRAO];
  const nome = (D.funcionario || 'Funcionario').trim().replace(/\s+/g, '_');
  const ref = D.dataSolicitacao || (D.archivedAt ? new Date(D.archivedAt).toISOString().slice(0, 10) : todayISO());
  return m.fileBase + '_' + nome + '_' + ref;
}

/* Filtra um documento para conter só as seções escolhidas (não-selecionada = vazia) */
function filteredDoc(src, sections) {
  const D = src || state;
  const out = Object.assign({}, D);
  for (const t of TABELAS) out[t] = (sections && sections[t]) ? (D[t] || []) : [];
  return out;
}

/* ---------------- Prestação de Contas (template-santander.xlsx) ----------------
   Layout: info E4=Nome, E5=Cargo, E6=Período, E7=Data de Entrega (serial), E8=Total(=J{total});
   tabela cabeçalho linha 16, dados 17.. (capac. 18 → linhas 17-34), linha de total 35 (J=SUM).
   Colunas: B=DATA, C:F=ESTABELECIMENTO, G:I=DESCRIÇÃO, J=VALOR, K=JUSTIFICATIVA. */
async function buildPrestacaoXlsx(src, mod) {
  mod = mod || MOD.alelo;
  const D = src || state;
  const chave = (mod.blocos && mod.blocos[0]) || 'alelo';
  const list = D[chave] || [];

  const files = await loadTemplateFiles(mod.template || 'template-santander.xlsx');
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const parser = new DOMParser();
  const ser = new XMLSerializer();

  const doc = parser.parseFromString(dec.decode(files['xl/worksheets/sheet1.xml']), 'application/xml');
  const draw = files['xl/drawings/drawing1.xml'] ? parser.parseFromString(dec.decode(files['xl/drawings/drawing1.xml']), 'application/xml') : null;
  const sheetData = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];
  const T = sheetTools(doc, sheetData, draw);

  const n = list.length;
  const CAP = 18;                          // linhas 17..34
  const extra = Math.max(0, n - CAP);
  const totalRowBase = 35;
  const totalRow = totalRowBase + extra;

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

  // ---- expansão: insere `extra` linhas de dados antes da linha de total ----
  if (extra > 0) {
    T.shiftRows(totalRowBase, extra);
    const tRow = T.getRow(totalRow);
    for (let i = 0; i < extra; i++) {
      const rr = totalRowBase + i;        // 35..34+extra
      sheetData.insertBefore(makeDataRow(rr), tRow);
      T.addMerge('C' + rr + ':F' + rr);
      T.addMerge('G' + rr + ':I' + rr);
    }
  }

  // ---- cabeçalho ----
  T.setText('E4', mod.assinante);                    // Nome (fixo do módulo)
  T.setText('E5', mod.assinanteCargo);               // Cargo (fixo do módulo)
  T.setText('E6', santanderPeriodoText(D, chave));   // Período (escolhido pelo usuário; sem escolha, automático)
  T.setNum('E7', dateToSerial(todayISO()));          // Data de Entrega = data de geração

  // ---- lançamentos ----
  list.forEach((e, i) => {
    const r = 17 + i;
    T.setText('B' + r, fmtDateBR(e.data));   // DATA
    T.setText('C' + r, e.estabelecimento);   // ESTABELECIMENTO (C:F)
    T.setText('G' + r, e.descricao);         // DESCRIÇÃO DA DESPESA (G:I)
    T.setNum('J' + r, e.valor);              // VALOR
    T.setText('K' + r, e.justificativa);     // JUSTIFICATIVA | FINALIDADE
  });

  // ---- total ----
  const sum = Math.round(sumOf(list) * 100) / 100;
  T.setFormula('J' + totalRow, 'SUM(J17:J' + (totalRow - 1) + ')', sum);
  T.setFormula('E8', 'J' + totalRow, sum);

  // ---- serializar ----
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const stripDecl = (s) => s.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
  files['xl/worksheets/sheet1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(doc)));
  if (draw) files['xl/drawings/drawing1.xml'] = enc.encode(xmlHead + stripDecl(ser.serializeToString(draw)));
  await applyBrandToXlsx(files, mod, dec, enc);
  dropCalcChain(files, dec, enc);
  return fflate.zipSync(files);
}

/* Confere lançamentos incompletos antes de exportar/arquivar. Retorna true p/ prosseguir.
   As regras de cada relatório vêm de MOD[t].obrigatorios. */
const CAMPO_LABEL = { data: 'data', valor: 'valor', categoria: 'categoria', estabelecimento: 'estabelecimento', justificativa: 'justificativa', descricao: 'descrição' };
function validateBeforeExport(D, sections) {
  const issues = [];
  const tag = (e) => fmtDateBR(e.data) || '(sem data)';
  for (const t of TABELAS) {
    if (!sections || !sections[t]) continue;
    const mod = modOf(t);
    const req = mod.obrigatorios || ['data', 'valor', 'categoria'];
    for (const e of (D[t] || [])) {
      const miss = req.filter((k) => !e[k]).map((k) => CAMPO_LABEL[k] || k);
      if (miss.length) issues.push(mod.tabLabel + ' ' + tag(e) + ': sem ' + miss.join(', '));
    }
  }
  if (!issues.length) return true;
  const list = issues.slice(0, 12).join('\n') + (issues.length > 12 ? '\n…e mais ' + (issues.length - 12) : '');
  return confirm('Alguns lançamentos estão incompletos:\n\n' + list + '\n\nExportar mesmo assim?');
}

/* Descobre QUAL módulo (e portanto qual formato) atende a seleção de seções.
   Um só relatório → o formato próprio dele. Reembolso + Cartão → o relatório
   combinado da Soma. Empresas diferentes na mesma seleção → recusa. */
function resolveExport(sections) {
  const sel = modulosSelecionados(sections);
  if (!sel.length) return { erro: 'Selecione ao menos um relatório.' };
  const grupos = {};
  for (const t of sel) grupos[modOf(t).grupoExport] = 1;
  if (Object.keys(grupos).length > 1) {
    return { erro: 'Relatórios de empresas diferentes não saem no mesmo arquivo. Exporte um de cada vez.' };
  }
  const cand = MODULOS.filter((m) => sel.every((t) => (m.blocos || []).indexOf(t) >= 0));
  if (!cand.length) return { erro: 'Essa combinação de relatórios não tem um formato correspondente.' };
  cand.sort((a, b) => a.blocos.length - b.blocos.length);
  return { mod: cand[0] };
}

/* Documento pronto p/ os builders: só as seções escolhidas + o perfil do módulo achatado */
function docParaExport(src, sections, mod) {
  return docForModule(filteredDoc(src, sections), mod.key);
}

async function buildXlsxFor(D, mod) {
  return mod.layout === 'prestacao' ? await buildPrestacaoXlsx(D, mod) : await buildXlsx(D, mod);
}

async function exportExcel(src, sections) {
  const inc = sections || mapPorTabela(() => true);
  const base = src || state;
  const has = TABELAS.some((t) => inc[t] && (base[t] || []).length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  const r = resolveExport(inc);
  if (r.erro) { toast(r.erro); return; }
  if (!validateBeforeExport(base, inc)) return;
  try {
    toast('Gerando Excel…');
    const D = docParaExport(base, inc, r.mod);
    const bytes = await buildXlsxFor(D, r.mod);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await shareOrDownload(blob, fileBaseOf(D, r.mod) + '.xlsx', r.mod.shareTitle + ' (Excel)');
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

/* ---- caixa de seleção do que exportar (uma opção por módulo) ---- */
let exportCtx = { kind: 'excel', src: null };
function openExportChooser(kind, src) {
  const D = src || state;
  if (!TABELAS.some((t) => (D[t] || []).length)) { toast('Adicione ao menos um lançamento.'); return; }
  exportCtx = { kind, src: D };
  $('export-title').textContent = 'Exportar ' + (kind === 'excel' ? 'Excel' : 'PDF');

  const box = $('exp-options');
  if (box) {
    box.innerHTML = MODULOS.map((m) => '<label class="exp-opt">' +
      '<input type="checkbox" class="exp-chk" data-t="' + m.key + '" id="exp-' + m.key + '" />' +
      '<span>' + escapeHtml(m.label) + '<span class="exp-count" id="exp-c-' + m.key + '"></span></span>' +
      '</label>').join('');
    box.querySelectorAll('.exp-chk').forEach((c) => c.addEventListener('change', () => onExportOptChange(c)));
  }
  // a aba ativa manda: marca os relatórios do grupo dela que tenham lançamentos
  const ativo = modOf(typeof activeReportTab === 'string' ? activeReportTab : TABELA_PADRAO);
  for (const m of MODULOS) {
    const n = (D[m.key] || []).length;
    const c = $('exp-c-' + m.key); if (c) c.textContent = n + ' lançamento(s) · ' + formatMoney(sumOf(D[m.key] || []));
    const chk = $('exp-' + m.key); if (chk) chk.checked = n > 0 && m.grupoExport === ativo.grupoExport;
  }
  if (!TABELAS.some((t) => !!($('exp-' + t) || {}).checked)) {
    for (const m of MODULOS) { const chk = $('exp-' + m.key); if (chk && (D[m.key] || []).length) { chk.checked = true; break; } }
  }
  const anexosRow = $('exp-anexos-row');
  if (anexosRow) anexosRow.style.display = kind === 'pdf' ? '' : 'none';
  const anexosChk = $('exp-anexos'); if (anexosChk) anexosChk.checked = true;
  updateExportHint();
  $('export-modal').classList.add('open');
}

/* marcar um relatório de outra empresa desmarca os demais (não somam no mesmo arquivo) */
function onExportOptChange(chk) {
  if (chk.checked) {
    const g = modOf(chk.dataset.t).grupoExport;
    for (const t of TABELAS) {
      if (t === chk.dataset.t) continue;
      if (modOf(t).grupoExport !== g) { const o = $('exp-' + t); if (o) o.checked = false; }
    }
  }
  updateExportHint();
}

function currentExportSections() {
  const s = {};
  for (const t of TABELAS) s[t] = !!($('exp-' + t) || {}).checked;
  return s;
}

function updateExportHint() {
  const h = $('exp-hint'); const p = $('exp-periodo');
  const r = resolveExport(currentExportSections());
  if (h) {
    h.innerHTML = r.erro ? escapeHtml(r.erro) : ('Formato: <b>' + escapeHtml(r.mod.shareTitle) + '</b>');
    h.style.display = '';
  }
  if (p) {
    if (!r.erro && r.mod.periodo) {
      const per = santanderPeriodoText(docForModule(exportCtx.src || state, r.mod.key), r.mod.blocos[0]);
      p.innerHTML = per ? ('Período Prestação: <b>' + escapeHtml(per) + '</b>') : 'Período Prestação: <b>—</b> (sem lançamentos com data)';
      p.style.display = '';
    } else { p.style.display = 'none'; }
  }
}

function closeExportModal() { $('export-modal').classList.remove('open'); }

function confirmExport() {
  const sections = currentExportSections();
  const r = resolveExport(sections);
  if (r.erro) { toast(r.erro); return; }
  closeExportModal();
  if (exportCtx.kind === 'excel') exportExcel(exportCtx.src, sections);
  else {
    const anexosChk = $('exp-anexos');
    exportPDF(exportCtx.src, sections, !anexosChk || anexosChk.checked);
  }
}
