# Despesas para Reembolso — Soma Urbanismo

Aplicativo (PWA) para registrar despesas ao longo do mês no celular e gerar o
relatório de reembolso em **Excel** (idêntico ao modelo da empresa) e **PDF**.

- Funciona offline, instala como app na tela inicial do Android.
- Os lançamentos ficam salvos no próprio celular. Opcionalmente, podem ser
  **sincronizados entre dispositivos** usando um repositório **privado** no GitHub
  (veja a seção 6) — útil para abrir os mesmos dados no celular e no computador.
- O Excel é gerado a partir da sua própria planilha-modelo (`template.xlsx`),
  preenchendo apenas os dados — logo, cores, fórmulas e layout ficam iguais ao original.

---

## 1. Publicar no GitHub Pages (passo a passo)

> Você só precisa fazer isto uma vez. Depois é só usar pelo celular.

1. Crie uma conta gratuita em <https://github.com> (se ainda não tiver).
2. Clique em **New repository** (Novo repositório):
   - **Repository name:** `despesas` (ou outro nome simples)
   - Marque **Public**
   - Clique em **Create repository**.
3. Na página do repositório, clique em **Add file → Upload files**.
4. **Arraste para a página os seguintes arquivos e pastas** (mantendo a estrutura):

   ```
   index.html
   app.js
   styles.css
   sw.js
   manifest.webmanifest
   template.xlsx
   lib/        (com fflate.min.js dentro)
   icons/      (icon-192.png, icon-512.png, maskable-512.png)
   assets/     (soma-logo.png)
   ```

   > Dica: no Windows, selecione esses itens, arraste todos de uma vez para a área
   > de upload. Os arquivos `server.ps1`, a pasta `.claude` e o
   > `Relatorio ... - Modelo.xlsx` **não precisam** ser enviados (são só de apoio).

5. Clique em **Commit changes**.
6. Vá em **Settings → Pages**:
   - Em **Source**, escolha **Deploy from a branch**.
   - Em **Branch**, escolha **main** e a pasta **/ (root)** → **Save**.
7. Aguarde ~1 minuto. O endereço do app aparecerá no topo dessa mesma página, algo como:

   ```
   https://SEU-USUARIO.github.io/despesas/
   ```

---

## 2. Instalar no celular (Android)

1. Abra o endereço acima no **Chrome** do celular.
2. Toque no menu **⋮** (canto superior direito).
3. Toque em **Adicionar à tela inicial** (ou **Instalar aplicativo**).
4. Pronto — o ícone da Soma aparece na tela inicial e abre como um app.

A partir daí funciona **sem internet**.

---

## 3. Como usar

- **Menu (☰):** toque no botão no canto superior esquerdo para abrir o menu lateral e navegar entre
  **Lançamentos**, **Relatórios mensais** (meses arquivados, por ano) e **Configurações**
  (sincronização, bloqueio e backup).
- **Dados do Reembolso:** preencha seu nome (Funcionário), a data da solicitação e
  o motivo (Reembolso Referente à). Ficam salvos automaticamente.
- **Despesas para Reembolso** e **Despesas Cartão Alelo:** toque em
  **＋ Adicionar** em cada seção, informe data, descrição, categoria e valor.
  Toque em um lançamento existente para editar, excluir ou **Duplicar**.
  - **⟲ Repetir último** cria rapidamente um lançamento igual ao último (ex.: almoço diário).
  - O **valor** e o **CPF** são formatados automaticamente enquanto você digita.
- **Dados Bancários (Se Aplicável):** preencha uma vez; ficam salvos para os próximos meses.
- No fim do mês, toque em **Excel** ou **PDF** para gerar o relatório.
  - No Android, abre direto a tela de **compartilhar** (WhatsApp, e-mail, etc.) com o
    arquivo anexado. Onde o compartilhamento não estiver disponível, o arquivo é baixado.
- O **Resumo por categoria** (no app, acima do total) ajuda a conferir os gastos antes de
  enviar — ele **não** aparece no Excel/PDF.
- O botão **🗑️** (topo) inicia um novo mês: o mês atual vai para o **Histórico de meses**
  (você pode reabrir ou reexportar Excel/PDF depois), e seus dados pessoais/bancários são mantidos.
- **🌙 / ☀️** (topo) alterna entre **tema claro e escuro** (por padrão segue o sistema).
- **Bloqueio do app:** em "Bloqueio do app", ative **biometria** (impressão digital/rosto do
  Android) e/ou um **PIN** para exigir autenticação ao abrir.
- **Backup / Restaurar:** exporta/importa um arquivo `.json` com todos os dados (atuais e
  histórico). Se a sincronização estiver ligada, também grava uma cópia versionada no Git.

> O modelo comporta 7 linhas por seção. Se você lançar mais de 7 numa seção,
> o app **expande as linhas automaticamente** no Excel, mantendo o mesmo visual.

---

## 4. Testar no computador (opcional)

No Windows, dentro desta pasta:

```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

Depois abra <http://127.0.0.1:8765/> no navegador.

---

## 5. Atualizar o app depois

Se algum arquivo for alterado, troque a versão do cache em `sw.js`
(linha `const CACHE = 'despesas-soma-v1';` → `...-v2`) e reenvie os arquivos.
Isso faz o celular baixar a versão nova.

---

## 6. Sincronizar entre celular e computador (opcional)

Permite que os lançamentos feitos no celular apareçam ao abrir o app no
computador (e vice-versa). Os dados ficam num repositório **privado** seu no
GitHub — **nunca** no repositório público do app.

### 6.1 Criar o repositório privado de dados

1. Em <https://github.com> → **New repository**.
2. **Repository name:** `Despesas-Soma-Dados` (ou outro nome).
3. Marque **Private** (importante — seus dados são pessoais).
4. Marque **Add a README file** (para o repositório não ficar vazio) → **Create repository**.

### 6.2 Gerar um token de acesso (fine-grained)

1. Acesse <https://github.com/settings/personal-access-tokens/new>.
2. **Token name:** `app-despesas`.
3. **Expiration:** escolha um prazo (ex.: 1 ano).
4. **Resource owner:** sua conta.
5. Em **Repository access**, escolha **Only select repositories** e selecione
   **apenas** o `Despesas-Soma-Dados`.
6. Em **Permissions → Repository permissions → Contents**, selecione
   **Read and write**.
7. Clique em **Generate token** e **copie** o token (começa com `github_pat_...`).
   Guarde-o — ele não será mostrado de novo.

### 6.3 Configurar no app

1. Abra o app, expanda **Sincronização entre dispositivos**.
2. Em **Repositório**, digite `SEU-USUARIO/Despesas-Soma-Dados`.
3. Cole o **token**.
4. Toque em **Conectar** (verifica o acesso) e depois em **Sincronizar agora**.
5. Repita os passos 1–4 no outro dispositivo (computador), com o **mesmo**
   repositório e um token (pode ser o mesmo token ou um por aparelho).

A partir daí o app sincroniza sozinho: ao abrir, ao voltar a ficar online e
poucos segundos depois de cada alteração. O token fica salvo **apenas naquele
aparelho**; use **Desconectar** para removê-lo de um dispositivo.

> **Segurança:** o token dá acesso de escrita só a esse repositório privado.
> Se o aparelho for perdido, gere um novo token e **revogue** o antigo em
> <https://github.com/settings/tokens?type=beta>.

---

## Estrutura dos arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Tela do app |
| `styles.css` | Visual (inclui o layout do PDF) |
| `app.js` | Lógica, armazenamento e geração de Excel/PDF |
| `template.xlsx` | Sua planilha-modelo (preenchida na exportação) |
| `lib/fflate.min.js` | Biblioteca para montar o arquivo Excel |
| `manifest.webmanifest`, `sw.js`, `icons/` | Tornam o site instalável e offline (PWA) |
| `assets/soma-logo.png` | Logo usada no cabeçalho e no PDF |
