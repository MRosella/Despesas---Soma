'use strict';
/* ============================================================
   Bloqueio do app (biometria via WebAuthn / PIN) — config local
   ============================================================ */
function loadLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); } catch (e) { return {}; } }
function saveLock(l) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch (e) {} }
function lockEnabled() { const l = loadLock(); return !!(l.bio || l.pin); }

function randBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
function abToB64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function b64ToAb(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer; }
async function sha256B64(str) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return abToB64(buf); }

async function enableBio() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    toast('Este aparelho/navegador não suporta biometria aqui.'); return false;
  }
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: randBytes(32),
      rp: { name: 'Despesas Soma', id: location.hostname },
      user: { id: randBytes(16), name: 'usuario-despesas', displayName: 'Usuário' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000, attestation: 'none'
    } });
    const l = loadLock(); l.bio = { credId: abToB64(cred.rawId) }; saveLock(l);
    return true;
  } catch (e) { console.error(e); toast('Não foi possível ativar a biometria.'); return false; }
}
async function unlockBio() {
  const l = loadLock(); if (!l.bio) throw new Error('sem biometria');
  await navigator.credentials.get({ publicKey: {
    challenge: randBytes(32),
    allowCredentials: [{ type: 'public-key', id: b64ToAb(l.bio.credId) }],
    userVerification: 'required', timeout: 60000, rpId: location.hostname
  } });
  return true;   // se não lançou exceção, a verificação passou
}
async function setPin(pin) { const l = loadLock(); l.pin = { hash: await sha256B64('despesas-soma|' + pin) }; saveLock(l); }
async function checkPin(pin) { const l = loadLock(); if (!l.pin) return false; return (await sha256B64('despesas-soma|' + pin)) === l.pin.hash; }

function maybeLock() { if (lockEnabled()) showLock(); }

function showLock() {
  if ($('lock-screen')) return;
  const l = loadLock();
  const div = document.createElement('div');
  div.id = 'lock-screen'; div.className = 'lock-screen';
  div.innerHTML = `
    <div class="lock-card">
      <img src="assets/soma-logo.png" alt="" class="lock-logo">
      <h3>App bloqueado</h3>
      <p>Autentique-se para acessar seus dados.</p>
      ${l.bio ? '<button class="btn btn-pdf" id="lock-bio">Desbloquear com biometria</button>' : ''}
      ${l.pin ? '<div class="lock-pin"><input type="password" inputmode="numeric" id="lock-pin-input" placeholder="PIN" maxlength="12"><button class="btn btn-excel" id="lock-pin-ok">Entrar</button></div>' : ''}
      <p class="lock-msg" id="lock-msg"></p>` + '</div>';
  document.body.appendChild(div);
  document.body.classList.add('locked');

  async function tryBio() {
    try { await unlockBio(); hideLock(); }
    catch (e) { $('lock-msg').textContent = 'Falha na biometria. Tente de novo' + (l.pin ? ' ou use o PIN.' : '.'); }
  }
  if (l.bio) { $('lock-bio').addEventListener('click', tryBio); setTimeout(tryBio, 350); }
  if (l.pin) {
    const ok = async () => { if (await checkPin($('lock-pin-input').value)) hideLock(); else $('lock-msg').textContent = 'PIN incorreto.'; };
    $('lock-pin-ok').addEventListener('click', ok);
    $('lock-pin-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ok(); });
  }
}
function hideLock() { const d = $('lock-screen'); if (d) d.remove(); document.body.classList.remove('locked'); maybePromptDrive(); }

function refreshSecStatus() {
  const l = loadLock();
  const bio = $('sec-bio'); if (bio) bio.textContent = l.bio ? 'Desativar biometria' : 'Ativar biometria';
  const st = $('sec-status'); if (st) {
    st.textContent = lockEnabled()
      ? 'Bloqueio ATIVO' + (l.bio ? ' · biometria' : '') + (l.pin ? ' · PIN' : '')
      : 'Bloqueio desativado.';
    st.className = 'sync-status' + (lockEnabled() ? ' ok' : '');
  }
}
function setupSecurityUI() {
  refreshSecStatus();
  if (!$('sec-bio')) return;
  $('sec-bio').addEventListener('click', async () => {
    const cur = loadLock();
    if (cur.bio) { delete cur.bio; saveLock(cur); refreshSecStatus(); toast('Biometria desativada.'); }
    else if (await enableBio()) { refreshSecStatus(); toast('Biometria ativada.'); }
  });
  $('sec-pin-set').addEventListener('click', async () => {
    const pin = ($('sec-pin').value || '').trim();
    const cur = loadLock();
    if (cur.pin && !pin) { delete cur.pin; saveLock(cur); refreshSecStatus(); toast('PIN removido.'); return; }
    if (!/^\d{4,12}$/.test(pin)) { toast('Use um PIN de 4 a 12 dígitos.'); return; }
    await setPin(pin); $('sec-pin').value = ''; refreshSecStatus(); toast('PIN definido.');
  });
}

/* ============================================================
   Backup / Restauração (arquivo JSON) + cópia versionada no Git
   ============================================================ */
async function exportBackup() {
  try {
    const json = JSON.stringify(currentDoc(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    await shareOrDownload(blob, 'backup-despesas-' + todayISO() + '.json', 'Backup de Despesas');
    const st = $('bk-status');
    if (isSyncConfigured() && navigator.onLine) {
      try { await ghPutBackup(loadSyncCfg(), json); if (st) { st.textContent = 'Backup salvo (local + cópia versionada no Git).'; st.className = 'sync-status ok'; } }
      catch (e) { console.error(e); if (st) { st.textContent = 'Backup local salvo. (Falha ao gravar cópia no Git.)'; st.className = 'sync-status warn'; } }
    } else if (st) { st.textContent = 'Backup local salvo.'; st.className = 'sync-status ok'; }
  } catch (e) { console.error(e); toast('Erro ao exportar backup: ' + e.message); }
}
async function ghPutBackup(cfg, jsonStr) {
  const path = 'backups/backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  const url = `${GH_API}/repos/${cfg.repo}/contents/${path}`;
  const body = { message: 'Backup ' + new Date().toISOString(), content: b64EncodeUtf8(jsonStr) };
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(cfg.token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('GitHub ' + res.status);
}
function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || (!imported.reembolso && !imported.history)) { toast('Arquivo de backup inválido.'); return; }
      if (!confirm('Importar este backup e MESCLAR com os dados atuais?\n(Lançamentos mais recentes prevalecem; nada é perdido.)')) return;
      const merged = mergeDocs(currentDoc(), imported);
      applyDoc(merged);
      setDirty(true); scheduleSync();
      const st = $('bk-status'); if (st) { st.textContent = 'Backup importado e mesclado.'; st.className = 'sync-status ok'; }
      toast('Backup importado.');
    } catch (e) { console.error(e); toast('Não foi possível ler o arquivo: ' + e.message); }
  };
  reader.readAsText(file);
}
function setupBackupUI() {
  if (!$('bk-export')) return;
  $('bk-export').addEventListener('click', exportBackup);
  $('bk-import-btn').addEventListener('click', () => $('bk-import').click());
  $('bk-import').addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) importBackupFile(e.target.files[0]); e.target.value = ''; });
}

