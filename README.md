# Despesas para Reembolso — Soma Urbanismo

Aplicativo (PWA) para registrar despesas ao longo do mês no celular e gerar o
relatório de reembolso em **Excel** (idêntico ao modelo da empresa) e **PDF**.

- Funciona offline, instala como app na tela inicial do Android.
- Os lançamentos ficam salvos no próprio celular (não vão para nenhum servidor).
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

- **Dados do Reembolso:** preencha seu nome (Funcionário), a data da solicitação e
  o motivo (Reembolso Referente à). Ficam salvos automaticamente.
- **Despesas para Reembolso** e **Despesas Cartão Alelo:** toque em
  **＋ Adicionar lançamento** em cada seção, informe data, descrição, categoria e valor.
  Toque em um lançamento existente para editar ou excluir.
- **Dados Bancários (Se Aplicável):** preencha uma vez; ficam salvos para os próximos meses.
- No fim do mês, toque em **Excel** ou **PDF** para gerar o relatório e enviar para a empresa.
  - No Android, o **PDF** é gerado pela tela de impressão → escolha **Salvar como PDF**.
- O botão **🗑️** (topo) inicia um novo mês, apagando os lançamentos e mantendo seus
  dados pessoais e bancários.

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
