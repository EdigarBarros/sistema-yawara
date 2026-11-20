"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import type { EntryType, FinanceEntry } from "@/types";
import { services } from "@/services";
import { withRequestId } from "@/services/firebase/call";
import { ServiceError } from "@/services/errors";
import { useAccess } from "@/hooks/use-access";
import { useDirectory, useFinanceCategories } from "@/hooks/use-data";
import { useSession } from "@/stores/session";
import { formatDate, formatMoney } from "@/lib/format";
import { errorMessage, notifySuccess } from "@/lib/notify";
import { isFirebaseMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { MemberSelect } from "@/components/shared/pickers";
import { FormAlert } from "@/components/shared/form-alert";
import { entryDescription, entryNotes, parseStatement, type StatementParse, type StatementRow } from "./statement-import";

/** Mesmo id que o servidor dá ao lançamento (functions/src/modules/finance.ts → newEntryId). */
async function serverEntryId(uid: string, requestId: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${requestId}`)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}

type RowState = "todo" | "done" | "skipped" | "failed";

/**
 * Importar extrato (CSV): mostra o que vai entrar, quem paga e quem recebe, e
 * registra cada linha como lançamento pelo caminho normal (código, histórico,
 * auditoria). Cada linha usa um identificador fixo de requisição, então
 * importar o mesmo extrato de novo não duplica nada.
 */
export function StatementImportDialog({ open, onOpenChange, entries }: { open: boolean; onOpenChange: (o: boolean) => void; entries: FinanceEntry[] }) {
  const access = useAccess();
  const dir = useDirectory();
  const qc = useQueryClient();
  const userId = useSession((s) => s.userId) ?? "";
  const { data: categories } = useFinanceCategories();
  const canSettle = access.can("finance.approve");

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<StatementParse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [incomeCat, setIncomeCat] = useState("");
  const [expenseCat, setExpenseCat] = useState("");
  const [department, setDepartment] = useState("");
  const [responsible, setResponsible] = useState(userId);
  const [source, setSource] = useState("extrato da InfinitePay");
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usable = useMemo(() => (parsed?.rows ?? []).filter((r) => r.kind !== "internal"), [parsed]);
  const internal = (parsed?.rows ?? []).length - usable.length;

  // Linhas já importadas antes (mesmo id de lançamento no servidor).
  useEffect(() => {
    if (usable.length === 0) return;
    let alive = true;
    const ids = new Set(entries.map((e) => e.id));
    // Também pelo conteúdo (data, valor, tipo e descrição): cobre a demonstração e outra pessoa que já importou.
    const sig = (type: string, date: string, amount: number, description: string) => `${type}|${date}|${amount}|${description}`;
    const sigs = new Set(entries.filter((e) => e.status !== "cancelled").map((e) => sig(e.type, e.date, e.amount, e.description)));
    void Promise.all(
      usable.map(async (r) => [r.key, isFirebaseMode && userId ? await serverEntryId(userId, r.key) : "", sig(r.kind, r.date, r.amount, entryDescription(r))] as const),
    ).then((triples) => {
      if (!alive) return;
      setExisting(new Set(triples.filter(([, id, s]) => ids.has(id) || sigs.has(s)).map(([k]) => k)));
    });
    return () => {
      alive = false;
    };
  }, [usable, entries, userId]);

  const pick = (rows: StatementRow[]) => new Set(rows.map((r) => r.key));
  const chosen = usable.filter((r) => selected.has(r.key) && !existing.has(r.key));
  const sum = (type: EntryType) => chosen.filter((r) => r.kind === type).reduce((a, r) => a + r.amount, 0);
  const count = (type: EntryType) => chosen.filter((r) => r.kind === type).length;
  const doneCount = Object.values(states).filter((s) => s === "done" || s === "skipped").length;
  const failed = Object.entries(states).filter(([, s]) => s === "failed").length;
  const finished = !running && Object.keys(states).length > 0;

  function reset() {
    setFileName("");
    setParsed(null);
    setSelected(new Set());
    setExisting(new Set());
    setStates({});
    setError(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    reset();
    setFileName(file.name);
    const result = parseStatement(await file.text());
    setParsed(result);
    setSelected(pick(result.rows.filter((r) => r.kind !== "internal")));
  }

  async function run() {
    setError(null);
    if (chosen.some((r) => r.kind === "income") && !incomeCat) return setError("Escolha a categoria das receitas.");
    if (chosen.some((r) => r.kind === "expense") && !expenseCat) return setError("Escolha a categoria das despesas.");
    if (!department) return setError("Escolha o departamento.");
    if (!responsible) return setError("Escolha o responsável.");
    setRunning(true);
    const queue = [...chosen];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const r = row;
        try {
          await withRequestId(r.key, () =>
            services.finance.create({
              type: r.kind as EntryType,
              description: entryDescription(r),
              categoryId: r.kind === "income" ? incomeCat : expenseCat,
              amount: r.amount,
              date: r.date,
              responsibleId: responsible,
              departmentId: department,
              paymentMethod: "pix",
              status: canSettle ? "settled" : "pending",
              notes: entryNotes(r, source.trim() || "extrato"),
            }),
          );
          setStates((s) => ({ ...s, [r.key]: "done" }));
        } catch (e) {
          // Já registrado numa importação anterior: não é erro.
          const repeated = e instanceof ServiceError && e.code === "conflict" && /já foi registrad/i.test(e.message);
          setStates((s) => ({ ...s, [r.key]: repeated ? "skipped" : "failed" }));
          if (!repeated) setError(errorMessage(e));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
    await qc.invalidateQueries();
    notifySuccess("Extrato importado", `${chosen.length} lançamento(s) processado(s).`);
  }

  const incomeCats = (categories ?? []).filter((c) => c.type === "income");
  const expenseCats = (categories ?? []).filter((c) => c.type === "expense");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (running) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        size="xl"
        modal
        title="Importar extrato"
        description="Escolha o extrato em CSV. Os movimentos entre conta, caixinhas e aplicação ficam de fora, porque o dinheiro só muda de lugar."
        footer={
          finished ? (
            <Button variant="primary" onClick={() => (reset(), onOpenChange(false))}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="ghost" disabled={running} onClick={() => (reset(), onOpenChange(false))}>
                Cancelar
              </Button>
              <Button variant="primary" disabled={!parsed || chosen.length === 0} loading={running} onClick={() => void run()}>
                <Upload /> {chosen.length === 1 ? "Importar 1 lançamento" : `Importar ${chosen.length} lançamentos`}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-5">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line-strong bg-sunken px-4 py-3.5 hover:border-gold/50">
            <FileSpreadsheet className="size-5 shrink-0 text-gold-fg" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{fileName || "Escolher arquivo CSV"}</span>
              <span className="block text-[12px] text-fg-subtle">Colunas: Data; Hora; Onde; Descrição; Tipo; Valor; Categoria</span>
            </span>
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={running} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          {parsed && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Categoria das receitas" required={count("income") > 0}>
                  <Select value={incomeCat} onChange={(e) => setIncomeCat(e.target.value)} disabled={running}>
                    <option value="">Escolha…</option>
                    {incomeCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Categoria das despesas" required={count("expense") > 0}>
                  <Select value={expenseCat} onChange={(e) => setExpenseCat(e.target.value)} disabled={running}>
                    <option value="">Escolha…</option>
                    {expenseCats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Departamento" required>
                  <Select value={department} onChange={(e) => setDepartment(e.target.value)} disabled={running}>
                    <option value="">Escolha…</option>
                    {dir.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Responsável" required>
                  <MemberSelect value={responsible} onChange={setResponsible} />
                </Field>
                <Field label="De onde veio" hint="Vai na observação de cada lançamento." className="sm:col-span-2">
                  <input value={source} onChange={(e) => setSource(e.target.value)} disabled={running} className="h-10 w-full rounded-lg border border-line-strong bg-sunken px-3 text-[13.5px]" />
                </Field>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
                <span>
                  Receitas: <b className="tnum font-mono text-ok">{count("income")} · {formatMoney(sum("income"))}</b>
                </span>
                <span>
                  Despesas: <b className="tnum font-mono text-fg">{count("expense")} · {formatMoney(sum("expense"))}</b>
                </span>
                <span>{internal} movimento(s) interno(s) fora</span>
                {existing.size > 0 && <span>{existing.size} já importado(s) antes</span>}
                {!canSettle && <span className="text-warn">Entram como pendentes: seu perfil não confirma pagamentos.</span>}
              </div>

              {parsed.problems.length > 0 && (
                <FormAlert message={`Linhas ignoradas: ${parsed.problems.map((p) => `${p.line} (${p.reason})`).join(", ")}.`} />
              )}

              {Object.keys(states).length > 0 && (
                <div className="flex items-center gap-2 text-[13px]">
                  {finished && failed === 0 ? <CheckCircle2 className="size-4 text-ok" /> : null}
                  <span>
                    {doneCount} de {Object.keys(states).length + (running ? queueLeft(chosen, states) : 0)} importado(s){failed > 0 && `, ${failed} com erro`}
                  </span>
                </div>
              )}

              <div className="max-h-[42dvh] overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-surface text-left text-[11.5px] tracking-wide text-fg-subtle uppercase">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          aria-label="Marcar todos"
                          checked={usable.length > 0 && usable.every((r) => selected.has(r.key))}
                          disabled={running || finished}
                          onChange={(e) => setSelected(e.target.checked ? pick(usable) : new Set())}
                        />
                      </th>
                      <th className="px-2 py-2">Data</th>
                      <th className="px-2 py-2">Descrição</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usable.map((r) => {
                      const st = existing.has(r.key) ? "skipped" : states[r.key];
                      return (
                        <tr key={r.key} className={cn("border-t border-line", st === "failed" && "bg-danger/10", (st === "done" || st === "skipped") && "opacity-60")}>
                          <td className="px-3 py-1.5">
                            <Checkbox
                              aria-label={`Importar ${r.name}`}
                              checked={selected.has(r.key) && !existing.has(r.key)}
                              disabled={running || finished || existing.has(r.key)}
                              onChange={(e) =>
                                setSelected((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(r.key);
                                  else n.delete(r.key);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="tnum px-2 py-1.5 font-mono text-[12px] whitespace-nowrap text-fg-muted">{formatDate(r.date)}</td>
                          <td className="max-w-0 px-2 py-1.5">
                            <p className="truncate">{r.name}</p>
                            <p className="truncate text-[11.5px] text-fg-subtle">
                              {r.where}
                              {st === "skipped" && " · já importado"}
                              {st === "done" && " · importado"}
                              {st === "failed" && " · erro"}
                            </p>
                          </td>
                          <td className={cn("tnum px-3 py-1.5 text-right font-mono whitespace-nowrap", r.kind === "income" ? "text-ok" : "text-fg")}>
                            {r.kind === "income" ? "+" : "−"} {formatMoney(r.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <FormAlert message={error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function queueLeft(chosen: StatementRow[], states: Record<string, RowState>) {
  return chosen.filter((r) => !states[r.key]).length;
}
