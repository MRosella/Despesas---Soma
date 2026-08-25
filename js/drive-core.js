'use strict';
/* ============================================================
   Comprovantes no Google Drive (escopo drive.file) + fila offline
   ============================================================ */
const GDRIVE_KEY = 'despesas-soma-gdrive-v1';
const GDDEL_KEY = 'despesas-soma-gddel-v1';   // fila de fileIds a excluir no Drive (retry ao reconectar)
const GDTOK_KEY = 'despesas-soma-gdtok-v1';   // token OAuth (LOCAL; nunca sincroniza). Persistir evita reautenticar a cada reabertura dentro de ~1h. Apagado no "Desconectar".
const GD_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';   // drive.file p/ criar/apagar o que o app envia; drive.readonly p/ ler arquivos subidos manualmente (varredura)
/* Uma pasta raiz POR MÓDULO — os nomes vêm de MODULOS[].driveRoot (js/modules.js). */
function gdRootName(tabela) { return modOf(tabela).driveRoot; }
let gdTokenClient = null;
let gdCodeClient = null;
let gdGisLoading = null;
let gdPending = null;
let gdRefreshTimer = null;

/* token OAuth persistido no aparelho: lê o access token (descarta se já expirou) e o refresh
   token (esse não expira por tempo — só se revogado). Com refresh token, a sessão do Drive fica
   valendo indefinidamente, sem popup, via o Worker (renovador). */
function loadGdAccess() {
  try {
    const a = JSON.parse(localStorage.getItem(GDTOK_KEY) || '{}');
    const refresh = a && a.refresh ? a.refresh : '';
    if (a && a.token && a.exp && Date.now() < a.exp) return { token: a.token, exp: a.exp, refresh };
    return { token: '', exp: 0, refresh };
  } catch (e) { console.warn('loadGdAccess falhou', e); }
  return { token: '', exp: 0, refresh: '' };
}
function saveGdAccess() {
  try {
    if (gdAccess && (gdAccess.token || gdAccess.refresh)) localStorage.setItem(GDTOK_KEY, JSON.stringify(gdAccess));
    else localStorage.removeItem(GDTOK_KEY);
  } catch (e) { console.warn('saveGdAccess falhou', e); }
}
let gdAccess = loadGdAccess();   // reaproveita o token entre aberturas (sem popup se ainda válido)

function loadGd() { try { return Object.assign({ clientId: '', folderId: '', workerUrl: '' }, JSON.parse(localStorage.getItem(GDRIVE_KEY) || '{}')); } catch (e) { return { clientId: '', folderId: '', workerUrl: '' }; } }
function saveGd(c) { try { localStorage.setItem(GDRIVE_KEY, JSON.stringify(c)); } catch (e) { console.warn('saveGd falhou', e); } }
function gdConfigured() { return !!loadGd().clientId; }
function gdConnected() { return !!gdAccess.token && Date.now() < gdAccess.exp; }
function gdWorkerUrl() { return (loadGd().workerUrl || '').trim().replace(/\/+$/, ''); }
function gdHasRefresh() { return !!gdAccess.refresh; }

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
        gdAccess = { token: resp.access_token, exp: Date.now() + ((resp.expires_in || 3600) - 60) * 1000, refresh: gdAccess.refresh || '' };
        saveGdAccess();          // persiste p/ reaproveitar entre aberturas
        scheduleGdRefresh();     // renova em silêncio antes de expirar
        if (gdPending) gdPending.resolve(resp.access_token);
      } else if (gdPending) { gdPending.reject(new Error('Autorização não concedida.')); }
      gdPending = null;
    }
  });
}

/* Fluxo "code" (com Worker configurado): a troca do código por access+refresh token acontece no
   Worker (só ele conhece o client_secret). Só precisa de popup na 1ª conexão (ou se o refresh
   token for revogado) — depois disso, gdRefreshAccessToken renova sozinho, sem popup, para sempre. */
function gdInitCodeClient(cfg) {
  gdCodeClient = google.accounts.oauth2.initCodeClient({
    client_id: cfg.clientId,
    scope: GD_SCOPE,
    ux_mode: 'popup',
    callback: async (resp) => {
      if (!(resp && resp.code)) { if (gdPending) gdPending.reject(new Error('Autorização não concedida.')); gdPending = null; return; }
      try {
        const tok = await gdWorkerExchange(resp.code);
        if (gdPending) gdPending.resolve(tok);
      } catch (e) { if (gdPending) gdPending.reject(e); }
      gdPending = null;
    },
    error_callback: () => { if (gdPending) gdPending.reject(new Error('Autorização cancelada.')); gdPending = null; }
  });
}

async function gdWorkerCall(path, body) {
  const base = gdWorkerUrl();
  if (!base) throw new Error('Configure a URL do renovador (Worker).');
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Worker ' + r.status));
  return j;
}

/* troca o código de autorização por access+refresh token (1ª vez / reconsentimento) */
async function gdWorkerExchange(code) {
  const j = await gdWorkerCall('/exchange', { code, redirect_uri: window.location.origin });
  gdAccess = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000, refresh: j.refresh_token || gdAccess.refresh || '' };
  saveGdAccess();
  scheduleGdRefresh();
  return gdAccess.token;
}

/* renova o access token a partir do refresh token — sem popup, funciona mesmo após dias/semanas */
async function gdRefreshAccessToken() {
  const j = await gdWorkerCall('/refresh', { refresh_token: gdAccess.refresh });
  gdAccess = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000, refresh: gdAccess.refresh };
  saveGdAccess();
  scheduleGdRefresh();
  return gdAccess.token;
}

/* Renovação silenciosa proativa: agenda um refresh ~2 min antes de expirar (enquanto o app
   estiver aberto). Com refresh token (Worker), renova via rede, sem depender de sessão do
   navegador. Sem Worker, cai no antigo prompt:'' (só funciona com a sessão do Google valendo). */
function scheduleGdRefresh() {
  if (gdRefreshTimer) { clearTimeout(gdRefreshTimer); gdRefreshTimer = null; }
  if (!gdAccess.exp) return;
  const delay = Math.max(1000, gdAccess.exp - Date.now() - 120000);
  gdRefreshTimer = setTimeout(() => {
    gdRefreshTimer = null;
    if (gdConfigured() && navigator.onLine) gdGetToken(false).catch((e) => console.warn('refresh silencioso do Drive falhou', e));
  }, delay);
}

async function gdGetToken(interactive) {
  if (gdConnected()) return gdAccess.token;
  const cfg = loadGd();
  if (!cfg.clientId) throw new Error('Configure o Client ID do Google.');
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  const worker = gdWorkerUrl();
  // tem refresh token (Worker) → renova por rede, sem popup, mesmo que a sessão do navegador tenha caído
  if (worker && gdHasRefresh()) {
    try { return await gdRefreshAccessToken(); }
    catch (e) { console.warn('refresh token falhou (revogado?)', e); gdAccess.refresh = ''; saveGdAccess(); if (!interactive) throw e; }
  }
  await gdLoadGis();
  if (worker) {
    if (!interactive) throw new Error('Sessão expirada. Toque em "Conectar Google".');
    if (!gdCodeClient) gdInitCodeClient(cfg);
    return new Promise((resolve, reject) => {
      gdPending = { resolve, reject };
      try { gdCodeClient.requestCode(); }
      catch (e) { gdPending = null; reject(e); }
    });
  }
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
  if (!state.driveFolders) state.driveFolders = mapPorTabela(() => '');
  if (state.driveFolders[tabela] === id) return;
  state.driveFolders[tabela] = id;
  if (tabela === TABELA_PADRAO) state.driveFolderId = id;   // mantém o campo legado coerente
  touchDoc(); saveState();                                   // propaga via dados.json
  if (typeof renderDriveFolders === 'function') renderDriveFolders();
}

/* Raiz separada por módulo (uma pasta por relatório/empresa). */
async function gdEnsureFolder(tabela) {
  tabela = tabela || TABELA_PADRAO;
  if (!MOD[tabela]) throw new Error('Relatório desconhecido: ' + tabela);
  // 1) id sincronizado entre dispositivos tem prioridade
  const known = state.driveFolders && state.driveFolders[tabela];
  if (known) return known;
  // 2) reembolso: aproveita o id legado / cache local (antes da separação de pastas)
  if (tabela === TABELA_PADRAO) {
    const legacy = state.driveFolderId || (loadGd().folderId || '');
    if (legacy) { setDriveFolder(TABELA_PADRAO, legacy); return legacy; }
  }
  // 3) procura por nome; se não achar, cria — e guarda o id (sincronizado)
  const name = gdRootName(tabela);
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
function reportFolderDateISO(tabela) { const m = (state.reportMonths || {})[tabela]; return m ? m + '-01' : null; }

/* ---- exclusão de comprovantes no Drive (com fila p/ retry offline) ---- */
function loadGdDel() { try { const a = JSON.parse(localStorage.getItem(GDDEL_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function saveGdDel(a) { try { localStorage.setItem(GDDEL_KEY, JSON.stringify(a)); } catch (e) { console.warn('saveGdDel falhou', e); } }
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

/* ---- pastas dos relatórios no Drive (uma por módulo) ----
   Lista as raízes com link direto. Criar antes do primeiro comprovante permite
   ARRASTAR cada pasta para o lugar que você quiser no Drive de uma vez — o app
   guarda o ID, então mover não quebra os envios seguintes. */
function driveFolderUrl(id) { return 'https://drive.google.com/drive/folders/' + id; }

function renderDriveFolders() {
  const box = $('gd-folders'); if (!box) return;
  box.innerHTML = MODULOS.map((m) => {
    const id = (state.driveFolders || {})[m.key] || '';
    const alvo = id
      ? '<a href="' + driveFolderUrl(id) + '" target="_blank" rel="noopener">abrir no Drive</a>'
      : '<span class="gd-folder-pend">ainda não criada</span>';
    return '<div class="gd-folder-row"><span class="gd-folder-dot" style="background:' + m.accent + '"></span>' +
      '<span class="gd-folder-name">' + escapeHtml(m.driveRoot) + '</span>' + alvo + '</div>';
  }).join('');
  const btn = $('gd-folders-make');
  if (btn) btn.style.display = MODULOS.every((m) => (state.driveFolders || {})[m.key]) ? 'none' : '';
}

/* Cria (ou localiza) a pasta raiz de CADA relatório, sem precisar lançar despesa antes. */
async function ensureAllDriveFolders() {
  if (!gdConfigured()) { setGdStatus('Cole o Client ID e conecte o Google primeiro.', 'warn'); return; }
  setGdStatus('Preparando as pastas no Drive…');
  try {
    await gdGetToken(true);
    for (const m of MODULOS) await gdEnsureFolder(m.key);
    renderDriveFolders();
    setGdStatus('Pastas prontas. Abra cada uma e mova para onde quiser no Drive — o app continua achando.', 'ok');
  } catch (e) {
    console.error(e);
    setGdStatus('Erro ao preparar as pastas: ' + e.message, 'err');
  }
}

/* ---- envia fotos que ficaram pendentes (offline) quando reconectar ---- */
function countPendingPhotos() {
  let n = 0;
  for (const t of TABELAS) for (const e of (state[t] || [])) if (e.foto && e.foto.pending) n++;
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
  for (const tabela of TABELAS) {
    for (const e of (state[tabela] || [])) {
      if (e.foto && e.foto.pending) {
        try {
          const rec = await idbGet('p_' + e.foto.pending);
          if (!rec) { e.foto = null; continue; }
          const id = await gdUpload(rec.blob, rec.name, reportFolderDateISO(tabela) || e.data || rec.data, tabela);
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

let gdVisHook = false;
function setupGDriveUI() {
  const cfg = loadGd();
  if ($('gd-client')) $('gd-client').value = cfg.clientId || '';
  if ($('gd-worker')) $('gd-worker').value = cfg.workerUrl || '';
  refreshGdStatus();
  if (gdConnected()) scheduleGdRefresh();   // token persistido ainda válido → mantém renovando sozinho
  // ao voltar o foco p/ o app (ou reconectar a internet), tenta reconexão silenciosa se o token estiver perto de vencer
  if (!gdVisHook) {
    gdVisHook = true;
    const wake = () => {
      if (!gdConfigured() || !navigator.onLine) return;
      if (!gdAccess.token || Date.now() > gdAccess.exp - 120000) maybePromptDrive();
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    window.addEventListener('online', wake);
  }
  if (!$('gd-connect')) return;
  $('gd-client').addEventListener('change', () => {
    const c = loadGd(); c.clientId = ($('gd-client').value || '').trim();
    if (c.clientId !== loadGd().clientId) c.folderId = '';   // troca de projeto reseta pasta
    saveGd(c); refreshGdStatus();
  });
  if ($('gd-worker')) $('gd-worker').addEventListener('change', () => {
    const c = loadGd(); c.workerUrl = ($('gd-worker').value || '').trim();
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
  if ($('gd-folders-make')) $('gd-folders-make').addEventListener('click', () => ensureAllDriveFolders());
  renderDriveFolders();
  updateGdPending();
  $('gd-clear').addEventListener('click', () => {
    if (!confirm('Desconectar o Google Drive deste aparelho?')) return;
    gdAccess = { token: '', exp: 0, refresh: '' };
    if (gdRefreshTimer) { clearTimeout(gdRefreshTimer); gdRefreshTimer = null; }
    localStorage.removeItem(GDTOK_KEY);
    localStorage.removeItem(GDRIVE_KEY);
    $('gd-client').value = '';
    if ($('gd-worker')) $('gd-worker').value = '';
    refreshGdStatus();
    toast('Google Drive desconectado.');
  });
}
function setGdStatus(msg, kind) { const el = $('gd-status'); if (el) { el.textContent = msg; el.className = 'sync-status' + (kind ? ' ' + kind : ''); } }
function refreshGdStatus() {
  updateGdPending();
  if (!gdConfigured()) { setGdStatus('Não configurado.', ''); return; }
  if (gdConnected()) {
    setGdStatus(gdHasRefresh() ? 'Conectado ✓ (sessão permanente)' : 'Conectado ✓', 'ok');
  } else {
    setGdStatus('Configurado. Toque em “Conectar Google”.', '');
  }
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

