# CHANGELOG

Histórico versão-a-versão (o número é o `CACHE`/`APP_VERSION`). Mantido fora do `CLAUDE.md` para
não gastar tokens de contexto toda sessão — consulte aqui quando precisar do "porquê" histórico.

## v60 — Barra de progresso da leitura pela IA + paleta da SA Ambiental em toda a interface
- **Barra de progresso no modal enquanto a IA lê o comprovante** (`ocrProgress` + `OCR_FASES` +
  `ocrStatus`, em `js/ocr.js`; markup `#m-ocr-prog` no `index.html`). Antes só havia um toast
  "Lendo comprovante…" que sumia em segundos: não dava para distinguir **"ainda processando"** de
  **"falhou calado"** — que é exatamente a dúvida relatada.
- **Por que uma barra "falsa"**: o Gemini não devolve progresso incremental. A barra mostra as
  ETAPAS reais (`prep` → `send` → `read` → `parse`, mais `cache` quando o arquivo já foi lido antes)
  e, dentro de cada etapa, escorrega **assintoticamente** em direção a um alvo — nunca chega a 100%
  sozinha, então não promete um progresso que não existe, só prova que ainda está vivo.
- **Retentativas ficam visíveis**: `geminiCall` ganhou um 3º parâmetro opcional `onStatus`, e a
  cada nova tentativa a barra escreve "A IA está instável — tentativa N de 4…". `ocrReceipt` e
  `ocrReceiptRaw` repassam o callback; como é **opcional**, a varredura do Drive continua usando o
  overlay `scanProgress` sem mudança.
- **Estado de erro persistente**: falha (ou leitura sem data nem valor) pinta a barra de vermelho,
  mostra a mensagem real do Gemini e um botão **"Tentar de novo"** (`#m-ocr-retry` → `runReceiptOcr`)
  que fica na tela até o usuário agir — em vez de um toast que evapora. O vermelho do erro é
  proposital e **não** segue a cor do módulo: erro é erro em qualquer empresa.
- A barra já aparece na **compressão da imagem**, antes da chamada da IA, porque a espera começa ali.
- **Paleta do módulo aplicada à interface inteira.** `applyModuleAccent` agora também define
  `--mod-tint` / `--mod-tint-ink` / `--mod-soft` e atualiza a `<meta name="theme-color">`. No
  `styles.css`, os pontos que eram **vermelho da marca** passaram a `var(--mod-accent, var(--red))`:
  `.card-head`, `.add-btn` (borda/texto/toque), `.nav-item.active`, `.empty-ic`, `.btn-pdf`,
  `.gd-folder-row a`, `accent-color` das caixas de exportação, `.scan-spinner`, e os chips de
  categoria (`.cat-tag` / `.cat-chip`).
- **O que continua vermelho de propósito**: tudo que é **semântico**, não marca — `.qbtn.danger`,
  `.hist-btn.danger`, `.btn-danger-text`, `.entry.over-limit`, `.sync-status.err`, `.scan-log li.err`,
  o aviso de offline e a tela de bloqueio (que é anterior à escolha do módulo).
- **Verdes agora amostrados do `assets/sa-logo.png`** em vez do verde genérico do Material:
  folha `#407830` (accent), escuro `#2c5a21`, oliva `#789838`. Vale para o app, o PDF
  (`mod.pdf`) e as cores dentro do `.xlsx` (`mod.excelColors`). O vinho `#600810` da "mão" do logo
  ficou de fora da UI para não reintroduzir vermelho.
- **`.btn-pdf` virou gradiente** para não se confundir com o `.btn-excel` (verde fixo do Excel)
  quando o módulo ativo também é verde.
- Registry: cada módulo declara `tint` / `tintInk` / `soft`. Os testes cobrem isso —
  `tests/logic.html` exige os 5 hex de paleta em **todos** os módulos e confere que a SA é verde;
  `tests/xlsx.html` deixou de fixar o hex e passou a derivá-lo de `MOD.sagestao.excelColors`;
  `tests/integrity.html` ganhou checagem de `const` de topo (`ocrProgress`, `OCR_FASES`, …), que
  não vão para `window` e por isso escapavam do harness.


## v58 — Escolher a pasta de cada relatório no Drive (Google Picker)
- **Botão "Escolher pasta" por relatório** (`chooseDriveFolder`): abre o **Google Picker** e o
  relatório passa a gravar os comprovantes dentro da pasta escolhida (subpastas `Ano/Mês` são
  criadas lá dentro). Resolve o pedido de ter a pasta da SA Ambiental num **local diferente** das
  pastas da Soma, em vez de todas nascerem na raiz do Drive.
- **Por que o Picker e não ampliar a permissão**: o escopo `drive.file` só dá acesso ao que o app
  cria — mas escolher uma pasta no Picker "abre" essa pasta para o app, que passa a poder gravar
  nela. É o mecanismo desenhado pelo Google exatamente para isso, e mantém o app **sem** acesso ao
  resto do Drive (o que aconteceria com o escopo `drive` completo).
- **Duas credenciais novas** nas Configurações (`#gd-apikey`, `#gd-appid`), no mesmo projeto do
  Client ID e com a **Google Picker API** ativada; ficam só no aparelho, como as demais.
  `gdLoadPicker` carrega `apis.google.com/js/api.js` sob demanda, no mesmo padrão do `gdLoadGis`.
- A escolha grava em `state.driveFolders[key]`, que **já era sincronizado** entre aparelhos — o
  outro dispositivo passa a gravar na mesma pasta sem reconfigurar.

## v57 — Pastas dos relatórios no Drive sob demanda
- **Card "Pastas dos relatórios"** em Configurações → Comprovantes (Google Drive): lista a raiz de
  cada módulo com a cor da empresa e um **link direto** para ela no Drive, ou "ainda não criada".
- **Botão "Criar as pastas agora"** (`ensureAllDriveFolders`): cria/localiza a raiz de todos os
  módulos **sem precisar lançar uma despesa antes**. Resolve o problema prático de só conseguir
  posicionar a pasta no Drive depois do primeiro comprovante — agora dá para criar, abrir e
  **arrastar cada pasta para o lugar desejado** de uma vez. Como o app guarda o **ID** da pasta
  (sincronizado entre aparelhos), mover ou renomear no Drive não interrompe os envios.
- `setDriveFolder` re-renderiza a lista quando uma pasta nasce durante um upload.

## v56 — Terceiro relatório (SA Ambiental) + generalização para N módulos
- **Registry de módulos (`js/modules.js`, novo)**: um array `MODULOS` descreve cada relatório
  (rótulo, empresa, logo, cores do app/PDF/Excel, pasta raiz no Drive, template + layout, campos do
  lançamento, campos obrigatórios, grupo de exportação). `MOD`/`TABELAS`/`TABELA_PADRAO` derivam
  dele. **Todo** `['reembolso','alelo']` e `tabela === 'alelo'` espalhado pelo app (eram ~45 pontos)
  virou loop/consulta ao registry. Carrega **antes** de `core.js`.
- **Novo módulo `sagestao` — SA Gestão de Serviços Especializados S/A** (rótulo *SA Ambiental*):
  terceira aba na tela de Lançamentos e no histórico, pasta própria no Drive
  (`Comprovantes - SA Ambiental`), prefixo próprio de arquivo (`Relatorio_Despesas_SA_…`) e
  identidade visual verde (`#2E7D32`/`#1B5E20`) tirada do logo. Mesmos campos do relatório da Soma.
- **Cabeçalho e Dados Bancários agora são POR MÓDULO** (`state.perfis[key]`): cada empresa tem seu
  Funcionário/Data da Solicitação/Referente/conta bancária, e o cartão guarda ali o Período de
  Prestação. `docForModule(D, key)` achata o perfil na raiz do documento, o que mantém
  `buildXlsx`/`buildPrint`/`fileBaseOf` inalterados e faz os **snapshots antigos do histórico
  continuarem funcionando**. Migração automática do estado antigo (raiz → `perfis.reembolso`, e o
  período → `perfis.alelo`); `currentDoc`/`mergeDocs` ainda escrevem os campos legados na raiz para
  não quebrar um aparelho em versão anterior.
- **Excel com uma tabela só**: a SA usa o **mesmo `template.xlsx`** com o 2º bloco (Cartão
  Santander) removido em tempo de geração por `removeRows(18, 11)` — apaga linhas, merges,
  validações e formas contidas no intervalo e sobe o resto. O logo do cabeçalho
  (`xl/media/image3.png`) é redesenhado com o logo da empresa **na dimensão original** (letterbox,
  sem distorcer) e as cores da marca são trocadas em `styles.xml`/`theme1.xml`/`drawing1.xml`.
- **`resolveExport(sections)`** substitui a heurística binária "só alelo → Santander", que não
  escalava para três módulos: escolhe o módulo cujos `blocos` cobrem a seleção, preferindo o de
  menos blocos, e **recusa misturar empresas diferentes** no mesmo arquivo. O seletor de exportação
  passou a ser gerado de `MODULOS`, marca o grupo da aba ativa e mostra qual formato vai sair.
- **PDF por módulo**: `buildPrint`/`buildPrestacaoPrint`/`generatePdfBlob` recebem o módulo em vez
  do booleano `santander`; a paleta do `#print-root` virou variáveis CSS (`--p-accent`, `--p-ink`,
  `--p-paper`, …) definidas por `applyPrintTheme(mod)`. O rótulo do subtotal passou a ser um
  parâmetro — antes era decidido comparando a **string do título**, o que jogaria a SA no rótulo do
  Santander.
- **Qualidade de vida**: a aba ativa troca a cor de destaque, o logo e o subtítulo do cabeçalho;
  cada aba mostra um badge `n · total`; a barra de abas rola na horizontal; o diálogo de fechar mês
  tem um botão por módulo na cor dele; duplicar/repetir lançamento agora **copia os campos próprios
  do módulo** (antes `estabelecimento`/`justificativa` se perdiam).
- **Robustez**: `gdEnsureFolder` com chave desconhecida agora lança erro em vez de gravar
  silenciosamente na pasta do reembolso; `isGeneratedArtifact` deriva os prefixos de `MODULOS`
  (módulo novo não precisa de regex nova); a instalação do Service Worker deixou de ser "tudo ou
  nada" — um asset ausente não derruba mais o precache inteiro.
- **Testes**: `tests/xlsx.html` (novo) gera os `.xlsx` de verdade e confere linhas, fórmulas,
  merges e validações das quatro variantes — é o que pega um arquivo que abriria com aviso de
  "reparo" no Excel. `tests/logic.html` ganhou casos de registry, `docForModule`, `resolveExport`,
  `fileBaseOf`/`isGeneratedArtifact`, validação por módulo e migração de estado legado.

## v55 — Relatórios divididos por tipo + remoção do módulo Finanças
- **Relatórios mensais divididos por tipo**: a tela de Relatórios mensais agora tem abas
  **Reembolso × Cartão Santander** (classes próprias `.htab`/`.hist-panel`, aba lembrada em
  `-histtab-v1`). `renderReports` passou a chamar `renderReportsPanel(tab, treeId, emptyId)` por
  aba; `histBelongsTo(h, tab)` decide onde cada snapshot aparece (por `h.table`; snapshots legados
  sem `table` entram na aba de cada tabela em que têm lançamentos). Contagem/total por aba usam só
  os dados daquela tabela.
- **Módulo Finanças removido**: a pedido do usuário (não seria usado). Apagados `js/fin-core.js`,
  `js/fin-render.js`, `js/fin-modal.js`, `js/fin-import.js` e todo o HTML/CSS da tela `#view-financas`,
  seus modais e os cards de Finanças em Configurações. Removidos do estado (`finContas`/`finCartoes`/
  `finTx`/`finConfig`/`finArquivo` + lápides), do `sync.js` (`currentDoc`/`applyDoc`/`mergeDocs`),
  do `core.js` (categorias/ícones/`normalizeFinConfig`) e do `init`/nav. Dados financeiros antigos no
  repo privado de sync são simplesmente ignorados no próximo merge. Harnesses de teste atualizados.
  Cache v54→v55.

## v53 — Finanças: estornos, pagamento de fatura ignorado, limite do cartão e busca
- **Pagamento da fatura anterior ignorado na importação**: `finEhPagamentoFatura` reconhece pela
  descrição (pagamento/pgto/pagto/débito em conta) os créditos que são quitação da fatura passada e,
  ao importar um cartão, `finMarcarPagamentosEstornos` os desmarca por padrão (rótulo "pagamento —
  ignorado") — o pagamento é modelado à parte (`pagamentoCartaoId`), não deve virar receita solta.
- **Estornos riscados e fora da soma**: na mesma função, cada crédito restante é casado com a compra
  (débito) de mesmo valor na leva e os dois recebem `estornado:true`. Transação estornada aparece
  **riscada** (lista, fatura e revisão) e sai da soma da fatura (`finFaturasDoCartao` acumula em
  `totalEstornado`), do saldo da conta (`finSaldoConta`), do resumo do mês (`finResumoMes`) e do
  arquivamento anual. Checkbox manual "⊘ Estornado" no modal de transação (`fm-estornado`).
- **Limite do cartão**: `finLimiteCartao` calcula usado × disponível (soma do que falta pagar nas
  faturas não quitadas); barra de progresso no card do cartão (Resumo) e na fatura (vermelha ≥90%).
- **Busca de transações**: campo de busca por descrição/categoria na aba Transações (`fin-tx-search`).
- **Fatura**: créditos agora aparecem com sinal "−" (abatem a fatura) e % por categoria no resumo do
  dashboard. Testes novos em `tests/logic.html`. Cache v52→v53.

## v47 — Finanças: corrige categorização/cruzamento de reembolso na importação
- **Categoria da IA não batia por acento/maiúscula**: `ocrStatementRaw` comparava `category` da IA
  com a lista de categorias por igualdade EXATA de string — qualquer diferença de acento, caixa ou
  espaço (ex. IA responde "alimentação" e a lista tem "Alimentação") zerava a categoria. Agora usa
  `finNormDesc` (mesma normalização do dedupe) pra achar a categoria correspondente e gravar o nome
  **canônico** da lista.
- **Cruzamento com reembolso não via meses já fechados**: `finMatchReembolsaveis` só olhava
  `state.reembolso` (tabela aberta) — se o relatório de reembolso daquele mês já tinha sido
  fechado/arquivado (`closeTable`), os lançamentos foram para `state.history[].reembolso` e ficavam
  invisíveis pro cruzamento. Novo getter `finReembolsoPool()` (`js/fin-core.js`) soma os abertos com
  os arquivados; `onFinImportFile` passa a usar esse pool. Teste novo em `tests/logic.html`. Cache
  v46→v47.

## v46 — Finanças: importação inteligente (reembolso + categoria + parcelas) e fatura multi-mês
- **Cruzamento com o reembolso**: ao importar extrato/fatura num cartão, `finMatchReembolsaveis`
  (em `js/fin-core.js`) casa cada despesa com um lançamento de `state.reembolso` por **mesmos
  centavos + data dentro de ±5 dias** e **pré-marca** a linha como reembolsável na revisão (o
  usuário confere/desmarca). Selo "casado" na tela de revisão.
- **Categorização pela IA**: `ocrStatementRaw` (`js/fin-import.js`) agora manda a lista de
  categorias do módulo no prompt e recebe `category` por transação (validada contra a lista; se não
  bater, fica vazia). CSV/OFX seguem sem categoria (parsers locais inalterados).
- **Parcelamento automático**: a IA detecta parcela (`installmentCurrent`/`installmentTotal`;
  reconhece "PARC 02/12", "2/12", "2 de 12"). Ao confirmar a importação, cada linha parcelada gera
  as **parcelas futuras reais** (`finParcelasFuturas`: uma finTx por mês seguinte, mesmo valor,
  `parcela.grupo` compartilhado). Dedupe por `finParcelaJaExiste` — reimportar a fatura do mês
  seguinte (que mostra a mesma série) não duplica. Excluir uma parcela oferece apagar o grupo todo
  (em `deleteFinTx`/`quickDeleteFinTx`). Campo novo em finTx: `parcela:{atual,total,grupo,base}`.
- **Fatura multi-mês**: nova tira de chips (`#fin-fat-strip`/`renderFinFatStrip`, dados por
  `finFaturaMeses`) acima da fatura aberta — total projetado de cada mês, da competência corrente
  até a última com transação (cobre as parcelas futuras), destacando meses com parcela; clicar num
  chip troca a competência aberta. Mantém a navegação ‹ › e o detalhe.
- Helper `finNormDesc` extraído de `finDedupKey` (normalização compartilhada). Testes novos em
  `tests/logic.html`/`integrity.html`. Cache v45→v46.

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
