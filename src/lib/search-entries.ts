/**
 * Entradas do índice de busca global, por tipo de registro.
 * O servidor grava uma entrada por registro (searchIndex/{kind}__{id}) na mesma
 * transação da criação/edição; a busca filtra pelo acesso de quem pesquisa.
 * Título e subtítulo NUNCA levam dados pessoais.
 */
import type { AtleticaEvent, Campaign, ContentItem, ExtensionProject, FinanceEntry, InstitutionalDocument, Meeting, ModuleKey, SearchResultKind, SportTeam } from "@/types";
import { ENTRY_TYPE_LABELS, EVENT_TYPE_LABELS, MEETING_STATUS, SPORT_CATEGORY_LABELS } from "./labels";
import { formatDate, formatMoney } from "./format";
import { campaignReaders, contentReaders, documentReaders, eventReaders, meetingReaders, projectReaders, teamReaders } from "./record-readers";
import { TOKEN } from "./access-tokens";

export interface SearchIndexEntry {
  kind: SearchResultKind;
  module: ModuleKey;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  at: string;
  /** Textos usados para gerar os termos (não são gravados). */
  text: (string | undefined | null)[];
  readers: string[];
  archived?: boolean;
}

export const searchEntryFor = {
  campaign: (c: Campaign): SearchIndexEntry => ({
    kind: "campaign",
    module: "campaigns",
    id: c.id,
    title: c.name,
    subtitle: `${c.code} · ${c.prize}`,
    href: `/campanhas/${c.id}`,
    at: c.updatedAt,
    text: [c.code, c.prize, c.description],
    readers: campaignReaders(c),
    archived: c.status === "closed",
  }),
  event: (e: AtleticaEvent): SearchIndexEntry => ({
    kind: "event",
    module: "events",
    id: e.id,
    title: e.name,
    subtitle: `${EVENT_TYPE_LABELS[e.type]} · ${formatDate(e.date)}`,
    href: `/eventos/${e.id}`,
    at: e.updatedAt,
    text: [e.code, e.location, e.description],
    readers: eventReaders(e),
    archived: e.status === "done" || e.status === "cancelled",
  }),
  document: (d: InstitutionalDocument, categoryName?: string): SearchIndexEntry => ({
    kind: "document",
    module: "documents",
    id: d.id,
    title: d.name,
    subtitle: categoryName ?? "Documento",
    href: `/documentos/${d.id}`,
    at: d.updatedAt,
    text: [d.description, categoryName],
    readers: documentReaders(d),
    archived: d.status === "archived",
  }),
  meeting: (m: Meeting): SearchIndexEntry => ({
    kind: "meeting",
    module: "meetings",
    id: m.id,
    title: m.title,
    subtitle: `${formatDate(m.date)} · ${MEETING_STATUS[m.status].label}`,
    href: `/secretaria/${m.id}`,
    at: m.updatedAt,
    text: [m.code, m.agenda.join(" "), m.summary],
    readers: meetingReaders(m),
    archived: m.status === "archived",
  }),
  /** Lançamentos: o acesso é pela permissão finance.view (conferida na busca). */
  finance: (f: FinanceEntry): SearchIndexEntry => ({
    kind: "finance",
    module: "finance",
    id: f.id,
    title: f.description,
    subtitle: `${ENTRY_TYPE_LABELS[f.type]} · ${formatMoney(f.amount)} · ${formatDate(f.date)}`,
    href: `/financeiro/lancamentos?id=${f.id}`,
    at: f.updatedAt,
    text: [f.code],
    readers: [TOKEN.all],
    archived: f.status === "cancelled",
  }),
  project: (p: ExtensionProject): SearchIndexEntry => ({
    kind: "project",
    module: "extension",
    id: p.id,
    title: p.name,
    subtitle: `${p.code} · ${formatDate(p.date)}`,
    href: `/extensao/${p.id}`,
    at: p.updatedAt,
    text: [p.code, p.description],
    readers: projectReaders(p),
    archived: p.status === "done" || p.status === "cancelled",
  }),
  content: (c: ContentItem): SearchIndexEntry => ({
    kind: "content",
    module: "marketing",
    id: c.id,
    title: c.title,
    subtitle: `${c.code}${c.publishDate ? ` · publicação ${formatDate(c.publishDate)}` : ""}`,
    href: `/marketing?item=${c.id}`,
    at: c.updatedAt,
    text: [c.code, c.briefing],
    readers: contentReaders(c),
    archived: c.status === "cancelled",
  }),
  team: (t: SportTeam): SearchIndexEntry => ({
    kind: "team",
    module: "sports",
    id: t.id,
    title: t.name,
    subtitle: `${t.code} · ${t.sport} ${SPORT_CATEGORY_LABELS[t.category].toLowerCase()}`,
    href: `/esportes/${t.id}`,
    at: t.updatedAt,
    // Nomes de atletas não entram no índice (só o que é da modalidade).
    text: [t.code, t.sport, t.coach, t.description, ...t.competitions.map((c) => c.name)],
    readers: teamReaders(t),
    archived: t.status === "archived",
  }),
};
