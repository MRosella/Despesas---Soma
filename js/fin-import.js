'use strict';

/* ============================================================
   Módulo Finanças — importação de extrato/fatura
   (PDF/imagem via Gemini; CSV/OFX com parser local) + revisão.
   ============================================================ */

let finImportDraft = null;   // {destino:{contaId|cartaoId}, rows:[{...tx, incluir, dup}]}

async function ocrStatement(blob, mime) { /* etapa 4 */ }
async function ocrStatementRaw(blob, mime) { /* etapa 4 */ }
function finParseCsv(text) { /* etapa 4 */ return []; }
function finParseOfx(text) { /* etapa 4 */ return []; }
function onFinImportFile(file) { /* etapa 4 */ }
function renderFinReview() { /* etapa 4 */ }
function confirmFinImport() { /* etapa 4 */ }
function setupFinImportUI() { /* etapa 4 */ }
