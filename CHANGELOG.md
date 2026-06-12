# CHANGELOG

Histórico versão-a-versão (o número é o `CACHE`/`APP_VERSION`). Mantido fora do `CLAUDE.md` para
não gastar tokens de contexto toda sessão — consulte aqui quando precisar do "porquê" histórico.

## v31
- **Modularização:** `app.js` (3.156 linhas) dividido em `js/*.js` por área (`core`, `render`,
  `modal`, `excel`, `pdf`, `sync`, `lock`, `ui`, `ocr`, `drive`, `main`), carregados como scripts
  **clássicos** na ordem (escopo global compartilhado, sem build, mantém teste headless em
  `file://`). Objetivo: baratear tokens de desenvolvimento (ler 1 arquivo pequeno em vez do
  monólito). `CLAUDE.md` reescrito p/ navegar por nome de função → arquivo (sem números de linha);
  histórico movido p/ este `CHANGELOG.md`.

## v30
- **PDF multipágina não corta linhas:** `generatePdfBlob` passa a fatiar a imagem nas fronteiras de
  fim de cada `<tr>` em vez de offsets de pixel fixos.
- **Data de Entrega = data de geração** (Excel E7 e PDF) via `todayISO()`.
- **Período Prestação automático** (`computeSantanderPeriodo`): do último lançamento do relatório
  Santander anterior até o último do atual. Substitui o uso de `referente` no Santander.
- **Validação antes de exportar** (`validateBeforeExport`): avisa lançamentos incompletos.
- **Fechamento por tabela** (`closeMonthFlow`/`closeTable`/`archiveMonthToDrive`): fecha só a
  tabela escolhida (a outra continua aberta); arquiva `.zip` dos comprovantes + Excel + PDF na pasta
  do mês no Drive (mantém os originais). Snapshots de histórico marcam `table:`; `reopenHistory`
  restaura só a tabela do snapshot.

## v29
- SW network-first real: `install` precacheia com `cache:'reload'` e `fetch` revalida com
  `cache:'no-cache'` + `updateViaCache:'none'` — fura o `max-age=600` do GitHub Pages que prendia o
  PWA na versão antiga.

## v28
- **OCR com retentativa:** `ocrReceipt` reenvia até 4x com backoff exponencial (jitter) em erros
  transitórios (429, 500/502/503, rede), respeitando `retryDelay` do `RetryInfo`. Erro definitivo
  propaga a mensagem real do Gemini (log da varredura + toast). Corrigido: `dateISO` vinha string
  vazia (motivos usam `!ocr.dateISO`).

## v27
- **Varredura do Drive:** modal de progresso ao vivo (`scanProgress`) por arquivo + motivo dos
  pendentes; botão "Analisar de novo" (`retryPendingOcr`) em cada pendente.

## v26
- **Cartão Santander:** campos Estabelecimento (IA+manual) e Justificativa; Nome/Cargo fixos; PDF
  réplica do modelo (paisagem); botão de varredura na tela principal.

## v25
- **Varredura do Drive:** reconhece comprovantes subidos manualmente (escopo `drive.readonly`),
  lança automático ou cria área de pendentes p/ revisar.
