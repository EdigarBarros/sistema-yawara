"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, FileUp, Link2, Paperclip, Search, X } from "lucide-react";
import type { ID } from "@/types";
import { useDirectory } from "@/hooks/use-data";
import { Select } from "@/components/ui/form";
import { FileTypeIcon } from "./file-type-icon";
import { cn, matchesQuery } from "@/lib/utils";
import { fileExtension, formatBytes } from "@/lib/format";
import { isLinkFile } from "@/lib/file-links";
import { usesFileDatabase, usesFileLinks } from "@/lib/mode";
import { LinkPicker } from "./file-link";

/* ---------------------------- Seleção de pessoas ---------------------------- */

interface MemberMultiPickerProps {
  value: ID[];
  onChange: (ids: ID[]) => void;
  /** Limita às pessoas listadas (ex.: integrantes ativos). */
  includeInactive?: boolean;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
}

/** Seleciona várias pessoas da lista de integrantes (fictícios). */
export function MemberMultiPicker({ value, onChange, includeInactive, placeholder = "Buscar pelo nome…", invalid, id }: MemberMultiPickerProps) {
  const dir = useDirectory();
  const [query, setQuery] = useState("");
  const pool = includeInactive ? dir.members : dir.activeMembers;
  const filtered = useMemo(
    () => pool.filter((m) => matchesQuery(query, m.name, dir.role(m.roleId)?.name, dir.departmentOf(m.id)?.name)),
    [pool, query, dir],
  );
  const toggle = (memberId: ID) => onChange(value.includes(memberId) ? value.filter((v) => v !== memberId) : [...value, memberId]);

  return (
    <div className={cn("rounded-lg border bg-sunken", invalid ? "border-danger/70" : "border-line-strong")}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line p-2">
          {value.map((vid) => (
            <span key={vid} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 py-0.5 pr-1 pl-1 text-[12.5px]">
              <MemberAvatar name={dir.memberName(vid)} id={vid} size={18} />
              {dir.memberName(vid)}
              <button type="button" onClick={() => toggle(vid)} className="grid size-5 place-items-center rounded-full text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label={`Remover ${dir.memberName(vid)}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative border-b border-line">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar integrante"
          className="h-9 w-full bg-transparent pr-3 pl-9 text-[13.5px] focus:outline-none"
        />
      </div>
      <ul className="max-h-52 overflow-y-auto p-1" role="listbox" aria-multiselectable>
        {filtered.length === 0 && <li className="px-3 py-3 text-[13px] text-fg-subtle">Ninguém encontrado.</li>}
        {filtered.map((m) => {
          const selected = value.includes(m.id);
          return (
            <li key={m.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => toggle(m.id)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2", selected && "bg-gold/[0.07]")}
              >
                <MemberAvatar name={m.name} id={m.id} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-[11.5px] text-fg-subtle">{dir.role(m.roleId)?.name}</span>
                </span>
                <span className={cn("grid size-4 place-items-center rounded border", selected ? "border-gold bg-gold text-gold-ink" : "border-line-strong")}>
                  {selected && <Check className="size-3" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Seleção de uma pessoa (lista suspensa nativa — funciona bem no celular). */
export function MemberSelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "Sem responsável",
  filter,
  ...rest
}: {
  value: ID | "";
  onChange: (id: ID) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  filter?: (memberId: ID) => boolean;
  id?: string;
  "aria-invalid"?: boolean;
}) {
  const dir = useDirectory();
  const members = dir.activeMembers.filter((m) => !filter || filter(m.id));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {(allowEmpty || !value) && <option value="">{allowEmpty ? emptyLabel : "Selecione…"}</option>}
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} — {dir.role(m.roleId)?.name}
        </option>
      ))}
    </Select>
  );
}

/** Seleção de vários cargos por caixas de seleção. */
export function RoleMultiPicker({ value, onChange, invalid }: { value: ID[]; onChange: (ids: ID[]) => void; invalid?: boolean }) {
  const dir = useDirectory();
  const groups = dir.departments
    .map((d) => ({ dep: d, roles: dir.roles.filter((r) => r.departmentId === d.id && r.active) }))
    .filter((g) => g.roles.length > 0);
  const toggle = (id: ID) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className={cn("max-h-64 overflow-y-auto rounded-lg border bg-sunken p-1", invalid ? "border-danger/70" : "border-line-strong")}>
      {groups.map(({ dep, roles }) => (
        <div key={dep.id} className="py-1">
          <div className="eyebrow px-2.5 pt-1.5 pb-1">{dep.name}</div>
          {roles.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-2">
              <input type="checkbox" checked={value.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--gold)]" />
              {r.name}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Seleção de arquivo ------------------------------ */

interface FilePickerProps {
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  hint?: ReactNode;
  label?: string;
}

/**
 * Seleção de arquivo. Modo demonstração: fica na memória do navegador. Modo
 * Firebase com Storage ou com arquivos no banco: enviado ao servidor pela
 * operação (no banco, também dá para informar um link). Implantação gratuita
 * só com links: a pessoa informa o LINK do arquivo.
 */
export function FilePicker({ file, onChange, accept, hint, label = "Escolher arquivo" }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [linkMode, setLinkMode] = useState(false);

  if (file && isLinkFile(file)) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-sunken px-3 py-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-3 text-gold-fg">
          <Link2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{file.name}</p>
          <p className="text-[11.5px] text-fg-subtle">Link do arquivo</p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="grid size-8 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Remover link">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (!file && usesFileLinks) return <LinkPicker onChange={onChange} />;
  if (!file && linkMode) {
    return (
      <div className="grid gap-2">
        <LinkPicker onChange={onChange} />
        <button type="button" onClick={() => setLinkMode(false)} className="justify-self-start text-[12.5px] font-semibold text-gold-fg hover:underline">
          Voltar e enviar o arquivo
        </button>
      </div>
    );
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-sunken px-3 py-2.5">
        <FileTypeIcon name={file.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{file.name}</p>
          <p className="text-[11.5px] text-fg-subtle">
            {formatBytes(file.size)} · {file.type || "formato não identificado"}
          </p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="grid size-8 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Remover arquivo">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
        dragging ? "border-gold/70 bg-gold/[0.06]" : "border-line-strong bg-sunken",
      )}
    >
      <FileUp className="size-5 text-fg-subtle" aria-hidden />
      <p className="text-[13px] text-fg-muted">
        Arraste um arquivo para cá ou{" "}
        <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-gold-fg hover:underline">
          {label.toLowerCase()}
        </button>
      </p>
      {hint && <p className="text-[11.5px] text-fg-subtle">{hint}</p>}
      {usesFileDatabase && (
        <button type="button" onClick={() => setLinkMode(true)} className="inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg hover:underline">
          <Link2 className="size-3.5" aria-hidden /> Arquivo grande? Informe um link
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Linha que representa um arquivo anexado. */
export function FileRow({
  name,
  size,
  meta,
  actions,
}: {
  name: string;
  size?: number;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-fg-muted">
        <Paperclip className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{name}</p>
        <p className="text-[11.5px] text-fg-subtle">
          {size === 0 ? "link" : fileExtension(name)}
          {size !== undefined && size > 0 && ` · ${formatBytes(size)}`}
          {meta && <> · {meta}</>}
        </p>
      </div>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </div>
  );
}
