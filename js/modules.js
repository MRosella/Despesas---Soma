'use strict';
/* ============================================================
   Registry dos MÓDULOS de lançamento (um por relatório/empresa)
   ------------------------------------------------------------
   Cada entrada descreve TUDO que distingue um relatório dos outros:
   rótulo, empresa, logo, cores (app + PDF), pasta raiz no Drive,
   template do Excel, layout do PDF e os campos do lançamento.

   Carregado ANTES de js/core.js (core executa loadState() no topo e
   precisa de TABELAS). Para acrescentar um 4º relatório: uma entrada
   aqui + o bloco de HTML do painel em index.html.
   ============================================================ */

const MODULOS = [
  {
    key: 'reembolso',
    tabLabel: 'Reembolso',
    label: 'Despesas para Reembolso',
    empresa: 'Soma Urbanismo S/A',
    logo: 'assets/soma-logo.png',
    accent: '#b3262d', accentDark: '#8f1e24',
    tint: '#f5e9dc', tintInk: '#a35a10', soft: '#fdf3f3',   // chips de categoria + realce de toque
    driveRoot: 'Comprovantes - Despesas Soma',          // nome LEGADO — não mudar (pastas já existentes)
    fileBase: 'Relatorio_Despesas',
    shareTitle: 'Relatório de Despesas',
    layout: 'reembolso',                                 // buildXlsx + buildPrint (retrato)
    template: 'template.xlsx',
    blocos: ['reembolso', 'alelo'],                      // seções da planilha desse layout
    header: 'reembolso',                                 // card de cabeçalho no app
    tituloPdf: 'RELATÓRIO DE DESPESAS PARA REEMBOLSO',
    tituloTabela: 'DESPESAS PARA REEMBOLSO',
    subtotalLabel: 'SUBTOTAL DESPESAS PARA REEMBOLSO:',
    campos: { estabelecimento: false, justificativa: false },
    obrigatorios: ['data', 'valor', 'categoria'],
    bank: true, periodo: false,
    grupoExport: 'soma',
    assinante: 'Murilo Rosella', assinanteCargo: 'Piloto de Aeronaves',
    aprovador: 'Gustavo Barbeitos da Gama', aprovadorCargo: 'Presidente',
    pdf: {
      bg: '#f8f4f2', paper: '#f8f4f2',
      accent: '#b3262d', accentDark: '#8f1e24', accentMid: '#7a1a21', accentDeep: '#4a0e11',
      ink: '#4e3f39', inkSoft: '#6b5c54', subtotal: '#ffff00'
    }
  },

  {
    key: 'alelo',                                        // chave estrutural histórica — NÃO renomear
    tabLabel: 'Cartão Santander',
    label: 'Despesas Cartão Santander - Soma',
    empresa: 'Soma Urbanismo S/A',
    logo: 'assets/soma-logo.png',
    accent: '#C00000', accentDark: '#8f0000',
    tint: '#f5e9dc', tintInk: '#a35a10', soft: '#fdf2f2',
    driveRoot: 'Comprovantes Cartao Santander - Despesas Soma',
    fileBase: 'Prestacao_Contas_Cartao',
    shareTitle: 'Prestação de Contas - Cartão Santander',
    layout: 'prestacao',                                 // buildPrestacaoXlsx + buildPrestacaoPrint (paisagem)
    template: 'template-santander.xlsx',
    blocos: ['alelo'],
    header: 'prestacao',
    tituloPdf: 'PRESTAÇÃO DE CONTAS - CARTÃO DE CRÉDITO',
    tituloTabela: 'DESPESAS CARTÃO SANTANDER - SOMA',
    subtotalLabel: 'SUBTOTAL DESPESAS CARTÃO SANTANDER - SOMA:',
    campos: { estabelecimento: true, justificativa: true },
    obrigatorios: ['data', 'valor', 'estabelecimento', 'justificativa'],
    bank: false, periodo: true,
    grupoExport: 'soma',
    assinante: 'Murilo Rosella', assinanteCargo: 'Piloto de Aeronaves',
    aprovador: 'Gustavo Barbeitos da Gama', aprovadorCargo: 'Presidente',
    pdf: {
      bg: '#ffffff', paper: '#ffffff',
      accent: '#C00000', accentDark: '#8f0000', accentMid: '#8f0000', accentDeep: '#5c0000',
      ink: '#000000', inkSoft: '#444444', subtotal: '#D8D8D8', gray: '#D8D8D8'
    }
  },

  {
    key: 'sagestao',
    tabLabel: 'SA Ambiental',
    label: 'Despesas SA Ambiental',
    empresa: 'SA Gestão de Serviços Especializados Ltda',
    logo: 'assets/sa-logo.png',
    /* verdes AMOSTRADOS do assets/sa-logo.png: folha #407830, folha clara #488840,
       folha oliva #789838 (o vinho #600810 da "mão" fica de fora da UI de propósito) */
    accent: '#407830', accentDark: '#2c5a21',
    tint: '#e4efdb', tintInk: '#3f6b23', soft: '#f1f7ec',
    driveRoot: 'Comprovantes - SA Ambiental',
    fileBase: 'Relatorio_Despesas_SA',
    shareTitle: 'Relatório de Despesas - SA Ambiental',
    layout: 'reembolso',
    template: 'template.xlsx',
    blocos: ['sagestao'],                                // uma única tabela na planilha
    header: 'reembolso',
    tituloPdf: 'RELATÓRIO DE DESPESAS PARA REEMBOLSO',
    tituloTabela: 'DESPESAS PARA REEMBOLSO',
    subtotalLabel: 'SUBTOTAL DESPESAS PARA REEMBOLSO:',
    campos: { estabelecimento: false, justificativa: false },
    obrigatorios: ['data', 'valor', 'categoria'],
    bank: true, periodo: false,
    grupoExport: 'sa',
    /* a SA contrata prestadores, nao funcionarios: troca o rotulo no Excel (B5) e no PDF */
    rotuloFuncionario: 'Prestador',
    /* sem bloco de assinaturas no rodape do relatorio (Excel e PDF) */
    assinaturas: false,
    /* sem o bloco "Observacoes" (limites por categoria + cupons) no rodape do PDF */
    observacoes: false,
    assinante: 'Murilo Rosella', assinanteCargo: 'Piloto de Aeronaves',
    aprovador: 'Gustavo Barbeitos da Gama', aprovadorCargo: 'Presidente',
    /* o modelo .xlsx é o mesmo da Soma: trocamos o logo do cabeçalho
       (xl/media/image3.png) e as cores da marca dentro do arquivo */
    excelLogo: true,
    excelColors: {
      'B3262D': '407830',   // vermelho Soma  -> verde da folha do logo
      'DE646A': '789838',   // vermelho claro -> verde oliva do logo
      '4E3F39': '35402F',   // marrom (texto/bordas) -> verde escuro acinzentado
      '382D28': '232B1E',
      'A58D83': '8F9E85',
      'B5A199': 'AFBCA4',
      'F8F4F2': 'F5F8F2',   // papel
      'FFFF00': 'D8E8C4'    // realce do subtotal
    },
    pdf: {
      bg: '#f5f8f2', paper: '#f5f8f2',
      accent: '#407830', accentDark: '#2c5a21', accentMid: '#33632a', accentDeep: '#1e4416',
      ink: '#35402f', inkSoft: '#5f6b56', subtotal: '#d8e8c4'
    }
  }
];

const MOD = {};
MODULOS.forEach((m) => { MOD[m.key] = m; });
const TABELAS = MODULOS.map((m) => m.key);
const TABELA_PADRAO = TABELAS[0];

/* módulo por chave, com fallback seguro para o padrão */
function modOf(key) { return MOD[key] || MOD[TABELA_PADRAO]; }

/* { reembolso: fn('reembolso'), alelo: …, sagestao: … } — usado nos defaults do estado */
function mapPorTabela(fn) {
  const o = {};
  for (const t of TABELAS) o[t] = fn(t);
  return o;
}

/* perfil (cabeçalho + banco + período) de um módulo, sempre normalizado */
function perfilVazio() {
  return {
    funcionario: '', dataSolicitacao: '', referente: '',
    bank: { nome: '', cpf: '', banco: '', agencia: '', conta: '', pix: '' },
    santPeriodo: { start: '', end: '' }
  };
}
function normalizePerfil(p) {
  const base = perfilVazio();
  const s = p || {};
  return {
    funcionario: s.funcionario || '',
    dataSolicitacao: s.dataSolicitacao || '',
    referente: s.referente || '',
    bank: Object.assign(base.bank, s.bank || {}),
    santPeriodo: Object.assign(base.santPeriodo, s.santPeriodo || {})
  };
}
function perfilDe(key) {
  if (!state.perfis) state.perfis = mapPorTabela(() => perfilVazio());
  if (!state.perfis[key]) state.perfis[key] = perfilVazio();
  return state.perfis[key];
}

/* ------------------------------------------------------------
   docForModule — peça central da generalização.
   Achata o perfil do módulo na RAIZ do documento, para que
   buildXlsx / buildPrint / fileBaseOf continuem lendo
   D.funcionario / D.bank / D.dataSolicitacao sem saber de módulos.
   Snapshots antigos do histórico (que já têm esses campos na raiz e
   não têm `perfis`) passam intactos.
   ------------------------------------------------------------ */
function docForModule(src, key) {
  const D = src || state;
  const p = D.perfis && D.perfis[key];
  if (!p) return D;
  return Object.assign({}, D, {
    funcionario: p.funcionario || D.funcionario || '',
    dataSolicitacao: p.dataSolicitacao || D.dataSolicitacao || '',
    referente: p.referente || D.referente || '',
    bank: Object.assign({}, D.bank || {}, p.bank || {}),
    santPeriodo: Object.assign({}, D.santPeriodo || {}, p.santPeriodo || {})
  });
}

/* Módulo "dono" de uma seleção de exportação (ver resolveExport em excel.js) */
function modulosSelecionados(sections) {
  return TABELAS.filter((t) => sections && sections[t]);
}
