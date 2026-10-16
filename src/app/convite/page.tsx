"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { services } from "@/services";
import { useSessionReady } from "@/stores/session";
import { errorMessage } from "@/lib/notify";
import { formatDateTime } from "@/lib/format";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/misc";
import { DemoNotice, FullPageLoader } from "@/components/shared/states";
import { BrandEmblem } from "@/components/layout/brand";
import { FormAlert } from "@/components/shared/form-alert";

const PASSWORD_RULE = "Use de 8 a 128 caracteres, com pelo menos uma letra e um número.";
const schema = z
  .object({
    password: z
      .string()
      .min(8, PASSWORD_RULE)
      .max(128, PASSWORD_RULE)
      .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), PASSWORD_RULE),
    confirm: z.string().min(1, "Repita a senha."),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não são iguais." });
type Values = z.infer<typeof schema>;

function InvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const { ready, userId } = useSessionReady();
  const [show, setShow] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const preview = useQuery({ queryKey: ["invitation", token], queryFn: () => services.auth.previewInvitation(token), retry: false });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });

  useEffect(() => {
    if (ready && userId) router.replace("/inicio");
  }, [ready, userId, router]);

  if (preview.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (preview.isError) {
    return (
      <div role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-4 py-3.5 text-[13.5px]">
        <strong className="text-fg">Não foi possível usar este convite.</strong> <span className="text-fg-muted">{errorMessage(preview.error)}</span>
        <p className="mt-3">
          <Link href="/login" className="font-medium text-gold-fg hover:underline">
            Ir para o login
          </Link>
        </p>
      </div>
    );
  }
  const inv = preview.data!;

  const onSubmit = async (values: Values) => {
    setServerError(undefined);
    try {
      await services.auth.acceptInvitation(token, values.password);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="rounded-lg border border-line bg-sunken/60 px-4 py-3.5 text-[13.5px]">
        <p className="font-semibold">{inv.name}</p>
        <p className="text-fg-muted">{inv.email}</p>
        <p className="mt-1.5 text-fg-muted">
          Cargo: <span className="font-medium text-fg">{inv.roleName}</span>
        </p>
        <p className="mt-1 text-[12px] text-fg-subtle">Convite válido até {formatDateTime(inv.expiresAt)}. Só pode ser usado uma vez.</p>
      </div>
      <Field label="Crie sua senha" hint={PASSWORD_RULE} error={errors.password?.message}>
        <Input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          className="h-11"
          icon={<Lock />}
          trailing={
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="grid size-8 place-items-center rounded-md text-fg-subtle hover:text-fg"
              aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={show}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
          {...register("password")}
        />
      </Field>
      <Field label="Repita a senha" error={errors.confirm?.message}>
        <Input type={show ? "text" : "password"} autoComplete="new-password" className="h-11" icon={<Lock />} {...register("confirm")} />
      </Field>
      <FormAlert message={serverError} className="py-3" />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
        {isSubmitting ? "Criando acesso…" : "Criar acesso e entrar"} {!isSubmitting && <ArrowRight />}
      </Button>
      <p className="flex items-start gap-2 text-[12px] text-fg-subtle">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />A senha é gerenciada pelo Firebase Authentication e não fica visível para ninguém da Atlética.
      </p>
    </form>
  );
}

function InvitationPage() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  return (
    <main className="atmos grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center gap-3">
          <BrandEmblem size={44} priority />
          <div>
            <p className="eyebrow !text-gold-fg">Convite</p>
            <h1 className="font-display text-[28px] leading-tight font-bold">Acesso à Central</h1>
          </div>
        </div>
        {isDemoMode ? (
          <DemoNotice tone="warn">Convites só funcionam com o Firebase configurado. Esta é a versão de demonstração.</DemoNotice>
        ) : token ? (
          <InvitationForm token={token} />
        ) : (
          <DemoNotice tone="warn">Link de convite incompleto. Abra novamente o link recebido ou peça um novo à presidência.</DemoNotice>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <InvitationPage />
    </Suspense>
  );
}
