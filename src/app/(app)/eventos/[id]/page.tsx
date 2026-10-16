"use client";

import { useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck2, CalendarDays, CheckCircle2, Clock, Copy, MapPin, MoreHorizontal, Pencil, RotateCcw, XCircle } from "lucide-react";
import type { EventStatus } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useEvent } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canCloseEvent, canEditEvent, canSeeEventFinance } from "@/lib/policies";
import { EVENT_STATUS, EVENT_TYPE_LABELS } from "@/lib/labels";
import { formatDate, formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { MetaItem, PageHeader, Panel } from "@/components/shared/page";
import { RecordErrorState, PageSkeleton } from "@/components/shared/states";
import { OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { EventFormDialog } from "@/features/events/event-form-dialog";
import { DuplicateEventDialog } from "@/features/events/event-dialogs";
import { DocumentsTab, FinanceTab, OverviewTab, PublicityTab, TasksTab } from "@/features/events/event-tabs";

const TABS = ["visao", "tarefas", "financeiro", "divulgacao", "documentos", "historico"] as const;

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const { data: event, isLoading, isError, error, refetch } = useEvent(id);
  useBreadcrumbTitle(`/eventos/${id}`, event?.name);
  const [editOpen, setEditOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const setStatus = useAction((s: EventStatus) => services.events.setStatus(id, s), { success: (e) => `Situação: ${EVENT_STATUS[e.status].label}` });

  const requested = params.get("aba") as (typeof TABS)[number] | null;
  const tab = requested && TABS.includes(requested) ? requested : "visao";
  const setTab = (t: string) => router.replace(`${pathname}?aba=${t}`, { scroll: false });

  if (isLoading) return <PageSkeleton />;
  if (isError || !event) return <RecordErrorState error={error} notFound="Evento não encontrado" backHref="/eventos" onRetry={() => refetch()} />;

  const ctx = access.ctx;
  const canEdit = !!ctx && canEditEvent(ctx, event);
  const canClose = !!ctx && canCloseEvent(ctx, event);
  const showFinance = !!ctx && canSeeEventFinance(ctx, event) && access.moduleEnabled("finance");
  // Link direto para uma aba que o perfil não vê (ex.: ?aba=financeiro) abre a visão geral.
  const activeTab = tab === "financeiro" && !showFinance ? "visao" : tab;
  const changeStatus = async (s: EventStatus, title: string, description: string, danger = false) => {
    if (await confirmAction({ title, description, confirmLabel: "Confirmar", tone: danger ? "danger" : "default" })) setStatus.runSafe(s);
  };

  return (
    <>
      <PageHeader
        back={{ href: "/eventos", label: "Eventos e projetos" }}
        eyebrow={`${EVENT_TYPE_LABELS[event.type]} · ${event.code}`}
        title={event.name}
        badge={
          <>
            <StatusBadge meta={EVENT_STATUS[event.status]} />
            <OwnershipBadge record={event} />
          </>
        }
        meta={
          <>
            <MetaItem icon={<CalendarDays />}>
              <b>{formatDate(event.date)}</b>
            </MetaItem>
            <MetaItem icon={<Clock />}>{formatTime(event.time)}</MetaItem>
            <MetaItem icon={<MapPin />}>{event.location}</MetaItem>
            <MetaItem>{dir.department(event.departmentId)?.name}</MetaItem>
          </>
        }
        actions={
          <>
            {canEdit && (
              <Button onClick={() => setEditOpen(true)}>
                <Pencil /> Editar
              </Button>
            )}
            {(canEdit || canClose || access.can("events.create")) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {access.can("events.create") && (
                    <DropdownMenuItem icon={<Copy />} hint="Copia só a estrutura de planejamento" onSelect={() => setDupOpen(true)}>
                      Duplicar evento
                    </DropdownMenuItem>
                  )}
                  {(canEdit || canClose) && <DropdownMenuSeparator />}
                  {canEdit && event.status === "planning" && (
                    <DropdownMenuItem icon={<CalendarCheck2 />} onSelect={() => changeStatus("confirmed", "Confirmar evento?", "O evento passa a aparecer como confirmado para todos com acesso.")}>
                      Marcar como confirmado
                    </DropdownMenuItem>
                  )}
                  {canEdit && (event.status === "confirmed" || event.status === "cancelled") && (
                    <DropdownMenuItem icon={<RotateCcw />} onSelect={() => changeStatus("planning", "Voltar para planejamento?", "A situação volta para “Em planejamento”.")}>
                      Voltar para planejamento
                    </DropdownMenuItem>
                  )}
                  {canClose && event.status !== "done" && event.status !== "cancelled" && (
                    <>
                      <DropdownMenuItem icon={<CheckCircle2 />} onSelect={() => changeStatus("done", "Marcar como concluído?", "Use depois que o evento acontecer.")}>
                        Marcar como concluído
                      </DropdownMenuItem>
                      <DropdownMenuItem icon={<XCircle />} tone="danger" onSelect={() => changeStatus("cancelled", "Cancelar o evento?", "O registro é mantido, com tarefas e histórico.", true)}>
                        Cancelar evento
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="tarefas" count={event.tasks.length}>
            Programação e tarefas
          </TabsTrigger>
          {showFinance && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
          <TabsTrigger value="divulgacao">Divulgação</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="visao" className="mt-5">
          <OverviewTab event={event} />
        </TabsContent>
        <TabsContent value="tarefas" className="mt-5">
          <TasksTab event={event} />
        </TabsContent>
        {showFinance && (
          <TabsContent value="financeiro" className="mt-5">
            <FinanceTab event={event} />
          </TabsContent>
        )}
        <TabsContent value="divulgacao" className="mt-5">
          <PublicityTab event={event} />
        </TabsContent>
        <TabsContent value="documentos" className="mt-5">
          <DocumentsTab event={event} />
        </TabsContent>
        <TabsContent value="historico" className="mt-5">
          <Panel title="Histórico do evento">
            <HistoryTimeline entries={event.history} limit={15} />
          </Panel>
        </TabsContent>
      </Tabs>

      <EventFormDialog open={editOpen} onOpenChange={setEditOpen} event={event} />
      <DuplicateEventDialog open={dupOpen} onOpenChange={setDupOpen} event={event} />
    </>
  );
}
