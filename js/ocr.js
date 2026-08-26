'use strict';
/* ============================================================
   Leitura automática do comprovante (OCR via Google Gemini)
   ============================================================ */
const AI_KEY = 'despesas-soma-ai-v1';
const GEMINI_MODEL = 'gemini-2.5-flash';   // visão + JSON estruturado, barato
function loadAi() { try { return Object.assign({ key: '', enabled: true }, JSON.parse(localStorage.getItem(AI_KEY) || '{}')); } catch (e) { return { key: '', enabled: true }; } }
function saveAi(c) { try { localStorage.setItem(AI_KEY, JSON.stringify(c)); } catch (e) { console.warn('saveAi falhou', e); } }
function aiConfigured() { const a = loadAi(); return !!a.key && a.enabled !== false; }

/* descrição padronizada: "Despesa de {Grupo} durante viagem a {Cidade}/{UF}" */
function buildDescricao(category, city, uf) {
  const grupo = grupoDaCategoria(category);
  const local = (city || '') + (uf ? ('/' + uf) : '');
  const head = grupo ? ('Despesa de ' + grupo) : 'Despesa';
  return local ? `${head} durante viagem a ${local}` : `${head} durante viagem`;
}

/* ============================================================
   Progresso da leitura (barra no modal)
   ------------------------------------------------------------
   O Gemini não devolve progresso real, então a barra mostra as ETAPAS
   (preparar → enviar → ler → organizar) e "escorrega" sozinha em direção
   a um alvo enquanto a resposta não chega. Serve para responder à única
   pergunta que importa: ainda está processando ou já falhou?
   Só existe no modal de lançamento; a varredura do Drive tem o overlay
   `scanProgress` próprio (por isso `onStatus` é opcional em todo o caminho).
   ============================================================ */
const ocrProgress = {
  timer: null, hideTimer: null, pct: 0, target: 0,
  els() { return { box: $('m-ocr-prog'), msg: $('m-ocr-msg'), fill: $('m-ocr-fill'), retry: $('m-ocr-retry') }; },
  paint() { const f = $('m-ocr-fill'); if (f) f.style.width = this.pct.toFixed(1) + '%'; },
  stopCreep() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  /* msg: texto da etapa · pct: salto imediato · target: até onde escorregar sozinha */
  step(msg, pct, target) {
    const e = this.els();
    if (!e.box) return;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    e.box.style.display = '';
    e.box.className = 'ocr-prog';
    if (e.retry) e.retry.style.display = 'none';
    if (msg && e.msg) e.msg.textContent = msg;
    if (pct != null && pct > this.pct) this.pct = pct;
    this.paint();
    this.stopCreep();
    if (target == null) return;
    this.target = target;
    this.timer = setInterval(() => {
      if (this.pct >= this.target - 0.4) return;
      this.pct += (this.target - this.pct) * 0.09;   // assintótica: nunca finge que terminou
      this.paint();
    }, 260);
  },
  done(msg) {
    const e = this.els();
    if (!e.box) return;
    this.stopCreep();
    this.pct = 100; this.paint();
    e.box.className = 'ocr-prog ok';
    if (e.msg) e.msg.textContent = msg || 'Comprovante lido ✓';
    if (e.retry) e.retry.style.display = 'none';
    this.hideTimer = setTimeout(() => this.hide(), 2600);
  },
  fail(msg) {
    const e = this.els();
    if (!e.box) return;
    this.stopCreep();
    this.pct = 100; this.paint();
    e.box.className = 'ocr-prog err';
    if (e.msg) e.msg.textContent = msg || 'Não consegui ler o comprovante.';
    if (e.retry) e.retry.style.display = '';   // erro fica na tela até o usuário decidir
  },
  hide() {
    const e = this.els();
    this.stopCreep();
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    this.pct = 0;
    if (e.box) { e.box.style.display = 'none'; e.box.className = 'ocr-prog'; }
    if (e.fill) e.fill.style.width = '0%';
    if (e.retry) e.retry.style.display = 'none';
  }
};

/* Etapas nomeadas: [texto, salto imediato, alvo do escorregamento] */
const OCR_FASES = {
  prep:  ['Preparando o comprovante…', 6, 22],
  cache: ['Comprovante já lido antes — reaproveitando.', 96, null],
  send:  ['Enviando o comprovante para a IA…', 26, 46],
  read:  ['A IA está lendo o comprovante…', 50, 90],
  parse: ['Organizando os dados lidos…', 93, 97]
};
/* callback passado a ocrReceipt() pelo modal — traduz a fase em movimento da barra */
function ocrStatus(fase, extra) {
  if (fase === 'retry') { ocrProgress.step('A IA está instável — tentativa ' + extra + ' de 4…', null, 88); return; }
  const f = OCR_FASES[fase];
  if (f) ocrProgress.step(f[0], f[1], f[2]);
}

/* SHA-256 (hex) dos bytes do arquivo — chave do cache de OCR. */
async function blobSha256(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* OCR com cache local (IndexedDB) por hash do arquivo: o MESMO comprovante não regasta a API
   Gemini (varredura repetida / "Analisar de novo" ficam grátis e instantâneos). Só cacheia
   resultados úteis (com data ou total); erros transitórios/ilegíveis não entram no cache. */
async function ocrReceipt(blob, mime, onStatus) {
  if (onStatus) onStatus('prep');
  let hash = '';
  try { hash = await blobSha256(blob); } catch (e) { console.warn('hash do comprovante falhou', e); }
  if (hash) {
    try {
      const hit = await idbGet('ocrcache_' + hash);
      if (hit && hit.ocr) { if (onStatus) onStatus('cache'); return hit.ocr; }
    } catch (e) { console.warn('leitura do cache de OCR falhou', e); }
  }
  const ocr = await ocrReceiptRaw(blob, mime, onStatus);
  if (hash && ocr && (ocr.dateISO || ocr.total != null)) {
    try { await idbPut('ocrcache_' + hash, { ocr, at: Date.now() }); }
    catch (e) { console.warn('gravacao do cache de OCR falhou', e); }
  }
  return ocr;
}

/* Chamada genérica ao Gemini (JSON estruturado) com retentativa/backoff — usada pelo OCR de
   comprovante (abaixo). Recebe as `parts` do conteúdo e o generationConfig; devolve o JSON já
   parseado. `onStatus(fase[, extra])` é opcional e serve para alimentar a barra de progresso. */
async function geminiCall(parts, generationConfig, onStatus) {
  const a = loadAi();
  if (!a.key) throw new Error('Chave do Gemini não configurada.');
  const body = { contents: [{ parts }], generationConfig };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(a.key);
  // Retentativa com backoff: erros transitórios da IA (429 quota/limite, 500/503 sobrecarga,
  // falha de rede) costumam passar na 2ª/3ª tentativa — sem isso, varrer vários comprovantes
  // de uma vez falha "em série". Respeita o retryDelay sugerido pela API quando vier.
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const backoff = (n) => Math.min(8000, 700 * Math.pow(2, n)) + Math.floor(Math.random() * 300);
  const MAX_TRIES = 4;
  let r = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (onStatus) onStatus(attempt === 0 ? 'read' : 'retry', attempt + 1);
    try {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (netErr) {   // sem resposta (rede caiu / timeout)
      if (attempt < MAX_TRIES - 1) { await sleep(backoff(attempt)); continue; }
      throw new Error('Falha de rede ao falar com a IA. Verifique a conexão.');
    }
    if (r.ok) break;
    let m = 'HTTP ' + r.status, retryMs = 0;
    try {
      const j = await r.json();
      if (j.error) {
        if (j.error.message) m = j.error.message;
        const d = (j.error.details || []).find((x) => /RetryInfo/i.test(x['@type'] || ''));
        if (d && d.retryDelay) { const s = parseFloat(d.retryDelay); if (isFinite(s)) retryMs = Math.ceil(s * 1000); }
      }
    } catch (e) {}
    const transient = r.status === 429 || r.status === 500 || r.status === 502 || r.status === 503;
    if (transient && attempt < MAX_TRIES - 1) { await sleep(Math.max(retryMs, backoff(attempt))); continue; }
    if (r.status === 429) throw new Error('Limite da IA atingido (cota/requisições). ' + m);
    throw new Error(m);
  }
  if (onStatus) onStatus('parse');
  const j = await r.json();
  const c = j && j.candidates && j.candidates[0];
  const txt = c && c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text;
  if (!txt) throw new Error('Resposta vazia da IA.');
  return JSON.parse(txt);
}

async function ocrReceiptRaw(blob, mime, onStatus) {
  const b64 = String(await blobToDataUrl(blob)).split(',')[1];
  const mimeType = mime || blob.type || 'image/jpeg';   // Gemini lê imagem ou PDF
  if (onStatus) onStatus('send');
  const cats = getCategorias();
  const prompt = [
    'Você é um leitor de cupons fiscais e notas fiscais brasileiras (NF/NFC-e/cupom).',
    'Extraia da imagem os campos pedidos. Responda SOMENTE no JSON do schema.',
    '- nfNumber: número da nota/cupom (apenas dígitos; null se não houver).',
    '- date: data de emissão no formato AAAA-MM-DD (null se ilegível).',
    '- city / uf: cidade e UF do estabelecimento emissor (ex.: "Porto Seguro", "BA").',
    '- establishment: nome do estabelecimento/loja emissor (razão social ou nome fantasia; null se ilegível).',
    '- total: valor total pago, em reais, como número (ponto decimal).',
    '- category: escolha UMA destas categorias exatas: ' + cats.join(' | ') + '.',
    '  Refeições => a categoria de refeição correspondente; posto de combustível => Combustível;',
    '  pedágio => Pedágio; o restante => Outras Despesas.'
  ].join('\n');
  const data = await geminiCall(
    [{ inline_data: { mime_type: mimeType, data: b64 } }, { text: prompt }],
    {
      temperature: 0,
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          nfNumber: { type: 'STRING', nullable: true },
          date: { type: 'STRING', nullable: true },
          city: { type: 'STRING', nullable: true },
          uf: { type: 'STRING', nullable: true },
          establishment: { type: 'STRING', nullable: true },
          total: { type: 'NUMBER', nullable: true },
          category: { type: 'STRING', enum: cats, nullable: true }
        }
      }
    },
    onStatus
  );
  return {
    nfNumber: data.nfNumber ? String(data.nfNumber).replace(/\D/g, '') : '',
    dateISO: (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '',
    city: (data.city || '').trim(),
    uf: (data.uf || '').trim().toUpperCase(),
    establishment: (data.establishment || '').trim(),
    total: (typeof data.total === 'number' && isFinite(data.total)) ? data.total : null,
    category: cats.indexOf(data.category) >= 0 ? data.category : ''
  };
}

/* preenche o modal só nos campos ainda vazios (não sobrescreve o que o usuário digitou) */
function fillFromOcr(ocr) {
  const dEl = $('m-data');
  if (ocr.dateISO && (!dEl.value || dEl.value === todayISO())) dEl.value = ocr.dateISO;
  const cEl = $('m-categoria');
  if (ocr.category && !cEl.value) { cEl.value = ocr.category; updateCatHint(); }
  const descEl = $('m-descricao');
  if (!descEl.value.trim()) descEl.value = buildDescricao(ocr.category, ocr.city, ocr.uf);
  const estEl = $('m-estabelecimento'), estField = $('m-estabelecimento-field');   // só preenche se visível (cartão) e vazio
  if (estEl && estField && estField.style.display !== 'none' && ocr.establishment && !estEl.value.trim()) estEl.value = ocr.establishment;
  const vEl = $('m-valor');
  if (ocr.total != null && !vEl.value.trim()) vEl.value = formatMoneyInput(ocr.total);
}
async function runReceiptOcr() {
  if (!modalPhoto || !modalPhoto.blob) { ocrProgress.hide(); return; }
  try {
    ocrProgress.step(OCR_FASES.prep[0], OCR_FASES.prep[1], OCR_FASES.prep[2]);
    const ocr = await ocrReceipt(modalPhoto.blob, modalPhoto.blob.type, ocrStatus);
    modalPhoto.ocr = { nfNumber: ocr.nfNumber, dateISO: ocr.dateISO, city: ocr.city, uf: ocr.uf, establishment: ocr.establishment };
    fillFromOcr(ocr);
    const vazio = !ocr.dateISO && ocr.total == null;
    if (vazio) ocrProgress.fail('A IA não achou data nem valor neste arquivo. Preencha à mão ou tente outra foto.');
    else ocrProgress.done('Comprovante lido — confira os campos.');
  } catch (e) {
    console.error(e);
    ocrProgress.fail('Não consegui ler o comprovante: ' + e.message);
  }
}

/* nome do arquivo no Drive: "NF {nº} {DD.MM}" com os dados que houver */
function sanitizeFileName(s) { return String(s || '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function ddmm(iso) { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (m[2] + '.' + m[1]) : ''; }
function ddmmaaaa(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (m[3] + '.' + m[2] + '.' + m[1]) : ''; }
function receiptExt() { return (modalPhoto && modalPhoto.kind === 'pdf') ? '.pdf' : '.jpg'; }
function receiptFileName(entry) {
  const ext = receiptExt();
  const o = modalPhoto.ocr || {};
  const num = o.nfNumber || '';
  const ocrD = ddmm(o.dateISO);
  // com nº da NF: usa a data da NF ou, na falta, a data do lançamento
  if (num) return sanitizeFileName('NF ' + num + ((ocrD || ddmm(entry.data)) ? ' ' + (ocrD || ddmm(entry.data)) : '')) + ext;
  // sem nº, mas com data da NF detectada: "NF DD.MM"
  if (ocrD) return sanitizeFileName('NF ' + ocrD) + ext;
  // sem leitura da IA: usa a data digitada manualmente — "NF DD.MM.AAAA"
  return sanitizeFileName('NF ' + ddmmaaaa(entry.data || todayISO())) + ext;
}

function setAiStatus(msg, cls) { const s = $('ai-status'); if (s) { s.textContent = msg || ''; s.className = 'sync-status' + (cls ? ' ' + cls : ''); } }
function setupAiUI() {
  if (!$('ai-key')) return;
  const a = loadAi();
  $('ai-key').value = a.key || '';
  if ($('ai-enabled')) $('ai-enabled').checked = a.enabled !== false;
  const persist = () => saveAi({ key: ($('ai-key').value || '').trim(), enabled: $('ai-enabled') ? $('ai-enabled').checked : true });
  $('ai-key').addEventListener('change', () => { persist(); setAiStatus(aiConfigured() ? 'Pronto para ler comprovantes ✓' : 'Cole a chave para ativar.', aiConfigured() ? 'ok' : ''); });
  if ($('ai-enabled')) $('ai-enabled').addEventListener('change', () => { persist(); setAiStatus(aiConfigured() ? 'Leitura ativada ✓' : 'Leitura desativada.', aiConfigured() ? 'ok' : 'warn'); });
  if ($('ai-clear')) $('ai-clear').addEventListener('click', () => { saveAi({ key: '', enabled: true }); $('ai-key').value = ''; if ($('ai-enabled')) $('ai-enabled').checked = true; setAiStatus('Chave removida deste aparelho.', 'warn'); });
  setAiStatus(aiConfigured() ? 'Pronto para ler comprovantes ✓' : 'Não configurado.', aiConfigured() ? 'ok' : '');
}

