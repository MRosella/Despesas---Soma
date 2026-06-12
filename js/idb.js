'use strict';
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

