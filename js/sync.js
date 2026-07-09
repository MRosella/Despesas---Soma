'use strict';
/* ============================================================
   Sincronização entre dispositivos (repositório PRIVADO no GitHub)
   Lê/grava um único arquivo dados.json via API do GitHub.
   O token fica salvo só neste aparelho (localStorage).
   ============================================================ */
const GH_API = 'https://api.github.com';
const DATA_PATH = 'dados.json';

function loadSyncCfg() {
  try { return Object.assign({ repo: '', token: '' }, JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')); }
  catch (e) { return { repo: '', token: '' }; }
}
function saveSyncCfg(cfg) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (e) { console.warn('saveSyncCfg falhou', e); } }
function isSyncConfigured() { const c = loadSyncCfg(); return !!(c.repo && c.token); }

// "sujo" = há alterações locais ainda não enviadas ao servidor (ex.: feitas offline)
const DIRTY_KEY = 'despesas-soma-dirty-v1';
function setDirty(v) { try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch (e) { console.warn('setDirty falhou', e); } updateSyncIndicator(); }
function isDirty() { try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch (e) { return false; } }

// horário da última sincronização bem-sucedida (para o rodapé)
function setLastSync(ts) { try { localStorage.setItem(LASTSYNC_KEY, String(ts)); } catch (e) { console.warn('setLastSync falhou', e); } }
function getLastSync() { try { return localStorage.getItem(LASTSYNC_KEY); } catch (e) { return null; } }

function updateFooter() {
  const v = $('ft-version'); if (v) v.textContent = 'App ' + APP_VERSION;
  const v2 = $('ft-version2'); if (v2) v2.textContent = APP_VERSION;
  const ls = $('ft-lastsync'); if (!ls) return;
  const t = getLastSync();
  const txt = t ? new Date(Number(t)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  ls.textContent = 'Última sincronização: ' + txt;
}

function setSyncStatus(msg, kind) {
  const el = $('sy-status'); if (!el) return;
  el.textContent = msg;
  el.className = 'sync-status' + (kind ? ' ' + kind : '');
}

// ícone no cabeçalho: ✓ sincronizado · ⟳ pendente/sincronizando · ⚠ offline
function updateSyncIndicator() {
  const el = $('sync-ind'); if (!el) return;
  if (!isSyncConfigured()) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.classList.remove('ok', 'pending', 'offline', 'spin');
  if (!navigator.onLine) {
    el.innerHTML = icon('alert-triangle', 20); el.classList.add('offline');
    el.title = 'Offline — sincroniza ao reconectar';
  } else if (syncing) {
    el.innerHTML = icon('refresh-cw', 20); el.classList.add('pending', 'spin');
    el.title = 'Sincronizando…';
  } else if (isDirty()) {
    el.innerHTML = icon('refresh-cw', 20); el.classList.add('pending');
    el.title = 'Alterações pendentes — toque para sincronizar';
  } else {
    el.innerHTML = icon('check', 20); el.classList.add('ok');
    el.title = 'Sincronizado — toque para sincronizar agora';
  }
}

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

// base64 <-> UTF-8 (btoa/atob não lidam com acentos sozinhos)
function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64DecodeUtf8(b64) {
  const bin = atob((b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGetFile(cfg) {
  const url = `${GH_API}/repos/${cfg.repo}/contents/${DATA_PATH}`;
  const res = await fetch(url, { headers: ghHeaders(cfg.token), cache: 'no-store' });
  if (res.status === 404) return { exists: false, sha: null, data: null };
  if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
  const j = await res.json();
  return { exists: true, sha: j.sha, data: JSON.parse(b64DecodeUtf8(j.content)) };
}

async function ghPutFile(cfg, dataObj, sha) {
  const url = `${GH_API}/repos/${cfg.repo}/contents/${DATA_PATH}`;
  const body = {
    message: 'Atualiza lançamentos — ' + new Date().toISOString(),
    content: b64EncodeUtf8(JSON.stringify(dataObj, null, 2))
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (res.status === 409) { const e = new Error('conflito'); e.conflict = true; throw e; }
  if (!res.ok) throw new Error('GitHub ' + res.status + ' — ' + (await res.text()).slice(0, 140));
  return (await res.json()).content.sha;
}

async function ghCheckRepo(cfg) {
  const res = await fetch(`${GH_API}/repos/${cfg.repo}`, { headers: ghHeaders(cfg.token), cache: 'no-store' });
  if (res.status === 404) throw new Error('Repositório não encontrado (confira usuário/repo e se o token tem acesso).');
  if (res.status === 401) throw new Error('Token inválido ou expirado.');
  if (!res.ok) throw new Error('GitHub ' + res.status);
  const j = await res.json();
  if (!j.private) throw new Error('ATENÇÃO: esse repositório é PÚBLICO. Use um repositório privado para seus dados.');
  if (!(j.permissions && (j.permissions.push || j.permissions.admin))) {
    throw new Error('O token não tem permissão de escrita (Contents: Read and write) nesse repositório.');
  }
  return j;
}

/* ---- documento sincronizado (snapshot + merge) ---- */
function currentDoc() {
  return {
    funcionario: state.funcionario,
    dataSolicitacao: state.dataSolicitacao,
    referente: state.referente,
    reportMonths: Object.assign({ reembolso: '', alelo: '' }, state.reportMonths || {}),
    santPeriodo: Object.assign({ start: '', end: '' }, state.santPeriodo || {}),
    bank: Object.assign({}, state.bank),
    reembolso: state.reembolso.map((e) => Object.assign({}, e)),
    alelo: state.alelo.map((e) => Object.assign({}, e)),
    history: state.history.map((h) => JSON.parse(JSON.stringify(h))),
    histTomb: Object.assign({}, state.histTomb),
    driveFolderId: state.driveFolderId || '',
    driveFolders: Object.assign({ reembolso: '', alelo: '' }, state.driveFolders || {}),
    pending: (state.pending || []).map((p) => Object.assign({}, p)),
    driveKnown: Object.assign({}, state.driveKnown || {}),
    driveDismissed: Object.assign({}, state.driveDismissed || {}),
    config: { categorias: getCatConfig().map((c) => Object.assign({}, c)) },
    tomb: {
      reembolso: Object.assign({}, state.tomb.reembolso),
      alelo: Object.assign({}, state.tomb.alelo)
    },
    meta: Object.assign({ updatedAt: 0, profileUpdatedAt: 0 }, state.meta)
  };
}

function applyDoc(doc) {
  applyingRemote = true;
  const base = emptyState();
  state.funcionario = doc.funcionario || '';
  state.dataSolicitacao = doc.dataSolicitacao || '';
  state.referente = doc.referente || '';
  state.reportMonths = Object.assign({ reembolso: '', alelo: '' }, doc.reportMonths || {});
  if (typeof doc.reportMonth === 'string' && doc.reportMonth) {   // doc legado com mês único
    if (!state.reportMonths.reembolso) state.reportMonths.reembolso = doc.reportMonth;
    if (!state.reportMonths.alelo) state.reportMonths.alelo = doc.reportMonth;
  }
  state.santPeriodo = Object.assign({ start: '', end: '' }, doc.santPeriodo || {});
  state.bank = Object.assign(base.bank, doc.bank || {});
  state.reembolso = doc.reembolso || [];
  state.alelo = doc.alelo || [];
  state.history = Array.isArray(doc.history) ? doc.history : [];
  state.histTomb = doc.histTomb || {};
  state.driveFolderId = doc.driveFolderId || '';
  state.driveFolders = Object.assign({ reembolso: '', alelo: '' }, doc.driveFolders || {});
  if (!state.driveFolders.reembolso && state.driveFolderId) state.driveFolders.reembolso = state.driveFolderId;
  state.pending = Array.isArray(doc.pending) ? doc.pending : [];
  state.driveKnown = doc.driveKnown || {};
  state.driveDismissed = doc.driveDismissed || {};
  state.config = normalizeCatConfig(doc.config);
  state.tomb = {
    reembolso: (doc.tomb && doc.tomb.reembolso) || {},
    alelo: (doc.tomb && doc.tomb.alelo) || {}
  };
  state.meta = Object.assign({ updatedAt: 0, profileUpdatedAt: 0 }, doc.meta || {});
  saveState();
  render();
  catDraft = null;
  populateCategorySelects();
  renderCatEditor();
  applyingRemote = false;
}

function mergeTable(t, a, b, outTomb) {
  const PURGE = Date.now() - 180 * 24 * 3600 * 1000;   // descarta lápides > 180 dias
  const tomb = {};
  for (const src of [a, b]) {
    const tm = (src.tomb && src.tomb[t]) || {};
    for (const id in tm) if (tm[id] >= PURGE) tomb[id] = Math.max(tomb[id] || 0, tm[id]);
  }
  const map = {};
  for (const src of [a, b]) {
    for (const e of (src[t] || [])) {
      const cur = map[e.id];
      if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) map[e.id] = e;
    }
  }
  const list = [];
  for (const id in map) {
    const e = map[id];
    if (tomb[id] && tomb[id] >= (e.updatedAt || 0)) continue;   // deletado
    list.push(e);
  }
  outTomb[t] = tomb;
  list.sort((x, y) => (x.data || '').localeCompare(y.data || ''));
  return list;
}

function mergeHistory(a, b) {
  const PURGE = Date.now() - 365 * 24 * 3600 * 1000;   // lápides de histórico: 1 ano
  const tomb = {};
  for (const src of [a, b]) {
    const tm = src.histTomb || {};
    for (const id in tm) if (tm[id] >= PURGE) tomb[id] = Math.max(tomb[id] || 0, tm[id]);
  }
  const map = {};
  for (const src of [a, b]) for (const h of (src.history || [])) if (!map[h.id]) map[h.id] = h;
  const list = [];
  for (const id in map) { if (tomb[id]) continue; list.push(map[id]); }
  list.sort((x, y) => (y.archivedAt || 0) - (x.archivedAt || 0));   // mais recente primeiro
  return { list, tomb };
}

function mergeDocs(a, b) {
  const pa = (a.meta && a.meta.profileUpdatedAt) || 0;
  const pb = (b.meta && b.meta.profileUpdatedAt) || 0;
  const p = pb > pa ? b : a;   // perfil/banco: o mais recente vence
  const out = {
    funcionario: p.funcionario || '',
    dataSolicitacao: p.dataSolicitacao || '',
    referente: p.referente || '',
    reportMonths: Object.assign({ reembolso: '', alelo: '' }, p.reportMonths || (p.reportMonth ? { reembolso: p.reportMonth, alelo: p.reportMonth } : {})),
    santPeriodo: Object.assign({ start: '', end: '' }, p.santPeriodo || {}),
    bank: Object.assign({}, p.bank || {}),
    config: normalizeCatConfig(p.config),
    tomb: { reembolso: {}, alelo: {} }
  };
  out.reembolso = mergeTable('reembolso', a, b, out.tomb);
  out.alelo = mergeTable('alelo', a, b, out.tomb);
  const mh = mergeHistory(a, b);
  out.history = mh.list;
  out.histTomb = mh.tomb;
  out.driveFolderId = a.driveFolderId || b.driveFolderId || '';   // id da pasta do Drive (estável)
  const fa = a.driveFolders || {}, fb = b.driveFolders || {};      // raízes separadas: prefere id não-vazio
  out.driveFolders = {
    reembolso: fa.reembolso || fb.reembolso || a.driveFolderId || b.driveFolderId || '',
    alelo: fa.alelo || fb.alelo || ''
  };
  // varredura do Drive: união de vistos/descartados; pendentes = união por fileId,
  // exceto os que já viraram lançamento (foto.id) ou foram descartados (evita "ressuscitar")
  out.driveKnown = Object.assign({}, a.driveKnown || {}, b.driveKnown || {});
  out.driveDismissed = Object.assign({}, a.driveDismissed || {}, b.driveDismissed || {});
  const linked = new Set();
  const collectFoto = (arr) => { for (const e of (arr || [])) if (e.foto && e.foto.id) linked.add(e.foto.id); };
  collectFoto(out.reembolso); collectFoto(out.alelo);
  for (const h of out.history) { collectFoto(h.reembolso); collectFoto(h.alelo); }
  const pmap = {};
  for (const p of (a.pending || []).concat(b.pending || [])) {
    if (!p || !p.fileId) continue;
    if (linked.has(p.fileId) || out.driveDismissed[p.fileId]) continue;
    pmap[p.fileId] = p;
  }
  out.pending = Object.values(pmap);
  out.meta = {
    updatedAt: Math.max((a.meta && a.meta.updatedAt) || 0, (b.meta && b.meta.updatedAt) || 0),
    profileUpdatedAt: Math.max(pa, pb)
  };
  return out;
}

/* ---- orquestração: puxar -> mesclar -> empurrar ---- */
let syncing = false;

function scheduleSync() {
  if (!isSyncConfigured()) return;
  clearTimeout(scheduleSync._t);
  scheduleSync._t = setTimeout(() => { syncNow(true); }, 2500);
}

async function syncNow(silent) {
  const cfg = loadSyncCfg();
  if (!cfg.repo || !cfg.token) { if (!silent) setSyncStatus('Configure o repositório e o token.', 'warn'); return; }
  if (!navigator.onLine) {
    setSyncStatus(isDirty()
      ? 'Offline — alterações pendentes serão enviadas assim que a conexão voltar.'
      : 'Offline — sincroniza quando a conexão voltar.', 'warn');
    updateSyncIndicator();
    return;
  }
  if (syncing) return;
  syncing = true;
  updateSyncIndicator();
  setSyncStatus('Sincronizando…');
  try {
    const remote = await ghGetFile(cfg);
    let merged, sha;
    if (!remote.exists) { merged = currentDoc(); sha = null; }
    else { merged = mergeDocs(currentDoc(), remote.data); sha = remote.sha; }

    applyDoc(merged);

    const changed = !remote.exists || JSON.stringify(merged) !== JSON.stringify(remote.data);
    if (changed) {
      try {
        await ghPutFile(cfg, merged, sha);
      } catch (e) {
        if (e.conflict) {   // outro dispositivo gravou no meio: refaz a mescla
          const r2 = await ghGetFile(cfg);
          const m2 = mergeDocs(currentDoc(), r2.data);
          applyDoc(m2);
          await ghPutFile(cfg, m2, r2.sha);
        } else { throw e; }
      }
    }
    setDirty(false);   // local e servidor consistentes
    setLastSync(Date.now());
    updateFooter();
    setSyncStatus('Sincronizado • ' + new Date().toLocaleString('pt-BR'), 'ok');
  } catch (e) {
    console.error(e);
    // mantém o estado "sujo": tenta de novo ao reconectar / reabrir
    setSyncStatus('Erro: ' + e.message + (isDirty() ? ' (alterações pendentes mantidas)' : ''), 'err');
  } finally {
    syncing = false;
    updateSyncIndicator();
  }
}

function setupSyncUI() {
  const cfg = loadSyncCfg();
  if ($('sy-repo')) $('sy-repo').value = cfg.repo || '';
  if ($('sy-token')) $('sy-token').value = cfg.token || '';
  if (!isSyncConfigured()) setSyncStatus('Não configurado.', '');
  else if (!navigator.onLine) setSyncStatus(isDirty()
    ? 'Offline — alterações pendentes serão enviadas ao reconectar.'
    : 'Offline.', 'warn');
  else setSyncStatus('Configurado. Toque em “Sincronizar agora”.', '');

  function persist() {
    saveSyncCfg({ repo: ($('sy-repo').value || '').trim(), token: ($('sy-token').value || '').trim() });
    updateSyncIndicator();
  }
  $('sy-repo').addEventListener('change', persist);
  $('sy-token').addEventListener('change', persist);

  $('sy-test').addEventListener('click', async () => {
    persist();
    const c = loadSyncCfg();
    if (!c.repo || !c.token) { setSyncStatus('Preencha o repositório e o token.', 'warn'); return; }
    setSyncStatus('Verificando conexão…');
    try { await ghCheckRepo(c); setSyncStatus('Conectado ✓ Repositório privado acessível.', 'ok'); }
    catch (e) { setSyncStatus('Erro: ' + e.message, 'err'); }
  });

  $('sy-now').addEventListener('click', () => { persist(); syncNow(false); });

  $('sy-clear').addEventListener('click', () => {
    if (!confirm('Apagar o token e o repositório salvos neste aparelho?\n(Os lançamentos locais permanecem.)')) return;
    try { localStorage.removeItem(SYNC_KEY); } catch (e) { console.warn('remover SYNC_KEY falhou', e); }
    $('sy-repo').value = ''; $('sy-token').value = '';
    setSyncStatus('Desconectado deste aparelho.', '');
    updateSyncIndicator();
    toast('Sincronização desativada neste aparelho.');
  });
}

