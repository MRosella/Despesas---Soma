# CHANGELOG

Histórico versão-a-versão (o número é o `CACHE`/`APP_VERSION`). Mantido fora do `CLAUDE.md` para
não gastar tokens de contexto toda sessão — consulte aqui quando precisar do "porquê" histórico.

## v41–v44 — Módulo Finanças (controle financeiro pessoal, estilo Mobills)
- **Nova tela `#view-financas`** (item "Finanças" no menu) com 4 abas próprias `.ftab`/`.fin-panel`:
  **Resumo** (saldos por conta, fatura do mês por cartão com totais Pessoal × Reembolsável,
  receitas × despesas, gastos por categoria, navegador de mês), **Transações** (lista mensal com
  filtros todas/receitas/despesas/reembolsáveis), **Contas** (CRUD de contas e cartões + painel de
  fatura por competência com filtro e "Registrar pagamento") e **Importar**.
- **Estado novo** (`finContas`/`finCartoes`/`finTx`/`finConfig`/`finArquivo` + lápides
  `tomb.fin*`), sincronizado no dados.json: tabelas via `mergeTable` (LWW por `updatedAt` +
  lápides), `finConfig`/`finArquivo` LWW de perfil. Categorias próprias (≠ reembolso corporativo),
  editáveis em Configurações.
- **Fatura por competência** (`js/fin-core.js`, lógica pura testada em `tests/logic.html`): compra
  até o dia efetivo de fechamento (`min(dia, diasNoMês)` — resolve dia 31 em fevereiro) cai na
  fatura do mês; vencimento no mês seguinte quando `venc <= fechamento`; status
  aberta/fechada/paga; pagamento = tx `contaId`+`pagamentoCartaoId` abatendo a fatura com
  vencimento no mês do pagamento. **Flag `reembolsavel`**: marca gastos de trabalho feitos no
  cartão pessoal — a fatura mostra Pessoal × Reembolsável separados (dor original do usuário).
- **Importação de extrato/fatura**: PDF/imagem via Gemini (`ocrStatement`, cache IndexedDB
  `ocrstmt_<hash>`, limite 15MB, `maxOutputTokens` alto) — a chamada de rede com retry do OCR foi
  extraída para `geminiCall(parts, generationConfig)` em `js/ocr.js` e é compartilhada; CSV/OFX com
  parsers locais (`finParseCsv` heurística de cabeçalho/separador/sinal, `finParseOfx` por blocos
  `STMTTRN`). Tela de revisão: marcar/desmarcar, categoria por linha, reembolsável (destino
  cartão), duplicadas (mesma data+valor+descrição) já vêm desmarcadas.
- **Arquivamento anual** (Configurações): `finArquivarAno` baixa backup .json do ano, guarda
  agregados em `finArquivo` e remove as transações (com lápides) — controla o crescimento do
  dados.json. Excluir conta/cartão oferece excluir as transações vinculadas (nunca deixa órfãs).
- 4 arquivos novos (`js/fin-core/-render/-modal/-import.js`, prefixo `fin` em tudo) registrados em
  `index.html`, `sw.js` ASSETS e nos dois harnesses; ~30 testes novos em `tests/logic.html`.

## v39
- **Sessão do Google Drive permanente (opcional):** novo campo "URL do renovador de sessão
  (Cloudflare Worker)" nas Configurações (`-gdrive-v1.workerUrl`). Quando preenchido, o app troca o
  fluxo antigo (`initTokenClient`, só dura enquanto a sessão do navegador valer) por
  `initCodeClient` + um Worker externo (`cloudflare-worker/drive-token-worker.js`, fora deste
  repo/PWA) que guarda o `client_secret` do Google com segurança e devolve `refresh_token`. Esse
  refresh token não expira por tempo — `gdRefreshAccessToken` renova o access token por rede, sem
  popup, mesmo dias depois de fechar o app. Sem o Worker configurado, o app continua funcionando
  como antes (v34). `-gdtok-v1` ganhou o campo `refresh`.

## v38
- **Período de Prestação (Cartão Santander) agora é escolhido pelo usuário:** dois campos de data
  (`#sant-periodo-inicio`/`#sant-periodo-fim`, `state.santPeriodo.start/end`) substituem o cálculo
  automático no cabeçalho da aba Santander. `santanderPeriodoText` usa as datas escolhidas quando
  preenchidas; sem escolha, cai no cálculo automático antigo (`computeSantanderPeriodo`, mantido
  como fallback). Zera ao fechar a tabela `alelo`; snapshot do histórico guarda o período usado e
  `reopenHistory` restaura. Sincroniza como campo de perfil (`profileUpdatedAt`, last-write-wins).

## v35
- Menu lateral: saudação "Olá, Murilo Rosella" (era "Soma Urbanismo"); rodapé sem "Plane it" (só a
  versão).

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
