"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Athlete, Competition, CompetitionStatus, Match, MatchStatus, SportTeam, TrainingSlot } from "@/types";
import { services } from "@/services";
import { useAction } from "@/hooks/use-action";
import { COMPETITION_STATUS, MATCH_STATUS, WEEKDAY_LABELS } from "@/lib/labels";
import { errorMessage } from "@/lib/notify";
import { findSport } from "@/lib/sports-catalog";
import { MAX_ROSTER_BATCH, parseRosterText, planRosterAdd } from "@/lib/sports-roster";
import { cn } from "@/lib/utils";
import { SPORTS_COLOR } from "./utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { FormAlert } from "@/components/shared/form-alert";

interface ItemProps<T> {
  team: SportTeam;
  /** Ausente = incluir um novo item. */
  item?: T;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/** Estrutura comum: título, rodapé com Salvar e erro do servidor. */
function ItemShell({ title, description, onSave, saving, error, onCancel, children }: { title: string; description?: string; onSave: () => void; saving: boolean; error?: string; onCancel: () => void; children: ReactNode }) {
  return (
    <DialogContent
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} onClick={onSave}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        {children}
        <button type="submit" hidden />
      </form>
      <FormAlert message={error} className="mt-4" />
    </DialogContent>
  );
}

function useSave<I>(fn: (input: I) => Promise<unknown>, success: string, close: () => void) {
  const [error, setError] = useState<string>();
  const action = useAction(fn, { success, silentError: true });
  const run = async (input: I | string) => {
    if (typeof input === "string") return setError(input);
    setError(undefined);
    try {
      await action.run(input);
      close();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return { run, pending: action.pending, error };
}

/* --------------------------------- treino --------------------------------- */

export function TrainingDialog(props: ItemProps<TrainingSlot>) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <TrainingBody {...props} />}</Dialog>;
}

function TrainingBody({ team, item, onOpenChange }: ItemProps<TrainingSlot>) {
  const [v, setV] = useState({ weekday: String(item?.weekday ?? 2), start: item?.start ?? "", end: item?.end ?? "", location: item?.location ?? team.trainings.at(-1)?.location ?? "" });
  const save = useSave((input: Omit<TrainingSlot, "id"> & { id?: string }) => services.sports.saveTraining(team.id, input), item ? "Treino atualizado" : "Treino adicionado", () => onOpenChange(false));
  const submit = () => {
    if (!v.start) return save.run("Informe o horário de início.");
    if (v.end && v.end <= v.start) return save.run("O término precisa ser depois do início.");
    if (v.location.trim().length < 2) return save.run("Informe o local do treino.");
    save.run({ id: item?.id, weekday: Number(v.weekday), start: v.start, end: v.end || undefined, location: v.location.trim() });
  };
  return (
    <ItemShell title={item ? "Editar treino" : "Novo horário de treino"} description="Horário fixo que se repete toda semana." onSave={submit} saving={save.pending} error={save.error} onCancel={() => onOpenChange(false)}>
      <Field label="Dia da semana" required className="sm:col-span-2">
        <Select value={v.weekday} onChange={(e) => setV((s) => ({ ...s, weekday: e.target.value }))}>
          {WEEKDAY_LABELS.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Início" required>
        <Input type="time" value={v.start} onChange={(e) => setV((s) => ({ ...s, start: e.target.value }))} />
      </Field>
      <Field label="Término" optional>
        <Input type="time" value={v.end} onChange={(e) => setV((s) => ({ ...s, end: e.target.value }))} />
      </Field>
      <Field label="Local" required className="sm:col-span-2">
        <Input value={v.location} onChange={(e) => setV((s) => ({ ...s, location: e.target.value }))} placeholder="Ex.: Quadra do campus" />
      </Field>
    </ItemShell>
  );
}

/* --------------------------------- atleta --------------------------------- */

export function AthleteDialog(props: ItemProps<Athlete>) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <AthleteBody {...props} />}</Dialog>;
}

function AthleteBody({ team, item, onOpenChange }: ItemProps<Athlete>) {
  const sport = findSport(team.sport);
  const [v, setV] = useState({ name: item?.name ?? "", nickname: item?.nickname ?? "", number: item?.number ?? "", position: item?.position ?? "", captain: !!item?.captain });
  const save = useSave((input: Omit<Athlete, "id"> & { id?: string }) => services.sports.saveAthlete(team.id, input), item ? "Atleta atualizado(a)" : "Atleta adicionado(a) ao elenco", () => onOpenChange(false));
  const submit = () => {
    if (v.name.trim().length < 2) return save.run("Informe o nome do(a) atleta.");
    if (v.number && !/^\d{1,4}$/.test(v.number)) return save.run("O número da camisa deve ter só algarismos.");
    save.run({ id: item?.id, name: v.name.trim(), nickname: v.nickname.trim() || undefined, number: v.number || undefined, position: v.position.trim() || undefined, captain: v.captain || undefined });
  };
  // Posição fora da lista do esporte (dado antigo ou digitado) continua aparecendo como opção.
  const positions = sport ? sport.positions.map((p) => p.name) : [];
  if (v.position && sport && !positions.includes(v.position)) positions.push(v.position);
  return (
    <ItemShell title={item ? "Editar atleta" : "Adicionar ao elenco"} description="Só nome e dados de jogo. Não cadastre telefone, documento ou endereço aqui." onSave={submit} saving={save.pending} error={save.error} onCancel={() => onOpenChange(false)}>
      <Field label="Nome" required className="sm:col-span-2">
        <Input value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} autoFocus />
      </Field>
      <Field label="Apelido" optional hint="É o que aparece na escalação. Sem apelido, vai o primeiro nome.">
        <Input maxLength={24} value={v.nickname} onChange={(e) => setV((s) => ({ ...s, nickname: e.target.value }))} placeholder={v.name.trim().split(" ")[0] || "Ex.: Aninha"} />
      </Field>
      <Field label="Número da camisa" optional>
        <Input inputMode="numeric" maxLength={4} value={v.number} onChange={(e) => setV((s) => ({ ...s, number: e.target.value.replace(/\D/g, "") }))} />
      </Field>
      <Field label="Posição" optional className="sm:col-span-2">
        {sport ? (
          <div role="radiogroup" aria-label="Posição" className="flex flex-wrap gap-2">
            {["", ...positions].map((p) => {
              const selected = v.position === p;
              return (
                <button
                  key={p || "nenhuma"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setV((s) => ({ ...s, position: p }))}
                  className={cn("press h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors", selected ? "border-transparent text-[#06102e]" : "border-line text-fg-muted hover:text-fg")}
                  style={selected ? { background: SPORTS_COLOR } : undefined}
                >
                  {p || "Sem posição"}
                </button>
              );
            })}
          </div>
        ) : (
          <Input value={v.position} onChange={(e) => setV((s) => ({ ...s, position: e.target.value }))} placeholder="Ex.: Goleira, Ala, Levantador" />
        )}
      </Field>
      <label className="flex items-center gap-2.5 text-[13.5px] sm:col-span-2">
        <Checkbox checked={v.captain} onChange={(e) => setV((s) => ({ ...s, captain: e.target.checked }))} />
        Capitão / capitã do time
      </label>
    </ItemShell>
  );
}

/* ---------------------------- vários atletas ---------------------------- */

const ROSTER_EXAMPLE = "10 Ana Souza\n7 Bia Lima\nCarla Dias (9)\nDuda";

/** "Adicionar vários": cola a lista do grupo do time e confere antes de salvar. */
export function BulkAthletesDialog({ team, open, onOpenChange }: { team: SportTeam; open: boolean; onOpenChange: (o: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <BulkAthletesBody team={team} onOpenChange={onOpenChange} />}</Dialog>;
}

function BulkAthletesBody({ team, onOpenChange }: { team: SportTeam; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState("");
  const lines = useMemo(() => parseRosterText(text), [text]);
  const plan = useMemo(() => planRosterAdd(team.athletes, lines), [team.athletes, lines]);
  const tooMany = plan.add.length > MAX_ROSTER_BATCH;
  const n = plan.add.length;
  const save = useSave(
    (items: { name: string; number?: string }[]) => services.sports.addAthletes(team.id, items),
    n === 1 ? "1 atleta adicionado(a) ao elenco" : `${n} atletas adicionados(as) ao elenco`,
    () => onOpenChange(false),
  );
  const submit = () => {
    if (lines.length === 0) return save.run("Cole pelo menos um nome, um por linha.");
    if (n === 0) return save.run("Todos esses nomes já estão no elenco.");
    if (tooMany) return save.run(`Dá para adicionar até ${MAX_ROSTER_BATCH} atletas de uma vez.`);
    save.run(plan.add);
  };
  return (
    <DialogContent
      title="Adicionar vários atletas"
      description="Cole a lista do grupo do time, um nome por linha. Se tiver o número da camisa, pode vir antes ou depois do nome."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} onClick={submit} disabled={n === 0 || tooMany}>
            {n === 0 ? "Adicionar" : n === 1 ? "Adicionar 1 atleta" : `Adicionar ${n} atletas`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea rows={7} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={ROSTER_EXAMPLE} aria-label="Lista de atletas" className="font-mono text-[13.5px]" />
        {lines.length > 0 && (
          <div className="rounded-xl border border-line bg-sunken p-3">
            <p className="mb-2 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">{n === 1 ? "Vai entrar 1 atleta" : `Vão entrar ${n} atletas`}</p>
            {n > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {plan.add.map((a) => (
                  <li key={a.name} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-[13px]">
                    <span className="grid h-6 min-w-6 place-items-center rounded-full px-1 font-mono text-[11.5px] font-bold tnum" style={{ background: `${SPORTS_COLOR}26`, color: SPORTS_COLOR }}>
                      {a.number ?? "–"}
                    </span>
                    {a.name}
                  </li>
                ))}
              </ul>
            )}
            {plan.duplicates.length > 0 && <p className="mt-2.5 text-[12.5px] text-fg-muted">Já estão no elenco (ficam de fora): {plan.duplicates.join(", ")}.</p>}
            {plan.numberTaken.length > 0 && <p className="mt-1.5 text-[12.5px] text-warn">Entram sem número porque a camisa já tem dono: {plan.numberTaken.join(", ")}.</p>}
            {tooMany && <p className="mt-1.5 text-[12.5px] text-danger">Dá para adicionar até {MAX_ROSTER_BATCH} de uma vez. Divida a lista.</p>}
          </div>
        )}
        <FormAlert message={save.error} />
      </div>
    </DialogContent>
  );
}

/* ---------------------------------- jogo ---------------------------------- */

export function MatchDialog(props: ItemProps<Match>) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <MatchBody {...props} />}</Dialog>;
}

function MatchBody({ team, item, onOpenChange }: ItemProps<Match>) {
  const [v, setV] = useState({
    date: item?.date ?? "",
    time: item?.time ?? "",
    opponent: item?.opponent ?? "",
    location: item?.location ?? "",
    competitionId: item?.competitionId ?? "",
    scoreFor: item?.scoreFor?.toString() ?? "",
    scoreAgainst: item?.scoreAgainst?.toString() ?? "",
    status: item?.status ?? ("scheduled" as MatchStatus),
    notes: item?.notes ?? "",
  });
  const save = useSave((input: Omit<Match, "id"> & { id?: string }) => services.sports.saveMatch(team.id, input), item ? "Jogo atualizado" : "Jogo adicionado", () => onOpenChange(false));
  const submit = () => {
    if (!v.date) return save.run("Informe a data do jogo.");
    if (v.opponent.trim().length < 2) return save.run("Informe o adversário.");
    if (v.location.trim().length < 2) return save.run("Informe o local do jogo.");
    if (!v.scoreFor !== !v.scoreAgainst) return save.run("Informe o placar dos dois lados (ou deixe os dois em branco).");
    save.run({
      id: item?.id,
      date: v.date,
      time: v.time || undefined,
      opponent: v.opponent.trim(),
      location: v.location.trim(),
      competitionId: v.competitionId || undefined,
      scoreFor: v.scoreFor ? Number(v.scoreFor) : undefined,
      scoreAgainst: v.scoreAgainst ? Number(v.scoreAgainst) : undefined,
      status: v.status,
      notes: v.notes.trim() || undefined,
    });
  };
  const digits = (s: string) => s.replace(/\D/g, "").slice(0, 3);
  return (
    <ItemShell title={item ? "Editar jogo" : "Novo jogo"} description="Depois do jogo, volte aqui para marcar como realizado e lançar o placar." onSave={submit} saving={save.pending} error={save.error} onCancel={() => onOpenChange(false)}>
      <Field label="Adversário" required className="sm:col-span-2">
        <Input value={v.opponent} onChange={(e) => setV((s) => ({ ...s, opponent: e.target.value }))} placeholder="Ex.: Atlética de Medicina" />
      </Field>
      <Field label="Data" required>
        <Input type="date" value={v.date} onChange={(e) => setV((s) => ({ ...s, date: e.target.value }))} />
      </Field>
      <Field label="Horário" optional>
        <Input type="time" value={v.time} onChange={(e) => setV((s) => ({ ...s, time: e.target.value }))} />
      </Field>
      <Field label="Local" required className="sm:col-span-2">
        <Input value={v.location} onChange={(e) => setV((s) => ({ ...s, location: e.target.value }))} />
      </Field>
      <Field label="Competição" optional className="sm:col-span-2" hint={team.competitions.length === 0 ? "Cadastre a competição na aba Competições para vinculá-la." : "Deixe em branco para amistosos."}>
        <Select value={v.competitionId} onChange={(e) => setV((s) => ({ ...s, competitionId: e.target.value }))}>
          <option value="">Amistoso / sem competição</option>
          {team.competitions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Situação" required className="sm:col-span-2">
        <Select value={v.status} onChange={(e) => setV((s) => ({ ...s, status: e.target.value as MatchStatus }))}>
          {(Object.keys(MATCH_STATUS) as MatchStatus[]).map((s) => (
            <option key={s} value={s}>
              {MATCH_STATUS[s].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nosso placar" optional>
        <Input inputMode="numeric" value={v.scoreFor} onChange={(e) => setV((s) => ({ ...s, scoreFor: digits(e.target.value) }))} />
      </Field>
      <Field label="Placar do adversário" optional>
        <Input inputMode="numeric" value={v.scoreAgainst} onChange={(e) => setV((s) => ({ ...s, scoreAgainst: digits(e.target.value) }))} />
      </Field>
      <Field label="Observações" optional className="sm:col-span-2">
        <Textarea rows={2} value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} placeholder="Ex.: placar em sets, destaques do jogo" />
      </Field>
    </ItemShell>
  );
}

/* ------------------------------- competição ------------------------------- */

export function CompetitionDialog(props: ItemProps<Competition>) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <CompetitionBody {...props} />}</Dialog>;
}

function CompetitionBody({ team, item, onOpenChange }: ItemProps<Competition>) {
  const [v, setV] = useState({
    name: item?.name ?? "",
    startDate: item?.startDate ?? "",
    endDate: item?.endDate ?? "",
    location: item?.location ?? "",
    placement: item?.placement ?? "",
    status: item?.status ?? ("upcoming" as CompetitionStatus),
    notes: item?.notes ?? "",
  });
  const save = useSave((input: Omit<Competition, "id"> & { id?: string }) => services.sports.saveCompetition(team.id, input), item ? "Competição atualizada" : "Competição adicionada", () => onOpenChange(false));
  const submit = () => {
    if (v.name.trim().length < 2) return save.run("Informe o nome da competição.");
    if (!v.startDate) return save.run("Informe a data de início.");
    if (v.endDate && v.endDate < v.startDate) return save.run("O término precisa ser no mesmo dia ou depois do início.");
    if (v.location.trim().length < 2) return save.run("Informe o local da competição.");
    save.run({
      id: item?.id,
      name: v.name.trim(),
      startDate: v.startDate,
      endDate: v.endDate || undefined,
      location: v.location.trim(),
      placement: v.placement.trim() || undefined,
      status: v.status,
      notes: v.notes.trim() || undefined,
    });
  };
  return (
    <ItemShell title={item ? "Editar competição" : "Nova competição"} description="Campeonatos, copas e jogos universitários de que a modalidade participa." onSave={submit} saving={save.pending} error={save.error} onCancel={() => onOpenChange(false)}>
      <Field label="Nome" required className="sm:col-span-2">
        <Input value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} placeholder="Ex.: Copa Intercursos 2026" />
      </Field>
      <Field label="Início" required>
        <Input type="date" value={v.startDate} onChange={(e) => setV((s) => ({ ...s, startDate: e.target.value }))} />
      </Field>
      <Field label="Término" optional>
        <Input type="date" value={v.endDate} onChange={(e) => setV((s) => ({ ...s, endDate: e.target.value }))} />
      </Field>
      <Field label="Local" required className="sm:col-span-2">
        <Input value={v.location} onChange={(e) => setV((s) => ({ ...s, location: e.target.value }))} />
      </Field>
      <Field label="Situação" required>
        <Select value={v.status} onChange={(e) => setV((s) => ({ ...s, status: e.target.value as CompetitionStatus }))}>
          {(Object.keys(COMPETITION_STATUS) as CompetitionStatus[]).map((s) => (
            <option key={s} value={s}>
              {COMPETITION_STATUS[s].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Resultado final" optional hint="Ex.: Campeã, Vice, 3º lugar">
        <Input value={v.placement} onChange={(e) => setV((s) => ({ ...s, placement: e.target.value }))} />
      </Field>
      <Field label="Observações" optional className="sm:col-span-2">
        <Textarea rows={2} value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} />
      </Field>
    </ItemShell>
  );
}
