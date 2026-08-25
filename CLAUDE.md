# CLAUDE.md — Guia do projeto (leitura otimizada)

> Objetivo: poupar tokens. A lógica foi dividida em **`js/*.js`** por área (cada arquivo é pequeno,
> ~90–680 linhas — **pode ler o arquivo inteiro**). Para achar algo: **Grep pelo nome da função**
> → abra o `js/` correspondente. **Não use números de linha** em referências (envelhecem a cada
> commit); navegue por nome de função. Histórico versão-a-versão: ver `CHANGELOG.md`.

## O que é
PWA de **lançamentos de despesas** da **Soma Urbanismo S/A**. Vanilla JS, **sem build, sem
Node/npm** (Windows 11, PowerShell). Gera Excel idêntico ao `template.xlsx` + PDF. GitHub Pages:
https://mrosella.github.io/Despesas---Soma/

## Arquivos
| Arquivo | Conteúdo |
|---|---|
| `js/modules.js` | **REGISTRY dos módulos** (`MODULOS`/`MOD`/`TABELAS`/`TABELA_PADRAO`): rótulo, empresa, logo, cores (app + PDF + Excel), pasta raiz no Drive, template/layout, campos e obrigatórios de cada relatório. Helpers `modOf`/`mapPorTabela`/`perfilVazio`/`normalizePerfil`/`perfilDe`/**`docForModule`**/`modulosSelecionados`. **Carrega ANTES de core.js.** |
| `js/core.js` | chaves localStorage + `APP_VERSION` (bump!), categorias/config (`getCatConfig`…), estado (`emptyState`/`loadState`/`saveState`/`touchDoc`/`touchProfile`, `let state`), utils (`parseMoney`/`formatMoney`/`todayISO`/`fmtDateBR`/`dateToSerial`/`uid`/`toast`/`sumOf`), ícones |
| `js/render.js` | `render`, `renderList` (mais recente no topo), histórico dividido por tipo (`renderReports`/`renderReportsPanel(tab,treeId,emptyId)`/`histBelongsTo`/`reopenHistory`/`deleteHistory`/`monthLabelFor`/`santanderPeriodoText`/`computeSantanderPeriodo`/`yearOf`), `renderCatSummary(tabela,boxId)` (resumo POR relatório), `limitExcedido`, `quickDelete`/`quickDuplicate`, `escapeHtml`, `hydrateThumbs` |
| `js/modal.js` | modal (`openModal`/`saveEntry`/`deleteEntry`/`repeatLast`), `toggleCartaoFields`, foto+OCR hook (`renderModalPhoto`/`onPhotoSelected`/`applyModalPhoto`), máscaras, `updateCatHint` |
| `js/excel.js` | `sheetTools` (helpers XML compartilhados, inclui **`removeRows`**), `buildXlsx(src,mod)` (1 ou 2 blocos), `buildPrestacaoXlsx(src,mod)`, `buildXlsxFor`, `applyBrandToXlsx`/`recolorHex`/`logoBytesFor` (logo+cores por módulo dentro do .xlsx), `fileBaseOf`, `filteredDoc`, `validateBeforeExport`, **`resolveExport`**, `docParaExport`, `exportExcel`, chooser de export |
| `js/pdf.js` | `applyPrintTheme` (paleta do módulo), `buildPrint(src,sections,mod)`, `buildPrestacaoPrint(src,mod)`, `buildPrintTable`, `buildSignatureBlock`, `exportPDF`, `generatePdfBlob(src,sections,mod,anexos)` (multipágina por linha), `shareOrDownload`/`downloadBlob` |
| `js/sync.js` | sync GitHub privado (`ghGetFile`/`ghPutFile`, `currentDoc`/`applyDoc`/`mergeDocs`, `syncNow`, `setupSyncUI`) |
| `js/lock.js` | bloqueio bio/PIN (`enableBio`/`unlockBio`/`setPin`/`showLock`) + backup (`exportBackup`/`importBackupFile`/`setupBackupUI`) |
| `js/ui.js` | navegação (`showView`/`setupNav`), **abas dos relatórios** da Home (`setupReportTabs`/`showReportTab`, lembra em `-tab-v1`), **abas do histórico** por tipo (`setupHistTabs`/`showHistTab`, lembra em `-histtab-v1`), `populateCategorySelects`, editor de categorias (`renderCatEditor`/`saveCatEditor`/`setupCatUI`) |
| `js/ocr.js` | Gemini (`AI_KEY`, `GEMINI_MODEL`, **`geminiCall(parts,generationConfig)`** = chamada genérica com retry/backoff, `ocrReceipt` = wrapper com **cache por hash**, `ocrReceiptRaw`, `blobSha256`, `fillFromOcr`, `runReceiptOcr`, `receiptFileName`, `setupAiUI`) |
| `js/idb.js` | IndexedDB (`idb`/`idbPut`/`idbGet`/`idbDel`), `compressImage`, `blobToDataUrl`, `saveThumb`, `getPhotoBlob` (camada de storage local) |
| `js/drive-core.js` | Drive: auth/token (`gdGetToken`, `GD_SCOPE`), pastas/upload (`gdEnsureFolder`/`gdEnsureMonthFolder`/`gdUpload`), exclusão+fila (`gdDeleteFile`/`flushGdDeletions`/`purgeEntryPhoto`), flush de pendentes, `setupGDriveUI`, conexão (`gdConnectFlow`/`maybePromptDrive`) |
| `js/drive-scan.js` | Varredura (`scanDriveForReceipts`/`gdListReceipts`/`knownDriveIds`), overlay `scanProgress` (`open(title,icon)`/`status`/`log`/`done`/`close`), pendentes (`renderPending`/`openPendingEntry`/`dismissPending`/`retryPendingOcr`) |
| `js/main.js` | tema, `bindField`, **fechamento por tabela** (`closeMonthFlow`/`closeTable`/`archiveMonthToDrive`/`chooseCloseTable`), `copyBankData`, `init` (registra todos os `setup*`), SW, conectividade — **carregado por último** |
| `index.html` | 3 telas (`#view-lancamentos/-relatorios/-config`); a de Lançamentos tem **uma aba por módulo** (`#tab-{key}`, `.report-panel`) + seletor `.rtab`; a de Relatórios mensais tem **abas por tipo** (`#hist-tab-{key}`, `.hist-panel`) + seletor `.htab`; carrega `lib/*` e depois `js/*` na ordem (**`js/modules.js` primeiro**). |
| `styles.css` | tema claro/escuro via variáveis. Reusar `.card/.field/.sync-status/.cat-row/.offline-notice`. |
| `sw.js` | SW network-first; `CACHE` na **linha 4** + lista `ASSETS` (inclui **cada** `js/*.js`). |
| `template.xlsx`, `template-santander.xlsx` | modelos Excel (não editar à mão). O `template.xlsx` serve aos **dois** módulos de reembolso: a SA Ambiental usa o mesmo arquivo com o 2º bloco removido, logo trocado (`xl/media/image3.png`) e cores recoloridas em tempo de geração. |
| `assets/` | `soma-logo.png` (Soma) e `sa-logo.png` (SA Ambiental) — referenciados por `MODULOS[].logo`. |
| `lib/` | fflate, html2canvas, jspdf (offline, já cacheados). |
| `cloudflare-worker/drive-token-worker.js` | **fora do PWA** (não carregado pelo app/SW): Worker opcional que guarda o `client_secret` do Google e faz `/exchange`+`/refresh` p/ manter a sessão do Drive permanente (ver seção própria abaixo). |

## Regras de ouro (OBRIGATÓRIO)
1. **Auto-publicar após qualquer mudança**, sem perguntar: bump de cache + commit + push.
2. **Bump de cache em DOIS lugares que batem:** `APP_VERSION` em `js/core.js` e `CACHE` em `sw.js`
   (ex.: `v30`→`v31`). Sem isso o PWA fica preso na versão antiga.
3. **Scripts clássicos, escopo global compartilhado:** todos os `js/*.js` dividem o mesmo escopo de
   topo. Cada identificador `const/let/function` aparece **uma só vez** entre eles (redeclarar =
   `SyntaxError` que pula o arquivo inteiro). Só `core.js` executa no topo (`loadState()`), por isso
   carrega primeiro; o resto são funções (hoisted) e `init` roda no `DOMContentLoaded`. **Novo
   arquivo `js/` → registrar em `index.html` E em `sw.js` ASSETS, na ordem.**
4. **Sem segredos no repo (público).** Token GitHub, Client ID do Drive e chave Gemini só no
   `localStorage` do aparelho. Dados financeiros sincronizam por um **repo PRIVADO separado**
   (`dados.json`), nunca neste repo.
5. **Sem dependências novas / sem passo de build.** Tudo client-side.

## Forma do estado (`emptyState` em `js/core.js`)
Tudo que é "por relatório" é indexado pela **chave do módulo** (`TABELAS` = `reembolso`,
`alelo`, `sagestao`) — nunca escreva as chaves à mão; use `TABELAS`/`mapPorTabela`.
```
{ perfis:{ [key]: { funcionario, dataSolicitacao, referente,   // cabeçalho POR módulo
                    bank:{nome,cpf,banco,agencia,conta,pix},   // conta bancária POR módulo
                    santPeriodo:{start,end} } },               // só nos módulos com periodo:true
  reportMonths:{ [key]: 'YYYY-MM' },   // pasta dos comprovantes no Drive; vazio = por data do lançamento
  reembolso:[], alelo:[], sagestao:[], // lançamentos, um array por módulo. entry.foto = {id|pending, name, w, h}
  history:[], histTomb:{},           // meses arquivados (snapshot marca `table:<key>`) + lápides
  driveFolderId,                     // (legado) raiz única; migra p/ driveFolders.reembolso
  driveFolders:{ [key]: id },        // RAÍZES SEPARADAS no Drive, uma por módulo
  pending:[], driveKnown:{}, driveDismissed:{},  // varredura do Drive: pendentes p/ revisar; ids já vistos; ids descartados
  config:{ categorias:[{nome,limite,grupo}] },  // ÚNICA e global (compartilhada pelos 3 módulos)
  tomb:{ [key]: {} },                // lápides de deleção (id->updatedAt)
  meta:{updatedAt, profileUpdatedAt} }
```
**`docForModule(D, key)`** (js/modules.js) achata `perfis[key]` na raiz do documento — é assim
que `buildXlsx`/`buildPrint`/`fileBaseOf` seguem lendo `D.funcionario`/`D.bank` sem conhecer
módulos, e é por isso que **snapshots antigos do histórico** (que já têm esses campos na raiz)
continuam funcionando sem conversão.

Merge de sync: `meta.updatedAt` p/ as tabelas (loop `TABELAS` → `mergeTable`);
`profileUpdatedAt` (last-write-wins, doc inteiro) p/ **`perfis`**/`config`/`driveFolders`/
`reportMonths`. `currentDoc`/`mergeDocs` ainda ESCREVEM os campos legados na raiz
(`funcionario`/`bank`/`santPeriodo`, vindos do perfil de reembolso) p/ um aparelho em versão
antiga continuar enxergando; `perfisFromDoc` (js/sync.js) migra na leitura.
Lápides propagam deleções. `pending` = união por `fileId` **menos** os já virados lançamento
(`foto.id`) ou descartados; `driveKnown`/`driveDismissed` = união (evita reprocessar/ressuscitar).

## Chaves de localStorage
`despesas-soma-v1` (estado) · `-sync-v1` (GitHub) · `-gdrive-v1` (Drive config: `clientId`,
`folderId` legado, `workerUrl` do renovador, `apiKey` + `appId` do **Picker**, `folderNames`
= nomes das pastas escolhidas, só p/ exibir) · `-gdtok-v1` (token OAuth do Drive, LOCAL, persiste
entre aberturas; inclui `refresh` quando o renovador está configurado) · `-gddel-v1` (fila de
exclusões) · `-ai-v1` (Gemini) · `-lock-v1` (bio/PIN) · `-theme-v1` · `-lastsync-v1` · `-dirty-v1` ·
`-tab-v1` (aba ativa da Home) · `-histtab-v1` (aba ativa dos Relatórios mensais).

## Verificação (esta máquina — sem Node/python; preview MCP trava)
Chrome em `C:\Program Files\Google\Chrome\Application\chrome.exe` com `--headless=new
--allow-file-access-from-files --virtual-time-budget=4000 --dump-dom` num harness `.html`
temporário (caminho Windows absoluto; em Git Bash `"$(pwd -W)/x.html"`). Grep é por linha → no
harness escreva 1 resultado por linha (não cruze `<` ). **Há dois harnesses FIXOS no repo** (não
recrie a cada sessão; scripts **clássicos** carregam de `file://` — por isso não usamos ES modules):
- **`tests/integrity.html`** — inclui todos os `js/*.js` na ordem e checa `typeof <fn> ===
  'function'` p/ uma função de cada arquivo (um `SyntaxError`/redeclaração pula o arquivo todo → a
  função some) + captura `window.onerror`. Pega quebras do split. Imprime `RESULT: PASS/FAIL`.
- **`tests/logic.html`** — funções puras com fixtures: `computeSantanderPeriodo`,
  `validateBeforeExport` (regras por módulo), `mergeDocs`/`mergeTable` last-write-wins + lápides,
  `histBelongsTo`, **`docForModule`**, **`resolveExport`**, `fileBaseOf`/`isGeneratedArtifact`,
  `filteredDoc` e a **migração de estado legado** (raiz → `perfis`). `RESULT: PASS/FAIL`.
- **`tests/xlsx.html`** — gera os `.xlsx` DE VERDADE (2 blocos, 1 bloco com `removeRows`, os dois
  com expansão de linhas, e a Prestação de Contas), descompacta e confere linhas, fórmulas,
  `mergeCells` (contagem + refs válidas) e `dataValidation`. É o teste que pega um arquivo que
  abriria com aviso de **"reparo"** no Excel. `RESULT: PASS/FAIL`.
- Rodar (em Git Bash): `"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new
  --allow-file-access-from-files --virtual-time-budget=8000 --dump-dom "$(pwd -W)/tests/logic.html"
  | grep -oE 'RESULT:[^<]*'` (idem `integrity.html` e `xlsx.html`). Ao adicionar função/arquivo,
  **atualize esses harnesses**.
- **OAuth/câmera/OCR/IndexedDB/PDF/Drive NÃO rodam headless** → validar no **site (HTTPS)** no
  dispositivo.

## Pontos de atenção (fatos de arquitetura)
- **TRÊS módulos** (`js/modules.js`): `reembolso` (Soma Urbanismo S/A), `alelo` (Cartão Santander
  da Soma — chave estrutural histórica, **não renomear**) e `sagestao` (SA Gestão de Serviços
  Especializados S/A, rótulo **SA Ambiental**). Um 4º = **uma entrada no registry** + copiar um
  bloco de painel no `index.html` (os ids seguem `-{key}`) + a aba do histórico + `sw.js`.
- **Home em ABAS por relatório** (`setupReportTabs`): painéis `#tab-{key}` (`.report-panel.active`),
  seletor `.rtab` (rolável na horizontal, com **badge** `n · total` em `#rtab-badge-{key}`).
  `showReportTab` guarda a aba em `activeReportTab` e chama **`applyModuleAccent`**: troca
  `--mod-accent`/`--mod-accent-dark` no `<html>` + o **logo e o subtítulo do cabeçalho** para os da
  empresa (com fallback p/ o logo da Soma se o arquivo faltar). Itens **globais** ficam acima das
  abas: card de pendentes do Drive e o botão `#gd-scan-main` (varre **todas** as raízes). Cada aba
  tem cabeçalho próprio, sua tabela, seu resumo (`#cat-summary-{key}`) e seu total
  (`#sum-{key}`/`#tot-{key}`).
- **Cabeçalho e Dados Bancários são POR MÓDULO** (`state.perfis[key]`, ids `#funcionario-{key}`,
  `#dataSolicitacao-{key}`, `#referente-{key}`, `#bk-{campo}-{key}`, `#bank-card-{key}`,
  `#reportMonth-{key}`) — cada empresa tem sua conta e sua data de solicitação. Os binds em `init`
  são um loop sobre `MODULOS` (`mod.header === 'reembolso'` / `mod.bank` / `mod.periodo` decidem
  quais campos existem). **Cabeçalho Prestação** (`header:'prestacao'`, hoje só o cartão):
  Nome/Cargo **fixos** vindos de `mod.assinante`/`mod.assinanteCargo` (read-only,
  `#sant-nome-{key}`/`#sant-cargo-{key}`), **Período escolhido pelo usuário**
  (`#sant-periodo-inicio-{key}`/`-fim-{key}` → `perfis[key].santPeriodo`), Data de Entrega
  automática (`#sant-entrega-{key}`). `santanderPeriodoText(D, key)` usa as datas escolhidas; sem
  escolha, cai em `computeSantanderPeriodo(D, key)` (fallback). **Mês de referência é por
  relatório** (`state.reportMonths[tabela]`, `reportFolderDateISO(tabela)`); zera só ao fechar
  aquele relatório.
- `#m-categoria` é **populado por JS** (`populateCategorySelects`, no `init`) a partir de
  `getCategorias()` — não criar `<option>` fixos. Rótulo da 2ª tabela: "Despesas Cartão Santander".
- **UMA raiz no Drive POR MÓDULO** (`gdEnsureFolder(tabela)` → `modOf(tabela).driveRoot`):
  `Comprovantes - Despesas Soma` (reembolso, nome legado), `Comprovantes Cartao Santander -
  Despesas Soma` (`alelo`) e `Comprovantes - SA Ambiental` (`sagestao`).
  `state.driveFolders[key]` guarda o id (sincronizado; `driveFolderId` legado migra p/ reembolso).
  Chave desconhecida agora **lança erro** em vez de cair silenciosamente na pasta do reembolso.
  O app guarda o **ID** da pasta, nunca o caminho: mover/renomear a pasta no Drive não quebra nada.
  Configurações → Drive tem o card **"Pastas dos relatórios"** (`renderDriveFolders`): uma linha
  por módulo com o nome da pasta em uso, link para abri-la, botão **"Escolher pasta"** e o botão
  **"Criar as pastas que faltam"** (`ensureAllDriveFolders`, cria as raízes sem precisar lançar
  despesa).
- **Escolher uma pasta QUE JÁ EXISTE no Drive** (`chooseDriveFolder` → `gdPickFolder`): usa o
  **Google Picker** — o caminho oficial para o escopo `drive.file` ganhar acesso de escrita a uma
  pasta que o app não criou (escolher no Picker "abre" a pasta para o app). **Não** ampliamos o
  escopo para `drive` (Drive inteiro). O Picker exige, no MESMO projeto do Client ID, uma
  **API Key** e o **número do projeto** (`appId`), guardados em `-gdrive-v1` (campos `#gd-apikey`
  e `#gd-appid`) e com a **Google Picker API** ativada. `gdLoadPicker` carrega
  `https://apis.google.com/js/api.js` sob demanda (mesmo padrão de `gdLoadGis`); offline falha com
  mensagem. A escolha grava o id em `state.driveFolders[key]` (sincronizado) via `setDriveFolder`,
  então `gdEnsureFolder` para de criar pasta por nome para aquele módulo.
  `gdUpload(blob,name,dateISO,tabela)`/`gdEnsureMonthFolder(dateISO,tabela)` recebem a tabela.
- **Comprovantes vão p/ subpastas `{Ano}/{Mês}`** dentro da raiz **da tabela** (resolvidas por
  nome, idempotente). O mês é o **`reportMonth`** (campo "Mês de referência", `reportFolderDateISO`)
  — todo o relatório cai na MESMA pasta; vazio → pasta da **data do lançamento**.
- **Excluir lançamento apaga o comprovante no Drive** — em `deleteEntry` (modal) **e**
  `quickDelete` (lista), via `purgeEntryPhoto`. Conectado → `gdDeleteFile`; senão fila `-gddel-v1`
  → `flushGdDeletions` ao reconectar. Limpa `thumb_<id>` e o pendente `p_<id>`.
- **Importar arquivo (imagem OU PDF)** no modal além de "Tirar foto". `onPhotoSelected` detecta PDF
  (`modalPhoto.kind='pdf'`, sem compressão/miniatura); `ocrReceipt(blob,mime)` manda imagem ou PDF.
  Nome sem leitura da IA = `NF {DD.MM.AAAA}` (`receiptFileName`/`ddmmaaaa`).
- **Qual formato sai na exportação: `resolveExport(sections)`** (js/excel.js) — substitui a antiga
  heurística binária "só alelo → santander", que não escalava. Regra: procura o módulo cujos
  `blocos` contêm TODAS as seções marcadas e escolhe o de **menos blocos**. Assim: só cartão →
  Prestação de Contas; só reembolso → relatório da Soma com o bloco do cartão vazio; reembolso +
  cartão → relatório combinado; só SA → relatório da SA. Seções de **empresas diferentes**
  (`grupoExport` distinto) → recusa com aviso. O chooser (`openExportChooser`) é **gerado de
  `MODULOS`**, marca por padrão o grupo da aba ativa e desmarca automaticamente módulos de outro
  grupo. Layout: `mod.layout` (`'reembolso'` → `buildXlsx`+`buildPrint` retrato; `'prestacao'` →
  `buildPrestacaoXlsx`+`buildPrestacaoPrint` paisagem).
- **Formato Prestação de Contas** (`buildPrestacaoXlsx`/`buildPrestacaoPrint`, asset
  `template-santander.xlsx`, módulos com `layout:'prestacao'`): Excel E4=Nome, E5=Cargo (de
  `mod.assinante`/`mod.assinanteCargo`), **E6=Período** (`santanderPeriodoText(D,key)`),
  **E7=Data de Entrega = data de geração** (`todayISO`), E8/J=Total; tabela linhas 17.. (total na
  35, expande se >18). Colunas: B=DATA, **C:F=ESTABELECIMENTO**, G:I=DESCRIÇÃO, J=VALOR,
  **K=JUSTIFICATIVA**. PDF = réplica visual (barra `mod.pdf.accent` + logo, total cinza) em paisagem.
- **Uma tabela só no `template.xlsx`** (`mod.blocos.length === 1`, caso da SA Ambiental):
  `buildXlsx` chama **`removeRows(18, 11)`** — apaga título + cabeçalho + 7 linhas de dados +
  subtotal do 2º bloco (e a linha em branco 28), descartando merges/`dataValidation` inteiramente
  contidos e as **formas do desenho que começam** no intervalo; depois `shiftRows(29, -11)` sobe o
  resto. Posições passam de `{total:29, banco:33, dim:41}` para `{total:18, banco:22, dim:30}` e o
  total vira `=E{subtotal}` em vez de `=E16+E27`. Coberto por `tests/xlsx.html`.
- **Logo e cores dentro do .xlsx por módulo** (`applyBrandToXlsx`): `mod.excelColors` mapeia
  hex→hex e é aplicado em `xl/styles.xml` + `xl/theme/theme1.xml` (formato `rgb="FFxxxxxx"`) e
  `xl/drawings/drawing1.xml` (`val="xxxxxx"`); `mod.excelLogo` substitui `xl/media/image3.png`
  pelo `mod.logo`, redesenhado por `logoBytesFor` **na mesma dimensão do original** (letterbox,
  preserva a proporção). Falha ao carregar o logo é tolerada (mantém o do modelo).
- **Paleta do PDF por módulo**: `applyPrintTheme(mod)` escreve `--p-accent`/`--p-accent-dark`/
  `--p-accent-mid`/`--p-accent-deep`/`--p-ink`/`--p-ink-soft`/`--p-paper`/`--p-subtotal` no
  `#print-root`; `styles.css` só usa essas variáveis nas regras `.p-*` (os padrões da Soma ficam
  definidos no próprio `#print-root`).
- **PDF multipágina não corta linhas:** `generatePdfBlob` rasteriza com html2canvas e **fatia nas
  fronteiras de fim de cada `<tr>`** (não em offsets fixos). Anexa os comprovantes como páginas
  finais.
- **Campos extras por módulo:** `mod.campos` (`{estabelecimento, justificativa}`) decide o que o
  modal mostra (`toggleCamposModulo`), o que `saveEntry` grava, o que `quickDuplicate`/`repeatLast`/
  `duplicateInModal` **copiam** e o que a varredura do Drive preenche. Hoje só o cartão os usa
  (alimentam C e K do Excel). `ocrReceipt` retorna `establishment`; `fillFromOcr` preenche se visível.
- **Validação antes de exportar/arquivar** (`validateBeforeExport`): regras vêm de
  `mod.obrigatorios` (cartão: data/valor/estabelecimento/justificativa; reembolso e SA:
  data/valor/categoria) e a mensagem usa `mod.tabLabel`. `confirm` para prosseguir mesmo assim.
- **Fechamento POR RELATÓRIO** (botão 🗑️ → `closeMonthFlow` → `chooseCloseTable`, com **um botão
  por módulo na cor dele**): fecha **só** o relatório escolhido (os outros continuam abertos).
  `closeTable` valida, grava um snapshot **só desse módulo** (com `table:` marcado e o perfil
  ACHATADO na raiz, formato do histórico) e chama `archiveMonthToDrive`, que compacta os
  comprovantes num `.zip` (`fflate.zipSync`, nome `NFs - {Mês} {Ano}.zip`) e grava **.zip + Excel +
  PDF** do mês na pasta do mês no Drive (**mantém** os comprovantes individuais). Mostra progresso
  por etapa reusando o overlay `scanProgress.open('Arquivando …','📦')` (de `drive-scan.js`).
  `reportMonth`/`dataSolicitacao`/`santPeriodo` zeram só no perfil daquele módulo.
  `reopenHistory` restaura só a tabela do snapshot (`h.table`) e volta o perfil para `perfis[t]`.
- **Varredura do Drive** (`scanDriveForReceipts`, botão `#gd-scan-main`): escopo `drive.file` +
  `drive.readonly`. Percorre **todas** as raízes (`for (const tabela of TABELAS)`).
  `isGeneratedArtifact` reconhece os arquivos gerados pelos prefixos `MODULOS[].fileBase` —
  **um módulo novo com `fileBase` novo já entra automaticamente**, sem regex nova.
  `gdListReceipts(tabela)` recursivo; ids novos (`knownDriveIds`) → OCR. Sucesso
  (data+total) vira lançamento `foto={id,name}` (sem reupload); falha vira **pendente**
  (`renderPending`/`openPendingEntry`/`dismissPending`/`retryPendingOcr`). Overlay `scanProgress`
  mostra cada arquivo ao vivo com o motivo.
- **Conexão do Drive ao abrir (token persistido):** o access token (~1h) é **persistido** em
  `-gdtok-v1` (`saveGdAccess`/`loadGdAccess`, que descarta o access token se expirou mas preserva
  `refresh`) e recarregado no topo de `drive-core.js` (`let gdAccess = loadGdAccess()`) — reabrir o
  app dentro de ~1h fica conectado **sem popup**. `scheduleGdRefresh` renova em silêncio ~2 min
  antes de expirar; `setupGDriveUI` reagenda no startup e escuta `visibilitychange`/`online` p/
  reconectar ao voltar o foco. `maybePromptDrive` (chamado em `hideLock`) tenta reconexão silenciosa
  e só mostra o popup se `countPendingDrive() > 0`.
  - **Sem o renovador (Worker) configurado:** fluxo antigo — `initTokenClient` com `prompt:''`; só
    funciona enquanto a sessão do Google no navegador valer (pode pedir login de novo depois de
    fechado por muito tempo).
  - **Com `-gdrive-v1.workerUrl` configurado** (campo "URL do renovador" nas Configurações): usa
    `initCodeClient` (`ux_mode:'popup'`) — o `code` retornado é trocado no Worker
    (`gdWorkerExchange` → `POST {workerUrl}/exchange`) por `access_token` **+ `refresh_token`**
    (só o Worker conhece o `client_secret`, nunca fica no app público). `gdAccess.refresh` **não
    expira por tempo** (só se revogado/inativo ~6 meses) e é usado por `gdRefreshAccessToken`
    (`POST {workerUrl}/refresh`) pra renovar o access token **por rede, sem popup, mesmo depois de
    dias sem abrir o app** — `gdGetToken` tenta esse caminho primeiro sempre que há `refresh`. Só
    pede popup de novo se o refresh token for revogado (Google retorna erro; `gdGetToken` limpa
    `gdAccess.refresh` e propaga). Worker fonte: `cloudflare-worker/drive-token-worker.js` (deploy
    manual do usuário no Cloudflare Workers, fora deste repo/PWA).
  - `gd-clear` apaga `-gdtok-v1` (token **e** refresh) e cancela o timer.
- **Miniaturas** são **locais** (IndexedDB `thumb_<id>`, não sincronizam). Lista mostra mais recente
  no topo; estado/Excel/PDF seguem cronológicos. Aviso de duplicado (mesma data+categoria+valor) no
  `saveEntry`. A chave de dados `alelo` é estrutural e **não muda** (rótulo visível pode mudar).
- **OCR com cache + retentativa:** `ocrReceipt` é um **wrapper com cache por hash** (SHA-256 dos
  bytes via `blobSha256`; chave `ocrcache_<hash>` no IndexedDB) — o MESMO comprovante não regasta o
  Gemini (varredura repetida / "Analisar de novo" ficam grátis). Só cacheia resultado útil (com
  `dateISO` ou `total`); erros não entram no cache. A chamada à rede é `ocrReceiptRaw`, que reenvia
  até 4x com backoff em erros transitórios (429, 500/502/503, rede), respeitando `retryDelay`. Erro
  definitivo propaga a **mensagem real** do Gemini (log da varredura + toast). `ocr.dateISO` vem
  string vazia (use `!ocr.dateISO`). `GEMINI_MODEL` (`gemini-2.5-flash`) é fácil de trocar.
- Categoria nova fora da validação do `template.xlsx` é gravada mesmo assim (Excel pode avisar
  "valor fora da lista"). Renomear categoria **não** reescreve lançamentos antigos.

- **Relatórios mensais divididos por tipo** (`#view-relatorios`): **uma aba por módulo**
  (`.htab`/`.hist-panel`, `setupHistTabs`/`showHistTab`, lembra em `-histtab-v1` — NÃO
  reusar `.rtab`, que `setupReportTabs` binda; a aba ativa ganha a cor da empresa inline).
  `renderReports` chama `renderReportsPanel(tab,treeId,emptyId)` por aba
  (`#reports-tree-{key}` / `#reports-empty-{key}`). `histBelongsTo(h,tab)`
  decide a aba de cada snapshot: pela marca `h.table` (fechamento por tabela do item v30+); snapshots
  **legados** sem `table` entram na aba de cada tabela em que têm lançamentos (podem aparecer nas
  duas). Contagem/total por aba somam **só** `h[tab]`. Export/reabrir seguem tratando `h.table`.

  > **Módulo Finanças removido** (v55, a pedido do usuário). Não existe mais `#view-financas`, os
  > `js/fin-*.js`, os ramos `fin*` do estado/sync nem as categorias/ícones próprios. Se algum dado
  > financeiro sobrar no repo privado de sync, é ignorado no próximo merge.

## Como adicionar um 4º relatório/empresa
1. Uma entrada em `MODULOS` (`js/modules.js`) com `key` nova, rótulos, empresa, logo, cores,
   `driveRoot` **único**, `fileBase` **único**, `layout`+`template`+`blocos`, `campos`,
   `obrigatorios`, `bank`/`periodo` e `grupoExport`.
2. `index.html`: copiar um bloco `.report-panel` (ids no padrão `-{key}`), o botão `.rtab` e a
   aba/painel do histórico (`.htab` + `#hist-tab-{key}`).
3. `sw.js`: bump do `CACHE` + o logo novo em `ASSETS`. Logo em `assets/`.
4. Atualizar os 3 harnesses em `tests/` e rodar. Nada mais no JS precisa mudar — todo o resto é
   loop sobre `TABELAS`/`MODULOS`.

## Fluxo de trabalho típico (ao editar)
1. Grep o nome da função → editar o `js/*.js` certo.
2. Bump `APP_VERSION` (`js/core.js`) **e** `CACHE` (`sw.js`) juntos.
3. Verificar (headless, acima) quando aplicável.
4. Commit + push (mensagens sem acentos, pt-BR curto). Pages publica em ~1 min; testar no celular.
