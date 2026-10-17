"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, ClipboardList, Eye, EyeOff, FolderOpen, Info, KeyRound, Lock, Mail, Moon, Sun, Ticket, UserRoundCheck, Wallet } from "lucide-react";
import { services } from "@/services";
import { useMounted } from "@/hooks/use-mounted";
import { useSession, useSessionReady } from "@/stores/session";
import { resolveTheme, useUI } from "@/stores/ui";
import { useScene } from "@/stores/scene";
import { errorMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Avatar, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DemoNotice } from "@/components/shared/states";
import { BrandEmblem } from "@/components/layout/brand";
import { Checkbox } from "@/components/ui/form";
import { FormAlert } from "@/components/shared/form-alert";
import { isDemoMode, isFirebaseMode } from "@/lib/mode";
import { useFirebaseSession, type SessionEndReason } from "@/services/firebase/session";

/** Campo maior, com brilho dourado no foco. */
const FIELD = "h-12 rounded-xl bg-sunken/70 text-[15px] transition-shadow focus:shadow-[0_0_0_4px_rgba(225,175,55,0.14)]";

const FEATURES = [
  { icon: <Ticket />, label: "Rifas" },
  { icon: <CalendarDays />, label: "Agenda" },
  { icon: <ClipboardList />, label: "Atas" },
  { icon: <Wallet />, label: "Finanças" },
  { icon: <FolderOpen />, label: "Documentos" },
];

const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe seu e-mail.").email("Digite um e-mail válido, como nome@example.org."),
  password: z.string().min(1, "Informe sua senha.").min(6, "A senha deve ter pelo menos 6 caracteres."),
});
type LoginValues = z.infer<typeof loginSchema>;

function PasswordResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string>();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setState("idle");
          setError(undefined);
        }
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
                setError(undefined);
                if (isFirebaseMode && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
                  setError("Informe um e-mail válido.");
                  return;
                }
                setState("loading");
                try {
                  await services.auth.requestPasswordReset(email);
                  setState("done");
                } catch (e) {
                  setError(errorMessage(e));
                  setState("idle");
                }
              }}
            >
              Solicitar recuperação
            </Button>
          )
        }
      >
        {state === "done" ? (
          isFirebaseMode ? (
            <DemoNotice>
              <strong className="text-fg">Solicitação registrada.</strong> Se houver uma conta com esse e-mail, você receberá um link para criar uma nova senha.
              Verifique também a caixa de spam.
            </DemoNotice>
          ) : (
            <DemoNotice tone="warn">
              <strong className="text-fg">Recurso indisponível nesta demonstração.</strong> Nenhum e-mail foi enviado. A recuperação de senha funciona com o
              Firebase Authentication configurado.
            </DemoNotice>
          )
        ) : (
          <Field label="E-mail" error={error}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.org" autoComplete="email" />
          </Field>
        )}
      </DialogContent>
    </Dialog>
  );
}

const END_MESSAGES: Record<Exclude<SessionEndReason, null | "manual">, { title: string; text: string }> = {
  expired: { title: "Sua sessão terminou.", text: "Entre novamente para continuar. Isso acontece quando a sessão expira ou é encerrada por segurança." },
  disabled: { title: "Sua conta foi desativada.", text: "O acesso à Central foi encerrado. Se acha que é um engano, procure a presidência da Atlética." },
  not_enabled: { title: "Sua conta não tem acesso à Central.", text: "Ela ainda não foi habilitada ou o convite não foi concluído. Procure a presidência." },
};

function SessionEndNotice() {
  const reason = useFirebaseSession((s) => s.endedReason);
  if (!reason || reason === "manual") return null;
  const msg = END_MESSAGES[reason];
  return (
    <div role="status" className="mb-5 rounded-lg border border-warn/35 bg-warn/10 px-3.5 py-3 text-[13px]">
      <strong className="text-fg">{msg.title}</strong> <span className="text-fg-muted">{msg.text}</span>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: (userId: string, label: string) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
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
      const profile = await services.auth.signInWithPassword(values.email, values.password, { remember });
      onSuccess(profile.member.id, isFirebaseMode ? profile.member.name.split(" ")[0] : (profile.member.demoProfile?.label ?? profile.role.name));
    } catch (e) {
      setServerError(errorMessage(e));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" autoComplete="email" placeholder="nome@example.org" className={FIELD} icon={<Mail />} {...register("email")} />
      </Field>
      <Field label="Senha" error={errors.password?.message}>
        <Input
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••"
          className={FIELD}
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
      <div className={cn("flex items-center gap-3", isFirebaseMode ? "justify-between" : "justify-end")}>
        {isFirebaseMode && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg-muted">
            <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Manter conectado neste dispositivo
          </label>
        )}
        <button type="button" onClick={() => setResetOpen(true)} className="shrink-0 text-[13px] font-medium text-gold-fg hover:underline">
          Esqueci minha senha
        </button>
      </div>
      <FormAlert message={serverError} className="py-3" />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="group h-12 w-full rounded-xl bg-gradient-to-r from-[#f0c75a] to-gold text-[15px] shadow-[0_12px_32px_-10px_rgba(225,175,55,0.6)] transition-[transform,box-shadow] hover:shadow-[0_16px_40px_-10px_rgba(225,175,55,0.75)] active:scale-[0.98] [&_svg]:transition-transform group-hover:[&_svg]:translate-x-1"
        loading={isSubmitting}
      >
        {isSubmitting ? "Verificando…" : "Entrar"} {!isSubmitting && <ArrowRight />}
      </Button>
      {isDemoMode ? (
        <DemoNotice>
          <strong className="text-fg">Versão de demonstração.</strong> Os e-mails dos perfis fictícios (por exemplo,{" "}
          <code className="font-mono text-[12px] text-fg">rebeca@example.org</code>) entram sem verificação de senha.
        </DemoNotice>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fg-subtle">
          O acesso é feito por convite. Se você recebeu um link da presidência, abra-o para criar sua senha. Use “Manter conectado” apenas em
          dispositivos pessoais.
        </p>
      )}
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
        {data?.map((p, i) => (
          <li key={p.member.id} className="anim-row" style={{ animationDelay: `${i * 50}ms` }}>
            <button
              type="button"
              onClick={() => onSelect(p.member.id, p.member.demoProfile?.label ?? p.role.name)}
              className="group flex w-full items-center gap-3 rounded-xl border border-line bg-sunken/60 px-3 py-2.5 text-left transition-[background-color,border-color,transform] hover:border-gold/50 hover:bg-gold/[0.05] active:scale-[0.98]"
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
  const playScene = useScene((s) => s.play);
  const [tab, setTab] = useState<"login" | "demo">("login");
  const mounted = useMounted();
  const isDark = !mounted || resolveTheme(theme) === "dark";

  useEffect(() => {
    if (hydrated && userId) router.replace("/inicio");
  }, [hydrated, userId, router]);

  const enter = (method: "demo-email" | "demo-profile") => (id: string, label: string) => {
    // A cena de entrada substitui o aviso: cobre a troca de tela e diz quem está entrando.
    if (isFirebaseMode) {
      playScene("login", `Bem-vindo(a), ${label}`, "Preparando a sua Central…");
      // A ponte de sessão (FirebaseSessionBridge) preenche a sessão e o redirecionamento acontece em seguida.
      return;
    }
    playScene("login", "Bem-vindo(a)!", `Entrando como ${label}`);
    signIn(id, method);
    router.replace("/inicio");
  };

  return (
    <div className="atmos relative min-h-dvh overflow-hidden bg-[var(--bg)]">
      {/* Fundo vivo: duas manchas de luz que se movem devagar */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] size-[70vmax] rounded-full bg-[radial-gradient(closest-side,rgba(19,76,182,0.35),transparent)] blur-2xl" style={{ animation: "drift-a 18s ease-in-out infinite" }} />
        <div className="absolute -right-[15%] -bottom-[25%] size-[60vmax] rounded-full bg-[radial-gradient(closest-side,rgba(225,175,55,0.16),transparent)] blur-2xl" style={{ animation: "drift-b 22s ease-in-out infinite" }} />
      </div>
      <div className="claws top-[-30px] left-[-20px] hidden sm:block" aria-hidden>
        {[0, 1, 2].map((i) => (
          <i key={i} style={{ animation: `claw-in .9s cubic-bezier(.2,1,.3,1) ${0.3 + i * 0.12}s both` }} />
        ))}
      </div>
      <div className="claws right-[30px] bottom-[-20px] hidden rotate-180 sm:block" aria-hidden>
        {[0, 1, 2].map((i) => (
          <i key={i} style={{ animation: `claw-in .9s cubic-bezier(.2,1,.3,1) ${0.6 + i * 0.12}s both` }} />
        ))}
      </div>

      <div className="mx-auto grid min-h-dvh max-w-[1400px] grid-cols-[minmax(0,1fr)] items-center lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Marca */}
        <section className="flex flex-col items-center gap-6 px-6 pt-10 pb-6 text-center sm:px-10 lg:min-h-dvh lg:items-start lg:justify-between lg:px-16 lg:py-14 lg:text-left">
          <div className="anim-rise hidden items-center gap-2.5 lg:flex">
            <BrandEmblem size={28} priority />
            <span className="text-[11.5px] font-semibold tracking-[0.28em] text-fg-muted">CENTRAL YAWARA</span>
          </div>
          <div className="flex max-w-[540px] flex-col items-center lg:items-start">
            <div className="relative mb-6 lg:mb-8">
              <span aria-hidden className="absolute inset-[-30%] rounded-full bg-[radial-gradient(closest-side,rgba(225,175,55,0.28),rgba(19,76,182,0.18),transparent)]" style={{ animation: "breathe 5s ease-in-out infinite" }} />
              <div className="relative" style={{ animation: "pop .7s cubic-bezier(.2,1.3,.4,1) both, float-soft 6s ease-in-out .7s infinite" }}>
                <BrandEmblem size={136} className="size-[104px] drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)] lg:size-[136px]" priority />
              </div>
            </div>
            <p className="eyebrow anim-rise !text-gold-fg" style={{ animationDelay: "120ms" }}>
              Sistema interno de gestão
            </p>
            <h1 className="anim-rise mt-3 font-display text-[42px] leading-[1.02] font-bold tracking-[-0.01em] sm:text-[60px]" style={{ animationDelay: "200ms" }}>
              Central{" "}
              <span className="bg-gradient-to-r from-[#f6d77a] via-gold to-[#c9921f] bg-clip-text text-transparent">Yawara</span>
            </h1>
            <p className="anim-rise mt-2 font-display text-[17px] font-medium text-ice sm:text-[19px]" style={{ animationDelay: "280ms" }}>
              Associação Atlética Acadêmica de Psicologia
            </p>
            <p className="anim-rise mt-4 hidden max-w-[440px] text-[15px] leading-relaxed text-fg-muted sm:block" style={{ animationDelay: "360ms" }}>
              Campanhas, eventos, documentos, reuniões e finanças da Atlética em um só lugar. Acesso restrito à diretoria e assessores.
            </p>
            <ul className="mt-6 hidden flex-wrap gap-2 sm:flex lg:justify-start">
              {FEATURES.map((f, i) => (
                <li
                  key={f.label}
                  className="anim-pop flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface/60 px-3.5 text-[13px] font-medium text-fg-muted backdrop-blur-sm [&_svg]:size-4 [&_svg]:text-gold-fg"
                  style={{ animationDelay: `${450 + i * 70}ms` }}
                >
                  {f.icon}
                  {f.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="anim-rise hidden items-center gap-3.5 text-[12px] text-fg-subtle lg:flex" style={{ animationDelay: "800ms" }}>
            <span className="anim-grow h-px w-14 bg-gradient-to-r from-gold to-transparent" />
            <span className="text-[11px] font-semibold tracking-[0.32em] text-fg-muted">
              #SOMOS<span className="text-gold">YAWARA</span>
            </span>
            <span>·</span>
            <span>@atleticayawara</span>
          </div>
        </section>

        {/* Formulário */}
        <section className="flex justify-center px-4 pb-10 sm:px-10 lg:py-12">
          <div
            className="anim-rise relative w-full max-w-[440px] rounded-[28px] border border-line-strong bg-surface/70 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-8"
            style={{ animationDelay: "250ms" }}
          >
            <span aria-hidden className="absolute inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
            <div className="mb-6 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-gold/15 text-gold-fg">
                <KeyRound className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-display text-[28px] leading-none font-bold tracking-[-0.005em]">Acessar a Central</h2>
                <p className="mt-1.5 text-[13.5px] text-fg-muted">{tab === "login" ? "Entre com seu e-mail e senha." : "Explore a interface com um perfil fictício."}</p>
              </div>
            </div>
            {isFirebaseMode && <SessionEndNotice />}
            {isDemoMode && (
              <div role="tablist" aria-label="Forma de acesso" className="relative mb-6 grid grid-cols-2 rounded-2xl border border-line bg-sunken/70 p-1">
                <span
                  aria-hidden
                  className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl bg-surface-3 shadow-[0_0_0_1px_var(--line-strong)] transition-transform duration-300 ease-[cubic-bezier(.2,1.2,.4,1)]"
                  style={{ transform: tab === "demo" ? "translateX(100%)" : "none" }}
                />
                {(
                  [
                    { value: "login", label: "Entrar", icon: <Lock /> },
                    { value: "demo", label: "Modo demonstração", icon: <UserRoundCheck /> },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === o.value}
                    onClick={() => setTab(o.value)}
                    className={cn(
                      "relative z-10 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-medium transition-colors [&_svg]:size-4",
                      tab === o.value ? "text-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {o.icon}
                    {o.value === "demo" ? (
                      <>
                        <span className="sm:hidden">Demonstração</span>
                        <span className="hidden sm:inline">{o.label}</span>
                      </>
                    ) : (
                      o.label
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className={cn(tab !== "login" && "hidden")}>
              <LoginForm onSuccess={enter("demo-email")} />
            </div>
            {isDemoMode && tab === "demo" && (
              <div className="anim-rise">
                <DemoProfiles onSelect={enter("demo-profile")} />
              </div>
            )}
            <div className="mt-7 flex items-center justify-between border-t border-line pt-5 text-[12px] text-fg-subtle">
              <span>Atlética Yawara · Psicologia</span>
              <button
                type="button"
                onClick={() => setTheme(isDark ? "light" : "dark")}
                className="press inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-3.5 text-[12px] font-medium text-fg-muted hover:text-fg"
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
