"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Lock, Paperclip, Pencil } from "lucide-react";
import type { ContentItem, ContentStatus } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaigns, useDirectory, useEvents } from "@/hooks/use-data";
import { allowedContentStatuses, canChangeContent, canEditContent } from "@/lib/policies";
import { CHANNEL_LABELS, CONTENT_FLOW, CONTENT_STATUS, CONTENT_TYPE_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { MARKETING_ACCEPT } from "@/services/firebase/marketing";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DetailList, SectionTitle } from "@/components/shared/page";
import { FileRow } from "@/components/shared/pickers";
import { FileActions } from "@/components/shared/file-actions";
import { AudienceSummary } from "@/components/shared/audience";
import { HistoryTimeline } from "@/components/shared/history";
import { DemoNotice } from "@/components/shared/states";
import { confirmAction } from "@/components/shared/confirm";
import { CONTENT_SCOPE_LABELS, ContentFormDialog } from "./content-form-dialog";

/** Linha do tempo das etapas de produção. */
function FlowTrack({ status }: { status: ContentStatus }) {
  if (status === "cancelled") return <Badge tone="danger">Cancelado</Badge>;
  const index = CONTENT_FLOW.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Etapa de produção">
      {CONTENT_FLOW.map((s, i) => (
        <li key={s} className="min-w-0">
          <div className={cn("h-1.5 rounded-full", i <= index ? "bg-gold" : "bg-surface-3")} />
          <p className={cn("mt-1.5 truncate text-[11px]", i === index ? "font-semibold text-fg" : "text-fg-subtle")} aria-current={i === index ? "step" : undefined}>
            {CONTENT_STATUS[s].label}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ContentSheet({ item, onOpenChange }: { item: ContentItem | null; onOpenChange: (o: boolean) => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const { data: campaigns } = useCampaigns();
  const { data: events } = useEvents(access.canModule("events"));
  const [editOpen, setEditOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const move = useAction((id: string, s: ContentStatus) => services.marketing.setStatus(id, s), { success: (c) => `Etapa: ${CONTENT_STATUS[c.status].label}` });
  const attach = useAction((id: string, files: File[]) => services.marketing.addFiles(id, files), {
    success: isDemoMode ? "Arquivos anexados (somente neste navegador)" : "Arquivos anexados",
  });

  if (!item) return <Sheet open={false} onOpenChange={onOpenChange} />;
  const ctx = access.ctx;
  const allowed = ctx ? allowedContentStatuses(ctx, item) : [];
  // Depois da aprovação, só quem aprova altera dados e arquivos (o servidor confere de novo).
  const editable = !!ctx && canChangeContent(ctx, item);
  const lockedByApproval = !!ctx && !editable && canEditContent(ctx, item);
  const nextInFlow = CONTENT_FLOW[CONTENT_FLOW.indexOf(item.status) + 1];
  const campaign = campaigns?.find((c) => c.id === item.campaignId);
  const event = events?.find((e) => e.id === item.eventId);

  const goTo = async (s: ContentStatus) => {
    if (s === "cancelled" && !(await confirmAction({ title: "Cancelar este conteúdo?", description: "Ele sai do fluxo de produção, mas o registro e o histórico são mantidos.", confirmLabel: "Cancelar conteúdo", tone: "danger" }))) return;
    move.runSafe(item.id, s);
  };

  return (
    <>
      <Sheet open={!!item} onOpenChange={onOpenChange}>
        <SheetContent
          width="lg"
          eyebrow={`${CONTENT_TYPE_LABELS[item.type]} · ${item.code}`}
          title={item.title}
          description={item.publishDate ? `Publicação prevista para ${formatDate(item.publishDate)}` : "Sem data de publicação"}
          footer={
            <>
              {nextInFlow && allowed.includes(nextInFlow) && (
                <Button variant="primary" loading={move.pending} onClick={() => goTo(nextInFlow)}>
                  Mover para {CONTENT_STATUS[nextInFlow].label} <ArrowRight />
                </Button>
              )}
              {editable && (
                <Button onClick={() => setEditOpen(true)}>
                  <Pencil /> Editar
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-6">
            <FlowTrack status={item.status} />
            {allowed.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="move-to" className="text-[12.5px] text-fg-muted">
                  Alterar etapa:
                </label>
                <select
                  id="move-to"
                  value=""
                  onChange={(e) => e.target.value && goTo(e.target.value as ContentStatus)}
                  className="h-8 rounded-md border border-line-strong bg-sunken px-2 text-[12.5px]"
                >
                  <option value="">Escolher…</option>
                  {allowed.map((s) => (
                    <option key={s} value={s}>
                      {CONTENT_STATUS[s].label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {lockedByApproval && (
              <p className="flex items-start gap-2 rounded-lg border border-line bg-sunken px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-muted">
                <Lock className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                {item.status === "published"
                  ? "Material publicado: para alterar dados ou arquivos, volte-o para “Em revisão”. Depois ele precisa ser aprovado de novo."
                  : "Material aprovado: só quem aprova pode alterar dados ou arquivos. Para mudar algo, peça a quem aprova para devolvê-lo à revisão."}
              </p>
            )}
            <div>
              <SectionTitle>Briefing</SectionTitle>
              <p className="rounded-lg border border-line bg-sunken px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line">{item.briefing}</p>
            </div>
            <DetailList
              items={[
                { label: "Responsável", value: dir.memberName(item.responsibleId) },
                { label: "Canais", value: item.channels.map((c) => CHANNEL_LABELS[c]).join(", ") },
                {
                  label: "Campanha",
                  value: campaign ? (
                    <Link href={`/campanhas/${campaign.id}`} className="text-gold-fg hover:underline">
                      {campaign.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Evento",
                  value: event ? (
                    <Link href={`/eventos/${event.id}?aba=divulgacao`} className="text-gold-fg hover:underline">
                      {event.name}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: "Criado por", value: `${dir.memberName(item.createdBy)} · ${formatDateTime(item.createdAt)}` },
              ]}
            />
            {item.notes && (
              <div>
                <SectionTitle>Observações</SectionTitle>
                <p className="text-[13px] text-fg-muted">{item.notes}</p>
              </div>
            )}
            <div>
              <SectionTitle
                action={
                  editable && (
                    <>
                      <Button size="sm" variant="ghost" loading={attach.pending} onClick={() => fileRef.current?.click()}>
                        <Paperclip /> Anexar
                      </Button>
                      <input
                        ref={fileRef}
                        type="file"
                        multiple
                        accept={isDemoMode ? undefined : MARKETING_ACCEPT}
                        className="sr-only"
                        tabIndex={-1}
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          if (files.length) attach.runSafe(item.id, files);
                          e.target.value = "";
                        }}
                      />
                    </>
                  )
                }
              >
                Arquivos e links
              </SectionTitle>
              {item.files.length === 0 && item.links.length === 0 && <p className="text-[13px] text-fg-subtle">Nenhum arquivo ou link.</p>}
              <div className="divide-y divide-line">
                {item.files.map((f, i) => {
                  const available = services.files.isAvailable(f);
                  const meta = isDemoMode ? (available ? "neste navegador" : "exemplo sem arquivo") : available ? "download autenticado" : "arquivo indisponível";
                  return <FileRow key={f.path ?? f.blobId ?? i} name={f.name} size={f.size} meta={meta} actions={<FileActions file={f} label={f.name} />} />;
                })}
                {item.links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 py-2.5 text-[13px] hover:text-gold-fg">
                    <ExternalLink className="size-4 text-fg-subtle" />
                    <span className="truncate">{l.label || l.url}</span>
                  </a>
                ))}
              </div>
            </div>
            <div>
              <SectionTitle>Quem pode ver</SectionTitle>
              <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                <AudienceSummary module="marketing" audience={item.access} labels={CONTENT_SCOPE_LABELS} alwaysIncluded={[item.createdBy, item.responsibleId]} />
                <p className="mt-2 text-[12px] text-fg-subtle">Quem criou e o responsável sempre têm acesso{editable ? ". Para compartilhar com outro departamento, edite o conteúdo." : "."}</p>
              </div>
            </div>
            <DemoNotice>A Central não publica nas redes sociais. “Publicado” é apenas a marcação feita pela equipe.</DemoNotice>
            <div>
              <SectionTitle>Histórico</SectionTitle>
              <HistoryTimeline entries={item.history} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ContentFormDialog open={editOpen} onOpenChange={setEditOpen} item={item} />
    </>
  );
}
