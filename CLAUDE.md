# CLAUDE.md — Guia do projeto (leitura otimizada)

> Objetivo deste arquivo: poupar tokens e tempo. **Não leia o `app.js` inteiro
> (2.200+ linhas).** Use o mapa de funções abaixo e o tool **Grep** para abrir só
> o trecho necessário (`Read` com `offset`/`limit`). Quase tudo está em `app.js`.

## O que é
PWA (Progressive Web App) de **lançamentos de despesas** da **Soma Urbanismo S/A**.
Vanilla JS, **sem build, sem Node/npm** na máquina (Windows 11, PowerShell).
Gera Excel idêntico ao `template.xlsx` + PDF. Publicado em GitHub Pages:
https://mrosella.github.io/Despesas---Soma/

## Arquivos
| Arquivo | Linhas | Conteúdo |
|---|---|---|
| `app.js` | ~2210 | **Toda a lógica.** Ver mapa abaixo. |
| `index.html` | ~407 | 3 telas: `#view-lancamentos`, `#view-relatorios`, `#view-config`. |
| `styles.css` | ~503 | Tema claro/escuro via variáveis CSS. Reusar `.card/.field/.sync-status/.cat-row`. |
| `sw.js` | 54 | Service Worker network-first. `CACHE` na linha 4. |
| `template.xlsx` | — | Modelo Excel preenchido por `buildXlsx`. Não editar à mão. |
| `lib/` | — | fflate, html2canvas, jspdf (offline, já cacheados). |

## Regras de ouro (OBRIGATÓRIO)
1. **Auto-publicar após qualquer mudança**, sem perguntar: bump de cache + commit + push.
2. **Bump de cache em DOIS lugares que devem bater:** `APP_VERSION` em `app.js:12` e
   `CACHE` em `sw.js:4` (ex.: `v19` → `v20`). Sem isso o PWA fica preso na versão antiga.
3. **Sem segredos no repo (público).** Token GitHub, Client ID do Drive e chave Gemini
   ficam **só no `localStorage` do aparelho**. Dados financeiros sincronizam por um
   **repositório PRIVADO separado** (`dados.json`), nunca neste repo.
4. **Sem dependências novas / sem passo de build.** Tudo client-side, carregado por `fetch`.

## Mapa de `app.js` (offsets para `Read`)
| Bloco | Linhas | Funções-chave |
|---|---|---|
| Constantes / chaves localStorage | 9–15 | `STORE_KEY`, `SYNC_KEY`, `APP_VERSION` (bump!) |
| **Categorias/limites (config)** | 19–48 | `DEFAULT_CATEGORIAS`, `getCatConfig`, `getCategorias`, `catByName`, `limiteDaCategoria`, `grupoDaCategoria`, `limitsObsText` |
| Estado / persistência | 51–105 | `emptyState`, `loadState`, `saveState`, `touchDoc/touchProfile` |
| Utils (moeda, data, uid, toast) | 111–152 | `parseMoney`, `formatMoney`, `todayISO`, `fmtDateBR`, `dateToSerial` |
| Ícones SVG | 155–192 | `ICONS`, `icon`, `setupIcons` |
| Render telas/listas | 194–410 | `render`, `renderReports`, `renderList` (exibe **mais recente no topo**; `hydrateThumbs` = miniaturas), `limitExcedido`, `emptyStateEl` |
| Modal de lançamento | 428–598 | `openModal`, `saveEntry`, `deleteEntry`, `updateCatHint`, máscaras |
| **Foto/anexo + OCR hook** | 457–503 | `renderModalPhoto`, `onPhotoSelected` (dispara OCR), `applyModalPhoto` (nome do arquivo) |
| Excel (XLSX) | 600–838 | `buildXlsx`, `exportExcel`, `filteredDoc` |
| Compartilhar/baixar | 839–885 | `shareOrDownload`, `downloadBlob`, chooser de export |
| PDF | 887–1037 | `buildPrint`, `exportPDF`, `generatePdfBlob` |
| **Sync GitHub (privado)** | 1038–1360 | `ghGetFile/ghPutFile`, `currentDoc`, `applyDoc`, `mergeDocs`, `syncNow`, `setupSyncUI` |
| Bloqueio (bio/PIN) | ~1340–1505 | `enableBio`, `unlockBio`, `setPin/checkPin`, `showLock` |
| `populateCategorySelects` | ~1507 | popula `#m-categoria` (chamado no `init`; já não há mais filtros) |
| **Editor de categorias (UI)** | ~1516–1590 | `getCatDraft`, `renderCatEditor`, `saveCatEditor`, `setupCatUI` |
| **OCR / Gemini** | 1619–1735 | `AI_KEY`, `GEMINI_MODEL`, `loadAi/saveAi`, `aiConfigured`, `buildDescricao`, `ocrReceipt`, `fillFromOcr`, `runReceiptOcr`, `receiptFileName`, `setupAiUI` |
| **Google Drive** | ~1690–2090 | `loadGd/saveGd`, `gdGetToken`, `gdEnsureFolder`, **subpastas Ano/Mês** (`MESES`, `gdFindOrCreateChild`, `gdEnsureMonthFolder`), `reportFolderDateISO` (mês de referência → pasta única), `gdUpload(blob,name,dateISO)`, **exclusão** (`gdDeleteFile`, fila `loadGdDel/queueGdDelete/flushGdDeletions`, `purgeEntryPhoto`), **conexão ao abrir** (`gdConnectFlow`, `gdSilentReconnect`, `showDriveConnectNotice`, `maybePromptDrive`, `countPendingDrive`), miniaturas (`saveThumb`), IndexedDB (`idbPut/Get/Del`: `p_`=pendentes, `thumb_`=miniaturas locais), `compressImage`, `flushPendingPhotos` |
| Tema | 2002–2032 | `applyTheme`, `toggleTheme`, `setupTheme` |
| Init / bootstrap | 2033–2210 | `bindField`, `newMonth`, `init` (registra todos os `setup*`), SW, conectividade |

## Forma do estado (`emptyState`, app.js:51)
```
{ funcionario, dataSolicitacao, referente,
  reportMonth,                       // 'YYYY-MM' (perfil): pasta única dos comprovantes no Drive; vazio = por data do lançamento
  bank:{nome,cpf,banco,agencia,conta,pix},
  reembolso:[], alelo:[],            // lançamentos (duas tabelas)
  history:[], histTomb:{},           // meses arquivados + lápides
  driveFolderId,                     // pasta de comprovantes (compartilhada)
  config:{ categorias:[{nome,limite,grupo}] },  // editável em Configurações
  tomb:{reembolso:{},alelo:{}},      // lápides de deleção (id->updatedAt)
  meta:{updatedAt, profileUpdatedAt} }
```
Merge de sync: `meta.updatedAt` para tabelas; `profileUpdatedAt` (last-write-wins)
para perfil/banco/**config**. Lápides garantem que deleções propaguem.

## Chaves de localStorage
`despesas-soma-v1` (estado) · `-sync-v1` (GitHub) · `-gdrive-v1` (Drive) ·
`-gddel-v1` (fila de exclusões no Drive) · `-ai-v1` (Gemini) · `-lock-v1` (bio/PIN) ·
`-theme-v1` · `-lastsync-v1` · `-dirty-v1`.

## Verificação (esta máquina)
- **Sem Node, sem python; preview MCP trava aqui.** Não conte com eles.
- **Lógica pura (headless):** Chrome em
  `C:\Program Files\Google\Chrome\Application\chrome.exe` com
  `--headless=new --dump-dom`. Passar caminho Windows **absoluto** do arquivo
  (em Git Bash: `"$(pwd -W)/arquivo.html"`). Harness de teste deve juntar
  resultados com ` || ` (grep não cruza linhas) e usar try/catch.
- **OAuth/câmera/OCR/IndexedDB e chamadas externas NÃO rodam headless** → validar
  só no **site publicado (HTTPS)**, no dispositivo.

## Fluxo de trabalho típico (ao editar)
1. Editar `app.js`/`index.html`/`styles.css`.
2. Bump `APP_VERSION` (app.js:12) **e** `CACHE` (sw.js:4) juntos.
3. Commit + push (mensagens de commit sem acentos, em pt-BR curto).
4. Pages publica em ~1 min; testar no celular.

## Pontos de atenção
- `index.html` `#m-categoria` é **populado por JS** (`populateCategorySelects`, chamado no
  `init`) a partir de `getCategorias()` — não recriar `<option>` fixos. (A busca/filtros foi
  removida; o rótulo da 2ª tabela é "Despesas Cartão Santander - Soma".)
- **Comprovantes no Drive vão para subpastas `{Ano}/{Mês}`** dentro da pasta raiz compartilhada;
  resolvidas por nome (idempotente entre aparelhos). O mês é o **`reportMonth`** (campo "Mês de
  referência", `reportFolderDateISO`) — **todo** o relatório aberto cai na MESMA pasta, mesmo
  comprovantes de outra data. Se `reportMonth` vazio, cai na pasta da **data do lançamento**
  (comportamento antigo). Botão 🗑️ (`newMonth`) arquiva e **zera** `reportMonth`.
- **Excluir lançamento apaga o comprovante no Drive** (`deleteEntry`→`purgeEntryPhoto`): se
  conectado, `gdDeleteFile` na hora; senão entra na fila `-gddel-v1` e é propagado por
  `flushGdDeletions` ao reconectar. Limpa também `thumb_<id>` e o pendente `p_<id>`. Escopo
  `drive.file` só apaga o que o app criou.
- **Conexão do Drive ao abrir:** token OAuth vive só em memória (~1h) → ao abrir/voltar ao
  foco, `maybePromptDrive` tenta reconexão silenciosa (sem UI) e **só** mostra o popup
  `gd-connect-notice` se `countPendingDrive() > 0` (fotos a enviar ou exclusões a propagar) —
  sem pendência **não incomoda**. Sequenciado após o desbloqueio (chamado em `hideLock`).
- **Miniaturas** dos comprovantes são **locais** (IndexedDB `thumb_<id>`, não sincronizam).
  Lista exibe **mais recente no topo** (estado/Excel/PDF seguem cronológicos). Há botão
  "Copiar dados bancários" (`copyBankData`) e aviso de duplicado (mesma data+categoria+valor) no `saveEntry`.
  Renomear "Alelo"→"Santander - Soma" foi só rótulo visível (tela/PDF/Excel via
  `template.xlsx` sharedStrings); a chave de dados `alelo` é estrutural e **não muda**.
- Categoria nova fora da validação do `template.xlsx` é gravada mesmo assim; o Excel
  pode avisar "valor fora da lista" — limitação conhecida.
- `GEMINI_MODEL` (app.js:1620) é constante fácil de trocar se a família mudar.
- Renomear categoria **não** reescreve lançamentos antigos (texto livre na coluna).
