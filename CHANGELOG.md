# CHANGELOG

Histórico versão-a-versão (o número é o `CACHE`/`APP_VERSION`). Mantido fora do `CLAUDE.md` para
não gastar tokens de contexto toda sessão — consulte aqui quando precisar do "porquê" histórico.

## v34
- **Acesso ao Drive persiste entre aberturas:** o access token OAuth passa a ser salvo em
  `-gdtok-v1` (`saveGdAccess`/`loadGdAccess`, descarta expirado) e recarregado no startup, então
  reabrir o app dentro de ~1h fica conectado **sem reautenticar**. `scheduleGdRefresh` renova em
  silêncio ~2 min antes de expirar; `setupGDriveUI` reagenda e escuta `visibilitychange`/`online`.
  `gd-clear` apaga o token. Limite: sem backend não há refresh token de longa duração — quando a
  sessão Google do navegador expira de fato, o login é pedido de novo (raro).

## v33
- **Dois relatórios independentes + home em abas:** a tela de Lançamentos virou um seletor
  `[Reembolso | Cartão Santander]` (`setupReportTabs`/`showReportTab`, lembra a aba em `-tab-v1`).
  Cada aba tem **cabeçalho próprio** (Reembolso: funcionário/data/referente/mês + banco; Santander:
  Nome/Cargo fixos + Período/Data de Entrega automáticos), sua tabela, seu **resumo por categoria**
  (`renderCatSummary(tabela,boxId)`) e seu **total**. Removido o resumo/total combinados.
- **Mês de referência por relatório:** `state.reportMonth` (único) → `state.reportMonths{reembolso,
  alelo}` (migra o legado p/ ambos); `reportFolderDateISO(tabela)`; sync/fechamento/reabertura por
  tabela. `excel.js`/`pdf.js` inalterados.
- Botão "Procurar comprovantes no Drive" agora é global (acima das abas; varre as duas raízes).

## v32
- **`drive.js` dividido** em `idb.js` (storage/IndexedDB), `drive-core.js` (auth/pastas/upload/
  exclusão/conexão) e `drive-scan.js` (varredura/pendentes/`scanProgress`) — nenhum arquivo > ~370
  linhas.
- **Cache de OCR por hash:** `ocrReceipt` virou wrapper com cache (`ocrcache_<hash>` no IndexedDB,
  `blobSha256`); a chamada à rede é `ocrReceiptRaw`. Reanalisar o mesmo comprovante não regasta o
  Gemini.
- **Progresso visual no arquivamento:** `archiveMonthToDrive` usa o overlay `scanProgress`
  (generalizado p/ `open(title, icon)`) com etapas zip/Excel/PDF.
- **Diagnóstico:** `catch (e) {}` vazios de I/O (localStorage/Drive) agora dão `console.warn`.
- **Pré-visualização do Período Prestação** no chooser de export (só-cartão), via `#exp-periodo`.
- **Testes versionados:** `tests/integrity.html` e `tests/logic.html` (rodam headless).

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
