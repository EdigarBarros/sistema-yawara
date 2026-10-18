"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, CalendarRange, CheckCircle2, Clock, FileDown, FileText, MapPin, Pencil, Send, Undo2, UserRound } from "lucide-react";
import type { MeetingStatus } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocuments, useEvents, useMeeting } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { allowedMeetingTransitions, canEditMeeting } from "@/lib/policies";
import { MEETING_MODE_LABELS, MEETING_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { MetaItem, PageHeader, Panel } from "@/components/shared/page";
import { DemoNotice, RecordErrorState, PageSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/badges";
import { AudienceSummary } from "@/components/shared/audience";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { approvalEntry, exportMeetingPdf } from "@/features/meetings/meeting-pdf";

const TRANSITION_UI: Record<MeetingStatus, { label: string; icon: React.ReactNode; title: string; description: string; primary?: boolean; danger?: boolean }> = {
  pending_approval: {
    label: "Enviar para aprovação",
    icon: <Send />,
    title: "Enviar ata para aprovação?",
    description: isDemoMode
      ? "A diretoria será avisada. A ata ainda pode ser editada até ser aprovada."
      : "Quem pode aprovar atas e tem acesso a esta reunião será avisado. A ata ainda pode ser editada até ser aprovada.",
    primary: true,
  },
  approved: { label: "Aprovar ata", icon: <CheckCircle2 />, title: "Aprovar esta ata?", description: "Atas aprovadas ficam bloqueadas para edição.", primary: true },
  draft: { label: "Devolver para rascunho", icon: <Undo2 />, title: "Devolver para rascunho?", description: "A ata volta a poder ser editada e precisará ser aprovada novamente." },
  archived: { label: "Arquivar ata", icon: <Archive />, title: "Arquivar esta ata?", description: "Ela continua disponível para consulta.", danger: true },
};

const STEPS: MeetingStatus[] = ["draft", "pending_approval", "approved", "archived"];

function StatusTrack({ status }: { status: MeetingStatus }) {
  const index = STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Situação do registro">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            aria-current={s === status ? "step" : undefined}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium",
              i < index && "border-ok/40 text-ok",
              i === index && "border-gold bg-gold/10 text-fg",
              i > index && "border-line text-fg-subtle",
            )}
          >
            {i < index ? "✓ " : ""}
            {MEETING_STATUS[s].label}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-4 bg-line-strong" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const access = useAccess();
  const dir = useDirectory();
  const { data: m, isLoading, isError, error, refetch } = useMeeting(id);
  const docsQuery = useDocuments(access.canModule("documents"));
  const documents = docsQuery.data;
  const eventsQuery = useEvents(access.canModule("events") && !!m?.eventId);
  useBreadcrumbTitle(`/secretaria/${id}`, m?.title);
  const [generating, setGenerating] = useState(false);
  const transition = useAction((s: MeetingStatus) => services.meetings.setStatus(id, s), { success: (r) => `Ata: ${MEETING_STATUS[r.status].label}` });

  if (isLoading) return <PageSkeleton />;
  if (isError || !m) return <RecordErrorState error={error} notFound="Reunião não encontrada" backHref="/secretaria" onRetry={() => refetch()} />;

  const ctx = access.ctx;
  const transitions = ctx ? allowedMeetingTransitions(ctx, m) : [];
  const editable = !!ctx && canEditMeeting(ctx, m);
  const docName = (docId: string) => documents?.find((d) => d.id === docId)?.name;
  const relatedEvent = m.eventId ? eventsQuery.data?.find((e) => e.id === m.eventId) : undefined;
  const eventName = (eventId: string) => eventsQuery.data?.find((e) => e.id === eventId)?.name;
  const guests = m.guests ?? [];
  const approval = approvalEntry(m);

  const pdf = async () => {
    setGenerating(true);
    try {
      // Registro na auditoria ANTES de entregar o arquivo (fechar a aba logo após o download não perde o
      // registro). Melhor esforço: nunca lança erro nem impede a exportação. Sem dados pessoais no resumo.
      await services.audit.recordExport({ module: "meetings", resourceType: "meeting", resourceId: m.id, summary: "PDF da ata", personalData: false }).catch(() => undefined);
      await exportMeetingPdf({
        meeting: m,
        memberName: dir.memberName,
        roleName: (mid) => dir.roleOf(mid)?.name,
        documentName: docName,
        eventName,
        generatedBy: access.user?.name ?? "—",
      });
      notifySuccess("PDF da ata gerado", isDemoMode ? "Gerado neste navegador a partir dos dados da demonstração." : "PDF gerado no navegador a partir dos dados registrados.");
    } catch (e) {
      notifyError(e, "Não foi possível gerar o PDF.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ href: "/secretaria", label: "Secretaria e reuniões" }}
        eyebrow={`Reunião · ${m.code}`}
        title={m.title}
        badge={<StatusBadge meta={MEETING_STATUS[m.status]} />}
        meta={
          <>
            <MetaItem icon={<CalendarDays />}>
              <b>{formatDate(m.date)}</b>
            </MetaItem>
            <MetaItem icon={<Clock />}>
              {formatTime(m.startTime)}
              {m.endTime && ` às ${formatTime(m.endTime)}`}
            </MetaItem>
            <MetaItem icon={<MapPin />}>
              {MEETING_MODE_LABELS[m.mode]} · {m.location}
            </MetaItem>
            {approval && (
              <MetaItem icon={<CheckCircle2 />}>
                Aprovada por {dir.memberName(approval.actorId)} em {formatDateTime(approval.at)}
              </MetaItem>
            )}
          </>
        }
        actions={
          <>
            {access.can("meetings.export") && (
              <Button onClick={pdf} loading={generating}>
                <FileDown /> Gerar PDF da ata
              </Button>
            )}
            {editable && (
              <ButtonLink href={`/secretaria/${m.id}/editar`}>
                <Pencil /> Editar
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <StatusTrack status={m.status} />
        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {transitions.map((s) => {
              const ui = s === "approved" && m.status === "archived" ? { ...TRANSITION_UI.approved, label: "Desarquivar", icon: <ArchiveRestore />, title: "Desarquivar ata?", description: "A ata volta para “Aprovada”." } : TRANSITION_UI[s];
              return (
                <Button
                  key={s}
                  size="sm"
                  variant={ui.primary ? "primary" : ui.danger ? "danger" : "secondary"}
                  loading={transition.pending}
                  onClick={async () => {
                    if (await confirmAction({ title: ui.title, description: ui.description, confirmLabel: ui.label, tone: ui.danger ? "danger" : "default" })) transition.runSafe(s);
                  }}
                >
                  {ui.icon} {ui.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Panel title="Pauta">
            {m.agenda.length ? (
              <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] marker:text-fg-subtle">
                {m.agenda.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-fg-subtle">Pauta não registrada.</p>
            )}
          </Panel>
          <Panel title="Resumo das discussões">
            {m.summary ? <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-fg-muted">{m.summary}</p> : <p className="text-[13px] text-fg-subtle">Ainda não registrado.</p>}
          </Panel>
          <Panel title="Decisões">
            {m.decisions.length ? (
              <ul className="space-y-2">
                {m.decisions.map((d, i) => (
                  <li key={i} className="flex gap-2.5 text-[13.5px]">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> {d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-subtle">Nenhuma decisão registrada.</p>
            )}
          </Panel>
          <Panel title="Encaminhamentos" bodyClassName={m.actions.length ? "py-1.5" : undefined}>
            {m.actions.length ? (
              <ul className="divide-y divide-line">
                {m.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13.5px]">
                    <span className="min-w-0 flex-1 font-medium">{a.description}</span>
                    <span className="text-[12.5px] text-fg-muted">{a.responsibleId ? dir.memberName(a.responsibleId) : "Sem responsável"}</span>
                    <span className="tnum font-mono text-[12px] text-fg-subtle">{a.dueDate ? formatDate(a.dueDate) : "sem prazo"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-subtle">Nenhum encaminhamento registrado.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title={`Participantes (${m.participantIds.length})`} bodyClassName="py-1.5">
            <ul className="divide-y divide-line">
              {m.participantIds.map((pid) => (
                <li key={pid} className="flex items-center gap-3 px-5 py-2">
                  <MemberAvatar name={dir.memberName(pid)} id={pid} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{dir.memberName(pid)}</p>
                    <p className="truncate text-[11.5px] text-fg-subtle">{dir.roleOf(pid)?.name}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          {guests.length > 0 && (
            <Panel title={`Convidados externos (${guests.length})`} description="Sem conta na Central" bodyClassName="py-1.5">
              <ul className="divide-y divide-line">
                {guests.map((g, i) => (
                  <li key={`${g}-${i}`} className="flex items-center gap-3 px-5 py-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-sunken text-fg-subtle" aria-hidden>
                      <UserRound className="size-3.5" />
                    </span>
                    <p className="min-w-0 truncate text-[13px] font-medium">{g}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {m.eventId && (
            <Panel title="Evento relacionado">
              {relatedEvent ? (
                <Link href={`/eventos/${relatedEvent.id}`} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2">
                  <CalendarRange className="size-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 truncate font-medium">{relatedEvent.name}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-fg-subtle">{formatDate(relatedEvent.date)}</span>
                </Link>
              ) : eventsQuery.isLoading ? (
                <p className="text-[13px] text-fg-subtle">Carregando evento…</p>
              ) : eventsQuery.isError ? (
                <p className="text-[13px] text-danger">Não foi possível carregar o evento relacionado.</p>
              ) : (
                <p className="text-[13px] text-fg-subtle">Evento restrito ao seu perfil</p>
              )}
            </Panel>
          )}
          <Panel title="Documentos relacionados" bodyClassName={m.documentIds.length ? "py-1.5" : undefined}>
            {m.documentIds.length ? (
              <ul className="divide-y divide-line">
                {m.documentIds.map((docId) => (
                  <li key={docId}>
                    {docName(docId) ? (
                      <Link href={`/documentos/${docId}`} className="flex items-center gap-2.5 px-5 py-2.5 text-[13px] hover:bg-surface-2">
                        <FileText className="size-4 shrink-0 text-fg-subtle" />
                        <span className="truncate">{docName(docId)}</span>
                      </Link>
                    ) : docsQuery.isLoading ? (
                      <p className="px-5 py-2.5 text-[13px] text-fg-subtle">Carregando documento…</p>
                    ) : docsQuery.isError ? (
                      <p className="px-5 py-2.5 text-[13px] text-danger">Não foi possível carregar o documento.</p>
                    ) : (
                      <p className="px-5 py-2.5 text-[13px] text-fg-subtle">Documento restrito ao seu perfil</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-subtle">Nenhum documento vinculado.</p>
            )}
          </Panel>
          <Panel title="Quem pode consultar">
            <AudienceSummary module="meetings" audience={m.access} alwaysIncluded={m.participantIds} />
          </Panel>
          <Panel title="Histórico">
            <HistoryTimeline entries={m.history} />
          </Panel>
        </div>
      </div>
      <DemoNotice className="mt-5">
        {isDemoMode
          ? "Registro demonstrativo. O PDF é gerado neste navegador e não substitui a ata oficial assinada."
          : "O PDF é gerado no navegador a partir dos dados registrados e não substitui a ata oficial assinada."}
      </DemoNotice>
    </>
  );
}
