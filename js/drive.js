'use strict';
/* ============================================================
   Comprovantes no Google Drive (escopo drive.file) + fila offline
   ============================================================ */
const GDRIVE_KEY = 'despesas-soma-gdrive-v1';
const GDDEL_KEY = 'despesas-soma-gddel-v1';   // fila de fileIds a excluir no Drive (retry ao reconectar)
const GD_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';   // drive.file p/ criar/apagar o que o app envia; drive.readonly p/ ler arquivos subidos manualmente (varredura)
const GD_FOLDER_NAME = 'Comprovantes - Despesas Soma';                 // raiz do reembolso (= nome legado, mantém os antigos)
const GD_FOLDER_SANTANDER = 'Comprovantes Cartao Santander - Despesas Soma';
const GD_ROOT_NAMES = { reembolso: GD_FOLDER_NAME, alelo: GD_FOLDER_SANTANDER };
let gdAccess = { token: '', exp: 0 };
let gdTokenClient = null;
let gdGisLoading = null;
let gdPending = null;

function loadGd() { try { return Object.assign({ clientId: '', folderId: '' }, JSON.parse(localStorage.getItem(GDRIVE_KEY) || '{}')); } catch (e) { return { clientId: '', folderId: '' }; } }
function saveGd(c) { try { localStorage.setItem(GDRIVE_KEY, JSON.stringify(c)); } catch (e) {} }
function gdConfigured() { return !!loadGd().clientId; }
function gdConnected() { return !!gdAccess.token && Date.now() < gdAccess.exp; }

function gdLoadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gdGisLoading) return gdGisLoading;
  gdGisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar o Google (você está online?).'));
    document.head.appendChild(s);
  });
  return gdGisLoading;
}

function gdInitClient(cfg) {
  gdTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.clientId,
    scope: GD_SCOPE,
    callback: (resp) => {
      if (resp && resp.access_token) {
        gdAccess = { token: resp.access_token, exp: Date.now() + ((resp.expires_in || 3600) - 60) * 1000 };
        if (gdPending) gdPending.resolve(resp.access_token);
      } else if (gdPending) { gdPending.reject(new Error('Autorização não concedida.')); }
      gdPending = null;
    }
  });
}

async function gdGetToken(interactive) {
  if (gdConnected()) return gdAccess.token;
  const cfg = loadGd();
  if (!cfg.clientId) throw new Error('Configure o Client ID do Google.');
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  await gdLoadGis();
  if (!gdTokenClient) gdInitClient(cfg);
  return new Promise((resolve, reject) => {
    gdPending = { resolve, reject };
    try { gdTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' }); }
    catch (e) { gdPending = null; reject(e); }
  });
}

async function gdEmail() {
  const t = await gdGetToken(false);
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('Drive ' + r.status);
  return (await r.json()).user.emailAddress;
}

function setDriveFolder(tabela, id) {
  if (!state.driveFolders) state.driveFolders = { reembolso: '', alelo: '' };
  if (state.driveFolders[tabela] === id) return;
  state.driveFolders[tabela] = id;
  if (tabela === 'reembolso') state.driveFolderId = id;   // mantém o campo legado coerente
  touchDoc(); saveState();                                 // propaga via dados.json
}

/* Raiz separada por tabela: 'reembolso' e 'alelo' (cartão Santander). */
async function gdEnsureFolder(tabela) {
  tabela = tabela || 'reembolso';
  // 1) id sincronizado entre dispositivos tem prioridade
  const known = state.driveFolders && state.driveFolders[tabela];
  if (known) return known;
  // 2) reembolso: aproveita o id legado / cache local (antes da separação de pastas)
  if (tabela === 'reembolso') {
    const legacy = state.driveFolderId || (loadGd().folderId || '');
    if (legacy) { setDriveFolder('reembolso', legacy); return legacy; }
  }
  // 3) procura por nome; se não achar, cria — e guarda o id (sincronizado)
  const name = GD_ROOT_NAMES[tabela] || GD_FOLDER_NAME;
  const t = await gdGetToken(false);
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  let r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', { headers: { Authorization: 'Bearer ' + t } });
  let j = await r.json();
  let id = j.files && j.files[0] && j.files[0].id;
  if (!id) {
    r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
    j = await r.json(); id = j.id;
  }
  setDriveFolder(tabela, id);
  return id;
}

/* Subpastas Ano/Mês dentro da pasta raiz (organiza os comprovantes por período). */
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const gdFolderCache = new Map();   // "pai|nome" -> id (evita queries repetidas na mesma sessão)

async function gdFindOrCreateChild(parentId, name, token) {
  const ck = parentId + '|' + name;
  if (gdFolderCache.has(ck)) return gdFolderCache.get(ck);
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`;
  let r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', { headers: { Authorization: 'Bearer ' + token } });
  let j = await r.json();
  let id = j.files && j.files[0] && j.files[0].id;
  if (!id) {
    r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    j = await r.json(); id = j.id;
  }
  gdFolderCache.set(ck, id);
  return id;
}

async function gdEnsureMonthFolder(dateISO, tabela) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateISO || '');
  const root = await gdEnsureFolder(tabela);
  if (!m) return root;   // sem data válida → cai na raiz (comportamento antigo)
  const ano = m[1], mesNome = MESES[parseInt(m[2], 10) - 1];
  if (!mesNome) return root;
  const t = await gdGetToken(false);
  const anoId = await gdFindOrCreateChild(root, ano, t);
  return await gdFindOrCreateChild(anoId, mesNome, t);
}

async function gdUpload(blob, name, dateISO, tabela) {
  const t = await gdGetToken(false);
  const folderId = dateISO ? await gdEnsureMonthFolder(dateISO, tabela) : await gdEnsureFolder(tabela);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', blob);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: form
  });
  if (!r.ok) throw new Error('Upload Drive ' + r.status);
  return (await r.json()).id;
}

async function gdDownloadBlob(fileId) {
  const t = await gdGetToken(false);
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('Download Drive ' + r.status);
  return await r.blob();
}

/* mês de referência do relatório → pasta única no Drive (vazio = organiza por data do lançamento) */
function reportFolderDateISO() { return state.reportMonth ? state.reportMonth + '-01' : null; }

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
  open() {
    if (this.el) return;
    const div = document.createElement('div');
    div.id = 'scan-progress';
    div.className = 'offline-notice';
    div.innerHTML = `
      <div class="offline-card scan-card">
        <div class="offline-icon">☁️</div>
        <h3>Procurando comprovantes no Drive</h3>
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

/* ---- exclusão de comprovantes no Drive (com fila p/ retry offline) ---- */
function loadGdDel() { try { const a = JSON.parse(localStorage.getItem(GDDEL_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function saveGdDel(a) { try { localStorage.setItem(GDDEL_KEY, JSON.stringify(a)); } catch (e) {} }
function queueGdDelete(id) { if (!id) return; const a = loadGdDel(); if (!a.includes(id)) { a.push(id); saveGdDel(a); } }
function unqueueGdDelete(id) { saveGdDel(loadGdDel().filter((x) => x !== id)); }

async function gdDeleteFile(fileId) {
  const t = await gdGetToken(false);
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok && r.status !== 404 && r.status !== 403) throw new Error('Excluir Drive ' + r.status);   // 404/403 = já removido/sem acesso → tratar como ok
  return true;
}

async function flushGdDeletions(report) {
  const fila = loadGdDel();
  if (!fila.length) return { sent: 0, failed: 0 };
  if (!gdConfigured() || !gdConnected()) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (const id of fila) {
    try { await gdDeleteFile(id); unqueueGdDelete(id); sent++; }
    catch (err) { console.error('Falha ao excluir no Drive', err); failed++; }
  }
  if (report && sent) toast(sent + ' comprovante(s) removido(s) do Drive.');
  updateGdPending();
  return { sent, failed };
}

/* remove vínculos da foto: miniatura local, pendente offline e arquivo no Drive (ou enfileira) */
async function purgeEntryPhoto(entry) {
  if (!entry) return;
  idbDel('thumb_' + entry.id).catch(() => {});
  const foto = entry.foto;
  if (!foto) return;
  if (foto.pending) { idbDel('p_' + foto.pending).catch(() => {}); return; }
  if (foto.id) {
    if (gdConnected()) {
      try { await gdDeleteFile(foto.id); return; }
      catch (e) { console.error(e); }   // falhou → cai na fila
    }
    queueGdDelete(foto.id);
  }
}

/* ---- IndexedDB (fila de fotos pendentes / offline) ---- */
let _idb = null;
function idb() {
  if (_idb) return _idb;
  _idb = new Promise((resolve, reject) => {
    const req = indexedDB.open('despesas-soma', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('photos'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idb;
}
async function idbPut(key, val) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('photos', 'readonly'); const r = tx.objectStore('photos').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbDel(key) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

/* ---- Compressão de imagem (canvas) ---- */
function compressImage(file, maxDim, quality) {
  maxDim = maxDim || 1400; quality = quality || 0.72;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => blob ? resolve({ blob, w, h }) : reject(new Error('Falha ao processar imagem')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* ---- miniatura local (IndexedDB, não sincroniza) p/ a lista ---- */
async function saveThumb(entryId, blob) {
  try {
    const t = await compressImage(blob, 160, 0.6);
    await idbPut('thumb_' + entryId, await blobToDataUrl(t.blob));
  } catch (e) { /* miniatura é opcional */ }
}

/* ---- obtém o blob da foto de um lançamento (Drive ou fila local) ---- */
async function getPhotoBlob(foto) {
  if (!foto) return null;
  if (foto.pending) { const rec = await idbGet('p_' + foto.pending); return rec ? rec.blob : null; }
  if (foto.id) return await gdDownloadBlob(foto.id);
  return null;
}

/* ---- envia fotos que ficaram pendentes (offline) quando reconectar ---- */
function countPendingPhotos() {
  let n = 0;
  for (const t of ['reembolso', 'alelo']) for (const e of state[t]) if (e.foto && e.foto.pending) n++;
  return n;
}
/* pendências do Drive = fotos a enviar + exclusões a propagar (gate do pop-up) */
function countPendingDrive() { return countPendingPhotos() + loadGdDel().length; }
function updateGdPending() {
  const b = $('gd-flush'); if (!b) return;
  const env = countPendingPhotos(), del = loadGdDel().length;
  if ((env > 0 || del > 0) && gdConfigured()) {
    b.style.display = '';
    b.textContent = del > 0
      ? 'Sincronizar Drive (' + env + ' envio(s), ' + del + ' exclusão(ões))'
      : 'Enviar ' + env + ' comprovante(s) pendente(s)';
  } else b.style.display = 'none';
}

async function flushPendingPhotos(report) {
  if (!gdConfigured() || !gdConnected()) { if (report) setGdStatus('Conecte o Google para enviar os pendentes.', 'warn'); return { sent: 0, failed: 0 }; }
  let sent = 0, failed = 0, lastErr = '';
  for (const tabela of ['reembolso', 'alelo']) {
    for (const e of state[tabela]) {
      if (e.foto && e.foto.pending) {
        try {
          const rec = await idbGet('p_' + e.foto.pending);
          if (!rec) { e.foto = null; continue; }
          const id = await gdUpload(rec.blob, rec.name, reportFolderDateISO() || e.data || rec.data, tabela);
          await idbDel('p_' + e.foto.pending);
          e.foto = { id, name: rec.name, w: e.foto.w, h: e.foto.h };
          e.updatedAt = Date.now();
          sent++;
        } catch (err) { console.error('Falha ao enviar foto pendente', err); failed++; lastErr = err.message; }
      }
    }
  }
  if (sent) { touchDoc(); saveState(); render(); }
  if (report) {
    if (failed) setGdStatus('Enviados: ' + sent + ' · falharam: ' + failed + ' (' + lastErr + ')', 'err');
    else if (sent) setGdStatus(sent + ' comprovante(s) enviado(s) ao Drive ✓', 'ok');
    else setGdStatus('Nenhum comprovante pendente.', 'ok');
  } else if (sent) { toast(sent + ' comprovante(s) enviado(s) ao Drive.'); }
  updateGdPending();
  return { sent, failed };
}

async function viewPhoto(foto, entryId) {
  try {
    toast('Abrindo comprovante…');
    const blob = await getPhotoBlob(foto);
    if (!blob) { toast('Comprovante não encontrado.'); return; }
    if (entryId) { idbGet('thumb_' + entryId).then((t) => { if (!t) saveThumb(entryId, blob); }); }   // cacheia miniatura (ex.: foto vinda de outro aparelho)
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { console.error(e); toast('Erro ao abrir: ' + e.message); }
}

function setupGDriveUI() {
  const cfg = loadGd();
  if ($('gd-client')) $('gd-client').value = cfg.clientId || '';
  refreshGdStatus();
  if (!$('gd-connect')) return;
  $('gd-client').addEventListener('change', () => {
    const c = loadGd(); c.clientId = ($('gd-client').value || '').trim();
    if (c.clientId !== loadGd().clientId) c.folderId = '';   // troca de projeto reseta pasta
    saveGd(c); refreshGdStatus();
  });
  $('gd-connect').addEventListener('click', () => gdConnectFlow());
  $('gd-flush').addEventListener('click', async () => {
    const c = loadGd();
    if (!c.clientId) { setGdStatus('Cole o Client ID primeiro.', 'warn'); return; }
    setGdStatus('Enviando comprovantes pendentes…');
    try {
      await gdGetToken(true);
      await gdEnsureFolder();
      await flushPendingPhotos(true);
      await flushGdDeletions(true);
    } catch (e) { console.error(e); setGdStatus('Erro: ' + e.message, 'err'); }
  });
  if ($('gd-scan-main')) $('gd-scan-main').addEventListener('click', () => scanDriveForReceipts());
  updateGdPending();
  $('gd-clear').addEventListener('click', () => {
    if (!confirm('Desconectar o Google Drive deste aparelho?')) return;
    gdAccess = { token: '', exp: 0 };
    const c = loadGd(); localStorage.removeItem(GDRIVE_KEY);
    $('gd-client').value = '';
    refreshGdStatus();
    toast('Google Drive desconectado.');
  });
}
function setGdStatus(msg, kind) { const el = $('gd-status'); if (el) { el.textContent = msg; el.className = 'sync-status' + (kind ? ' ' + kind : ''); } }
function refreshGdStatus() {
  updateGdPending();
  if (!gdConfigured()) { setGdStatus('Não configurado.', ''); return; }
  setGdStatus(gdConnected() ? 'Conectado ✓' : 'Configurado. Toque em “Conectar Google”.', gdConnected() ? 'ok' : '');
}

/* ---- Conexão do Drive: fluxo único + reconexão silenciosa + popup ao abrir ---- */
async function gdConnectFlow() {
  const c = loadGd();
  if (!c.clientId) { setGdStatus('Cole o Client ID primeiro.', 'warn'); return false; }
  setGdStatus('Conectando ao Google…');
  try {
    await gdGetToken(true);
    const email = await gdEmail();
    await gdEnsureFolder();
    setGdStatus('Conectado como ' + email + ' ✓', 'ok');
    await flushPendingPhotos(true);
    await flushGdDeletions(true);
    return true;
  } catch (e) { console.error(e); setGdStatus('Erro: ' + e.message, 'err'); return false; }
}

async function gdSilentReconnect() {
  if (!gdConfigured() || !navigator.onLine || gdConnected()) return gdConnected();
  try {
    // sem UI: só funciona se a sessão Google ainda vale; timeout evita travar se o callback não vier
    await Promise.race([
      gdGetToken(false),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
    ]);
    await gdEnsureFolder();
    refreshGdStatus();
    await flushPendingPhotos(false);
    await flushGdDeletions(false);
    return true;
  } catch (e) { return false; }
}

function showDriveConnectNotice() {
  if ($('gd-connect-notice')) return;
  const pend = countPendingDrive();
  const div = document.createElement('div');
  div.id = 'gd-connect-notice';
  div.className = 'offline-notice';
  div.innerHTML = `
    <div class="offline-card">
      <div class="offline-icon">☁️</div>
      <h3>Conecte ao Google Drive</h3>
      <p>É preciso conectar para enviar seus comprovantes ao Drive.${pend ? ' Você tem <b>' + pend + '</b> comprovante(s) aguardando envio.' : ''}</p>
      <div class="notice-actions">
        <button class="btn btn-excel" id="gd-notice-connect">Conectar agora</button>
        <button class="btn btn-ghost" id="gd-notice-later">Agora não</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  $('gd-notice-later').addEventListener('click', () => div.remove());
  $('gd-notice-connect').addEventListener('click', async () => {
    $('gd-notice-connect').disabled = true;
    const ok = await gdConnectFlow();
    if (ok) { div.remove(); toast('Google Drive conectado.'); }
    else { $('gd-notice-connect').disabled = false; toast('Não foi possível conectar. Tente de novo.'); }
  });
}

async function maybePromptDrive() {
  if (!gdConfigured() || !navigator.onLine || gdConnected()) return;
  const ok = await gdSilentReconnect();                  // sem UI; já envia/expurga pendentes se a sessão valer
  if (ok) return;
  if (countPendingDrive() > 0) showDriveConnectNotice();  // só incomoda se há comprovante a enviar/excluir
}

