'use strict';
/* ---------------- Geração do PDF (impressão) ---------------- */
const APROVADOR_NOME = 'Gustavo Barbeitos da Gama';
const APROVADOR_CARGO = 'Presidente';

function buildSignatureBlock() {
  return `
    <div class="p-sign">
      <div class="p-sign-box">
        <div class="p-sign-line"></div>
        <div class="p-sign-name">${escapeHtml(SANTANDER_NOME)}</div>
        <div class="p-sign-role">${escapeHtml(SANTANDER_CARGO)}</div>
      </div>
      <div class="p-sign-box">
        <div class="p-sign-line"></div>
        <div class="p-sign-name">${escapeHtml(APROVADOR_NOME)}</div>
        <div class="p-sign-role">${escapeHtml(APROVADOR_CARGO)}</div>
      </div>
    </div>
    <div class="p-sign-date">Data: ${fmtDateBR(todayISO())}</div>`;
}

function buildPrintTable(title, list, minRows) {
  let rows = '';
  const n = Math.max(list.length, minRows);
  for (let i = 0; i < n; i++) {
    const e = list[i];
    rows += `<tr>
      <td class="c-data">${e ? fmtDateBR(e.data) : ''}</td>
      <td>${e ? escapeHtml(e.descricao) : ''}</td>
      <td class="c-cat">${e ? escapeHtml(e.categoria) : ''}</td>
      <td class="c-val">${e ? formatMoney(e.valor) : ''}</td>
    </tr>`;
  }
  const sub = sumOf(list);
  return `
    <div class="p-section">${title}</div>
    <table class="p-tbl">
      <thead><tr>
        <th class="c-data">DATA DA COMPRA</th><th>DESCRIÇÃO</th>
        <th class="c-cat">CATEGORIA</th><th class="c-val">VALOR</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="p-subtotal">
          <td colspan="3" class="sub-lbl">${title === 'DESPESAS PARA REEMBOLSO' ? 'SUBTOTAL DESPESAS PARA REEMBOLSO:' : 'SUBTOTAL DESPESAS CARTÃO SANTANDER - SOMA:'}</td>
          <td class="sub-val">${formatMoney(sub)}</td>
        </tr>
      </tbody>
    </table>`;
}

function buildPrint(src, sections) {
  const D = src || state;
  const inc = sections || { reembolso: true, alelo: true };
  const s1 = inc.reembolso ? sumOf(D.reembolso) : 0;
  const s2 = inc.alelo ? sumOf(D.alelo) : 0;
  const b = D.bank;
  const root = $('print-root');
  root.innerHTML = `
    <div class="p-top">
      <div class="p-logo"><img src="assets/soma-logo.png" alt="Soma"></div>
      <div class="p-title">RELATÓRIO DE DESPESAS PARA REEMBOLSO</div>
    </div>
    <table class="p-info">
      <tr><td class="lab">Empresa:</td><td class="val">${EMPRESA}</td>
          <td class="lab">Data da Solicitação:</td><td class="val">${fmtDateBR(D.dataSolicitacao)}</td></tr>
      <tr><td class="lab">Funcionário:</td><td class="val">${escapeHtml(D.funcionario)}</td>
          <td class="lab">Reembolso Referente à:</td><td class="val">${escapeHtml(D.referente)}</td></tr>
    </table>
    ${inc.reembolso ? buildPrintTable('DESPESAS PARA REEMBOLSO', D.reembolso, 5) : ''}
    ${inc.alelo ? buildPrintTable('DESPESAS CARTÃO SANTANDER - SOMA', D.alelo, 5) : ''}
    <div class="p-total"><span>TOTAL DOS GASTOS</span><span>${formatMoney(s1 + s2)}</span></div>
    <div class="p-bank-title">Dados Bancários (Se Aplicável)</div>
    <table class="p-bank">
      <tr><td class="lab">Nome:</td><td>${escapeHtml(b.nome)}</td><td class="lab">Banco:</td><td>${escapeHtml(b.banco)}</td></tr>
      <tr><td class="lab">CPF:</td><td>${escapeHtml(b.cpf)}</td><td class="lab">Agência:</td><td>${escapeHtml(b.agencia)}</td></tr>
      <tr><td class="lab">Conta:</td><td>${escapeHtml(b.conta)}</td><td class="lab">Chave Pix:</td><td>${escapeHtml(b.pix)}</td></tr>
    </table>
    <div class="p-obs">
      <b>Observações:</b> ${limitsObsText()}
      Enviar junto a este relatório os cupons das despesas. Em caso de gasto reembolsável,
      informar os dados da conta bancária para o recebimento.
    </div>
    ${buildSignatureBlock()}`;
}

/* PDF exclusivo do Cartão Santander — replica o VISUAL do modelo "Prestação de Contas"
   (barra vermelha #C00000 + logo, info à esquerda, declaração à direita, checklist, tabela
   com cabeçalho vermelho e total cinza #D8D8D8). Gerado em paisagem por generatePdfBlob. */
function buildSantanderPrint(src) {
  const D = src || state;
  const list = D.alelo || [];
  const total = sumOf(list);
  const RED = '#C00000', GRAY = '#D8D8D8';
  const bd = 'border:1px solid #000;', pad = 'padding:5px 7px;';
  const th = bd + pad + 'color:#fff;background:' + RED + ';font-weight:bold;text-align:center;';
  const lab = bd + pad + 'font-weight:bold;background:#fff;white-space:nowrap;';
  const val = bd + pad + 'background:#fff;';
  const tdTxt = bd + pad + 'word-break:break-word;';
  const minRows = 12;
  let rows = '';
  const nrows = Math.max(list.length, minRows);
  for (let i = 0; i < nrows; i++) {
    const e = list[i];
    rows += `<tr>
      <td style="${bd}${pad}text-align:center;white-space:nowrap;">${e ? fmtDateBR(e.data) : ''}</td>
      <td style="${tdTxt}">${e ? escapeHtml(e.estabelecimento || '') : ''}</td>
      <td style="${tdTxt}">${e ? escapeHtml(e.descricao || '') : ''}</td>
      <td style="${bd}${pad}text-align:right;white-space:nowrap;">${e ? formatMoney(e.valor) : ''}</td>
      <td style="${tdTxt}">${e ? escapeHtml(e.justificativa || '') : ''}</td>
    </tr>`;
  }
  const root = $('print-root');
  root.innerHTML = `
  <div style="font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#000;background:#fff;font-size:13px;">
    <div style="background:${RED};color:#fff;display:flex;align-items:center;gap:14px;padding:9px 14px;">
      <img src="assets/soma-logo.png" alt="Soma" style="height:44px;background:#fff;padding:3px 6px;border-radius:3px;">
      <div style="font-weight:bold;font-size:21px;letter-spacing:.5px;">PRESTAÇÃO DE CONTAS - CARTÃO DE CRÉDITO</div>
    </div>
    <div style="display:flex;gap:12px;margin-top:12px;align-items:stretch;">
      <table style="border-collapse:collapse;width:46%;font-size:14px;">
        <tr><td style="${lab}width:38%;">Nome:</td><td style="${val}">${escapeHtml(SANTANDER_NOME)}</td></tr>
        <tr><td style="${lab}">Cargo:</td><td style="${val}">${escapeHtml(SANTANDER_CARGO)}</td></tr>
        <tr><td style="${lab}">Período Prestação:</td><td style="${val}">${escapeHtml(computeSantanderPeriodo(D))}</td></tr>
        <tr><td style="${lab}">Data de Entrega:</td><td style="${val}">${fmtDateBR(todayISO())}</td></tr>
        <tr><td style="${lab}">Total da Despesas:</td><td style="${bd}${pad}background:${GRAY};font-weight:bold;">${formatMoney(total)}</td></tr>
      </table>
      <div style="flex:1;border:1px solid #000;padding:10px 12px;font-size:12.5px;line-height:1.45;">
        Declaro que os valores acima referem-se a despesas realizadas exclusivamente para fins
        profissionais, conforme as normas da empresa/instituição.<br><br>
        Solicitar inclusão de CNPJ na emissão da nota fiscal.<br><br>
        <b><u>Toda despesa sem o respectivo comprovante fiscal será considerada indevida, sujeita
        à restituição por parte do colaborador.</u></b>
      </div>
    </div>
    <div style="margin-top:10px;font-weight:bold;font-size:13px;">
      Anexar: &#9744; Comprovante do cartão de crédito (fatura) &nbsp;&nbsp; &#9744; Notas fiscais ou recibos de todas as despesas &nbsp;&nbsp; &#9744; Relatório de viagem (se aplicável)
    </div>
    <table style="border-collapse:collapse;width:100%;margin-top:10px;font-size:12.5px;table-layout:fixed;">
      <colgroup><col style="width:9%"><col style="width:22%"><col style="width:27%"><col style="width:11%"><col style="width:31%"></colgroup>
      <thead><tr>
        <th style="${th}">DATA</th><th style="${th}">ESTABELECIMENTO</th>
        <th style="${th}">DESCRIÇÃO DA DESPESA</th><th style="${th}">VALOR</th>
        <th style="${th}">JUSTIFICATIVA / FINALIDADE</th>
      </tr></thead>
      <tbody>${rows}
        <tr>
          <td colspan="3" style="${bd}${pad}background:${GRAY};font-weight:bold;text-align:right;">TOTAL DAS DESPESAS:</td>
          <td style="${bd}${pad}background:${GRAY};font-weight:bold;text-align:right;white-space:nowrap;">${formatMoney(total)}</td>
          <td style="${bd}${pad}background:${GRAY};"></td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

async function exportPDF(src, sections, includeAttachments) {
  const inc = sections || { reembolso: true, alelo: true };
  const D = src || state;
  const has = (inc.reembolso && D.reembolso.length) || (inc.alelo && D.alelo.length);
  if (!has) { toast('Nada para exportar com a seleção.'); return; }
  if (!validateBeforeExport(D, inc)) return;
  const santander = !!inc.alelo && !inc.reembolso;   // só cartão → formato exclusivo
  try {
    toast('Gerando PDF…');
    const blob = await generatePdfBlob(D, inc, santander, includeAttachments !== false);
    const fname = (santander ? santanderFileBase(D) : reportFileBase(D)) + '.pdf';
    await shareOrDownload(blob, fname, santander ? 'Prestação de Contas - Cartão Santander' : 'Relatório de Despesas (PDF)');
  } catch (e) {
    console.error(e);
    toast('Erro ao gerar PDF: ' + e.message);
  }
}

/* Gera um PDF de verdade (arquivo) a partir do mesmo layout do relatório,
   capturado com html2canvas e montado com jsPDF (A4 retrato, multipágina). */
async function generatePdfBlob(src, sections, santander, includeAttachments) {
  if (includeAttachments === undefined) includeAttachments = true;
  if (santander) buildSantanderPrint(src || state);
  else buildPrint(src || state, sections);
  const root = $('print-root');
  const prevStyle = root.getAttribute('style') || '';
  // torna o layout capturável fora da tela (cartão Santander = fundo branco + mais largo p/ paisagem)
  const bg = santander ? '#ffffff' : '#f8f4f2';
  const w = santander ? 1120 : 800;
  root.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:' + w + 'px;background:' + bg + ';padding:24px;';

  // espera o logo carregar para não sair em branco
  const img = root.querySelector('img');
  if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; });

  try {
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: bg, useCORS: true });
    // fronteiras seguras de quebra (fim de cada linha) p/ não cortar lançamentos entre páginas
    const scaleY = canvas.height / root.scrollHeight;
    const rootTop = root.getBoundingClientRect().top;
    const breaks = [];
    root.querySelectorAll('tr').forEach((tr) => {
      const b = (tr.getBoundingClientRect().bottom - rootTop) * scaleY;
      if (b > 0 && b < canvas.height) breaks.push(b);
    });
    breaks.sort((a, b) => a - b);

    const jsPDF = window.jspdf.jsPDF;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: santander ? 'landscape' : 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    const pxPerMm = canvas.width / imgW;
    const pageMaxPx = usableH * pxPerMm;

    let startPx = 0, first = true;
    while (startPx < canvas.height - 1) {
      let endPx = startPx + pageMaxPx;
      if (endPx < canvas.height) {
        let safe = 0;
        for (const b of breaks) { if (b > startPx + 4 && b <= endPx) safe = b; }
        if (safe) endPx = safe;           // quebra no fim de uma linha
      } else {
        endPx = canvas.height;
      }
      const sliceH = Math.round(endPx - startPx);
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = sliceH;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(canvas, 0, startPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const sliceData = tmp.toDataURL('image/jpeg', 0.96);
      if (!first) pdf.addPage();
      pdf.addImage(sliceData, 'JPEG', margin, margin, imgW, sliceH / pxPerMm);
      first = false;
      startPx = endPx;
    }

    // anexa comprovantes (Drive ou fila local) como páginas finais
    const inc = sections || { reembolso: true, alelo: true };
    const D = src || state;
    const fotos = [];
    if (includeAttachments) {
      if (inc.reembolso) fotos.push(...(D.reembolso || []));
      if (inc.alelo) fotos.push(...(D.alelo || []));
    }
    for (const e of fotos) {
      if (!e.foto) continue;
      if (e.foto.id && !gdConnected()) continue;   // evita pedir login no meio da exportação
      let blob = null;
      try { blob = await getPhotoBlob(e.foto); } catch (er) { console.error(er); }
      if (!blob) continue;
      try {
        const durl = await blobToDataUrl(blob);
        const props = pdf.getImageProperties(durl);
        pdf.addPage();
        pdf.setFontSize(10);
        pdf.text('Comprovante — ' + (e.descricao || '') + ' (' + fmtDateBR(e.data) + ')', margin, margin + 4);
        const availW = pageW - margin * 2, availH = pageH - margin * 2 - 8;
        let iw = availW, ih = props.height * (availW / props.width);
        if (ih > availH) { ih = availH; iw = props.width * (availH / props.height); }
        pdf.addImage(durl, 'JPEG', margin + (availW - iw) / 2, margin + 8, iw, ih);
      } catch (er) { console.error('Falha ao anexar comprovante', er); }
    }

    return pdf.output('blob');
  } finally {
    root.setAttribute('style', prevStyle);
    root.style.display = 'none';
  }
}

