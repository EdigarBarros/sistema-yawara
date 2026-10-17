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
  /**
   * Motivo pelo qual a permissão não pode ser marcada/desmarcada por quem está
   * editando (undefined = pode). A caixa fica desabilitada e o motivo aparece
   * como dica. Espelha as regras do servidor; não é segurança.
   */
  lockReason?: (permission: Permission, checked: boolean) => string | undefined;
}

/**
 * Matriz de permissões por módulo × atividade. No computador é uma tabela;
 * no celular, uma lista por módulo. Só aparecem as atividades que existem
 * em cada módulo.
 */
export function PermissionMatrix({ value, onChange, readOnly, lockReason }: Props) {
  const set = new Set(value);
  /** Motivo do bloqueio de uma caixa, incluindo os efeitos em cascata do "Visualizar". */
  const lockOf = (p: Permission): string | undefined => {
    if (readOnly || !lockReason) return undefined;
    const checked = set.has(p);
    const own = lockReason(p, checked);
    if (own) return own;
    const [module, action] = p.split(".") as [string, PermissionAction];
    const view = `${module}.view` as Permission;
    // Desmarcar "Visualizar" desmarca as demais; marcar outra atividade marca "Visualizar".
    if (action === "view" && checked) {
      for (const a of ACTIONS) {
        const other = `${module}.${a}` as Permission;
        if (other !== p && set.has(other)) {
          const reason = lockReason(other, true);
          if (reason) return reason;
        }
      }
    }
    if (action !== "view" && !checked && !set.has(view)) return lockReason(view, false);
    return undefined;
  };
  const toggle = (p: Permission, on: boolean) => {
    if (!onChange || lockOf(p)) return;
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
    if (Object.keys(def.actions).some((a) => lockOf(`${module}.${a}` as Permission))) return;
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
              const moduleLocked = available.some((a) => lockOf(`${m.key}.${a}` as Permission));
              return (
                <tr key={m.key} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">
                    <div className="flex items-center justify-between gap-3">
                      <span>{m.label}</span>
                      {!readOnly && !moduleLocked && (
                        <button type="button" onClick={() => toggleModule(m.key, !all)} className="text-[11.5px] font-medium text-gold-fg hover:underline">
                          {all ? "Nenhuma" : "Todas"}
                        </button>
                      )}
                    </div>
                  </th>
                  {ACTIONS.map((a) => {
                    const p = `${m.key}.${a}` as Permission;
                    const exists = available.includes(a);
                    const lock = exists ? lockOf(p) : undefined;
                    return (
                      <td key={a} className="px-2 py-2.5 text-center">
                        {exists ? (
                          // A dica fica no invólucro: caixas desabilitadas não recebem o cursor em todos os navegadores.
                          <span title={lock ?? m.actions[a]} className={cn("inline-flex", lock && "cursor-not-allowed")}>
                            <input
                              type="checkbox"
                              className={cn("size-4 accent-[var(--gold)]", readOnly && "pointer-events-none", lock && "pointer-events-none opacity-45")}
                              checked={set.has(p)}
                              readOnly={readOnly}
                              disabled={!!lock}
                              onChange={(e) => toggle(p, e.target.checked)}
                              aria-label={`${m.label}: ${ACTION_LABELS[a]} — ${m.actions[a]}${lock ? ` (bloqueado: ${lock})` : ""}`}
                            />
                          </span>
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
                const lock = lockOf(p);
                return (
                  <li key={a}>
                    <label className={cn("flex items-start gap-2.5 text-[13px]", lock && "cursor-not-allowed")} title={lock}>
                      <input type="checkbox" className={cn("mt-0.5 size-4 accent-[var(--gold)]", lock && "opacity-45")} checked={set.has(p)} disabled={readOnly || !!lock} onChange={(e) => toggle(p, e.target.checked)} />
                      <span>
                        <b className="font-medium">{ACTION_LABELS[a]}</b> <span className="text-fg-muted">— {m.actions[a]}</span>
                        {lock && <span className="block text-[11.5px] text-fg-subtle">{lock}</span>}
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
