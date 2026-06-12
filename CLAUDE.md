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
| `js/core.js` | chaves localStorage + `APP_VERSION` (bump!), categorias/config (`getCatConfig`…), estado (`emptyState`/`loadState`/`saveState`/`touchDoc`/`touchProfile`, `let state`), utils (`parseMoney`/`formatMoney`/`todayISO`/`fmtDateBR`/`dateToSerial`/`uid`/`toast`/`sumOf`), ícones |
| `js/render.js` | `render`, `renderList` (mais recente no topo), histórico (`renderReports`/`reopenHistory`/`deleteHistory`/`monthLabelFor`/`computeSantanderPeriodo`/`yearOf`), resumo por categoria, `limitExcedido`, `quickDelete`/`quickDuplicate`, `escapeHtml`, `hydrateThumbs` |
| `js/modal.js` | modal (`openModal`/`saveEntry`/`deleteEntry`/`repeatLast`), `toggleCartaoFields`, foto+OCR hook (`renderModalPhoto`/`onPhotoSelected`/`applyModalPhoto`), máscaras, `updateCatHint` |
| `js/excel.js` | `buildXlsx`, `buildSantanderXlsx`, `exportExcel`, `validateBeforeExport`, `filteredDoc`, `reportFileBase`/`santanderFileBase`, chooser de export, `SANTANDER_NOME/CARGO` |
| `js/pdf.js` | `buildPrint`, `buildSantanderPrint`, `exportPDF`, `generatePdfBlob` (multipágina por linha), `shareOrDownload`/`downloadBlob` |
| `js/sync.js` | sync GitHub privado (`ghGetFile`/`ghPutFile`, `currentDoc`/`applyDoc`/`mergeDocs`, `syncNow`, `setupSyncUI`) |
| `js/lock.js` | bloqueio bio/PIN (`enableBio`/`unlockBio`/`setPin`/`showLock`) + backup (`exportBackup`/`importBackupFile`/`setupBackupUI`) |
| `js/ui.js` | navegação (`showView`/`setupNav`), `populateCategorySelects`, editor de categorias (`renderCatEditor`/`saveCatEditor`/`setupCatUI`) |
| `js/ocr.js` | Gemini (`AI_KEY`, `GEMINI_MODEL`, `ocrReceipt`, `fillFromOcr`, `runReceiptOcr`, `receiptFileName`, `setupAiUI`) |
| `js/drive.js` | Google Drive completo (`gd*`, varredura `scanDriveForReceipts`/pendentes, exclusão+fila, IndexedDB `p_`/`thumb_`, `compressImage`, `getPhotoBlob`, `flushPendingPhotos`, `setupGDriveUI`) |
| `js/main.js` | tema, `bindField`, **fechamento por tabela** (`closeMonthFlow`/`closeTable`/`archiveMonthToDrive`/`chooseCloseTable`), `copyBankData`, `init` (registra todos os `setup*`), SW, conectividade — **carregado por último** |
| `index.html` | 3 telas (`#view-lancamentos/-relatorios/-config`); carrega `lib/*` e depois `js/*` na ordem. |
| `styles.css` | tema claro/escuro via variáveis. Reusar `.card/.field/.sync-status/.cat-row/.offline-notice`. |
| `sw.js` | SW network-first; `CACHE` na **linha 4** + lista `ASSETS` (inclui **cada** `js/*.js`). |
| `template.xlsx`, `template-santander.xlsx` | modelos Excel (não editar à mão). |
| `lib/` | fflate, html2canvas, jspdf (offline, já cacheados). |

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
```
{ funcionario, dataSolicitacao, referente,
  reportMonth,                       // 'YYYY-MM' (perfil): pasta única dos comprovantes no Drive; vazio = por data do lançamento
  bank:{nome,cpf,banco,agencia,conta,pix},
  reembolso:[], alelo:[],            // lançamentos (duas tabelas). entry.foto = {id|pending, name, w, h}
  history:[], histTomb:{},           // meses arquivados (snapshot pode marcar `table:'reembolso'|'alelo'`) + lápides
  driveFolderId,                     // (legado) raiz única; migra p/ driveFolders.reembolso
  driveFolders:{reembolso,alelo},    // RAÍZES SEPARADAS no Drive (reembolso × cartão Santander)
  pending:[], driveKnown:{}, driveDismissed:{},  // varredura do Drive: pendentes p/ revisar; ids já vistos; ids descartados
  config:{ categorias:[{nome,limite,grupo}] },  // editável em Configurações
  tomb:{reembolso:{},alelo:{}},      // lápides de deleção (id->updatedAt)
  meta:{updatedAt, profileUpdatedAt} }
```
Merge de sync: `meta.updatedAt` p/ tabelas; `profileUpdatedAt` (last-write-wins) p/
perfil/banco/**config**/`driveFolders`/`reportMonth`. Lápides propagam deleções. `pending` = união
por `fileId` **menos** os já virados lançamento (`foto.id`) ou descartados; `driveKnown`/
`driveDismissed` = união (evita reprocessar/ressuscitar).

## Chaves de localStorage
`despesas-soma-v1` (estado) · `-sync-v1` (GitHub) · `-gdrive-v1` (Drive) · `-gddel-v1` (fila de
exclusões) · `-ai-v1` (Gemini) · `-lock-v1` (bio/PIN) · `-theme-v1` · `-lastsync-v1` · `-dirty-v1`.

## Verificação (esta máquina — sem Node/python; preview MCP trava)
Chrome em `C:\Program Files\Google\Chrome\Application\chrome.exe` com `--headless=new
--allow-file-access-from-files --virtual-time-budget=4000 --dump-dom` num harness `.html`
temporário (caminho Windows absoluto; em Git Bash `"$(pwd -W)/x.html"`). Grep é por linha → no
harness escreva 1 resultado por linha (não cruze `<` ). Dois testes úteis (scripts **clássicos**
carregam de `file://` — por isso não usamos ES modules):
- **Integridade do split / sintaxe:** harness que inclui os 11 `js/*.js` na ordem + checa
  `typeof <fn> === 'function'` p/ uma função de cada arquivo (um `SyntaxError`/redeclaração pula o
  arquivo todo → a função some) e captura `window.onerror`.
- **Lógica pura:** chamar funções (ex.: `computeSantanderPeriodo`, `validateBeforeExport`) com
  fixtures e comparar. Limpar os harnesses (`rm`) depois.
- **OAuth/câmera/OCR/IndexedDB/PDF/Drive NÃO rodam headless** → validar no **site (HTTPS)** no
  dispositivo.

## Pontos de atenção (fatos de arquitetura)
- `#m-categoria` é **populado por JS** (`populateCategorySelects`, no `init`) a partir de
  `getCategorias()` — não criar `<option>` fixos. Rótulo da 2ª tabela: "Despesas Cartão Santander".
- **DUAS raízes no Drive** (`gdEnsureFolder(tabela)`): `Comprovantes - Despesas Soma` (reembolso,
  nome legado) e `Comprovantes Cartao Santander - Despesas Soma` (`alelo`).
  `state.driveFolders={reembolso,alelo}` (sincronizado; `driveFolderId` legado migra p/ reembolso).
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
- **Formato exclusivo do Cartão Santander** (`buildSantanderXlsx`/`buildSantanderPrint`, asset
  `template-santander.xlsx`): acionado ao exportar **só** `alelo`. Excel: E4=Nome FIXO
  (`SANTANDER_NOME`), E5=Cargo FIXO (`SANTANDER_CARGO`), **E6=Período AUTOMÁTICO**
  (`computeSantanderPeriodo`: do último lançamento do relatório Santander anterior no histórico até
  o último do atual), **E7=Data de Entrega = data de geração** (`todayISO`), E8/J=Total; tabela
  linhas 17.. (total na 35, expande se >18). Colunas: B=DATA, **C:F=ESTABELECIMENTO**, G:I=DESCRIÇÃO,
  J=VALOR, **K=JUSTIFICATIVA**. PDF = réplica visual (barra `#C00000`+logo, total cinza `#D8D8D8`)
  em **paisagem** (`generatePdfBlob(...,santander)`). Reembolso/"ambos" → `buildXlsx`/`buildPrint`
  (retrato).
- **PDF multipágina não corta linhas:** `generatePdfBlob` rasteriza com html2canvas e **fatia nas
  fronteiras de fim de cada `<tr>`** (não em offsets fixos). Anexa os comprovantes como páginas
  finais.
- **Campos só do cartão (`alelo`):** `entry.estabelecimento` (IA+manual) e `entry.justificativa`
  (manual), visíveis só p/ `alelo` (`toggleCartaoFields`); alimentam C e K. `ocrReceipt` retorna
  `establishment`; `fillFromOcr` preenche se visível.
- **Validação antes de exportar/arquivar** (`validateBeforeExport`): acusa lançamentos sem campos
  (cartão: data/valor/estabelecimento/justificativa; reembolso: data/valor/categoria) com `confirm`.
- **Fechamento POR TABELA** (botão 🗑️ → `closeMonthFlow` → `chooseCloseTable`): fecha **só** a
  tabela escolhida (a outra continua aberta). `closeTable` valida, arquiva um snapshot **só dessa
  tabela** (com `table:` marcado) no histórico e chama `archiveMonthToDrive`, que compacta os
  comprovantes num `.zip` (`fflate.zipSync`, nome `NFs - {Mês} {Ano}.zip`) e grava **.zip + Excel +
  PDF** do mês na pasta do mês no Drive (**mantém** os comprovantes individuais). `reportMonth`/
  `dataSolicitacao` só zeram quando **as duas** tabelas ficam vazias. `reopenHistory` restaura só a
  tabela do snapshot (`h.table`).
- **Varredura do Drive** (`scanDriveForReceipts`, botão `#gd-scan-main`): escopo `drive.file` +
  `drive.readonly`. `gdListReceipts(tabela)` recursivo; ids novos (`knownDriveIds`) → OCR. Sucesso
  (data+total) vira lançamento `foto={id,name}` (sem reupload); falha vira **pendente**
  (`renderPending`/`openPendingEntry`/`dismissPending`/`retryPendingOcr`). Overlay `scanProgress`
  mostra cada arquivo ao vivo com o motivo.
- **Conexão do Drive ao abrir:** token OAuth só em memória (~1h). `maybePromptDrive` (chamado em
  `hideLock`) tenta reconexão silenciosa e só mostra o popup se `countPendingDrive() > 0`.
- **Miniaturas** são **locais** (IndexedDB `thumb_<id>`, não sincronizam). Lista mostra mais recente
  no topo; estado/Excel/PDF seguem cronológicos. Aviso de duplicado (mesma data+categoria+valor) no
  `saveEntry`. A chave de dados `alelo` é estrutural e **não muda** (rótulo visível pode mudar).
- **OCR com retentativa:** `ocrReceipt` reenvia até 4x com backoff em erros transitórios (429,
  500/502/503, rede), respeitando `retryDelay`. Erro definitivo propaga a **mensagem real** do
  Gemini (aparece no log da varredura e no toast). `ocr.dateISO` vem como string vazia (use
  `!ocr.dateISO`). `GEMINI_MODEL` (`gemini-2.5-flash`) é fácil de trocar.
- Categoria nova fora da validação do `template.xlsx` é gravada mesmo assim (Excel pode avisar
  "valor fora da lista"). Renomear categoria **não** reescreve lançamentos antigos.

## Fluxo de trabalho típico (ao editar)
1. Grep o nome da função → editar o `js/*.js` certo.
2. Bump `APP_VERSION` (`js/core.js`) **e** `CACHE` (`sw.js`) juntos.
3. Verificar (headless, acima) quando aplicável.
4. Commit + push (mensagens sem acentos, pt-BR curto). Pages publica em ~1 min; testar no celular.
