"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { Audience, SessionKind, SessionStatus, SportModality, SportSession, SportTeam, TeamAthlete, TeamCategory } from "@/types";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { useAccess } from "@/hooks/use-access";
import { useDirectory } from "@/hooks/use-data";
import { CATEGORY_LABELS, inkOn, MODALITIES, SESSION_KIND_LABELS, SESSION_STATUS, SPORT_RULES, TEAM_COLORS } from "@/lib/sports";
import { todayDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceCards, Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { MemberMultiPicker } from "@/components/shared/pickers";
import { AudiencePicker } from "@/components/shared/audience";
import { FormAlert } from "@/components/shared/form-alert";
import { MODALITY_ICON } from "./sport-ui";

/* --------------------------------- Time --------------------------------- */

export function TeamFormDialog({ open, onOpenChange, team }: { open: boolean; onOpenChange: (o: boolean) => void; team?: SportTeam }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <TeamFormBody onOpenChange={onOpenChange} team={team} />}
    </Dialog>
  );
}

function TeamFormBody({ onOpenChange, team }: { onOpenChange: (o: boolean) => void; team?: SportTeam }) {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const defaultDep = dir.departments.find((d) => d.name.toLowerCase() === "esportes")?.id ?? access.ctx?.role.departmentId ?? dir.departments[0]?.id ?? "";
  const [name, setName] = useState(team?.name ?? "");
  const [modality, setModality] = useState<SportModality>(team?.modality ?? "futsal");
  const [category, setCategory] = useState<TeamCategory>(team?.category ?? "misto");
  const [color, setColor] = useState(team?.color ?? TEAM_COLORS[0]);
  const [departmentId, setDepartmentId] = useState(team?.departmentId ?? defaultDep);
  const [coachIds, setCoachIds] = useState<string[]>(team?.coachIds ?? (access.user ? [access.user.id] : []));
  const [audience, setAudience] = useState<Audience>(team?.access ?? { scope: "all", roleIds: [], userIds: [] });
  const [notes, setNotes] = useState(team?.notes ?? "");
  const [error, setError] = useState<string>();
  const lockedModality = !!team && team.athletes.length > 0;

  const input = { name, modality, category, color, departmentId, coachIds, access: audience, notes };
  const save = useAction(() => (team ? services.sports.update(team.id, input) : services.sports.create(input)), {
    success: team ? "Time atualizado" : "Time criado",
    silentError: true,
  });

  return (
    <DialogContent
      size="lg"
      modal
      title={team ? "Editar time" : "Novo time"}
      description={team ? undefined : "Depois de criar, cadastre o elenco e monte a escalação na quadra."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={async () => {
              if (name.trim().length < 3) return setError("Informe o nome do time (mínimo de 3 caracteres).");
              setError(undefined);
              try {
                const saved = await save.run();
                onOpenChange(false);
                if (!team) router.push(`/esportes/${saved.id}`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Check /> {team ? "Salvar alterações" : "Criar time"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Nome do time" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Futsal Feminino" maxLength={80} />
        </Field>
        <Field label="Modalidade" required hint={lockedModality ? "A modalidade não muda depois que o time tem atletas." : undefined}>
          <ChoiceCards
            name="modality"
            value={modality}
            onChange={setModality}
            columns={2}
            options={MODALITIES.map((m) => {
              const Icon = MODALITY_ICON[m];
              return {
                value: m,
                label: SPORT_RULES[m].label,
                description: `${SPORT_RULES[m].starters} titulares · quadra ${SPORT_RULES[m].length}×${SPORT_RULES[m].width} m`,
                icon: <Icon className="size-4 text-fg-subtle" />,
                disabled: lockedModality && m !== team?.modality,
              };
            })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria">
            <Select value={category} onChange={(e) => setCategory(e.target.value as TeamCategory)}>
              {(Object.keys(CATEGORY_LABELS) as TeamCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Departamento">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {dir.departments
                .filter((d) => d.active || d.id === departmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Field label="Cor do uniforme">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor do uniforme">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Cor ${c}`}
                onClick={() => setColor(c)}
                className={cn("press grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface", color === c ? "ring-2 ring-gold" : "ring-1 ring-line-strong")}
                style={{ background: c }}
              >
                {color === c && <Check className="size-4" style={{ color: inkOn(c) }} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Técnicos(as) e responsáveis" hint="Podem ver e cuidar do time, mesmo fora do público escolhido abaixo." optional>
          <MemberMultiPicker value={coachIds} onChange={setCoachIds} />
        </Field>
        <Field label="Quem pode ver o time">
          <AudiencePicker name="team-access" value={audience} onChange={setAudience} scopes={["all", "board", "department", "people"]} departmentId={departmentId} />
        </Field>
        <Field label="Observações" optional>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={600} placeholder="Dias de treino, metas da temporada..." />
        </Field>
        <FormAlert message={error} />
      </div>
    </DialogContent>
  );
}

/* -------------------------------- Atleta -------------------------------- */

export function AthleteDialog({
  open,
  onOpenChange,
  team,
  athlete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team: SportTeam;
  athlete?: TeamAthlete;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AthleteBody onOpenChange={onOpenChange} team={team} athlete={athlete} />}
    </Dialog>
  );
}

function freeNumber(team: SportTeam) {
  const used = new Set(team.athletes.filter((a) => a.active).map((a) => a.number));
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 0;
}

function AthleteBody({ onOpenChange, team, athlete }: { onOpenChange: (o: boolean) => void; team: SportTeam; athlete?: TeamAthlete }) {
  const rules = SPORT_RULES[team.modality];
  const [name, setName] = useState(athlete?.name ?? "");
  const [number, setNumber] = useState(String(athlete?.number ?? freeNumber(team)));
  const [position, setPosition] = useState(athlete?.position ?? rules.positions[0].key);
  const [course, setCourse] = useState(athlete?.course ?? "");
  const [active, setActive] = useState(athlete?.active ?? true);
  const [error, setError] = useState<string>();
  const save = useAction(() => services.sports.saveAthlete(team.id, { name, number: Number(number), position, course, active }, athlete?.id), {
    success: athlete ? "Atleta atualizado(a)" : "Atleta incluído(a) no elenco",
    silentError: true,
  });

  const submit = async () => {
    if (name.trim().length < 2) return setError("Informe o nome do(a) atleta.");
    if (!/^\d{1,2}$/.test(number)) return setError("O número da camisa vai de 0 a 99.");
    setError(undefined);
    try {
      await save.run();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <DialogContent
      title={athlete ? "Editar atleta" : "Incluir atleta"}
      description={`${team.name} · ${rules.label}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} onClick={submit}>
            <Check /> {athlete ? "Salvar" : "Incluir no elenco"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </Field>
          <Field label="Camisa" required>
            <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 2))} className="tnum font-mono" />
          </Field>
        </div>
        <Field label="Posição" required>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Posição">
            {rules.positions.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={position === p.key}
                onClick={() => setPosition(p.key)}
                className={cn(
                  "press rounded-full border px-3 py-1.5 text-[13px] font-medium",
                  position === p.key ? "border-gold/60 bg-gold/10 text-fg" : "border-line text-fg-muted hover:border-line-strong",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Curso" optional>
          <Input value={course} onChange={(e) => setCourse(e.target.value)} maxLength={80} placeholder="Psicologia" />
        </Field>
        <Switch checked={active} onCheckedChange={setActive} label="Atleta ativo(a) no elenco (inativos não entram na escalação)" />
        <FormAlert message={error} />
        <button type="submit" hidden />
      </form>
    </DialogContent>
  );
}

/* ---------------------------- Treino ou jogo ---------------------------- */

export function SessionDialog({
  open,
  onOpenChange,
  teams,
  teamId,
  session,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Times em que a pessoa pode marcar (o primeiro vem escolhido). */
  teams: SportTeam[];
  teamId?: string;
  session?: SportSession;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <SessionBody onOpenChange={onOpenChange} teams={teams} teamId={teamId} session={session} />}
    </Dialog>
  );
}

function SessionBody({ onOpenChange, teams, teamId, session }: { onOpenChange: (o: boolean) => void; teams: SportTeam[]; teamId?: string; session?: SportSession }) {
  const [team, setTeam] = useState(teamId ?? teams[0]?.id ?? "");
  const [kind, setKind] = useState<SessionKind>(session?.kind ?? "treino");
  const [date, setDate] = useState(session?.date ?? todayDateOnly());
  const [time, setTime] = useState(session?.time ?? "19:00");
  const [location, setLocation] = useState(session?.location ?? "");
  const [opponent, setOpponent] = useState(session?.opponent ?? "");
  const [competition, setCompetition] = useState(session?.competition ?? "");
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? "scheduled");
  const [us, setUs] = useState(session?.score ? String(session.score.us) : "");
  const [them, setThem] = useState(session?.score ? String(session.score.them) : "");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [error, setError] = useState<string>();
  const game = kind !== "treino";
  const withScore = game && status === "done" && us !== "" && them !== "";

  const save = useAction(
    () =>
      services.sports.saveSession(
        team,
        { kind, date, time, location, opponent, competition, status, score: withScore ? { us: Number(us), them: Number(them) } : null, notes },
        session?.id,
      ),
    { success: session ? "Atualizado" : `${SESSION_KIND_LABELS[kind]} marcado`, silentError: true },
  );

  const submit = async () => {
    if (!team) return setError("Escolha o time.");
    if (!location.trim()) return setError("Informe o local.");
    if (game && !opponent.trim()) return setError("Informe o adversário.");
    setError(undefined);
    try {
      await save.run();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <DialogContent
      title={session ? `Editar ${SESSION_KIND_LABELS[kind].toLowerCase()}` : "Marcar treino ou jogo"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} onClick={submit}>
            <Check /> {session ? "Salvar" : "Marcar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!teamId && (
          <Field label="Time" required>
            <Select value={team} onChange={(e) => setTeam(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {SPORT_RULES[t.modality].label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="O que é">
          <ChoiceCards
            name="session-kind"
            value={kind}
            onChange={setKind}
            columns={3}
            options={(Object.keys(SESSION_KIND_LABELS) as SessionKind[]).map((k) => ({ value: k, label: SESSION_KIND_LABELS[k] }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Horário" required>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Local" required>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder="Quadra do campus" />
        </Field>
        {game && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Adversário" required>
              <Input value={opponent} onChange={(e) => setOpponent(e.target.value)} maxLength={80} placeholder="Atlética de ..." />
            </Field>
            {kind === "campeonato" && (
              <Field label="Competição" optional>
                <Input value={competition} onChange={(e) => setCompetition(e.target.value)} maxLength={80} placeholder="Jogos Interatléticas" />
              </Field>
            )}
          </div>
        )}
        {session && (
          <Field label="Situação">
            <ChoiceCards
              name="session-status"
              value={status}
              onChange={setStatus}
              columns={3}
              options={(Object.keys(SESSION_STATUS) as SessionStatus[]).map((s) => ({ value: s, label: SESSION_STATUS[s].label }))}
            />
          </Field>
        )}
        {session && game && status === "done" && (
          <Field label="Placar final" hint="Nosso time × adversário.">
            <div className="flex items-center gap-3">
              <Input aria-label="Nossos gols/pontos" inputMode="numeric" value={us} onChange={(e) => setUs(e.target.value.replace(/\D/g, "").slice(0, 3))} className="tnum w-20 text-center font-mono text-lg" />
              <span className="font-display text-xl font-bold text-fg-subtle">×</span>
              <Input aria-label="Gols/pontos do adversário" inputMode="numeric" value={them} onChange={(e) => setThem(e.target.value.replace(/\D/g, "").slice(0, 3))} className="tnum w-20 text-center font-mono text-lg" />
            </div>
          </Field>
        )}
        <Field label="Observações" optional>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
        </Field>
        <FormAlert message={error} />
      </div>
    </DialogContent>
  );
}
