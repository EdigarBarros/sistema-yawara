"use client";

import type { Permission, PermissionAction } from "@/types";
import { MODULES } from "@/lib/modules";
import { ACTION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ACTIONS: PermissionAction[] = ["view", "create", "register", "edit", "approve", "archive", "export", "admin"];

interface Props {
  value: Permission[];
  onChange?: (value: Permission[]) => void;
  readOnly?: boolean;
}

/**
 * Matriz de permissões por módulo × atividade. No computador é uma tabela;
 * no celular, uma lista por módulo. Só aparecem as atividades que existem
 * em cada módulo.
 */
export function PermissionMatrix({ value, onChange, readOnly }: Props) {
  const set = new Set(value);
  const toggle = (p: Permission, on: boolean) => {
    if (!onChange) return;
    const next = new Set(set);
    if (on) next.add(p);
    else next.delete(p);
    // Sem "Visualizar", as demais permissões do módulo não fazem sentido.
    const [module, action] = p.split(".") as [string, PermissionAction];
    if (action === "view" && !on) for (const a of ACTIONS) next.delete(`${module}.${a}` as Permission);
    if (action !== "view" && on) next.add(`${module}.view` as Permission);
    onChange([...next]);
  };
  const toggleModule = (module: string, on: boolean) => {
    if (!onChange) return;
    const def = MODULES.find((m) => m.key === module)!;
    const next = new Set(set);
    for (const a of Object.keys(def.actions)) {
      const p = `${module}.${a}` as Permission;
      if (on) next.add(p);
      else next.delete(p);
    }
    onChange([...next]);
  };

  return (
    <>
      {/* Computador */}
      <div className="hidden overflow-x-auto rounded-lg border border-line md:block">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Permissões por módulo e atividade</caption>
          <thead>
            <tr className="border-b border-line bg-sunken">
              <th scope="col" className="px-4 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">
                Módulo
              </th>
              {ACTIONS.map((a) => (
                <th key={a} scope="col" className="px-2 py-2.5 text-center text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">
                  {ACTION_LABELS[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => {
              const available = Object.keys(m.actions) as PermissionAction[];
              const all = available.every((a) => set.has(`${m.key}.${a}` as Permission));
              return (
                <tr key={m.key} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">
                    <div className="flex items-center justify-between gap-3">
                      <span>{m.label}</span>
                      {!readOnly && (
                        <button type="button" onClick={() => toggleModule(m.key, !all)} className="text-[11.5px] font-medium text-gold-fg hover:underline">
                          {all ? "Nenhuma" : "Todas"}
                        </button>
                      )}
                    </div>
                  </th>
                  {ACTIONS.map((a) => {
                    const p = `${m.key}.${a}` as Permission;
                    const exists = available.includes(a);
                    return (
                      <td key={a} className="px-2 py-2.5 text-center">
                        {exists ? (
                          <input
                            type="checkbox"
                            className={cn("size-4 accent-[var(--gold)]", readOnly && "pointer-events-none")}
                            checked={set.has(p)}
                            readOnly={readOnly}
                            onChange={(e) => toggle(p, e.target.checked)}
                            aria-label={`${m.label}: ${ACTION_LABELS[a]} — ${m.actions[a]}`}
                            title={m.actions[a]}
                          />
                        ) : (
                          <span className="text-fg-subtle" aria-hidden>
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Celular */}
      <div className="space-y-3 md:hidden">
        {MODULES.map((m) => (
          <fieldset key={m.key} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">{m.label}</legend>
            <ul className="space-y-1.5">
              {(Object.keys(m.actions) as PermissionAction[]).map((a) => {
                const p = `${m.key}.${a}` as Permission;
                return (
                  <li key={a}>
                    <label className="flex items-start gap-2.5 text-[13px]">
                      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--gold)]" checked={set.has(p)} disabled={readOnly} onChange={(e) => toggle(p, e.target.checked)} />
                      <span>
                        <b className="font-medium">{ACTION_LABELS[a]}</b> <span className="text-fg-muted">— {m.actions[a]}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
    </>
  );
}

/** Resumo legível das permissões (para perfis e cartões). */
export function PermissionSummary({ value }: { value: Permission[] }) {
  const set = new Set(value);
  return (
    <ul className="space-y-2">
      {MODULES.filter((m) => set.has(`${m.key}.view` as Permission)).map((m) => (
        <li key={m.key} className="text-[13px]">
          <span className="font-medium">{m.label}:</span>{" "}
          <span className="text-fg-muted">
            {(Object.keys(m.actions) as PermissionAction[])
              .filter((a) => set.has(`${m.key}.${a}` as Permission))
              .map((a) => ACTION_LABELS[a].toLowerCase())
              .join(", ")}
          </span>
        </li>
      ))}
      {!MODULES.some((m) => set.has(`${m.key}.view` as Permission)) && <li className="text-[13px] text-fg-subtle">Nenhum módulo liberado.</li>}
    </ul>
  );
}
