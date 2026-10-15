"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, Database, FolderTree, Info, KeyRound, Landmark, LayoutGrid, Palette, Pencil, Plus, RotateCcw, Server, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import type { EntryType, InstitutionSettings, ModuleKey } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocumentCategories, useFinanceCategories, useSettings } from "@/hooks/use-data";
import { useUI, type ThemePreference } from "@/stores/ui";
import { MODULES } from "@/lib/modules";
import { ENTRY_TYPE_LABELS } from "@/lib/labels";
import { isDemoMode, isFirebaseMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { errorMessage, notifyError, notifySuccess } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { ChoiceCards, Field, Input, Switch } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DetailList, PageHeader, Panel } from "@/components/shared/page";
import { DemoNotice, ErrorState, InlineLoader, RestrictedState } from "@/components/shared/states";
import { confirmAction } from "@/components/shared/confirm";

const SECTIONS = [
  { key: "instituicao", label: "Dados institucionais", icon: Landmark },
  { key: "identidade", label: "Identidade visual", icon: Palette },
  { key: "organizacao", label: "Cargos, departamentos e permissões", icon: ShieldCheck },
  { key: "categorias-documentos", label: "Categorias de documentos", icon: FolderTree },
  { key: "categorias-financeiras", label: "Categorias financeiras", icon: Wallet },
  { key: "modulos", label: "Módulos", icon: LayoutGrid },
  { key: "preferencias", label: "Preferências da interface", icon: SlidersHorizontal },
  { key: "demonstracao", label: "Dados da demonstração", icon: Database },
  { key: "ambiente", label: "Ambiente", icon: Server },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

/** "Dados da demonstração" só existe na demonstração; "Ambiente" só no ambiente real. */
const MODE_SECTIONS = SECTIONS.filter((s) => (isDemoMode ? s.key !== "ambiente" : s.key !== "demonstracao"));

/** Aviso que depende do modo: demonstração (ícone de laboratório) ou ambiente real. */
function ModeNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  if (isDemoMode) return <DemoNotice className={className}>{children}</DemoNotice>;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border border-info/25 bg-info/[0.07] px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-muted", className)}>
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------- Dados institucionais ------------------------------- */

const INSTITUTION_FIELDS: { key: keyof InstitutionSettings; label: string; wide?: boolean }[] = [
  { key: "legalName", label: "Razão social / nome completo", wide: true },
  { key: "shortName", label: "Nome curto" },
  { key: "systemName", label: "Nome do sistema" },
  { key: "course", label: "Curso" },
  { key: "institution", label: "Instituição de ensino" },
  { key: "city", label: "Cidade" },
  { key: "email", label: "E-mail de contato" },
  { key: "instagram", label: "Instagram" },
  { key: "motto", label: "Lema / hashtag" },
];

function InstitutionSection() {
  const access = useAccess();
  const { data, isError, error: loadError, refetch } = useSettings();
  const [form, setForm] = useState<InstitutionSettings | null>(null);
  const [error, setError] = useState<string>();
  const editable = access.can("settings.edit");
  const value = form ?? data?.institution;
  const save = useAction((data: InstitutionSettings) => services.settings.updateInstitution(data), { success: "Dados institucionais salvos", silentError: true, onSuccess: () => setForm(null) });
  if (!value && isError) return <ErrorState message={errorMessage(loadError, "Não foi possível carregar as configurações.")} onRetry={() => void refetch()} />;
  if (!value) return <InlineLoader />;
  return (
    <Panel
      title="Dados institucionais"
      description="Exibidos em relatórios, atas e certificados gerados pela Central."
      actions={
        editable && (
          <Button
            variant="primary"
            size="sm"
            disabled={!form}
            loading={save.pending}
            onClick={async () => {
              if (!form) return;
              setError(undefined);
              try {
                await save.run(form);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Salvar
          </Button>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {INSTITUTION_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} className={f.wide ? "sm:col-span-2" : undefined}>
            <Input value={value[f.key]} disabled={!editable} onChange={(e) => setForm({ ...value, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      {!editable && <ModeNotice className="mt-4">Seu perfil pode consultar, mas não editar estes dados.</ModeNotice>}
    </Panel>
  );
}

/* ---------------------------------- Identidade visual ---------------------------------- */

const SWATCHES = [
  { name: "Marinho Yawara", hex: "#030F45", use: "Fundo do escudo e do mascote" },
  { name: "Noite", hex: "#00020C", use: "Fundo do post de lançamento" },
  { name: "Azul royal", hex: "#134CB6", use: "Informações e links" },
  { name: "Azul gelo", hex: "#94B6D0", use: "Detalhes e números reservados" },
  { name: "Ouro", hex: "#E1AF37", use: "Ação principal e destaques" },
  { name: "Ouro envelhecido", hex: "#B28413", use: "Ouro sobre fundo claro" },
  { name: "Creme", hex: "#FBEBA0", use: "Detalhes do mascote" },
];

function IdentitySection() {
  return (
    <div className="space-y-4">
      <Panel title="Arquivos da marca" description="Arquivos enviados pela diretoria, usados na interface e nos PDFs.">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { src: "/brand/escudo.png", label: "Escudo oficial", note: "Recortado em círculo para a interface", round: true },
            { src: "/brand/mascote.png", label: "Mascote", note: "Ícone do sistema" },
            { src: "/brand/post-lancamento.jpg", label: "Post de lançamento", note: "Referência de estilo" },
          ].map((a) => (
            <figure key={a.src} className="rounded-xl border border-line bg-sunken p-3">
              <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-[#030f45]">
                <Image src={a.src} alt={a.label} width={220} height={220} className={cn("h-auto w-[80%]", a.round && "rounded-full")} />
              </div>
              <figcaption className="mt-2.5">
                <p className="text-[13px] font-semibold">{a.label}</p>
                <p className="text-[12px] text-fg-subtle">{a.note}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <ModeNotice className="mt-4">Para mais nitidez, envie versões em vetor (SVG) ou PNG com fundo transparente do escudo e do mascote.</ModeNotice>
      </Panel>
      <Panel title="Paleta" description="Cores extraídas dos arquivos oficiais. Centralizadas no design system (globals.css).">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SWATCHES.map((s) => (
            <li key={s.hex} className="overflow-hidden rounded-lg border border-line">
              <div className="h-14" style={{ background: s.hex }} />
              <div className="px-3 py-2">
                <p className="text-[13px] font-semibold">{s.name}</p>
                <p className="font-mono text-[11.5px] text-fg-subtle">{s.hex}</p>
                <p className="text-[11.5px] text-fg-muted">{s.use}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Tipografia">
        <div className="space-y-3">
          <p className="font-display text-[28px] font-bold">Barlow Semi Condensed — títulos</p>
          <p className="text-[15px]">Inter — textos, tabelas, formulários e botões.</p>
          <p className="font-mono text-[14px]">JetBrains Mono — números e códigos (001 · R$ 1.410)</p>
        </div>
      </Panel>
    </div>
  );
}

/* ----------------------------------- Organização ----------------------------------- */

function OrganizationSection() {
  const dir = useDirectory();
  const links = [
    { href: "/diretoria?aba=cargos", icon: <ShieldCheck />, title: "Cargos", text: `${dir.roles.length} cargos cadastrados` },
    { href: "/diretoria?aba=departamentos", icon: <Building2 />, title: "Departamentos", text: `${dir.departments.length} departamentos` },
    { href: "/diretoria?aba=permissoes", icon: <KeyRound />, title: "Permissões", text: "Matriz por módulo e atividade" },
  ];
  return (
    <Panel title="Cargos, departamentos e permissões" description="Gerenciados na área Diretoria e organização.">
      <ul className="grid gap-3 sm:grid-cols-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex h-full flex-col gap-2 rounded-xl border border-line bg-sunken p-4 hover:border-gold/40 [&_svg]:size-5">
              <span className="text-gold-fg">{l.icon}</span>
              <span className="font-semibold">{l.title}</span>
              <span className="text-[12.5px] text-fg-muted">{l.text}</span>
              <span className="mt-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-gold-fg">
                Abrir <ArrowRight className="!size-3.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------ Categorias ------------------------------------ */

function CategoryList({
  items,
  editable,
  onAdd,
  onRename,
  addLabel,
}: {
  items: { id: string; name: string; tag?: string }[];
  editable: boolean;
  onAdd: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
  addLabel: string;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  return (
    <>
      <ul className="divide-y divide-line">
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            {editing?.id === c.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await onRename(c.id, editing.name);
                    setEditing(null);
                  } catch {
                    // erro já exibido; mantém a edição aberta para corrigir
                  }
                }}
              >
                <Input autoFocus value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} aria-label="Novo nome" className="h-9" />
                <Button type="submit" size="sm" variant="primary">
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-[13.5px]">{c.name}</span>
                {c.tag && <Badge>{c.tag}</Badge>}
                {editable && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Renomear ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}>
                    <Pencil />
                  </Button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onAdd(name);
              setName("");
            } catch {
              // erro já exibido
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={addLabel} aria-label={addLabel} />
          <Button type="submit" disabled={name.trim().length < 2}>
            <Plus /> Adicionar
          </Button>
        </form>
      )}
    </>
  );
}

function DocumentCategoriesSection() {
  const access = useAccess();
  const { data, isError, error, refetch } = useDocumentCategories();
  const add = useAction((name: string) => services.settings.createDocumentCategory(name), { success: "Categoria criada" });
  const rename = useAction((id: string, name: string) => services.settings.renameDocumentCategory(id, name), { success: "Categoria renomeada" });
  return (
    <Panel title="Categorias de documentos" description="Usadas na biblioteca de Documentos.">
      {data ? (
        <CategoryList items={data} editable={access.can("settings.edit")} onAdd={add.run} onRename={rename.run} addLabel="Nova categoria de documento" />
      ) : isError ? (
        <ErrorState message={errorMessage(error, "Não foi possível carregar as categorias.")} onRetry={() => void refetch()} />
      ) : (
        <InlineLoader />
      )}
    </Panel>
  );
}

function FinanceCategoriesSection() {
  const access = useAccess();
  const { data, isError, error, refetch } = useFinanceCategories();
  const [type, setType] = useState<EntryType>("income");
  const add = useAction((name: string) => services.settings.createFinanceCategory(name, type), { success: "Categoria criada" });
  const rename = useAction((id: string, name: string) => services.settings.renameFinanceCategory(id, name), { success: "Categoria renomeada" });
  return (
    <Panel title="Categorias financeiras" description="Usadas nos lançamentos e relatórios.">
      <ChoiceCards
        name="fin-type"
        value={type}
        onChange={setType}
        options={[
          { value: "income", label: "Receitas" },
          { value: "expense", label: "Despesas" },
        ]}
      />
      <div className="mt-4">
        {data ? (
          <CategoryList
            items={data.filter((c) => c.type === type).map((c) => ({ ...c, tag: ENTRY_TYPE_LABELS[c.type] }))}
            editable={access.can("settings.edit")}
            onAdd={add.run}
            onRename={rename.run}
            addLabel={`Nova categoria de ${type === "income" ? "receita" : "despesa"}`}
          />
        ) : isError ? (
          <ErrorState message={errorMessage(error, "Não foi possível carregar as categorias.")} onRetry={() => void refetch()} />
        ) : (
          <InlineLoader />
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------- Módulos -------------------------------------- */

function ModulesSection() {
  const access = useAccess();
  const { data, isError, error, refetch } = useSettings();
  const toggle = useAction((m: ModuleKey, on: boolean) => services.settings.setModuleEnabled(m, on), { success: "Módulos atualizados" });
  const admin = access.can("settings.admin");
  if (!data && isError) return <ErrorState message={errorMessage(error, "Não foi possível carregar as configurações.")} onRetry={() => void refetch()} />;
  if (!data) return <InlineLoader />;
  return (
    <Panel
      title="Módulos"
      description={
        isDemoMode
          ? "Desativar um módulo o retira da navegação de todos os perfis nesta demonstração."
          : "Desativar um módulo o retira da navegação de todos e faz o servidor recusar novas operações nele. Os dados são mantidos."
      }
    >
      <ul className="divide-y divide-line">
        {MODULES.map((m) => (
          <li key={m.key} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="flex items-center gap-2 text-[13.5px] font-medium">
                {m.label} {m.core && <Badge>Essencial</Badge>}
              </p>
              <p className="text-[12.5px] text-fg-muted">{m.description}</p>
            </div>
            <Switch
              checked={data.modules[m.key]}
              disabled={!admin || m.core || toggle.pending}
              onCheckedChange={async (on) => {
                if (
                  !on &&
                  !(await confirmAction({
                    title: `Desativar ${m.label}?`,
                    description: isDemoMode
                      ? "O módulo some do menu, mas os dados são mantidos e voltam ao reativar."
                      : "O módulo some do menu de todos e novas operações nele são recusadas. Os dados são mantidos e voltam ao reativar.",
                    confirmLabel: "Desativar",
                    tone: "danger",
                  }))
                )
                  return;
                toggle.runSafe(m.key, on);
              }}
              label={`${m.label}: ${data.modules[m.key] ? "ativo" : "inativo"}`}
            />
          </li>
        ))}
      </ul>
      {!admin && (
        <ModeNotice className="mt-3">
          {isDemoMode ? "Somente a Presidência pode ativar ou desativar módulos." : "Somente cargos com a permissão “Configurações: administrar” podem ativar ou desativar módulos."}
        </ModeNotice>
      )}
    </Panel>
  );
}

/* ------------------------------------ Preferências ------------------------------------ */

function PreferencesSection() {
  const { theme, setTheme, sidebarCollapsed, toggleSidebar } = useUI();
  return (
    <Panel title="Preferências da interface" description={isDemoMode ? "Valem apenas para este navegador." : "Ficam salvas só neste aparelho; não acompanham a sua conta."}>
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-[13px] font-medium">Tema</p>
          <ChoiceCards<ThemePreference>
            name="theme"
            columns={3}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Escuro", description: "Padrão da Central, como o post de lançamento." },
              { value: "light", label: "Claro", description: "Melhor sob luz forte." },
              { value: "system", label: "Automático", description: "Segue o sistema do aparelho." },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
          <div>
            <p className="text-[13.5px] font-medium">Barra lateral recolhida</p>
            <p className="text-[12.5px] text-fg-muted">Mostra só os ícones no computador.</p>
          </div>
          <Switch checked={sidebarCollapsed} onCheckedChange={toggleSidebar} label="Barra lateral recolhida" />
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------- Demonstração ---------------------------------- */

function DemoSection() {
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Dados da demonstração" description="Como a Central funciona nesta etapa">
      <ul className="space-y-2.5 text-[13.5px] text-fg-muted">
        <li>• Todos os dados são fictícios e ficam salvos apenas neste navegador (armazenamento local).</li>
        <li>• Pessoas ou aparelhos diferentes não veem as alterações umas das outras.</li>
        <li>• Arquivos escolhidos ficam apenas na memória da aba e somem ao recarregar a página.</li>
        <li>• Perfis e permissões são simulados para demonstrar a experiência — não são segurança real.</li>
        <li>• Login real, banco de dados compartilhado, armazenamento de arquivos e auditoria serão feitos no backend (Etapa 2, Firebase).</li>
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">Restaurar dados de demonstração</p>
          <p className="text-[12.5px] text-fg-muted">Desfaz tudo o que foi criado ou alterado neste navegador.</p>
        </div>
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            if (!(await confirmAction({ title: "Restaurar dados de demonstração?", description: "Rifas, vendas, eventos, documentos e demais registros voltam ao estado original.", confirmLabel: "Restaurar", tone: "danger" }))) return;
            setBusy(true);
            try {
              await services.settings.resetDemoData();
              await qc.invalidateQueries();
              notifySuccess("Dados de demonstração restaurados");
              router.push("/inicio");
            } catch (e) {
              notifyError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RotateCcw /> Restaurar
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------- Ambiente ------------------------------------- */

// Configuração pública do app web (incorporada no build). Nenhum segredo é lido ou exibido aqui.
const ENV = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  region: process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "southamerica-east1",
  emulators: process.env.NEXT_PUBLIC_USE_EMULATORS === "true",
  appCheckKey: !!process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY,
  configured: !!(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  ),
};

function EnvironmentSection() {
  // Mesma regra de src/services/firebase/app.ts: o App Check não é iniciado com os emuladores.
  const appCheck = ENV.appCheckKey && !ENV.emulators;
  return (
    <Panel title="Ambiente" description="Onde esta instalação da Central guarda e processa os dados.">
      <DetailList
        items={[
          { label: "Modo de dados", value: <Badge tone="ok">Firebase</Badge> },
          { label: "Projeto", value: ENV.projectId ? <span className="font-mono text-[13px]">{ENV.projectId}</span> : <Badge tone="danger">Não configurado</Badge> },
          { label: "Configuração do app web", value: ENV.configured ? <Badge tone="ok">Completa</Badge> : <Badge tone="danger">Incompleta</Badge> },
          { label: "Região das funções", value: <span className="font-mono text-[13px]">{ENV.region}</span> },
          { label: "Emuladores", value: ENV.emulators ? <Badge tone="warn">Sim (ambiente local de testes)</Badge> : <Badge>Não</Badge> },
          {
            label: "App Check",
            value: appCheck ? (
              <Badge tone="ok">Ativo (reCAPTCHA Enterprise)</Badge>
            ) : ENV.appCheckKey ? (
              <Badge tone="warn">Desligado nos emuladores</Badge>
            ) : (
              <Badge tone="warn">Inativo</Badge>
            ),
          },
        ]}
      />
      <ul className="mt-5 space-y-2 text-[13px] text-fg-muted">
        <li>• Login pelo Firebase Authentication; contas novas entram somente por convite.</li>
        <li>• Dados no Cloud Firestore, lidos conforme as regras de acesso de cada cargo.</li>
        <li>• Operações, validações e auditoria feitas pelas Cloud Functions, no servidor.</li>
        <li>• Arquivos no Cloud Storage, com download apenas para quem tem acesso (sem links públicos).</li>
      </ul>
      <ModeNotice className="mt-4">Esta tela mostra apenas a configuração pública do aplicativo. Chaves e credenciais administrativas nunca ficam no navegador.</ModeNotice>
    </Panel>
  );
}

/* --------------------------------------- Página --------------------------------------- */

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const access = useAccess();
  const requested = params.get("secao") as SectionKey | null;
  const section: SectionKey = requested && MODE_SECTIONS.some((s) => s.key === requested) ? requested : "instituicao";
  const canSettings = access.canModule("settings");
  // Preferências e dados da demonstração ficam disponíveis para todos os perfis.
  const visible = MODE_SECTIONS.filter((s) => canSettings || s.key === "preferencias" || s.key === "demonstracao");
  const current = visible.some((s) => s.key === section) ? section : visible[0].key;

  const content: Record<SectionKey, React.ReactNode> = {
    instituicao: <InstitutionSection />,
    identidade: <IdentitySection />,
    organizacao: <OrganizationSection />,
    "categorias-documentos": <DocumentCategoriesSection />,
    "categorias-financeiras": <FinanceCategoriesSection />,
    modulos: <ModulesSection />,
    preferencias: <PreferencesSection />,
    demonstracao: isDemoMode ? <DemoSection /> : null,
    ambiente: isFirebaseMode ? <EnvironmentSection /> : null,
  };

  if (!canSettings && !["preferencias", "demonstracao"].includes(current)) return <RestrictedState />;

  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Configurações"
        description={
          isDemoMode
            ? "Configurações demonstrativas. Infraestrutura e segurança reais serão configuradas no backend."
            : "Dados institucionais, categorias, módulos e preferências da Central."
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav aria-label="Seções" className="lg:self-start">
          <select value={current} onChange={(e) => router.replace(`${pathname}?secao=${e.target.value}`)} aria-label="Seção" className="h-10 w-full rounded-lg border border-line-strong bg-sunken px-3 text-[14px] lg:hidden">
            {visible.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <ul className="hidden space-y-0.5 lg:block">
            {visible.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.key}>
                  <Link
                    href={`${pathname}?secao=${s.key}`}
                    replace
                    scroll={false}
                    aria-current={s.key === current ? "page" : undefined}
                    className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px]", s.key === current ? "bg-gold/10 font-medium text-fg" : "text-fg-muted hover:bg-surface")}
                  >
                    <Icon className={cn("size-4", s.key === current && "text-gold")} />
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">{content[current]}</div>
      </div>
    </>
  );
}
