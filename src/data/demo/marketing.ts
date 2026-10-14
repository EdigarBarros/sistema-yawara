import type { Channel, ContentItem, ContentStatus, ContentType } from "@/types";
import { audience, h, type Clock } from "./helpers";
import { USR } from "./organization";
import { EVT } from "./events";
import { CMP } from "./campaigns";

interface Row {
  title: string;
  type: ContentType;
  status: ContentStatus;
  responsibleId: string;
  publishIn?: number;
  createdDaysAgo: number;
  channels: Channel[];
  briefing: string;
  campaignId?: string;
  eventId?: string;
  notes?: string;
  files?: { name: string; size: number; mimeType: string }[];
  links?: { label: string; url: string }[];
}

export function buildContents(clock: Clock): ContentItem[] {
  const rows: Row[] = [
    { title: "Arte principal da Calourada", type: "arte", status: "approved", responsibleId: USR.julia, publishIn: 1, createdDaysAgo: 9, channels: ["instagram_feed", "instagram_stories"], eventId: EVT.calourada, briefing: "Arte com o mascote em destaque, data, local e chamada para o 1º lote. Usar ouro e marinho do manual.", files: [{ name: "calourada-feed.png", size: 1_450_000, mimeType: "image/png" }] },
    { title: "Vídeo de anúncio das atrações", type: "reels", status: "production", responsibleId: USR.julia, publishIn: 4, createdDaysAgo: 6, channels: ["instagram_feed", "tiktok"], eventId: EVT.calourada, briefing: "Reels de 20 a 30 segundos revelando as atrações, com contagem regressiva.", links: [{ label: "Roteiro (link de exemplo)", url: "https://example.org/roteiro" }] },
    { title: "Contagem regressiva — Calourada", type: "story", status: "briefing", responsibleId: USR.julia, publishIn: 9, createdDaysAgo: 2, channels: ["instagram_stories"], eventId: EVT.calourada, briefing: "Sequência de stories nos três dias anteriores ao evento." },
    { title: "Divulgação da Rifa do Kit Interatlética", type: "carrossel", status: "published", responsibleId: USR.livia, publishIn: -17, createdDaysAgo: 19, channels: ["instagram_feed", "whatsapp"], campaignId: CMP.kit, briefing: "Carrossel com o prêmio, valor do número e como comprar com os integrantes.", files: [{ name: "rifa-kit-carrossel.zip", size: 3_200_000, mimeType: "application/zip" }] },
    { title: "Lembrete: sorteio da Rifa de Chocolates", type: "story", status: "review", responsibleId: USR.julia, publishIn: 3, createdDaysAgo: 3, channels: ["instagram_stories", "whatsapp"], campaignId: CMP.chocolate, briefing: "Lembrar o prazo final e reforçar que o sorteio acontece ao vivo (sem resultado antecipado)." },
    { title: "Lançamento do moletom oficial", type: "arte", status: "published", responsibleId: USR.livia, publishIn: -2, createdDaysAgo: 7, channels: ["instagram_feed"], campaignId: CMP.moletom, briefing: "Foto do moletom com fundo marinho e chamada para a rifa." },
    { title: "Programação da Semana do Psicólogo", type: "carrossel", status: "approved", responsibleId: USR.julia, publishIn: 2, createdDaysAgo: 8, channels: ["instagram_feed", "mural"], eventId: EVT.semanaPsi, briefing: "Um card por dia com palestrante, horário e local." },
    { title: "Cobertura do Bazar Solidário", type: "video", status: "published", responsibleId: USR.julia, publishIn: -19, createdDaysAgo: 21, channels: ["instagram_feed"], eventId: EVT.bazar, briefing: "Vídeo curto com bastidores e agradecimento aos doadores." },
    { title: "Convocação para os Jogos Interatléticas", type: "arte", status: "briefing", responsibleId: USR.livia, publishIn: 15, createdDaysAgo: 1, channels: ["instagram_feed", "whatsapp"], eventId: EVT.interatletica, briefing: "Chamada para atletas se inscreverem nas modalidades." },
    { title: "Post institucional — o que faz cada departamento", type: "carrossel", status: "production", responsibleId: USR.livia, publishIn: 6, createdDaysAgo: 5, channels: ["instagram_feed"], briefing: "Apresentar os departamentos para os calouros, com convite para assessoria." },
    { title: "Enquete de horários dos treinos", type: "story", status: "cancelled", responsibleId: USR.julia, publishIn: -5, createdDaysAgo: 10, channels: ["instagram_stories"], briefing: "Substituída por formulário enviado pelos grupos de mensagens.", notes: "Cancelado pela diretoria de Esportes (exemplo)." },
    { title: "Texto de boas-vindas para o grupo dos calouros", type: "texto", status: "review", responsibleId: USR.livia, publishIn: 3, createdDaysAgo: 2, channels: ["whatsapp"], eventId: EVT.recepcao, briefing: "Mensagem curta, acolhedora, com link para a recepção." },
  ];

  return rows.map((r, i) => {
    const createdAt = clock.at(-r.createdDaysAgo, 10 + (i % 6), (i * 11) % 60);
    const history = [h(createdAt, r.responsibleId, "created", "Conteúdo criado com briefing")];
    if (r.status !== "briefing") history.push(h(clock.at(-r.createdDaysAgo + 1, 15, 0), r.responsibleId, "status", "Etapa alterada para Em produção"));
    if (["review", "approved", "published"].includes(r.status)) history.push(h(clock.at(-Math.max(r.createdDaysAgo - 2, 0), 17, 0), r.responsibleId, "status", "Enviado para revisão"));
    if (["approved", "published"].includes(r.status)) history.push(h(clock.at(-Math.max(r.createdDaysAgo - 3, 0), 19, 0), USR.livia, "status", "Material aprovado"));
    if (r.status === "published") history.push(h(clock.at(r.publishIn ?? 0, 12, 0), r.responsibleId, "status", "Marcado como publicado"));
    if (r.status === "cancelled") history.push(h(clock.at(-r.createdDaysAgo + 2, 12, 0), USR.livia, "status", "Conteúdo cancelado"));
    return {
      id: `cnt-seed-${i + 1}`,
      code: `MKT-${String(i + 31).padStart(4, "0")}`,
      title: r.title,
      type: r.type,
      campaignId: r.campaignId,
      eventId: r.eventId,
      responsibleId: r.responsibleId,
      publishDate: r.publishIn === undefined ? undefined : clock.date(r.publishIn),
      channels: r.channels,
      briefing: r.briefing,
      notes: r.notes,
      links: r.links ?? [],
      files: r.files ?? [],
      status: r.status,
      access: audience.all(),
      createdBy: r.responsibleId,
      createdAt,
      updatedAt: history[history.length - 1].at,
      history,
    };
  });
}
