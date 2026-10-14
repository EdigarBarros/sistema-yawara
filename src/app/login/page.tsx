"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Eye, EyeOff, Info, Lock, Mail, Moon, Sun, UserRoundCheck } from "lucide-react";
import { services } from "@/services";
import { useMounted } from "@/hooks/use-mounted";
import { useSession, useSessionReady } from "@/stores/session";
import { resolveTheme, useUI } from "@/stores/ui";
import { errorMessage, notifyInfo } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented } from "@/components/ui/form";
import { Avatar, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DemoNotice } from "@/components/shared/states";
import { BrandEmblem } from "@/components/layout/brand";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe seu e-mail.").email("Digite um e-mail válido, como nome@example.org."),
  password: z.string().min(1, "Informe sua senha.").min(6, "A senha deve ter pelo menos 6 caracteres."),
});
type LoginValues = z.infer<typeof loginSchema>;

function PasswordResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setState("idle");
      }}
    >
      <DialogContent
        size="sm"
        title="Recuperar senha"
        description="Informe o e-mail cadastrado na Central."
        footer={
          state === "done" ? (
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Entendi
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={state === "loading"}
              onClick={async () => {
                setState("loading");
                await services.auth.requestPasswordReset(email);
                setState("done");
              }}
            >
              Solicitar recuperação
            </Button>
          )
        }
      >
        {state === "done" ? (
          <DemoNotice tone="warn">
            <strong className="text-fg">Recurso indisponível nesta demonstração.</strong> Nenhum e-mail foi enviado. A recuperação de senha depende do
            Firebase Authentication, que será configurado na Etapa 2 (backend).
          </DemoNotice>
        ) : (
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@example.org" autoComplete="email" />
          </Field>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LoginForm({ onSuccess }: { onSuccess: (userId: string, label: string) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = async (values: LoginValues) => {
    setServerError(undefined);
    try {
      const profile = await services.auth.signInWithPassword(values.email, values.password);
      onSuccess(profile.member.id, profile.member.demoProfile?.label ?? profile.role.name);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" autoComplete="email" placeholder="nome@example.org" className="h-11" icon={<Mail />} {...register("email")} />
      </Field>
      <Field label="Senha" error={errors.password?.message}>
        <Input
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••"
          className="h-11"
          icon={<Lock />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="grid size-8 place-items-center rounded-md text-fg-subtle hover:text-fg"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
          {...register("password")}
        />
      </Field>
      <div className="flex justify-end">
        <button type="button" onClick={() => setResetOpen(true)} className="text-[13px] font-medium text-gold-fg hover:underline">
          Esqueci minha senha
        </button>
      </div>
      {serverError && (
        <div role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-3 text-[13px] text-danger">
          {serverError}
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
        {isSubmitting ? "Verificando…" : "Entrar"} {!isSubmitting && <ArrowRight />}
      </Button>
      <DemoNotice>
        <strong className="text-fg">O login real ainda não está ativo.</strong> Nesta demonstração, os e-mails dos perfis fictícios (por exemplo,{" "}
        <code className="font-mono text-[12px] text-fg">rebeca@example.org</code>) entram sem verificação de senha.
      </DemoNotice>
      <PasswordResetDialog open={resetOpen} onOpenChange={setResetOpen} />
    </form>
  );
}

function DemoProfiles({ onSelect }: { onSelect: (userId: string, label: string) => void }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["demo-profiles"], queryFn: () => services.auth.listDemoProfiles() });
  return (
    <div>
      <p className="mb-3 text-[13px] text-fg-muted">Escolha um perfil fictício para experimentar a Central. Cada perfil vê menus e dados diferentes.</p>
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[58px] rounded-lg" />
          ))}
        </div>
      )}
      {isError && (
        <Button onClick={() => refetch()} className="w-full">
          Tentar carregar os perfis novamente
        </Button>
      )}
      <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {data?.map((p) => (
          <li key={p.member.id}>
            <button
              type="button"
              onClick={() => onSelect(p.member.id, p.member.demoProfile?.label ?? p.role.name)}
              className="group flex w-full items-center gap-3 rounded-lg border border-line bg-sunken/60 px-3 py-2.5 text-left transition-colors hover:border-gold/50 hover:bg-gold/[0.05]"
            >
              <Avatar name={p.member.name} id={p.member.id} size={34} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13.5px] font-semibold">{p.member.demoProfile?.label}</span>
                <span className="block truncate text-[12px] text-fg-muted">
                  {p.member.name} · {p.member.demoProfile?.description}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-gold" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-2 text-[12px] text-fg-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Perfis e pessoas são fictícios e servem apenas para testar as telas. Não representam integrantes reais da Atlética.
      </p>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { ready: hydrated, userId } = useSessionReady();
  const signIn = useSession((s) => s.signIn);
  const { theme, setTheme } = useUI();
  const [tab, setTab] = useState<"login" | "demo">("login");
  const mounted = useMounted();
  const isDark = !mounted || resolveTheme(theme) === "dark";

  useEffect(() => {
    if (hydrated && userId) router.replace("/inicio");
  }, [hydrated, userId, router]);

  const enter = (method: "demo-email" | "demo-profile") => (id: string, label: string) => {
    signIn(id, method);
    notifyInfo(`Entrou no modo demonstração como ${label}`, method === "demo-email" ? "A senha não é verificada nesta etapa." : "Perfil fictício.");
    router.replace("/inicio");
  };

  return (
    <div className="atmos relative min-h-dvh overflow-hidden bg-[var(--bg)]">
      <div className="claws top-[-30px] left-[-20px] hidden sm:block" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="claws right-[30px] bottom-[-20px] hidden rotate-180 sm:block" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <div className="mx-auto grid min-h-dvh max-w-[1400px] lg:grid-cols-[1.1fr_1fr]">
        {/* Marca */}
        <section className="flex flex-col justify-between gap-10 px-6 pt-8 pb-6 sm:px-10 lg:px-16 lg:py-14">
          <div className="flex items-center gap-2.5">
            <BrandEmblem size={28} priority />
            <span className="text-[11.5px] font-semibold tracking-[0.28em] text-fg-muted">CENTRAL YAWARA</span>
          </div>
          <div className="max-w-[520px]">
            <BrandEmblem size={124} className="mb-7 hidden shadow-[0_0_0_1px_rgba(225,175,55,0.25),0_0_80px_rgba(19,76,182,0.35)] sm:block" priority />
            <p className="eyebrow !text-gold-fg">Sistema interno de gestão</p>
            <h1 className="mt-3 font-display text-[44px] leading-[1.02] font-bold tracking-[-0.01em] sm:text-[56px]">
              Central <span className="text-gold">Yawara</span>
            </h1>
            <p className="mt-2 font-display text-[18px] font-medium text-ice">Associação Atlética Acadêmica de Psicologia</p>
            <p className="mt-5 max-w-[440px] text-[15px] leading-relaxed text-fg-muted">
              Campanhas, eventos, documentos, reuniões e finanças da Atlética em um só lugar. Acesso restrito à diretoria e assessores.
            </p>
          </div>
          <div className="hidden items-center gap-3.5 text-[12px] text-fg-subtle lg:flex">
            <span className="h-px w-14 bg-gradient-to-r from-gold to-transparent" />
            <span className="text-[11px] font-semibold tracking-[0.32em] text-fg-muted">
              #SOMOS<span className="text-gold">YAWARA</span>
            </span>
            <span>·</span>
            <span>@atleticayawara</span>
          </div>
        </section>

        {/* Formulário */}
        <section className="flex items-center justify-center border-line px-5 pb-10 sm:px-10 lg:border-l lg:bg-gradient-to-b lg:from-surface/50 lg:to-sunken/30 lg:py-12">
          <div className="w-full max-w-[420px]">
            <h2 className="font-display text-[30px] font-bold tracking-[-0.005em]">Acessar a Central</h2>
            <p className="mt-1.5 mb-6 text-[14px] text-fg-muted">
              {tab === "login" ? "Entre com seu e-mail institucional e senha." : "Explore a interface com um perfil fictício."}
            </p>
            <Segmented
              ariaLabel="Forma de acesso"
              value={tab}
              onChange={setTab}
              className="mb-6 grid w-full grid-cols-2 [&>button]:justify-center"
              options={[
                { value: "login", label: "Entrar" },
                { value: "demo", label: "Modo demonstração", icon: <UserRoundCheck /> },
              ]}
            />
            <div className={cn(tab !== "login" && "hidden")}>
              <LoginForm onSuccess={enter("demo-email")} />
            </div>
            {tab === "demo" && <DemoProfiles onSelect={enter("demo-profile")} />}
            <div className="mt-8 flex items-center justify-between border-t border-line pt-5 text-[12px] text-fg-subtle">
              <span>Atlética Yawara · Psicologia</span>
              <button
                type="button"
                onClick={() => setTheme(isDark ? "light" : "dark")}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong px-3 text-[12px] font-medium text-fg-muted hover:text-fg"
              >
                {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                {isDark ? "Modo claro" : "Modo escuro"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
