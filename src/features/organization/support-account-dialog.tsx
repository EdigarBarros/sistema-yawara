"use client";

import { useRef, useState } from "react";
import { Camera, Eye, EyeOff, Trash2 } from "lucide-react";
import type { Member } from "@/types";
import { services, type SupportAccountInput } from "@/services";
import { useAction } from "@/hooks/use-action";
import { isFirebaseMode } from "@/lib/mode";
import { errorMessage } from "@/lib/notify";
import { imageFileToAvatar } from "@/lib/photo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Avatar } from "@/components/ui/misc";
import { ErrorLine, Notice } from "./org-dialogs";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_RULE = "A senha precisa ter de 8 a 128 caracteres, com pelo menos uma letra e um número.";

/**
 * SUPORTE DO SISTEMA: corrige a conta de qualquer integrante — foto, nome,
 * e-mail de acesso e senha. Só o que mudou é enviado. O servidor confere de
 * novo que quem pede está no cargo de suporte (organization.supportUpdateAccount).
 */
export function SupportAccountDialog({ member, open, onOpenChange }: { member: Member; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <SupportAccountBody member={member} onOpenChange={onOpenChange} />}</Dialog>;
}

function SupportAccountBody({ member, onOpenChange }: { member: Member; onOpenChange: (open: boolean) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // undefined = foto sem mudança; null = remover; string = foto nova.
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  const save = useAction((input: SupportAccountInput) => services.organization.supportUpdateAccount(member.id, input), {
    success: (m) => `Conta de ${m.name} atualizada`,
    silentError: true,
  });

  const shownPhoto = photo === undefined ? member.photo : (photo ?? undefined);

  async function submit() {
    const input: SupportAccountInput = {};
    if (name.trim() !== member.name) input.name = name.trim();
    if (email.trim().toLowerCase() !== member.email.toLowerCase()) input.email = email.trim().toLowerCase();
    if (password) input.password = password;
    if (photo !== undefined) input.photo = photo;
    if (input.name !== undefined && input.name.length < 2) return setError("O nome precisa ter pelo menos 2 caracteres.");
    if (input.email !== undefined && !EMAIL.test(input.email)) return setError("Informe um e-mail válido.");
    if (input.password !== undefined && (password.length < 8 || password.length > 128 || !/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password))) {
      return setError(PASSWORD_RULE);
    }
    if (Object.keys(input).length === 0) return onOpenChange(false);
    setError(undefined);
    try {
      await save.run(input);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <DialogContent
      title={`Conta de ${member.name}`}
      description="Acesso de suporte: tudo o que mudar aqui vale na hora e fica registrado na auditoria (a senha nunca é registrada)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex items-center gap-4">
          <Avatar id={member.id} name={name || member.name} size={64} src={shownPhoto} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
              <Camera /> {shownPhoto ? "Trocar foto" : "Adicionar foto"}
            </Button>
            {shownPhoto && (
              <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                <Trash2 /> Remover foto
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                setPhoto(await imageFileToAvatar(file));
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          />
        </div>
        <Field label="Nome" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-mail de acesso" required hint="É o e-mail usado para entrar na Central.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@example.org" />
        </Field>
        <Field label="Nova senha" optional hint={isFirebaseMode ? "Deixe em branco para manter a atual. Mínimo de 8 caracteres, com letra e número." : "Na demonstração não há senhas; o campo é ignorado."}>
          <Input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            trailing={
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="text-fg-subtle [&_svg]:size-4">
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            }
          />
        </Field>
        {isFirebaseMode && (
          <Notice tone="warn">Trocar o e-mail ou a senha encerra as sessões abertas da pessoa: ela precisa entrar de novo com os dados novos.</Notice>
        )}
      </div>
      <ErrorLine error={error} />
    </DialogContent>
  );
}
