'use strict';
/* ---------------- Modo escuro ---------------- */
function currentTheme() {
  const p = localStorage.getItem(THEME_KEY);
  if (p === 'dark' || p === 'light') return p;
  return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme() {
  const t = currentTheme();
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('theme-toggle');
  if (btn) { btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 22); btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#201a17' : '#b3262d');
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { console.warn('salvar tema falhou', e); }
  applyTheme();
}
function setupTheme() {
  applyTheme();
  if ($('theme-toggle')) $('theme-toggle').addEventListener('click', toggleTheme);
  if (window.matchMedia) {
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme();   // segue o sistema só sem escolha manual
      });
    } catch (e) {}
  }
}

/* ---------------- Persistência de campos ---------------- */
function bindField(id, getter, setter) {
  const el = $(id);
  if (!el) return;   // campo não existe neste módulo (ex.: período só no cartão)
  el.addEventListener('input', () => { setter(el.value); touchProfile(); saveState(); });
  el.addEventListener('change', () => { setter(el.value); touchProfile(); saveState(); render(); });
}

/* Chooser: o usuário escolhe QUAL relatório fechar (os outros continuam abertos). */
function chooseCloseTable() {
  return new Promise((resolve) => {
    const botoes = MODULOS.map((m) =>
      `<button class="btn btn-mod" data-t="${m.key}" style="background:${m.accent}">${escapeHtml(m.tabLabel)} (${(state[m.key] || []).length})</button>`
    ).join('');
    const div = document.createElement('div');
    div.className = 'offline-notice';
    div.innerHTML = `
      <div class="offline-card">
        <div class="offline-icon">📦</div>
        <h3>Fechar e arquivar mês</h3>
        <p>Escolha o relatório a fechar. Os comprovantes dele no Drive serão compactados (.zip) e o
        Excel + PDF do mês ficam guardados na pasta. Os outros relatórios continuam abertos.</p>
        <div class="notice-actions">
          ${botoes}
          <button class="btn btn-ghost" data-t="">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-t]'); if (!b) return;
      div.remove(); resolve(b.dataset.t || null);
    });
  });
}

async function closeMonthFlow() {
  const tabela = await chooseCloseTable();
  if (!tabela) return;
  await closeTable(tabela);
}

/* Fecha SOMENTE a tabela escolhida: arquiva snapshot, compacta os comprovantes no Drive,
   guarda Excel + PDF do mês na pasta e limpa a tabela. A outra permanece aberta. */
async function closeTable(tabela) {
  const mod = modOf(tabela);
  if (!(state[tabela] || []).length) { toast('O relatório de ' + mod.tabLabel + ' está vazio.'); return; }
  if (!confirm('Fechar e arquivar o relatório de ' + mod.tabLabel + '?\nOs lançamentos vão para o Histórico e os arquivos do mês são gravados no Drive.')) return;
  const sections = mapPorTabela((t) => t === tabela);
  if (!validateBeforeExport(state, sections)) return;

  // pergunta se os comprovantes (fotos/NFs) devem ser anexados ao final do PDF do mês
  const incluirAnexos = confirm('Anexar os comprovantes (fotos/NFs) ao final do PDF do mês?\n\nOK = com anexos · Cancelar = PDF sem anexos.');

  const now = Date.now();
  const perfil = perfilDe(tabela);
  // snapshot só do relatório escolhido — o perfil vai ACHATADO na raiz (formato do histórico)
  const snapshot = {
    id: uid(),
    archivedAt: now,
    table: tabela,
    label: monthLabelFor(docForModule(state, tabela)) + ' · ' + mod.tabLabel,
    funcionario: perfil.funcionario,
    dataSolicitacao: perfil.dataSolicitacao,
    referente: perfil.referente,
    reportMonth: (state.reportMonths || {})[tabela] || '',
    santPeriodo: mod.periodo ? Object.assign({}, perfil.santPeriodo) : undefined,
    bank: Object.assign({}, perfil.bank)
  };
  for (const t of TABELAS) snapshot[t] = (t === tabela) ? (state[t] || []).map((e) => Object.assign({}, e)) : [];

  // arquiva no Drive (zip + Excel + PDF) — best-effort
  try { await archiveMonthToDrive(tabela, snapshot, incluirAnexos); }
  catch (e) { if (e && e.message === 'cancelado') { toast('Fechamento cancelado.'); return; } throw e; }

  // grava o snapshot e limpa só a tabela fechada
  state.history.unshift(snapshot);
  for (const e of state[tabela]) state.tomb[tabela][e.id] = now;   // lápides p/ a sincronização
  state[tabela] = [];
  state.reportMonths[tabela] = '';   // o mês de referência daquele relatório zera ao fechá-lo
  perfil.dataSolicitacao = '';
  if (mod.periodo) perfil.santPeriodo = { start: '', end: '' };   // período de prestação zera ao fechar
  touchProfile(); touchDoc();
  saveState();
  render();
  toast(mod.tabLabel + ': mês arquivado.');
}

/* Compacta os comprovantes da tabela num único .zip e grava .zip + Excel + PDF do mês
   na pasta do mês no Drive. Mantém os comprovantes individuais. */
async function archiveMonthToDrive(tabela, snapshot, incluirAnexos) {
  if (incluirAnexos === undefined) incluirAnexos = true;
  if (!gdConfigured()) { toast('Drive não configurado — arquivado só no histórico.'); return; }
  if (!gdConnected()) {
    try { await gdGetToken(true); } catch (e) { console.warn('conexão ao Drive no arquivamento falhou', e); }
    if (!gdConnected()) {
      if (!confirm('Não foi possível conectar ao Google Drive. Concluir o fechamento sem gravar os arquivos do mês no Drive?')) throw new Error('cancelado');
      return;
    }
  }
  const list = snapshot[tabela] || [];
  const maxData = (l) => l.map((e) => e && e.data).filter(Boolean).sort().pop() || '';
  const dateISO = reportFolderDateISO(tabela) || maxData(list) || todayISO();
  const m = /^(\d{4})-(\d{2})/.exec(dateISO);
  const mesNome = m ? MESES[parseInt(m[2], 10) - 1] : '';
  const ano = m ? m[1] : '';
  const baseNome = (mesNome && ano) ? mesNome + ' ' + ano : monthLabelFor(snapshot);

  const mod = modOf(tabela);
  const LBL = mod.tabLabel;
  const D = docForModule(snapshot, tabela);   // perfil do módulo achatado p/ os builders
  scanProgress.open('Arquivando ' + LBL, '📦');
  try {
    // 1) zip dos comprovantes
    scanProgress.status('Compactando comprovantes…');
    const files = {};
    let faltou = 0;
    for (const e of list) {
      if (!e.foto) continue;
      let blob = null;
      try { blob = await getPhotoBlob(e.foto); } catch (er) { console.warn('comprovante indisponivel no arquivamento', er); }
      if (!blob) { faltou++; continue; }
      const base = (e.foto.name || ('Comprovante_' + (e.data || todayISO()))).replace(/[\\/:*?"<>|]/g, '_');
      let nome = base, k = 1;
      while (files[nome]) { const i = base.lastIndexOf('.'); nome = i > 0 ? base.slice(0, i) + '_' + k + base.slice(i) : base + '_' + k; k++; }
      files[nome] = new Uint8Array(await blob.arrayBuffer());
    }
    const nZip = Object.keys(files).length;
    if (nZip) {
      scanProgress.log('Compactando ' + nZip + ' comprovante(s)…', 'info');
      const zipBytes = fflate.zipSync(files);
      await gdUpload(new Blob([zipBytes], { type: 'application/zip' }), 'NFs - ' + baseNome + '.zip', dateISO, tabela);
      scanProgress.log('✓ NFs - ' + escapeHtml(baseNome) + '.zip enviado', 'ok');
    } else {
      scanProgress.log('Sem comprovantes para compactar.', 'info');
    }
    if (faltou) scanProgress.log('⚠ ' + faltou + ' comprovante(s) não baixados (ficaram de fora do zip).', 'warn');

    // 2) Excel do mês
    scanProgress.status('Gerando Excel…');
    const sections = mapPorTabela((t) => t === tabela);
    const xlsxBytes = await buildXlsxFor(D, mod);
    const xlsxBlob = new Blob([xlsxBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const xlsxName = fileBaseOf(D, mod) + '.xlsx';
    await gdUpload(xlsxBlob, xlsxName, dateISO, tabela);
    scanProgress.log('✓ Excel enviado', 'ok');

    // 3) PDF do mês (com comprovantes anexados)
    scanProgress.status('Gerando PDF…');
    const pdfBlob = await generatePdfBlob(D, sections, mod, incluirAnexos);
    const pdfName = fileBaseOf(D, mod) + '.pdf';
    await gdUpload(pdfBlob, pdfName, dateISO, tabela);
    scanProgress.log('✓ PDF enviado', 'ok');

    scanProgress.done('Arquivo do mês gravado no Drive.');
  } catch (e) {
    if (e && e.message === 'cancelado') { scanProgress.close(); throw e; }
    console.error('Falha ao arquivar no Drive', e);
    scanProgress.log('⚠ Erro: ' + escapeHtml(e.message || String(e)), 'err');
    scanProgress.done('Falha ao gravar no Drive.');
    if (!confirm('Erro ao gravar no Drive: ' + (e.message || e) + '\nConcluir o fechamento mesmo assim?')) throw new Error('cancelado');
  }
}

/* copia os dados bancários formatados (p/ colar no e-mail de reembolso) */
async function copyBankData(tabela) {
  const b = perfilDe(MOD[tabela] ? tabela : TABELA_PADRAO).bank || {};
  const linhas = [
    ['Nome', b.nome], ['CPF', b.cpf], ['Banco', b.banco],
    ['Agência', b.agencia], ['Conta', b.conta], ['Chave Pix', b.pix]
  ].filter((x) => (x[1] || '').trim());
  if (!linhas.length) { toast('Preencha os dados bancários primeiro.'); return; }
  const txt = linhas.map((x) => x[0] + ': ' + x[1]).join('\n');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
    else { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('Dados bancários copiados.');
  } catch (e) { console.error(e); toast('Não foi possível copiar.'); }
}

/* ---------------- Inicialização ---------------- */
function init() {
  maybeLock();
  render();

  maskCurrencyEl($('m-valor'));

  // cabeçalho, período e dados bancários: um conjunto de campos POR módulo
  for (const mod of MODULOS) {
    const t = mod.key;
    // NAO capturar o perfil aqui: applyDoc (sync) troca state.perfis por objetos
    // novos, e um `p` capturado viraria um objeto orfao (o que o usuario digita
    // no cabecalho some no proximo render). Resolver o perfil a CADA evento.
    bindField('reportMonth-' + t, null, (v) => state.reportMonths[t] = v);
    if (mod.header === 'reembolso') {
      bindField('funcionario-' + t, null, (v) => perfilDe(t).funcionario = v);
      bindField('dataSolicitacao-' + t, null, (v) => perfilDe(t).dataSolicitacao = v);
      bindField('referente-' + t, null, (v) => perfilDe(t).referente = v);
    }
    if (mod.periodo) {
      bindField('sant-periodo-inicio-' + t, null, (v) => perfilDe(t).santPeriodo.start = v);
      bindField('sant-periodo-fim-' + t, null, (v) => perfilDe(t).santPeriodo.end = v);
    }
    if (mod.bank) {
      maskCpfEl($('bk-cpf-' + t));
      for (const k of ['nome', 'cpf', 'banco', 'agencia', 'conta', 'pix']) {
        bindField('bk-' + k + '-' + t, null, (v) => perfilDe(t).bank[k] = v);
      }
      const cp = $('bk-copy-' + t);
      if (cp) cp.addEventListener('click', () => copyBankData(t));
    }
  }

  document.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => openModal(btn.dataset.add, null)));
  document.querySelectorAll('[data-repeat]').forEach((btn) =>
    btn.addEventListener('click', () => repeatLast(btn.dataset.repeat)));

  $('m-save').addEventListener('click', saveEntry);
  $('m-cancel').addEventListener('click', closeModal);
  $('m-delete').addEventListener('click', deleteEntry);
  $('m-duplicate').addEventListener('click', duplicateInModal);
  $('m-categoria').addEventListener('change', updateCatHint);
  $('m-foto-attach').addEventListener('click', () => $('m-foto-file').click());
  $('m-foto-change').addEventListener('click', () => $('m-foto-import').click());
  if ($('m-foto-importbtn')) $('m-foto-importbtn').addEventListener('click', () => $('m-foto-import').click());
  $('m-foto-file').addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; onPhotoSelected(f); });
  if ($('m-foto-import')) $('m-foto-import').addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; onPhotoSelected(f); });
  $('m-foto-view').addEventListener('click', () => viewPhoto(modalPhoto.existing));
  $('m-foto-remove').addEventListener('click', () => { modalPhoto = { mode: 'remove', existing: modalPhoto.existing, blob: null, dataUrl: null, w: 0, h: 0 }; renderModalPhoto(); });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

  $('btn-excel').addEventListener('click', () => openExportChooser('excel', state));
  $('btn-pdf').addEventListener('click', () => openExportChooser('pdf', state));
  $('btn-new-month').addEventListener('click', closeMonthFlow);

  $('exp-cancel').addEventListener('click', closeExportModal);
  $('exp-confirm').addEventListener('click', confirmExport);
  $('export-modal').addEventListener('click', (e) => { if (e.target === $('export-modal')) closeExportModal(); });

  setupIcons();
  populateCategorySelects();
  setupNav();
  setupReportTabs();
  setupHistTabs();
  setupTheme();
  setupServiceWorker();
  setupConnectivity();
  setupSyncUI();
  setupSecurityUI();
  setupBackupUI();
  setupGDriveUI();
  setupCatUI();
  setupAiUI();
  updateFooter();
  updateSyncIndicator();
  $('sync-ind').addEventListener('click', () => syncNow(false));

  // sincronização inicial ao abrir (puxa o que houver de outro dispositivo)
  if (isSyncConfigured() && navigator.onLine) syncNow(true);

  // ao voltar a ficar online, envia o que ficou pendente offline (o merge decide
  // se o mais recente é do servidor ou deste aparelho)
  window.addEventListener('online', () => {
    if (isSyncConfigured()) {
      if (isDirty()) toast('Conexão restaurada — enviando lançamentos…');
      syncNow(true);
    }
    flushPendingPhotos();
    flushGdDeletions(false);
  });

  // ao voltar para o app (reabrir/trazer ao foco), sincroniza para pegar a
  // versão mais recente e enviar pendências
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (isSyncConfigured() && navigator.onLine) syncNow(true);
    maybePromptDrive();
  });

  // popup de conexão do Drive ao abrir (se houver bloqueio, dispara após o desbloqueio)
  if (!lockEnabled()) maybePromptDrive();
}

/* ---------------- Auto-atualização (Service Worker) ---------------- */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

  // updateViaCache:'none' = o próprio sw.js nunca é lido do cache HTTP na checagem de
  // atualização → o navegador sempre vê a versão nova publicada no Pages.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // procura nova versão ao abrir e periodicamente
    reg.update();
    setInterval(() => reg.update(), 60000);

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Atualizando para a versão mais recente…');
        }
      });
    });
  }).catch(() => {});

  // quando o novo Service Worker assume o controle, recarrega 1x p/ aplicar
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  // ao voltar para o app, checa se há atualização
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((r) => { if (r) r.update(); });
    }
  });
}

/* ---------------- Aviso de offline ---------------- */
function setupConnectivity() {
  if (!navigator.onLine) showOfflineNotice();
  window.addEventListener('offline', () => { showOfflineNotice(); updateSyncIndicator(); });
  window.addEventListener('online', () => { const n = $('offline-notice'); if (n) n.remove(); updateSyncIndicator(); maybePromptDrive(); });
}

function showOfflineNotice() {
  if ($('offline-notice')) return;
  const div = document.createElement('div');
  div.id = 'offline-notice';
  div.className = 'offline-notice';
  div.innerHTML = `
    <div class="offline-card">
      <div class="offline-icon">📡</div>
      <h3>Você está offline</h3>
      <p>O app pode não estar na versão mais recente. Conecte-se à internet para
         garantir a atualização automática e a sincronização dos lançamentos.</p>
      <button class="btn btn-pdf" id="offline-ok">Entendi</button>
    </div>`;
  document.body.appendChild(div);
  $('offline-ok').addEventListener('click', () => div.remove());
}

document.addEventListener('DOMContentLoaded', init);
