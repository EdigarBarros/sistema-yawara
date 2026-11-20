"use client";

import { useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, CalendarPlus, MoreHorizontal, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import type { SportSession, TeamAthlete } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useTeam } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canArchiveTeam, canEditTeam, canEditTeamSettings } from "@/lib/policies";
import { CATEGORY_LABELS, inkOn, positionLabel, SPORT_RULES, teamRecord } from "@/lib/sports";
import { todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { MetaItem, PageHeader, Panel } from "@/components/shared/page";
import { RecordErrorState, PageSkeleton, EmptyState } from "@/components/shared/states";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { LineupBoard } from "@/features/sports/court/lineup-board";
import { MODALITY_ICON, SessionRow } from "@/features/sports/sport-ui";
import { AthleteDialog, SessionDialog, TeamFormDialog } from "@/features/sports/sport-dialogs";

const TABS = ["quadra", "elenco", "agenda", "historico"] as const;

export default function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const { data: team, isLoading, isError, error, refetch } = useTeam(id);
  useBreadcrumbTitle(`/esportes/${id}`, team?.name);
  const [editOpen, setEditOpen] = useState(false);
  const [athlete, setAthlete] = useState<TeamAthlete | "new" | null>(null);
  const [session, setSession] = useState<SportSession | "new" | null>(null);
  const setStatus = useAction((s: "active" | "archived") => services.sports.setStatus(id, s), { success: (t) => (t.status === "archived" ? "Time arquivado" : "Time reativado") });
  const remove = useAction((athleteId: string) => services.sports.removeAthlete(id, athleteId), { success: "Atleta removido(a) do elenco" });

  const requested = params.get("aba") as (typeof TABS)[number] | null;
  const tab = requested && TABS.includes(requested) ? requested : "quadra";
  const setTab = (t: string) => router.replace(`${pathname}?aba=${t}`, { scroll: false });

  if (isLoading) return <PageSkeleton />;
  if (isError || !team) return <RecordErrorState error={error} notFound="Time não encontrado" backHref="/esportes" onRetry={() => refetch()} />;

  const ctx = access.ctx;
  const archived = team.status === "archived";
  const canEdit = !!ctx && canEditTeam(ctx, team) && !archived;
  const canSettings = !!ctx && canEditTeamSettings(ctx, team) && !archived;
  const canArchive = !!ctx && canArchiveTeam(ctx, team);
  const rules = SPORT_RULES[team.modality];
  const Icon = MODALITY_ICON[team.modality];
  const record = teamRecord(team);
  const today = todayDateOnly();
  const sessions = [...team.sessions].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const upcoming = sessions.filter((s) => s.status === "scheduled" && s.date >= today);
  const past = sessions.filter((s) => !(s.status === "scheduled" && s.date >= today)).reverse();
  const starters = new Set(team.lineup.slots.map((s) => s.athleteId));
  const roster = [...team.athletes].sort((a, b) => Number(b.active) - Number(a.active) || a.number - b.number);

  const askRemove = async (a: TeamAthlete) => {
    if (await confirmAction({ title: `Remover ${a.name} do elenco?`, description: "Se estiver escalado(a), sai da quadra também. Para afastar por um tempo, prefira marcar como inativo(a).", confirmLabel: "Remover", tone: "danger" }))
      remove.runSafe(a.id);
  };

  return (
    <>
      <PageHeader
        back={{ href: "/esportes", label: "Esportes" }}
        eyebrow={`${rules.label} · ${CATEGORY_LABELS[team.category]} · ${team.code}`}
        title={
          <span className="inline-flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: `linear-gradient(145deg, ${team.color}, ${team.color}b8)`, color: inkOn(team.color) }}>
              <Icon className="size-6" strokeWidth={2.2} aria-hidden />
            </span>
            {team.name}
          </span>
        }
        badge={archived ? <Badge tone="neutral">Arquivado</Badge> : undefined}
        meta={
          <>
            <MetaItem icon={<Users />}>
              <b>{team.athletes.filter((a) => a.active).length}</b> no elenco
            </MetaItem>
            <MetaItem>
              <b className="text-ok">{record.win}V</b> · {record.draw}E · <span className="text-danger">{record.loss}D</span>
            </MetaItem>
            <MetaItem>Técnicos: {team.coachIds.length ? team.coachIds.map((c) => dir.memberName(c)).join(", ") : "—"}</MetaItem>
          </>
        }
        actions={
          <>
            {canEdit && (
              <Button onClick={() => setSession("new")}>
                <CalendarPlus /> Marcar treino ou jogo
              </Button>
            )}
            {(canSettings || canArchive) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {canSettings && (
                    <DropdownMenuItem icon={<Pencil />} onSelect={() => setEditOpen(true)}>
                      Editar time
                    </DropdownMenuItem>
                  )}
                  {canArchive && !archived && (
                    <DropdownMenuItem
                      icon={<Archive />}
                      onSelect={async () => {
                        if (await confirmAction({ title: "Arquivar o time?", description: "Elenco, escalação e jogos ficam guardados. Para alterar de novo, reative o time.", confirmLabel: "Arquivar" })) setStatus.runSafe("archived");
                      }}
                    >
                      Arquivar time
                    </DropdownMenuItem>
                  )}
                  {canArchive && archived && (
                    <DropdownMenuItem icon={<ArchiveRestore />} onSelect={() => setStatus.runSafe("active")}>
                      Reativar time
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="quadra">Quadra</TabsTrigger>
          <TabsTrigger value="elenco" count={team.athletes.length}>
            Elenco
          </TabsTrigger>
          <TabsTrigger value="agenda" count={upcoming.length}>
            Treinos e jogos
          </TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="quadra" className="mt-5">
          <LineupBoard team={team} editable={canEdit} />
        </TabsContent>

        <TabsContent value="elenco" className="mt-5">
          <Panel
            title="Elenco"
            description={`${rules.label}: ${rules.starters} titulares. Inativos ficam fora da escalação.`}
            actions={
              canEdit && (
                <Button size="sm" variant="primary" onClick={() => setAthlete("new")}>
                  <UserPlus /> Incluir atleta
                </Button>
              )
            }
            bodyClassName="p-0"
          >
            {roster.length === 0 ? (
              <EmptyState icon={<Users />} title="Elenco vazio" description="Inclua os atletas para montar a escalação na quadra." />
            ) : (
              <ul className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
                {roster.map((a, i) => (
                  <li key={a.id} className={cn("anim-rise flex items-center gap-3 bg-surface px-4 py-3", !a.active && "opacity-60")} style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}>
                    <span className="tnum grid size-11 shrink-0 place-items-center rounded-full font-display text-[18px] font-extrabold" style={{ background: a.active ? team.color : "var(--surface-3)", color: a.active ? inkOn(team.color) : "var(--fg-muted)" }}>
                      {a.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.name}</span>
                      <span className="block truncate text-[12px] text-fg-muted">
                        {positionLabel(team.modality, a.position)}
                        {a.course ? ` · ${a.course}` : ""}
                      </span>
                    </span>
                    {starters.has(a.id) && <Badge tone="gold">Titular</Badge>}
                    {!a.active && <Badge tone="neutral">Inativo(a)</Badge>}
                    {canEdit && (
                      <span className="flex shrink-0">
                        <Button size="icon-sm" variant="ghost" aria-label={`Editar ${a.name}`} onClick={() => setAthlete(a)}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Remover ${a.name}`} onClick={() => askRemove(a)}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="agenda" className="mt-5 space-y-6">
          {[
            { title: "Próximos", list: upcoming, empty: "Nada marcado." },
            { title: "Realizados e cancelados", list: past, empty: "Nenhum treino ou jogo realizado ainda." },
          ].map((g) => (
            <section key={g.title}>
              <h2 className="eyebrow mb-3">{g.title}</h2>
              {g.list.length === 0 ? (
                <p className="text-[13px] text-fg-muted">{g.empty}</p>
              ) : (
                <ul className="grid gap-2 lg:grid-cols-2">
                  {g.list.map((s, i) => (
                    <li key={s.id} className="anim-row" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                      <SessionRow session={s} team={team} onClick={canEdit ? () => setSession(s) : undefined} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {canEdit && <p className="text-[12.5px] text-fg-subtle">Toque num treino ou jogo para editar, marcar como realizado e registrar o placar.</p>}
        </TabsContent>

        <TabsContent value="historico" className="mt-5">
          <Panel title="Histórico do time">
            <HistoryTimeline entries={team.history} limit={20} />
          </Panel>
        </TabsContent>
      </Tabs>

      <TeamFormDialog open={editOpen} onOpenChange={setEditOpen} team={team} />
      <AthleteDialog open={athlete !== null} onOpenChange={(o) => !o && setAthlete(null)} team={team} athlete={athlete && athlete !== "new" ? athlete : undefined} />
      <SessionDialog open={session !== null} onOpenChange={(o) => !o && setSession(null)} teams={[team]} teamId={team.id} session={session && session !== "new" ? session : undefined} />
    </>
  );
}
