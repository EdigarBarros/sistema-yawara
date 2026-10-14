import type { DocumentCategory, InstitutionalDocument } from "@/types";
import { audience, h, type Clock } from "./helpers";
import { DEP, ROLE, USR } from "./organization";
import { EVT } from "./events";

export const DOC_CAT = {
  estatuto: "dcat-estatuto",
  fundacao: "dcat-ata-fundacao",
  atas: "dcat-atas",
  administrativos: "dcat-administrativos",
  financeiros: "dcat-rel-financeiros",
  eventos: "dcat-rel-eventos",
  extensao: "dcat-rel-extensao",
  contratos: "dcat-contratos",
  propostas: "dcat-propostas",
  certificados: "dcat-certificados",
  identidade: "dcat-identidade",
  outros: "dcat-outros",
} as const;

export const DOC = {
  estatuto: "doc-estatuto",
  fundacao: "doc-ata-fundacao",
  ataSetembro: "doc-ata-setembro",
  relFinanceiro: "doc-rel-financeiro-s1",
  relBazar: "doc-rel-bazar",
  relSemana: "doc-rel-semana-2025",
  contratoEspaco: "doc-contrato-espaco",
  propostaPatrocinio: "doc-proposta-patrocinio",
  modeloCertificado: "doc-modelo-certificado",
  manualMarca: "doc-manual-marca",
  arteCalourada: "doc-arte-calourada",
  regimento: "doc-regimento",
  calendario2025: "doc-calendario-2025",
} as const;

export function buildDocumentCategories(): DocumentCategory[] {
  return [
    { id: DOC_CAT.estatuto, name: "Estatuto" },
    { id: DOC_CAT.fundacao, name: "Ata de fundação" },
    { id: DOC_CAT.atas, name: "Atas de reuniões" },
    { id: DOC_CAT.administrativos, name: "Documentos administrativos" },
    { id: DOC_CAT.financeiros, name: "Relatórios financeiros" },
    { id: DOC_CAT.eventos, name: "Relatórios de eventos" },
    { id: DOC_CAT.extensao, name: "Relatórios de Ensino e Extensão" },
    { id: DOC_CAT.contratos, name: "Contratos" },
    { id: DOC_CAT.propostas, name: "Propostas" },
    { id: DOC_CAT.certificados, name: "Certificados" },
    { id: DOC_CAT.identidade, name: "Identidade visual" },
    { id: DOC_CAT.outros, name: "Outros" },
  ];
}

type DocSeed = Omit<InstitutionalDocument, "sample" | "history" | "updatedAt" | "links"> &
  Partial<Pick<InstitutionalDocument, "links" | "history" | "updatedAt">>;

function doc(clock: Clock, d: DocSeed): InstitutionalDocument {
  const last = d.versions[d.versions.length - 1];
  return {
    links: {},
    sample: true,
    updatedAt: last?.uploadedAt ?? d.createdAt,
    history: [h(d.createdAt, d.createdBy, "created", "Documento adicionado")],
    ...d,
  };
}

/** Todos os documentos são EXEMPLOS: não há arquivos oficiais da Atlética anexados. */
export function buildDocuments(clock: Clock): InstitutionalDocument[] {
  const pdf = (name: string, kb: number) => ({ name, size: kb * 1024, mimeType: "application/pdf" });
  return [
    doc(clock, {
      id: DOC.estatuto, name: "Estatuto social (exemplo)", description: "Exemplo de estatuto para demonstrar o versionamento. Não é o estatuto oficial.",
      categoryId: DOC_CAT.estatuto, departmentId: DEP.secretaria, access: audience.all(), status: "current",
      versions: [
        { version: 1, file: pdf("estatuto-exemplo-v1.pdf", 312), uploadedBy: USR.helena, uploadedAt: clock.at(-240, 10, 0), note: "Versão inicial" },
        { version: 2, file: pdf("estatuto-exemplo-v2.pdf", 328), uploadedBy: USR.helena, uploadedAt: clock.at(-60, 15, 20), note: "Alteração aprovada em assembleia (exemplo)" },
      ],
      createdBy: USR.helena, createdAt: clock.at(-240, 10, 0),
      history: [
        h(clock.at(-240, 10, 0), USR.helena, "created", "Documento adicionado"),
        h(clock.at(-60, 15, 20), USR.helena, "version", "Versão 2 enviada; versão 1 mantida no histórico"),
      ],
    }),
    doc(clock, {
      id: DOC.fundacao, name: "Ata de fundação (exemplo)", description: "Modelo ilustrativo de ata de fundação.",
      categoryId: DOC_CAT.fundacao, departmentId: DEP.secretaria, access: audience.all(), status: "current",
      versions: [{ version: 1, file: pdf("ata-fundacao-exemplo.pdf", 180), uploadedBy: USR.helena, uploadedAt: clock.at(-260, 9, 0) }],
      createdBy: USR.helena, createdAt: clock.at(-260, 9, 0),
    }),
    doc(clock, {
      id: DOC.ataSetembro, name: "Ata — Reunião ordinária de setembro (exemplo)", description: "Ata aprovada, gerada a partir do módulo de Secretaria.",
      categoryId: DOC_CAT.atas, departmentId: DEP.secretaria, access: audience.board(), status: "current",
      versions: [{ version: 1, file: pdf("ata-reuniao-setembro.pdf", 96), uploadedBy: USR.helena, uploadedAt: clock.at(-22, 18, 0) }],
      links: { meetingId: "mtg-ordinaria-setembro" },
      createdBy: USR.helena, createdAt: clock.at(-22, 18, 0),
    }),
    doc(clock, {
      id: DOC.relFinanceiro, name: "Relatório financeiro — 1º semestre (exemplo)", description: "Prestação de contas semestral compartilhada com a diretoria.",
      categoryId: DOC_CAT.financeiros, departmentId: DEP.financeiro, access: audience.board(), status: "current",
      versions: [{ version: 1, file: pdf("relatorio-financeiro-s1.pdf", 240), uploadedBy: USR.caio, uploadedAt: clock.at(-95, 11, 0) }],
      createdBy: USR.caio, createdAt: clock.at(-95, 11, 0),
      history: [
        h(clock.at(-95, 11, 0), USR.caio, "created", "Documento adicionado"),
        h(clock.at(-95, 11, 5), USR.caio, "shared", "Compartilhado com a diretoria"),
      ],
    }),
    doc(clock, {
      id: DOC.relBazar, name: "Relatório do Bazar Solidário (exemplo)", description: "Resumo de arrecadação e participação do bazar.",
      categoryId: DOC_CAT.eventos, departmentId: DEP.eventos, access: audience.all(), status: "current",
      versions: [{ version: 1, file: pdf("relatorio-bazar.pdf", 140), uploadedBy: USR.bruno, uploadedAt: clock.at(-16, 14, 0) }],
      links: { eventId: EVT.bazar },
      createdBy: USR.bruno, createdAt: clock.at(-16, 14, 0),
    }),
    doc(clock, {
      id: DOC.relSemana, name: "Relatório da Semana do Psicólogo 2025 (exemplo)", description: "Relatório da edição anterior, usado como referência.",
      categoryId: DOC_CAT.extensao, departmentId: DEP.extensao, access: audience.all(), status: "current",
      versions: [{ version: 1, file: pdf("relatorio-semana-psicologo-2025.pdf", 410), uploadedBy: USR.marina, uploadedAt: clock.at(-330, 10, 0) }],
      links: { eventId: EVT.semanaPsi },
      createdBy: USR.marina, createdAt: clock.at(-330, 10, 0),
    }),
    doc(clock, {
      id: DOC.contratoEspaco, name: "Contrato de locação de espaço — Calourada (exemplo)", description: "Contrato ilustrativo com valores fictícios.",
      categoryId: DOC_CAT.contratos, departmentId: DEP.eventos, access: audience.roles(ROLE.presidente, ROLE.vice, ROLE.financeiro, ROLE.eventos), status: "current",
      versions: [{ version: 1, file: pdf("contrato-espaco-calourada.pdf", 205), uploadedBy: USR.bruno, uploadedAt: clock.at(-4, 10, 30) }],
      links: { eventId: EVT.calourada },
      createdBy: USR.bruno, createdAt: clock.at(-4, 10, 30),
    }),
    doc(clock, {
      id: DOC.propostaPatrocinio, name: "Proposta de patrocínio (exemplo)", description: "Modelo de proposta comercial para parceiros.",
      categoryId: DOC_CAT.propostas, departmentId: DEP.financeiro, access: audience.directors(), status: "draft",
      versions: [{ version: 1, file: pdf("proposta-patrocinio.pdf", 520), uploadedBy: USR.caio, uploadedAt: clock.at(-12, 16, 0) }],
      createdBy: USR.caio, createdAt: clock.at(-12, 16, 0),
    }),
    doc(clock, {
      id: DOC.modeloCertificado, name: "Modelo de certificado (exemplo)", description: "Modelo-base usado nos certificados demonstrativos.",
      categoryId: DOC_CAT.certificados, departmentId: DEP.extensao, access: audience.all(), status: "current",
      versions: [{ version: 1, file: pdf("modelo-certificado.pdf", 88), uploadedBy: USR.marina, uploadedAt: clock.at(-70, 9, 0) }],
      createdBy: USR.marina, createdAt: clock.at(-70, 9, 0),
    }),
    doc(clock, {
      id: DOC.manualMarca, name: "Manual de identidade visual (exemplo)", description: "Cores, tipografia e usos do escudo e do mascote.",
      categoryId: DOC_CAT.identidade, departmentId: DEP.marketing, access: audience.all(), status: "current",
      versions: [{ version: 1, file: pdf("manual-identidade-yawara.pdf", 2300), uploadedBy: USR.livia, uploadedAt: clock.at(-45, 13, 0) }],
      createdBy: USR.livia, createdAt: clock.at(-45, 13, 0),
    }),
    doc(clock, {
      id: DOC.arteCalourada, name: "Arte oficial — Calourada 2026.2 (aprovada)", description: "Arte aprovada pelo Marketing e compartilhada com a diretoria.",
      categoryId: DOC_CAT.identidade, departmentId: DEP.marketing, access: audience.board(), status: "current",
      versions: [{ version: 1, file: { name: "arte-calourada-feed.png", size: 1_450_000, mimeType: "image/png" }, uploadedBy: USR.livia, uploadedAt: clock.at(-1, 19, 0) }],
      links: { eventId: EVT.calourada },
      createdBy: USR.livia, createdAt: clock.at(-1, 19, 0),
      history: [
        h(clock.at(-1, 19, 0), USR.livia, "created", "Documento adicionado"),
        h(clock.at(-1, 19, 2), USR.livia, "shared", "Compartilhado com a diretoria"),
      ],
    }),
    doc(clock, {
      id: DOC.regimento, name: "Regimento interno — rascunho (exemplo)", description: "Rascunho em discussão pela diretoria.",
      categoryId: DOC_CAT.administrativos, departmentId: DEP.presidencia, access: audience.board(), status: "draft",
      versions: [{ version: 1, file: pdf("regimento-rascunho.pdf", 150), uploadedBy: USR.rebeca, uploadedAt: clock.at(-9, 21, 0) }],
      createdBy: USR.rebeca, createdAt: clock.at(-9, 21, 0),
    }),
    doc(clock, {
      id: DOC.calendario2025, name: "Calendário de eventos 2025 (exemplo)", description: "Calendário do ano anterior, mantido para consulta.",
      categoryId: DOC_CAT.outros, departmentId: DEP.eventos, access: audience.all(), status: "archived",
      versions: [{ version: 1, file: pdf("calendario-2025.pdf", 64), uploadedBy: USR.bruno, uploadedAt: clock.at(-300, 10, 0) }],
      createdBy: USR.bruno, createdAt: clock.at(-300, 10, 0),
      history: [
        h(clock.at(-300, 10, 0), USR.bruno, "created", "Documento adicionado"),
        h(clock.at(-40, 10, 0), USR.helena, "archived", "Documento arquivado"),
      ],
    }),
  ];
}
