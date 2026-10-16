"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Award, CalendarDays, CheckCircle2, Clock, FilePlus2, FileSpreadsheet, FileText, Lock, MapPin, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, XCircle } from "lucide-react";
import type { CertificateStatus, ProjectStatus } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocuments, useEvents, useProject } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canCloseProject, canEditProject } from "@/lib/policies";
import { ACTIVITY_TYPE_LABELS, CERTIFICATE_STATUS, PROJECT_STATUS } from "@/lib/labels";
import { isDemoMode } from "@/lib/mode";
import { formatDate, formatTime } from "@/lib/format";
import { downloadCsv, slugify } from "@/lib/export/common";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { Progress } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { DetailList, MetaItem, PageHeader, Panel } from "@/components/shared/page";
import { DemoNotice, EmptyState, RecordErrorState, PageSkeleton } from "@/components/shared/states";
import { OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { HistoryTimeline } from "@/components/shared/history";
import { ListRow } from "@/components/shared/list-row";
import { confirmAction } from "@/components/shared/confirm";
import { AddDocumentDialog } from "@/features/documents/document-form-dialog";
import { ProjectFormDialog } from "@/features/extension/project-form-dialog";
import { markAttendance as markOptimistic, settleAttendance, shownAttendance, type AttendanceMarks } from "@/features/extension/attendance";
import { attendanceRows, exportCertificatesPdf } from "@/features/extension/certificates";
import { attendeeTotal, certificateStatusMeta, RESTRICTED_ATTENDEES_TEXT } from "@/features/extension/labels";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const access = useAccess();
  const dir = useDirectory();
  const { data: p, isLoading, isError, error, refetch } = useProject(id);
  const { data: events } = useEvents(access.canModule("events"));
  const { data: documents } = useDocuments(access.canModule("documents"));
  useBreadcrumbTitle(`/extensao/${id}`, p?.name);
  const [editOpen, setEditOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [speaker, setSpeaker] = useState({ name: "", affiliation: "", topic: "" });
  const [slot, setSlot] = useState({ time: "", title: "" });
  const [attendee, setAttendee] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  // Marcação otimista: a caixa muda na hora; quando a gravação termina, vale de novo o dado do servidor.
  const [optimistic, setOptimistic] = useState<AttendanceMarks>({});
  const clickSeq = useRef(0);

  const setStatus = useAction((s: ProjectStatus) => services.extension.setStatus(id, s), { success: (r) => `Situação: ${PROJECT_STATUS[r.status].label}` });
  const addSpeaker = useAction(() => services.extension.addSpeaker(id, speaker), { success: "Palestrante adicionado" });
  const removeSpeaker = useAction((sid: string) => services.extension.removeSpeaker(id, sid), { success: "Palestrante removido" });
  const addSlot = useAction(() => services.extension.addScheduleItem(id, slot), { success: "Item adicionado à programação" });
  const removeSlot = useAction((sid: string) => services.extension.removeScheduleItem(id, sid), { success: "Item removido" });
  const addAttendee = useAction(() => services.extension.addAttendee(id, attendee), { success: "Participante adicionado" });
  const toggle = useAction((aid: string, present: boolean) => services.extension.setAttendance(id, aid, present));
  const markAttendance = async (aid: string, present: boolean) => {
    const token = ++clickSeq.current;
    setOptimistic((o) => markOptimistic(o, aid, present, token));
    // Com sucesso o projeto já foi relido (ver QueryProvider); com falha, volta o valor salvo.
    await toggle.runSafe(aid, present);
    setOptimistic((o) => settleAttendance(o, aid, token));
  };
  const setCert = useAction((s: CertificateStatus) => services.extension.setCertificateStatus(id, s), { success: (r) => `Certificados: ${certificateStatusMeta(r.certificateStatus).label}` });
  const saveReport = useAction(() => services.extension.update(id, { report: report ?? "" }), { success: "Relatório salvo" });
  const linkDoc = useAction((docId: string) => services.extension.linkDocument(id, docId), { success: "Documento vinculado ao projeto" });

  if (isLoading) return <PageSkeleton />;
  if (isError || !p) return <RecordErrorState error={error} notFound="Projeto não encontrado" backHref="/extensao" onRetry={() => refetch()} />;

  const ctx = access.ctx;
  const editable = !!ctx && canEditProject(ctx, p);
  const closable = !!ctx && canCloseProject(ctx, p);
  const event = events?.find((e) => e.id === p.eventId);
  const isPresent = (a: { id: string; present: boolean }) => shownAttendance(optimistic, a);
  const present = p.attendees.filter(isPresent).length;
  // Lista de presença (dados pessoais): só vem preenchida para quem organiza o projeto.
  const restricted = !!p.attendeesRestricted;
  const total = attendeeTotal(p);
  const canApprove = access.can("extension.approve");
  /**
   * Registro da exportação na auditoria (melhor esforço; o resumo não traz nomes).
   * É aguardado ANTES de entregar o arquivo: fechar a aba logo após o download não perde o registro.
   */
  const recordExport = (summary: string) =>
    services.audit.recordExport({ module: "extension", resourceType: "project", resourceId: p.id, summary, personalData: true }).catch(() => undefined);
  const linkedDocs = (documents ?? []).filter((d) => p.documentIds.includes(d.id) || d.links.projectId === p.id);
  const reportValue = report ?? p.report ?? "";

  return (
    <>
      <PageHeader
        back={{ href: "/extensao", label: "Ensino e Extensão" }}
        eyebrow={`${ACTIVITY_TYPE_LABELS[p.activityType]} · ${p.code}`}
        title={p.name}
        badge={
          <>
            <StatusBadge meta={PROJECT_STATUS[p.status]} />
            <OwnershipBadge record={p} />
          </>
        }
        meta={
          <>
            <MetaItem icon={<CalendarDays />}>
              <b>{formatDate(p.date)}</b>
            </MetaItem>
            {p.time && <MetaItem icon={<Clock />}>{formatTime(p.time)}</MetaItem>}
            <MetaItem icon={<MapPin />}>{p.location}</MetaItem>
          </>
        }
        actions={
          <>
            {editable && (
              <Button onClick={() => setEditOpen(true)}>
                <Pencil /> Editar
              </Button>
            )}
            {(editable || closable) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="Alterar situação">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {editable && p.status === "planning" && (
                    <DropdownMenuItem icon={<UserPlus />} onSelect={() => setStatus.runSafe("open")}>
                      Abrir inscrições
                    </DropdownMenuItem>
                  )}
                  {closable && p.status !== "done" && (
                    <DropdownMenuItem icon={<CheckCircle2 />} onSelect={async () => (await confirmAction({ title: "Marcar como realizado?", description: "Use depois que a atividade acontecer.", confirmLabel: "Confirmar" })) && setStatus.runSafe("done")}>
                      Marcar como realizado
                    </DropdownMenuItem>
                  )}
                  {closable && p.status !== "cancelled" && (
                    <DropdownMenuItem
                      icon={<XCircle />}
                      tone="danger"
                      onSelect={async () => (await confirmAction({ title: "Cancelar o projeto?", description: "O registro é mantido.", confirmLabel: "Cancelar projeto", tone: "danger" })) && setStatus.runSafe("cancelled")}
                    >
                      Cancelar projeto
                    </DropdownMenuItem>
                  )}
                  {/* Reabrir um projeto realizado ou cancelado: no servidor, só quem pode concluir (criador ou extension.archive). */}
                  {(isDemoMode || p.status === "open" ? editable : closable) && p.status !== "planning" && (
                    <DropdownMenuItem icon={<Clock />} onSelect={() => setStatus.runSafe("planning")}>
                      Voltar para planejamento
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <Tabs defaultValue="visao">
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="programacao" count={p.speakers.length}>
            Programação e palestrantes
          </TabsTrigger>
          <TabsTrigger value="presenca" count={total}>
            Presença e certificados
          </TabsTrigger>
          <TabsTrigger value="relatorio">Relatório e documentos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="mt-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Panel title="Sobre">
              {p.description && <p className="text-[13.5px] leading-relaxed text-fg-muted">{p.description}</p>}
              {p.objective && (
                <div className="mt-4 rounded-lg border border-line bg-sunken px-4 py-3">
                  <p className="eyebrow mb-1.5">Objetivo</p>
                  <p className="text-[13.5px]">{p.objective}</p>
                </div>
              )}
              <DetailList
                className="mt-4"
                items={[
                  { label: "Tipo", value: ACTIVITY_TYPE_LABELS[p.activityType] },
                  { label: "Responsável", value: dir.memberName(p.responsibleId) },
                  { label: "Data", value: `${formatDate(p.date)}${p.time ? `, às ${formatTime(p.time)}` : ""}` },
                  { label: "Local", value: p.location },
                  { label: "Carga horária", value: p.certificateHours ? `${p.certificateHours} h` : "Não definida" },
                  { label: "Criado por", value: `${dir.memberName(p.createdBy)} em ${formatDate(p.createdAt)}` },
                ]}
              />
            </Panel>
            <div className="space-y-4">
              <Panel title="Evento vinculado">
                {event ? (
                  <Link href={`/eventos/${event.id}`} className="block rounded-lg border border-line bg-sunken px-4 py-3 hover:border-gold/40">
                    <p className="font-semibold">{event.name}</p>
                    <p className="text-[12.5px] text-fg-muted">
                      {formatDate(event.date)} · {event.location}
                    </p>
                  </Link>
                ) : p.eventId ? (
                  <p className="text-[13px] text-fg-subtle">Evento restrito ao seu perfil.</p>
                ) : (
                  <p className="text-[13px] text-fg-subtle">Não vinculado a um evento. Use “Editar” para vincular a um evento já existente.</p>
                )}
              </Panel>
              <Panel title="Participação">
                {restricted ? (
                  <>
                    <p className="text-[13px] text-fg-muted">{total} inscrito(s) na lista de presença</p>
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
                      <Lock className="size-3.5" aria-hidden /> {RESTRICTED_ATTENDEES_TEXT}
                    </p>
                  </>
                ) : (
                  <>
                    <Progress value={present} max={Math.max(1, p.attendees.length)} label="Presença" />
                    <p className="mt-2 text-[13px] text-fg-muted">
                      {present} presente(s) de {p.attendees.length} na lista
                    </p>
                  </>
                )}
                <p className="mt-3 text-[13px]">
                  Certificados: <StatusBadge meta={certificateStatusMeta(p.certificateStatus)} />
                </p>
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="programacao" className="mt-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Palestrantes e parceiros">
              {p.speakers.length === 0 ? (
                <p className="text-[13px] text-fg-subtle">Nenhum palestrante ou parceiro cadastrado.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {p.speakers.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium">{s.name}</p>
                        <p className="text-[12px] text-fg-subtle">
                          {s.affiliation}
                          {s.topic && ` · ${s.topic}`}
                        </p>
                      </div>
                      {editable && (
                        <Button size="icon-sm" variant="ghost" aria-label={`Remover ${s.name}`} onClick={async () => (await confirmAction({ title: `Remover ${s.name}?`, confirmLabel: "Remover", tone: "danger" })) && removeSpeaker.runSafe(s.id)}>
                          <Trash2 />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {editable && (
                <form
                  className="mt-4 grid gap-2 sm:grid-cols-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if ((await addSpeaker.runSafe()) !== undefined) setSpeaker({ name: "", affiliation: "", topic: "" });
                  }}
                >
                  <Input placeholder="Nome" aria-label="Nome do palestrante" value={speaker.name} onChange={(e) => setSpeaker((s) => ({ ...s, name: e.target.value }))} />
                  <Input placeholder="Instituição ou área" aria-label="Instituição" value={speaker.affiliation} onChange={(e) => setSpeaker((s) => ({ ...s, affiliation: e.target.value }))} />
                  <Input placeholder="Tema (opcional)" aria-label="Tema" value={speaker.topic} onChange={(e) => setSpeaker((s) => ({ ...s, topic: e.target.value }))} className="sm:col-span-2" />
                  <Button type="submit" loading={addSpeaker.pending} disabled={!speaker.name.trim()} className="sm:col-span-2 sm:justify-self-start">
                    <Plus /> Adicionar palestrante
                  </Button>
                </form>
              )}
            </Panel>
            <Panel title="Programação">
              {p.schedule.length === 0 ? (
                <p className="text-[13px] text-fg-subtle">Programação ainda não definida.</p>
              ) : (
                <ol className="space-y-2">
                  {p.schedule.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2">
                      <span className="tnum w-14 shrink-0 font-mono text-[13px] font-semibold text-gold-fg">{formatTime(s.time)}</span>
                      <span className="min-w-0 flex-1 text-[13.5px]">{s.title}</span>
                      {editable && (
                        <Button size="icon-sm" variant="ghost" aria-label={`Remover ${s.title}`} onClick={() => removeSlot.runSafe(s.id)}>
                          <Trash2 />
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {editable && (
                <form
                  className="mt-4 flex flex-col gap-2 sm:flex-row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if ((await addSlot.runSafe()) !== undefined) setSlot({ time: "", title: "" });
                  }}
                >
                  <Input type="time" aria-label="Horário" value={slot.time} onChange={(e) => setSlot((s) => ({ ...s, time: e.target.value }))} className="sm:w-32" />
                  <Input placeholder="Atividade" aria-label="Atividade" value={slot.title} onChange={(e) => setSlot((s) => ({ ...s, title: e.target.value }))} />
                  <Button type="submit" loading={addSlot.pending} disabled={!slot.time || !slot.title.trim()}>
                    <Plus /> Adicionar
                  </Button>
                </form>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="presenca" className="mt-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Panel
              title="Lista de presença"
              description={isDemoMode ? "Nomes de participantes fictícios" : "Dados pessoais: visíveis só para quem organiza o projeto"}
              actions={
                !restricted &&
                access.can("extension.export") &&
                p.attendees.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={exportingCsv}
                    onClick={async () => {
                      setExportingCsv(true);
                      try {
                        const rows = attendanceRows(p);
                        await recordExport(`Lista de presença em CSV (${rows.length - 1} participantes)`);
                        downloadCsv(rows, `presenca-${slugify(p.name)}.csv`);
                        notifySuccess("Lista de presença exportada (CSV)");
                      } catch (e) {
                        notifyError(e);
                      } finally {
                        setExportingCsv(false);
                      }
                    }}
                  >
                    <FileSpreadsheet /> Exportar CSV
                  </Button>
                )
              }
            >
              {restricted ? (
                <EmptyState compact icon={<Lock />} title={`${total} inscrito(s)`} description={RESTRICTED_ATTENDEES_TEXT} />
              ) : p.attendees.length === 0 ? (
                <EmptyState compact title="Lista vazia" description={editable ? "Adicione os participantes inscritos." : undefined} />
              ) : (
                <ul className="divide-y divide-line">
                  {p.attendees.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-[13.5px]">{a.name}</span>
                      <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-[12.5px] font-medium", isPresent(a) ? "border-ok/40 bg-ok/10 text-ok" : "border-line text-fg-muted")}>
                        <input type="checkbox" className="size-4 accent-[var(--ok)]" checked={isPresent(a)} disabled={!editable} onChange={(e) => markAttendance(a.id, e.target.checked)} />
                        {isPresent(a) ? "Presente" : "Ausente"}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {editable && !restricted && (
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if ((await addAttendee.runSafe()) !== undefined) setAttendee("");
                  }}
                >
                  <Input placeholder="Nome do participante" aria-label="Nome do participante" value={attendee} onChange={(e) => setAttendee(e.target.value)} />
                  <Button type="submit" loading={addAttendee.pending} disabled={attendee.trim().length < 2}>
                    <UserPlus /> Adicionar
                  </Button>
                </form>
              )}
            </Panel>
            <Panel title="Certificados">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-fg-muted">Situação</span>
                  <StatusBadge meta={certificateStatusMeta(p.certificateStatus)} />
                </div>
                {editable && (
                  <select
                    aria-label="Situação dos certificados"
                    value={p.certificateStatus}
                    disabled={setCert.pending || (!isDemoMode && p.certificateStatus === "issued" && !canApprove)}
                    onChange={(e) => setCert.runSafe(e.target.value as CertificateStatus)}
                    className="h-9 w-full rounded-lg border border-line-strong bg-sunken px-3 text-[13px]"
                  >
                    {(Object.keys(CERTIFICATE_STATUS) as CertificateStatus[]).map((s) => (
                      <option key={s} value={s} disabled={s === "issued" && !canApprove}>
                        {certificateStatusMeta(s).label}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[12.5px] text-fg-muted">{restricted ? `${RESTRICTED_ATTENDEES_TEXT}.` : `${present} participante(s) com presença confirmada.`}</p>
                {access.can("extension.export") && !restricted && (
                  <Button
                    className="w-full"
                    loading={generating}
                    disabled={present === 0 || toggle.pending}
                    onClick={async () => {
                      setGenerating(true);
                      try {
                        const n = await exportCertificatesPdf(p, dir.memberName(p.responsibleId), { onBeforeSave: (count) => recordExport(`Certificados (${count} participantes)`) });
                        notifySuccess(`${n} certificado(s) gerado(s) em PDF`, isDemoMode ? "Modelo demonstrativo, sem validade." : "PDF gerado no navegador a partir dos dados registrados.");
                      } catch (e) {
                        notifyError(e);
                      } finally {
                        setGenerating(false);
                      }
                    }}
                  >
                    <Award /> Gerar certificados (PDF)
                  </Button>
                )}
                {isDemoMode ? (
                  <DemoNotice>Certificados de demonstração: trazem a marca “sem validade” e não têm código de verificação.</DemoNotice>
                ) : (
                  <p className="text-[12px] leading-relaxed text-fg-subtle">
                    PDF gerado no navegador a partir dos dados registrados, somente para quem teve presença marcada. Os certificados não têm código de verificação; a geração fica registrada na auditoria.
                  </p>
                )}
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="relatorio" className="mt-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Relatório da atividade" actions={editable && isDemoMode && <span className="text-[12px] text-fg-subtle">Salvo apenas neste navegador</span>}>
              {editable ? (
                <>
                  <Textarea rows={10} value={reportValue} onChange={(e) => setReport(e.target.value)} placeholder="Como foi a atividade, participação, aprendizados e próximos passos." aria-label="Relatório" />
                  <div className="mt-3 flex justify-end">
                    <Button variant="primary" loading={saveReport.pending} disabled={report === null || report === (p.report ?? "")} onClick={async () => (await saveReport.runSafe()) && setReport(null)}>
                      Salvar relatório
                    </Button>
                  </div>
                </>
              ) : p.report ? (
                <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-fg-muted">{p.report}</p>
              ) : (
                <p className="text-[13px] text-fg-subtle">Relatório ainda não escrito.</p>
              )}
            </Panel>
            <Panel
              title="Documentos relacionados"
              actions={
                editable &&
                access.can("documents.create") && (
                  <Button size="sm" onClick={() => setDocOpen(true)}>
                    <FilePlus2 /> Adicionar
                  </Button>
                )
              }
              bodyClassName="py-1.5"
            >
              {linkedDocs.length === 0 ? (
                <EmptyState compact icon={<FileText />} title="Nenhum documento vinculado" />
              ) : (
                <ul className="divide-y divide-line">
                  {linkedDocs.map((d) => (
                    <li key={d.id}>
                      <ListRow href={`/documentos/${d.id}`} leading={<FileText className="size-4 text-fg-subtle" />} title={d.name} subtitle={`v${d.versions.length} · ${formatDate(d.updatedAt)}`} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="historico" className="mt-5">
          <Panel title="Histórico do projeto">
            <HistoryTimeline entries={p.history} limit={15} />
          </Panel>
        </TabsContent>
      </Tabs>

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={p} />
      <AddDocumentDialog open={docOpen} onOpenChange={setDocOpen} links={{ projectId: p.id }} stay onCreated={(docId) => linkDoc.runSafe(docId)} />
    </>
  );
}
