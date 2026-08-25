'use strict';
/* ---------------- Modal de lançamento ---------------- */
function openModal(tabela, id, prefill) {
  $('m-tabela').value = tabela;
  $('m-id').value = id || '';
  const isEdit = !!id;
  $('modal-title').textContent = isEdit ? 'Editar lançamento' : 'Novo lançamento';
  $('m-delete').style.display = isEdit ? 'block' : 'none';
  $('m-duplicate').style.display = isEdit ? 'block' : 'none';

  let entry = { data: todayISO(), descricao: '', categoria: '', valor: '' };
  if (isEdit) entry = state[tabela].find((e) => e.id === id) || entry;
  else if (prefill) entry = Object.assign({ data: todayISO() }, prefill);

  $('m-data').value = entry.data || todayISO();
  $('m-descricao').value = entry.descricao || '';
  $('m-categoria').value = entry.categoria || '';
  $('m-valor').value = entry.valor ? formatMoneyInput(entry.valor) : '';
  if ($('m-estabelecimento')) $('m-estabelecimento').value = entry.estabelecimento || '';
  if ($('m-justificativa')) $('m-justificativa').value = entry.justificativa || '';
  toggleCamposModulo(tabela);
  updateCatHint();

  resetModalPhoto(isEdit ? (entry.foto || null) : null);
  renderModalPhoto();

  $('modal').classList.add('open');
  setTimeout(() => $('m-descricao').focus(), 150);
}

function closeModal() { $('modal').classList.remove('open'); linkedPendingId = null; }

/* Campos extras (estabelecimento / justificativa) aparecem conforme MOD[tabela].campos */
const CAMPOS_EXTRA = ['estabelecimento', 'justificativa'];
function toggleCamposModulo(tabela) {
  const campos = (MOD[tabela] || {}).campos || {};
  for (const k of CAMPOS_EXTRA) {
    const f = $('m-' + k + '-field');
    if (f) f.style.display = campos[k] ? '' : 'none';
  }
}

/* ---- comprovante no modal ---- */
let modalPhoto = { mode: 'keep', existing: null, blob: null, dataUrl: null, w: 0, h: 0 };
function resetModalPhoto(existing) { modalPhoto = { mode: 'keep', existing: existing || null, blob: null, dataUrl: null, w: 0, h: 0 }; }
function renderModalPhoto() {
  const attach = $('m-foto-attach'), prev = $('m-foto-preview');
  if (!attach || !prev) return;
  const has = modalPhoto.mode === 'new' || (modalPhoto.mode === 'keep' && modalPhoto.existing);
  attach.style.display = has ? 'none' : '';
  prev.style.display = has ? '' : 'none';
  const thumb = $('m-foto-thumb');
  if (modalPhoto.mode === 'new') {
    if (modalPhoto.kind === 'pdf') {
      thumb.style.display = 'none';
      $('m-foto-label').textContent = 'PDF pronto para enviar';
    } else {
      thumb.src = modalPhoto.dataUrl; thumb.style.display = '';
      $('m-foto-label').textContent = 'Comprovante pronto para enviar';
    }
    $('m-foto-view').style.display = 'none';
  } else if (modalPhoto.existing) {
    thumb.style.display = 'none';
    $('m-foto-label').textContent = modalPhoto.existing.pending ? 'Comprovante anexado (envio pendente)' : 'Comprovante anexado';
    $('m-foto-view').style.display = '';
  }
}
async function onPhotoSelected(file) {
  if (!file) return;
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      modalPhoto = { mode: 'new', kind: 'pdf', existing: modalPhoto.existing, blob: file, dataUrl: null, w: 0, h: 0 };
      renderModalPhoto();
      if (aiConfigured()) await runReceiptOcr();
      return;
    }
    toast('Processando imagem…');
    const { blob, w, h } = await compressImage(file);
    modalPhoto = { mode: 'new', kind: 'img', existing: modalPhoto.existing, blob, dataUrl: await blobToDataUrl(blob), w, h };
    renderModalPhoto();
    if (aiConfigured()) await runReceiptOcr();
  } catch (e) { console.error(e); toast('Erro no arquivo: ' + e.message); }
}
async function applyModalPhoto(entry) {
  if (modalPhoto.mode === 'keep') {
    // vincula um arquivo do Drive já existente (ex.: pendente preenchido) a um lançamento novo
    if (!entry.foto && modalPhoto.existing && modalPhoto.existing.id) {
      entry.foto = { id: modalPhoto.existing.id, name: modalPhoto.existing.name };
    }
    return;
  }
  if (modalPhoto.mode === 'remove') { entry.foto = null; idbDel('thumb_' + entry.id).catch(() => {}); return; }   // só desvincula (não apaga do Drive)
  saveThumb(entry.id, modalPhoto.blob);   // miniatura local p/ a lista (não sincroniza)
  const name = receiptFileName(entry);
  const tabela = $('m-tabela').value;     // raiz do Drive depende da tabela (reembolso / cartão)
  if (gdConfigured() && gdConnected()) {
    try {
      toast('Enviando comprovante ao Drive…');
      const fid = await gdUpload(modalPhoto.blob, name, reportFolderDateISO(tabela) || entry.data, tabela);
      entry.foto = { id: fid, name, w: modalPhoto.w, h: modalPhoto.h };
      return;
    } catch (e) { console.error(e); }
  }
  const localId = uid();
  await idbPut('p_' + localId, { blob: modalPhoto.blob, name, data: entry.data, tabela });
  entry.foto = { pending: localId, name, w: modalPhoto.w, h: modalPhoto.h };
  if (gdConfigured()) toast('Comprovante salvo localmente; será enviado ao Drive ao conectar.');
  else toast('Comprovante salvo localmente. Configure o Google Drive para enviá-lo.');
}

/* Repetir último lançamento da seção (despesas recorrentes) */
function repeatLast(tabela) {
  const list = state[tabela];
  if (!list.length) { toast('Nenhum lançamento para repetir nesta seção.'); return; }
  const last = list[list.length - 1];
  const prefill = { data: todayISO(), descricao: last.descricao, categoria: last.categoria, valor: last.valor };
  const campos = (MOD[tabela] || {}).campos || {};
  for (const k of CAMPOS_EXTRA) if (campos[k]) prefill[k] = last[k] || '';
  openModal(tabela, null, prefill);
}

/* Duplicar: abre um NOVO lançamento com os mesmos dados do que está no modal */
function duplicateInModal() {
  const tabela = $('m-tabela').value;
  const prefill = {
    data: $('m-data').value || todayISO(),
    descricao: $('m-descricao').value,
    categoria: $('m-categoria').value,
    valor: parseMoney($('m-valor').value)
  };
  const campos = (MOD[tabela] || {}).campos || {};
  for (const k of CAMPOS_EXTRA) if (campos[k]) prefill[k] = (($('m-' + k) || {}).value || '').trim();
  openModal(tabela, null, prefill);
}

/* ---------------- Máscaras de entrada ---------------- */
function formatMoneyInput(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function maskCurrencyEl(el) {
  if (!el) return;
  el.setAttribute('inputmode', 'numeric');
  el.addEventListener('input', () => {
    const digits = el.value.replace(/\D/g, '');
    if (!digits) { el.value = ''; return; }
    el.value = (parseInt(digits, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
}
function maskCpfEl(el) {
  if (!el) return;
  el.setAttribute('inputmode', 'numeric');
  el.addEventListener('input', () => {
    const d = el.value.replace(/\D/g, '').slice(0, 11);
    let out = d;
    if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    else if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    else if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
    el.value = out;
  });
}

function updateCatHint() {
  const lim = limiteDaCategoria($('m-categoria').value);
  $('m-cat-hint').textContent = lim ? ('Limite de reembolso: ' + formatMoney(lim)) : '';
}

async function saveEntry() {
  const tabela = $('m-tabela').value;
  const id = $('m-id').value;
  const data = $('m-data').value;
  const descricao = $('m-descricao').value.trim();
  const categoria = $('m-categoria').value;
  const valor = parseMoney($('m-valor').value);

  if (!data) { toast('Informe a data da compra.'); return; }
  if (!descricao) { toast('Informe a descrição.'); return; }
  if (!categoria) { toast('Selecione a categoria.'); return; }
  if (!valor) { toast('Informe um valor válido.'); return; }

  // aviso de possível duplicado (mesma data + categoria + valor de outro lançamento)
  const cents = Math.round(valor * 100);
  const dup = state[tabela].some((x) => x.id !== id && x.data === data && x.categoria === categoria && Math.round((x.valor || 0) * 100) === cents);
  if (dup && !confirm('Já existe um lançamento com a mesma data, categoria e valor. Adicionar mesmo assim?')) return;

  // campos extras declarados pelo módulo (ex.: estabelecimento/justificativa do cartão)
  const campos = (MOD[tabela] || {}).campos || {};
  const extras = {};
  for (const k of CAMPOS_EXTRA) if (campos[k]) extras[k] = (($('m-' + k) || {}).value || '').trim();

  const now = Date.now();
  let entry;
  if (id) {
    entry = state[tabela].find((x) => x.id === id);
    if (entry) Object.assign(entry, { data, descricao, categoria, valor, updatedAt: now }, extras);
  } else {
    entry = Object.assign({ id: uid(), data, descricao, categoria, valor, updatedAt: now }, extras);
    state[tabela].push(entry);
    lastAddedId = entry.id;
  }
  if (entry) { try { await applyModalPhoto(entry); } catch (e) { console.error(e); } }
  // pendente do Drive preenchido vira lançamento → sai da lista de pendentes
  if (!id && linkedPendingId) { state.pending = (state.pending || []).filter((p) => p.fileId !== linkedPendingId); linkedPendingId = null; }
  touchDoc();
  state[tabela].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  saveState();
  render();
  closeModal();
  setTimeout(() => { lastAddedId = null; }, 900);
}

async function deleteEntry() {
  const tabela = $('m-tabela').value;
  const id = $('m-id').value;
  if (!id) return;
  const entry = state[tabela].find((e) => e.id === id);
  const temFoto = !!(entry && entry.foto);
  const msg = temFoto
    ? 'Excluir este lançamento? O comprovante anexado também será removido do Google Drive.'
    : 'Excluir este lançamento?';
  if (!confirm(msg)) return;
  if (entry) { try { await purgeEntryPhoto(entry); } catch (e) { console.error(e); } }   // apaga foto no Drive/fila/miniatura
  state[tabela] = state[tabela].filter((e) => e.id !== id);
  state.tomb[tabela][id] = Date.now();   // lápide p/ propagar a deleção na sincronização
  touchDoc();
  saveState();
  render();
  closeModal();
}

