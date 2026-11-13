"use client";

import { useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, Crown, Dumbbell, FileSpreadsheet, MapPin, MoreHorizontal, PauseCircle, Pencil, Plus, Shirt, Swords, Trash2, Trophy, UserRound } from "lucide-react";
import type { Athlete, Competition, Match, TeamStatus, TrainingSlot } from "@/types";
import { services, type TeamList } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useSportsTeam } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canArchiveTeam, canEditTeam } from "@/lib/policies";
import { COMPETITION_STATUS, MATCH_STATUS, SPORT_CATEGORY_LABELS, TEAM_STATUS, WEEKDAY_LABELS } from "@/lib/labels";
import { formatDate, formatTime, todayDateOnly } from "@/lib/format";
import { downloadCsv, slugify } from "@/lib/export/common";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/menu";
import { DetailList, MetaItem, PageHeader, Panel, Stat } from "@/components/shared/page";
import { EmptyState, PageSkeleton, RecordErrorState } from "@/components/shared/states";
import { OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { HistoryTimeline } from "@/components/shared/history";
import { DateChip } from "@/components/shared/list-row";
import { confirmAction } from "@/components/shared/confirm";
import { TeamFormDialog } from "@/features/sports/team-form-dialog";
import { AthleteDialog, CompetitionDialog, MatchDialog, TrainingDialog } from "@/features/sports/item-dialogs";
import { matchOutcome, nextTraining, OUTCOME_META, SPORTS_COLOR, teamRecord, trainingLabel, upcomingMatches, whenLabel } from "@/features/sports/utils";

const TABS = ["visao", "treinos", "elenco", "jogos", "competicoes", "historico"] as const;
type Tab = (typeof TABS)[number];

type Editing =
  | { kind: "training"; item?: TrainingSlot }
  | { kind: "athlete"; item?: Athlete }
  | { kind: "match"; item?: Match }
  | { kind: "competition"; item?: Competition }
  | null;

export default function SportTeamPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const dir = useDirectory();
  const { data: t, isLoading, isError, error, refetch } = useSportsTeam(id);
  useBreadcrumbTitle(`/esportes/${id}`, t?.name);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [exporting, setExporting] = useState(false);
  const requested = params.get("aba") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "visao";
  const setTab = (next: string) => router.replace(`${pathname}?aba=${next}`, { scroll: false });

  const setStatus = useAction((s: TeamStatus) => services.sports.setStatus(id, s), { success: (r) => `Situação: ${TEAM_STATUS[r.status].label}` });
  const remove = useAction((list: TeamList, itemId: string) => services.sports.removeItem(id, list, itemId), { success: "Removido" });

  if (isLoading) return <PageSkeleton />;
  if (isError || !t) return <RecordErrorState error={error} notFound="Modalidade não encontrada" backHref="/esportes" onRetry={() => refetch()} />;

  const ctx = access.ctx;
  const editable = !!ctx && canEditTeam(ctx, t) && t.status !== "archived";
  const archivable = !!ctx && canArchiveTeam(ctx, t);
  const today = todayDateOnly();
  const record = teamRecord(t.matches);
  const upcoming = upcomingMatches(t, today);
  const training = t.status === "active" ? nextTraining(t.trainings, today) : null;
  const competitionName = (cid?: string) => (cid ? (t.competitions.find((c) => c.id === cid)?.name ?? "Competição removida") : "Amistoso");

  const askRemove = async (list: TeamList, itemId: string, label: string) => {
    if (await confirmAction({ title: `Remover ${label}?`, confirmLabel: "Remover", tone: "danger" })) remove.runSafe(list, itemId);
  };

  const exportRoster = async () => {
    setExporting(true);
    try {
      const rows: (string | number | undefined)[][] = [["Número", "Nome", "Posição", "Capitão(ã)"], ...t.athletes.map((a) => [a.number ?? "", a.name, a.position ?? "", a.captain ? "Sim" : ""])];
      // Registro na auditoria antes de entregar o arquivo (o resumo não traz nomes).
      await services.audit.recordExport({ module: "sports", resourceType: "team", resourceId: t.id, summary: `Elenco em CSV (${t.athletes.length} atletas)`, personalData: true }).catch(() => undefined);
      downloadCsv(rows, `elenco-${slugify(t.name)}.csv`);
      notifySuccess("Elenco exportado (CSV)");
    } catch (e) {
      notifyError(e);
    } finally {
      setExporting(false);
    }
  };

  const addButton = (label: string, kind: Exclude<Editing, null>["kind"]) =>
    editable && (
      <Button size="sm" onClick={() => setEditing({ kind } as Editing)}>
        <Plus /> {label}
      </Button>
    );
  const rowActions = (onEdit: () => void, onRemove: () => void, label: string) =>
    editable && (
      <div className="flex shrink-0 gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={`Editar ${label}`} onClick={onEdit}>
          <Pencil />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Remover ${label}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
    );

  return (
    <>
      <PageHeader
        back={{ href: "/esportes", label: "Esportes" }}
        eyebrow={`${t.sport} · ${SPORT_CATEGORY_LABELS[t.category]} · ${t.code}`}
        title={t.name}
        badge={
          <>
            <StatusBadge meta={TEAM_STATUS[t.status]} />
            <OwnershipBadge record={t} />
          </>
        }
        meta={
          <>
            <MetaItem icon={<UserRound />}>{dir.memberName(t.responsibleId)}</MetaItem>
            {t.coach && <MetaItem icon={<Trophy />}>Técnico(a): {t.coach}</MetaItem>}
          </>
        }
        actions={
          <>
            {editable && (
              <Button onClick={() => setEditOpen(true)}>
                <Pencil /> Editar
              </Button>
            )}
            {archivable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="Alterar situação">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {t.status !== "active" && (
                    <DropdownMenuItem icon={<ArchiveRestore />} onSelect={() => setStatus.runSafe("active")}>
                      Reativar modalidade
                    </DropdownMenuItem>
                  )}
                  {t.status === "active" && (
                    <DropdownMenuItem icon={<PauseCircle />} onSelect={() => setStatus.runSafe("paused")}>
                      Pausar (treinos suspensos)
                    </DropdownMenuItem>
                  )}
                  {t.status !== "archived" && (
                    <DropdownMenuItem
                      icon={<Archive />}
                      tone="danger"
                      onSelect={async () =>
                        (await confirmAction({ title: "Arquivar a modalidade?", description: "Ela sai da lista principal e não pode ser editada. Nada é apagado; dá para reativar depois.", confirmLabel: "Arquivar", tone: "danger" })) &&
                        setStatus.runSafe("archived")
                      }
                    >
                      Arquivar
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
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="treinos" count={t.trainings.length}>
            Treinos
          </TabsTrigger>
          <TabsTrigger value="elenco" count={t.athletes.length}>
            Elenco
          </TabsTrigger>
          <TabsTrigger value="jogos" count={t.matches.length}>
            Jogos
          </TabsTrigger>
          <TabsTrigger value="competicoes" count={t.competitions.length}>
            Competições
          </TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        {/* ------------------------------ visão geral ------------------------------ */}
        <TabsContent value="visao" className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Jogos realizados" value={record.played} footer={<span>com placar lançado</span>} />
            <Stat label="Vitórias" value={record.wins} footer={<span>{record.draws} empate(s) · {record.losses} derrota(s)</span>} />
            <Stat label="Saldo" value={`${record.scored - record.conceded > 0 ? "+" : ""}${record.scored - record.conceded}`} footer={<span>{record.scored} pró · {record.conceded} contra</span>} />
            <Stat label="Elenco" value={t.athletes.length} footer={<span>{t.athletes.filter((a) => a.captain).length ? "com capitão(ã) definido(a)" : "atletas cadastrados"}</span>} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Panel title="Sobre">
              {t.description && <p className="mb-4 text-[13.5px] leading-relaxed text-fg-muted">{t.description}</p>}
              <DetailList
                items={[
                  { label: "Esporte", value: t.sport },
                  { label: "Naipe", value: SPORT_CATEGORY_LABELS[t.category] },
                  { label: "Responsável", value: dir.memberName(t.responsibleId) },
                  { label: "Técnico(a)", value: t.coach ?? "Não informado" },
                  { label: "Criada por", value: `${dir.memberName(t.createdBy)} em ${formatDate(t.createdAt)}` },
                ]}
              />
            </Panel>
            <div className="space-y-4">
              <Panel title="Próximo treino">
                {training ? (
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl" style={{ background: `${SPORTS_COLOR}22`, color: SPORTS_COLOR }}>
                      <Dumbbell className="size-5" aria-hidden />
                    </span>
                    <div>
                      <p className="font-semibold">
                        {whenLabel(training)}, {formatTime(training.slot.start)}
                        {training.slot.end && `–${formatTime(training.slot.end)}`}
                      </p>
                      <p className="text-[12.5px] text-fg-muted">{training.slot.location}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-subtle">{t.status === "active" ? "Sem horário de treino cadastrado." : "Treinos suspensos enquanto a modalidade não está em atividade."}</p>
                )}
              </Panel>
              <Panel title="Próximo jogo">
                {upcoming[0] ? (
                  <div className="flex items-center gap-3">
                    <DateChip date={upcoming[0].date} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">× {upcoming[0].opponent}</p>
                      <p className="truncate text-[12.5px] text-fg-muted">
                        {upcoming[0].time ? `${formatTime(upcoming[0].time)} · ` : ""}
                        {upcoming[0].location}
                      </p>
                      <p className="truncate text-[12px] text-fg-subtle">{competitionName(upcoming[0].competitionId)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-subtle">Nenhum jogo agendado.</p>
                )}
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* -------------------------------- treinos -------------------------------- */}
        <TabsContent value="treinos" className="mt-5">
          <Panel title="Horários de treino" description="Repetem toda semana" actions={addButton("Adicionar horário", "training")}>
            {t.trainings.length === 0 ? (
              <EmptyState compact icon={<Dumbbell />} title="Nenhum horário de treino" description={editable ? "Adicione os dias e horários fixos dos treinos." : undefined} />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {t.trainings.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-sunken px-3.5 py-3">
                    <span className="grid w-12 shrink-0 place-items-center rounded-lg py-1.5 text-[11px] font-bold tracking-wide uppercase" style={{ background: `${SPORTS_COLOR}22`, color: SPORTS_COLOR }}>
                      {WEEKDAY_LABELS[s.weekday].slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[14px] font-semibold tnum">
                        {formatTime(s.start)}
                        {s.end && ` – ${formatTime(s.end)}`}
                      </p>
                      <p className="flex items-center gap-1 truncate text-[12.5px] text-fg-muted">
                        <MapPin className="size-3.5 shrink-0" aria-hidden /> {s.location}
                      </p>
                    </div>
                    {rowActions(() => setEditing({ kind: "training", item: s }), () => askRemove("trainings", s.id, `o treino de ${trainingLabel(s)}`), trainingLabel(s))}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        {/* --------------------------------- elenco -------------------------------- */}
        <TabsContent value="elenco" className="mt-5">
          <Panel
            title="Elenco"
            description="Só nome e dados de jogo"
            actions={
              <div className="flex gap-2">
                {access.can("sports.export") && t.athletes.length > 0 && (
                  <Button size="sm" variant="ghost" loading={exporting} onClick={exportRoster}>
                    <FileSpreadsheet /> Exportar CSV
                  </Button>
                )}
                {addButton("Adicionar atleta", "athlete")}
              </div>
            }
          >
            {t.athletes.length === 0 ? (
              <EmptyState compact icon={<Shirt />} title="Elenco vazio" description={editable ? "Adicione as pessoas que treinam e jogam na modalidade." : undefined} />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {t.athletes.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-sunken px-3 py-2.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full font-mono text-[15px] font-bold tnum" style={{ background: `${SPORTS_COLOR}22`, color: SPORTS_COLOR }}>
                      {a.number ?? "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold">
                        {a.name}
                        {a.captain && <Crown className="size-3.5 shrink-0 text-gold" aria-label="Capitão(ã)" />}
                      </p>
                      <p className="truncate text-[12px] text-fg-subtle">{a.position ?? "Posição não informada"}</p>
                    </div>
                    {rowActions(() => setEditing({ kind: "athlete", item: a }), () => askRemove("athletes", a.id, `${a.name} do elenco`), a.name)}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        {/* ---------------------------------- jogos -------------------------------- */}
        <TabsContent value="jogos" className="mt-5">
          <Panel title="Jogos" description={`${record.wins} vitória(s), ${record.draws} empate(s), ${record.losses} derrota(s)`} actions={addButton("Novo jogo", "match")}>
            {t.matches.length === 0 ? (
              <EmptyState compact icon={<Swords />} title="Nenhum jogo cadastrado" description={editable ? "Cadastre amistosos e jogos de competições." : undefined} />
            ) : (
              <ul className="divide-y divide-line">
                {[...t.matches].reverse().map((m) => {
                  const outcome = matchOutcome(m);
                  return (
                    <li key={m.id} className="flex items-start gap-3 py-3 sm:items-center">
                      <DateChip date={m.date} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">× {m.opponent}</p>
                        <p className="truncate text-[12.5px] text-fg-muted">
                          {m.time ? `${formatTime(m.time)} · ` : ""}
                          {m.location} · {competitionName(m.competitionId)}
                        </p>
                        {m.notes && <p className="truncate text-[12px] text-fg-subtle">{m.notes}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                        {m.scoreFor != null && m.scoreAgainst != null ? (
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-[18px] font-bold tnum">
                              {m.scoreFor} × {m.scoreAgainst}
                            </span>
                            {outcome && <Badge tone={OUTCOME_META[outcome].tone}>{OUTCOME_META[outcome].label}</Badge>}
                          </span>
                        ) : (
                          <StatusBadge meta={MATCH_STATUS[m.status]} />
                        )}
                        {rowActions(() => setEditing({ kind: "match", item: m }), () => askRemove("matches", m.id, `o jogo contra ${m.opponent}`), `jogo contra ${m.opponent}`)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </TabsContent>

        {/* ------------------------------- competições ----------------------------- */}
        <TabsContent value="competicoes" className="mt-5">
          <Panel title="Competições" actions={addButton("Nova competição", "competition")}>
            {t.competitions.length === 0 ? (
              <EmptyState compact icon={<Trophy />} title="Nenhuma competição cadastrada" description={editable ? "Cadastre copas, campeonatos e jogos universitários." : undefined} />
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {[...t.competitions].reverse().map((c) => {
                  const games = t.matches.filter((m) => m.competitionId === c.id);
                  const r = teamRecord(games);
                  return (
                    <li key={c.id} className="rounded-xl border border-line bg-sunken p-4">
                      <div className="flex items-start gap-3">
                        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", c.placement ? "bg-gold/15 text-gold-fg" : "bg-surface-3 text-fg-subtle")}>
                          <Trophy className="size-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14.5px] font-semibold">{c.name}</p>
                          <p className="flex items-center gap-1 text-[12.5px] text-fg-muted">
                            <CalendarDays className="size-3.5" aria-hidden />
                            {formatDate(c.startDate)}
                            {c.endDate && c.endDate !== c.startDate && ` a ${formatDate(c.endDate)}`} · {c.location}
                          </p>
                        </div>
                        {rowActions(() => setEditing({ kind: "competition", item: c }), () => askRemove("competitions", c.id, `a competição ${c.name}`), c.name)}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <StatusBadge meta={COMPETITION_STATUS[c.status]} />
                        {c.placement && (
                          <Badge tone="gold" icon={<Trophy />}>
                            {c.placement}
                          </Badge>
                        )}
                        <span className="text-[12px] text-fg-subtle">
                          {games.length} jogo(s){r.played > 0 && ` · ${r.wins}V ${r.draws}E ${r.losses}D`}
                        </span>
                      </div>
                      {c.notes && <p className="mt-2 text-[12.5px] text-fg-muted">{c.notes}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="historico" className="mt-5">
          <Panel title="Histórico da modalidade">
            <HistoryTimeline entries={t.history} limit={20} />
          </Panel>
        </TabsContent>
      </Tabs>

      <TeamFormDialog open={editOpen} onOpenChange={setEditOpen} team={t} />
      <TrainingDialog team={t} open={editing?.kind === "training"} item={editing?.kind === "training" ? editing.item : undefined} onOpenChange={(o) => !o && setEditing(null)} />
      <AthleteDialog team={t} open={editing?.kind === "athlete"} item={editing?.kind === "athlete" ? editing.item : undefined} onOpenChange={(o) => !o && setEditing(null)} />
      <MatchDialog team={t} open={editing?.kind === "match"} item={editing?.kind === "match" ? editing.item : undefined} onOpenChange={(o) => !o && setEditing(null)} />
      <CompetitionDialog team={t} open={editing?.kind === "competition"} item={editing?.kind === "competition" ? editing.item : undefined} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}
