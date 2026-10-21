"use client";

import { useRef, useState } from "react";
import { Camera, Eye, EyeOff, Trash2 } from "lucide-react";
import { errorMessage } from "@/lib/notify";
import { imageFileToAvatar } from "@/lib/photo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Avatar } from "@/components/ui/misc";

/**
 * Campos que só o Suporte do sistema vê ao editar um integrante (foto e
 * senha). O servidor confere de novo o cargo (organization.supportUpdateAccount).
 */

export const PASSWORD_RULE = "A senha precisa ter de 8 a 128 caracteres, com pelo menos uma letra e um número.";

export function validPassword(value: string) {
  return value.length >= 8 && value.length <= 128 && /[A-Za-zÀ-ÿ]/.test(value) && /\d/.test(value);
}

/** Foto do integrante: `value` undefined = sem mudança, null = remover, string = foto nova. */
export function PhotoPicker({
  id,
  name,
  current,
  value,
  onChange,
  onError,
}: {
  id: string;
  name: string;
  current?: string;
  value: string | null | undefined;
  onChange: (photo: string | null) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const shown = value === undefined ? current : (value ?? undefined);
  return (
    <div className="flex items-center gap-4">
      <Avatar id={id} name={name} size={64} src={shown} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <Camera /> {shown ? "Trocar foto" : "Adicionar foto"}
        </Button>
        {shown && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            <Trash2 /> Remover foto
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            onChange(await imageFileToAvatar(file));
          } catch (err) {
            onError(errorMessage(err));
          }
        }}
      />
    </div>
  );
}

export function PasswordInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <Input
      type={show ? "text" : "password"}
      autoComplete="new-password"
      value={value}
      placeholder="Deixe em branco para manter a atual"
      onChange={(e) => onChange(e.target.value)}
      trailing={
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar senha" : "Mostrar senha"} className="grid size-8 place-items-center text-fg-subtle [&_svg]:size-4">
          {show ? <EyeOff /> : <Eye />}
        </button>
      }
    />
  );
}
