'use strict';
/* ============================================================
   Varredura do Drive: reconhece comprovantes subidos manualmente que ainda
   não viraram lançamento. Sucesso na IA → lança automático; falha → fila de
   pendentes (revisão manual). Requer o escopo drive.readonly. */
function knownDriveIds() {
  const s = new Set();
  const add = (arr) => { for (const e of (arr || [])) if (e.foto && e.foto.id) s.add(e.foto.id); };
  add(state.reembolso); add(state.alelo);
  for (const h of (state.history || [])) { add(h.reembolso); add(h.alelo); }
  for (const k of Object.keys(state.driveKnown || {})) s.add(k);
  for (const k of Object.keys(state.driveDismissed || {})) s.add(k);
  for (const p of (state.pending || [])) if (p && p.fileId) s.add(p.fileId);
  return s;
}

/* lista todos os arquivos (recursivo) sob a raiz da tabela, incluindo subpastas Ano/Mês */
async function gdListReceipts(tabela) {
  const root = await gdEnsureFolder(tabela);
  const t = await gdGetToken(false);
  const out = [];
  async function walk(folderId) {
    let pageToken = '';
    do {
      const q = `'${folderId}' in parents and trashed=false`;
      const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
        '&fields=nextPageToken,files(id,name,mimeType,createdTime)&pageSize=200' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) throw new Error('Listar Drive ' + r.status);
      const j = await r.json();
      for (const f of (j.files || [])) {
        if (f.mimeType === 'application/vnd.google-apps.folder') await walk(f.id);
        else out.push(f);
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
  }
  await walk(root);
  return out;
}

/* ---- modal de progresso da varredura (mostra ao usuário o que está acontecendo) ---- */
const scanProgress = {
  el: null, statusEl: null, logEl: null, footEl: null,
  open(title, icon) {
    if (this.el) return;
    const div = document.createElement('div');
    div.id = 'scan-progress';
    div.className = 'offline-notice';
    div.innerHTML = `
      <div class="offline-card scan-card">
        <div class="offline-icon">${icon || '☁️'}</div>
        <h3>${escapeHtml(title || 'Procurando comprovantes no Drive')}</h3>
        <div class="scan-status"><span class="scan-spinner"></span><span id="scan-status-txt">Iniciando…</span></div>
        <ul class="scan-log" id="scan-log"></ul>
        <div class="notice-actions" id="scan-foot"></div>
      </div>`;
    document.body.appendChild(div);
    this.el = div;
    this.statusEl = $('scan-status-txt');
    this.logEl = $('scan-log');
    this.footEl = $('scan-foot');
  },
  status(msg) { if (this.statusEl) this.statusEl.textContent = msg; },
  log(msg, kind) {
    if (!this.logEl) return;
    const li = document.createElement('li');
    if (kind) li.className = kind;
    li.innerHTML = msg;
    this.logEl.appendChild(li);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  },
  done(summary) {
    const sp = this.el && this.el.querySelector('.scan-spinner');
    if (sp) sp.remove();
    if (summary) this.status(summary);
    if (this.footEl) {
      this.footEl.innerHTML = '<button class="btn btn-excel" id="scan-close">Fechar</button>';
      $('scan-close').addEventListener('click', () => this.close());
    }
  },
  close() { if (this.el) { this.el.remove(); this.el = null; } }
};

let scanningDrive = false;
async function scanDriveForReceipts() {
  if (scanningDrive) return;
  if (!gdConfigured()) { toast('Configure o Google Drive primeiro.'); return; }
  if (!aiConfigured()) { toast('Configure a leitura por IA (Gemini) para reconhecer os comprovantes.'); return; }
  if (!navigator.onLine) { toast('Sem conexão com a internet.'); return; }
  scanningDrive = true;
  const btn = $('gd-scan-main'); if (btn) { btn.disabled = true; }
  scanProgress.open();
  try {
    if (!gdConnected()) {
      scanProgress.status('Conectando ao Google Drive…');
      try { await gdGetToken(true); }
      catch (e) { scanProgress.log('Não foi possível conectar ao Drive (autorize o acesso de leitura).', 'err'); scanProgress.done('Conexão necessária.'); return; }
    }
    const known = knownDriveIds();
    let novos = 0, pend = 0, erros = 0, jaLanc = 0, total = 0, lidos = 0;
    const LBL = { reembolso: 'Reembolso', alelo: 'Cartão Santander' };
    for (const tabela of ['reembolso', 'alelo']) {
      scanProgress.status('Listando pasta de ' + LBL[tabela] + '…');
      let files = [];
      try { files = await gdListReceipts(tabela); }
      catch (e) { console.error(e); erros++; scanProgress.log('Erro ao listar a pasta de <b>' + LBL[tabela] + '</b>: ' + escapeHtml(e.message || String(e)), 'err'); continue; }
      const novosArq = files.filter((f) => !known.has(f.id));
      scanProgress.log('Pasta <b>' + LBL[tabela] + '</b>: ' + files.length + ' arquivo(s), ' + novosArq.length + ' novo(s).', 'info');
      for (const f of files) {
        total++;
        if (known.has(f.id)) { jaLanc++; continue; }
        known.add(f.id);
        state.driveKnown[f.id] = 1;
        lidos++;
        scanProgress.status('Analisando ' + lidos + '/' + novosArq.length + ' — ' + LBL[tabela] + '…');
        let ocr = null, falhou = false, errMsg = '';
        try { const blob = await gdDownloadBlob(f.id); ocr = await ocrReceipt(blob, f.mimeType); }
        catch (e) { console.error('OCR/scan falhou', e); falhou = true; errMsg = e.message || String(e); }
        if (ocr && ocr.dateISO && ocr.total != null) {
          const entry = {
            id: uid(), data: ocr.dateISO, descricao: buildDescricao(ocr.category, ocr.city, ocr.uf),
            categoria: ocr.category, valor: ocr.total, updatedAt: Date.now(),
            foto: { id: f.id, name: f.name }
          };
          if (tabela === 'alelo') { entry.estabelecimento = ocr.establishment || ''; entry.justificativa = ''; }
          state[tabela].push(entry);
          state[tabela].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
          novos++;
          scanProgress.log('✓ <b>' + escapeHtml(f.name) + '</b> → lançado (' + formatMoney(ocr.total) + ' · ' + fmtDateBR(ocr.dateISO) + ').', 'ok');
        } else {
          state.pending.push({
            fileId: f.id, name: f.name, tabela, mimeType: f.mimeType, createdTime: f.createdTime || '',
            ocr: ocr ? { dateISO: ocr.dateISO, category: ocr.category, total: ocr.total, descricao: buildDescricao(ocr.category, ocr.city, ocr.uf), establishment: ocr.establishment || '' } : null
          });
          pend++;
          const motivo = falhou ? ('falha na leitura: ' + escapeHtml(errMsg))
            : (!ocr ? 'não reconhecido'
            : (!ocr.dateISO && ocr.total == null ? 'sem data e valor'
            : (!ocr.dateISO ? 'sem data' : 'sem valor')));
          scanProgress.log('⚠ <b>' + escapeHtml(f.name) + '</b> → pendente (' + motivo + ').', 'pend');
        }
      }
    }
    touchDoc(); saveState(); render();
    const partes = [];
    partes.push('<b>' + novos + '</b> lançado(s) automaticamente');
    partes.push('<b>' + pend + '</b> pendente(s) para revisar');
    if (jaLanc) partes.push(jaLanc + ' já conhecido(s)');
    if (erros) partes.push(erros + ' pasta(s) com erro');
    scanProgress.log('Concluído: ' + partes.join(' · ') + '.', novos || pend ? 'info' : 'info');
    if (total === 0) scanProgress.log('Nenhum arquivo encontrado nas pastas do Drive.', 'info');
    else if (lidos === 0) scanProgress.log('Todos os arquivos já estavam lançados ou descartados.', 'info');
    if (pend) scanProgress.log('Os pendentes aparecem no card "Lançamentos pendentes (Drive)" — lá você pode preencher à mão ou pedir nova análise.', 'info');
    scanProgress.done(novos + ' lançado(s) · ' + pend + ' pendente(s)');
  } catch (e) {
    console.error(e);
    scanProgress.log('Erro inesperado: ' + escapeHtml(e.message || String(e)), 'err');
    scanProgress.done('Falhou.');
  } finally {
    scanningDrive = false;
    if (btn) btn.disabled = false;
  }
}

/* ---- pendentes (Drive) ---- */
let linkedPendingId = null;   // fileId do pendente sendo preenchido no modal (vincula sem reenviar)
function openPendingEntry(p) {
  if (!p) return;
  linkedPendingId = p.fileId;
  const o = p.ocr || {};
  openModal(p.tabela, null, {
    data: o.dateISO || todayISO(),
    descricao: o.descricao || '',
    categoria: o.category || '',
    valor: (o.total != null ? o.total : ''),
    estabelecimento: o.establishment || ''
  });
  // vincula o arquivo do Drive já existente (não reenvia ao salvar)
  modalPhoto = { mode: 'keep', existing: { id: p.fileId, name: p.name }, blob: null, dataUrl: null, w: 0, h: 0 };
  renderModalPhoto();
}
function dismissPending(fileId) {
  if (!confirm('Descartar este comprovante? Ele continua no Drive, mas deixa de aparecer aqui.')) return;
  state.pending = (state.pending || []).filter((p) => p.fileId !== fileId);
  state.driveDismissed[fileId] = Date.now();   // não reaparece na próxima varredura/sincronização
  touchDoc(); saveState(); renderPending();
}
function renderPending() {
  const card = $('pending-card'); if (!card) return;
  const list = state.pending || [];
  if (!list.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  if ($('pending-count')) $('pending-count').textContent = list.length;
  const ul = $('pending-list'); if (!ul) return;
  ul.innerHTML = '';
  list.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'pending-item';
    const tabelaLbl = p.tabela === 'alelo' ? 'Cartão Santander' : 'Reembolso';
    const hint = (p.ocr && p.ocr.total != null)
      ? (formatMoney(p.ocr.total) + (p.ocr.dateISO ? ' · ' + fmtDateBR(p.ocr.dateISO) : ''))
      : 'sem leitura automática';
    li.innerHTML = `<div class="pending-info"><b>${escapeHtml(p.name)}</b><span>${tabelaLbl} · ${hint}</span></div>
      <div class="pending-actions">
        <button type="button" class="hist-btn" data-act="retry">Analisar de novo</button>
        <button type="button" class="hist-btn" data-act="fill">Preencher</button>
        <button type="button" class="hist-btn danger" data-act="dismiss">Descartar</button>
      </div>`;
    li.querySelector('[data-act=retry]').addEventListener('click', (ev) => retryPendingOcr(p.fileId, ev.currentTarget));
    li.querySelector('[data-act=fill]').addEventListener('click', () => openPendingEntry(p));
    li.querySelector('[data-act=dismiss]').addEventListener('click', () => dismissPending(p.fileId));
    ul.appendChild(li);
  });
}

/* reanalisa um pendente com a IA; se reconhecer data+valor, vira lançamento automático */
async function retryPendingOcr(fileId, btn) {
  const p = (state.pending || []).find((x) => x.fileId === fileId);
  if (!p) return;
  if (!aiConfigured()) { toast('Configure a leitura por IA (Gemini) primeiro.'); return; }
  if (!navigator.onLine) { toast('Sem conexão com a internet.'); return; }
  if (!gdConnected()) { try { await gdGetToken(true); } catch (e) { toast('Conecte o Google Drive primeiro.'); return; } }
  if (btn) { btn.disabled = true; btn.textContent = 'Analisando…'; }
  try {
    let ocr = null;
    try { const blob = await gdDownloadBlob(fileId); ocr = await ocrReceipt(blob, p.mimeType); }
    catch (e) { console.error('Reanálise falhou', e); toast('Falha ao ler: ' + (e.message || 'tente de novo') + '.'); return; }
    if (ocr && ocr.dateISO && ocr.total != null) {
      const entry = {
        id: uid(), data: ocr.dateISO, descricao: buildDescricao(ocr.category, ocr.city, ocr.uf),
        categoria: ocr.category, valor: ocr.total, updatedAt: Date.now(),
        foto: { id: p.fileId, name: p.name }
      };
      if (p.tabela === 'alelo') { entry.estabelecimento = ocr.establishment || ''; entry.justificativa = ''; }
      state[p.tabela].push(entry);
      state[p.tabela].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
      state.pending = (state.pending || []).filter((x) => x.fileId !== fileId);
      touchDoc(); saveState(); render();
      toast('Reconhecido! Lançado: ' + formatMoney(ocr.total) + ' · ' + fmtDateBR(ocr.dateISO) + '.');
    } else {
      p.ocr = ocr ? { dateISO: ocr.dateISO, category: ocr.category, total: ocr.total, descricao: buildDescricao(ocr.category, ocr.city, ocr.uf), establishment: ocr.establishment || '' } : null;
      touchDoc(); saveState(); renderPending();
      const motivo = !ocr ? 'não reconhecido' : (!ocr.dateISO && ocr.total == null ? 'sem data e valor' : (!ocr.dateISO ? 'sem data' : 'sem valor'));
      toast('Ainda não consegui ler tudo (' + motivo + '). Preencha à mão.');
    }
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Analisar de novo'; }
  }
}

