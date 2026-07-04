'use strict';

/* ============================================================
   Módulo Finanças — renderização (dashboard, transações,
   contas & cartões, fatura) e abas próprias (.ftab/.fin-panel).
   ============================================================ */

const FIN_TAB_KEY = 'despesas-soma-fintab-v1';
let finMesAtivo = todayISO().slice(0, 7);   // 'YYYY-MM' exibido no dashboard/transações
let finFaturaView = null;                    // {cartaoId, competencia} da fatura aberta

function renderFin() { /* etapa 2 */ }
function renderFinDashboard() { /* etapa 2 */ }
function renderFinTransacoes() { /* etapa 3 */ }
function renderFinContasCartoes() { /* etapa 3 */ }
function renderFinFatura() { /* etapa 3 */ }

function showFinTab(tab) { /* etapa 2 */ }
function setupFinTabs() { /* etapa 2 */ }
function setupFinUI() { /* etapa 2 */ }
