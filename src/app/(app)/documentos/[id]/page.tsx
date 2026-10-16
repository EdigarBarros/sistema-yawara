"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, ClipboardList, Download, ExternalLink, FileText, FileUp, GraduationCap, Loader2, Pencil, Share2, Tag } from "lucide-react";
import type { FileRef } from "@/types";
import { services } from "@/services";
import { downloadName } from "@/services/firebase/files";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocument, useDocumentCategories } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canArchiveDocument, canEditDocument } from "@/lib/policies";
import { DOCUMENT_STATUS } from "@/lib/labels";
import { fileExtension, formatBytes, formatDateTime, formatDateTimeShort } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import { isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DetailList, MetaItem, PageHeader, Panel } from "@/components/shared/page";
import { RecordErrorState, PageSkeleton, DemoNotice } from "@/components/shared/states";
import { FileActions, useFileObjectUrl } from "@/components/shared/file-actions";
import { DemoTag, OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { AudienceSummary } from "@/components/shared/audience";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { EditDocumentDialog, NewVersionDialog, ShareDocumentDialog } from "@/features/documents/document-dialogs";
import { DOC_SCOPE_LABELS } from "@/features/documents/document-form-dialog";

/** Tipos que a página consegue mostrar (o restante só é aberto ou baixado). */
function isPreviewable(file: FileRef | null | undefined) {
  return !!file && (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf" || file.mimeType.startsWith("text/"));
}

type FilePreviewState = ReturnType<typeof useFileObjectUrl>;

function Preview({ file, sample, preview }: { file: FileRef | null; sample: boolean; preview: FilePreviewState }) {
  if (!file) return <Placeholder text="Este registro não tem arquivo anexado." />;
  if (!services.files.isAvailable(file)) {
    if (!isDemoMode) return <Placeholder text="O arquivo desta versão não está disponível no armazenamento." />;
    return (
      <Placeholder
        text={
          sample
            ? "Exemplo demonstrativo: não há um arquivo real anexado, apenas os dados do registro."
            : "O conteúdo deste arquivo ficou na memória de uma sessão anterior do navegador. Nesta etapa, os arquivos não são guardados em servidor."
        }
      />
    );
  }
  if (!isPreviewable(file)) return <Placeholder text={`Pré-visualização indisponível para ${fileExtension(file.name)}. Use “Baixar”.`} />;
  if (preview.error) return <Placeholder text={preview.error} />;
  const url = preview.url;
  if (!url) {
    return (
      <div role="status" className="grid place-items-center rounded-lg border border-dashed border-line-strong bg-sunken px-6 py-14 text-center">
        <Loader2 className="mb-3 size-6 animate-spin text-gold" aria-hidden />
        <p className="text-[13px] text-fg-muted">Carregando a pré-visualização…</p>
      </div>
    );
  }
  if (file.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- arquivo local (blob) carregado com autorização
    return <img src={url} alt={`Pré-visualização de ${file.name}`} className="max-h-[520px] w-full rounded-lg border border-line object-contain" />;
  }
  if (file.mimeType === "application/pdf") {
    return <iframe src={url} title={`Pré-visualização de ${file.name}`} className="h-[560px] w-full rounded-lg border border-line bg-white" />;
  }
  return <iframe src={url} title={`Pré-visualização de ${file.name}`} className="h-[400px] w-full rounded-lg border border-line bg-white" />;
}

/**
 * "Visualizar" e "Baixar" do arquivo atual. Com a pré-visualização já
 * carregada, usa a mesma URL local; senão, baixa o arquivo no clique
 * (Firebase: download autenticado, conferido pelas regras do Storage).
 */
function CurrentFileButtons({ file, url }: { file: FileRef | null; url: string | null }) {
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  if (!file) return null;
  const outline = "inline-flex h-[38px] items-center gap-2 rounded-lg border border-line-strong px-4 text-[13.5px] font-semibold hover:bg-surface-2";
  const primary = "inline-flex h-[38px] items-center gap-2 rounded-lg bg-gold px-4 text-[13.5px] font-semibold text-gold-ink hover:bg-gold-hover";
  if (url) {
    return (
      <>
        <a href={url} target="_blank" rel="noreferrer" className={outline}>
          <ExternalLink className="size-4" /> Visualizar
        </a>
        <a href={url} download={downloadName(file)} className={primary}>
          <Download className="size-4" /> Baixar
        </a>
      </>
    );
  }
  if (isDemoMode || !services.files.isAvailable(file)) return null;
  const run = (mode: "view" | "download") => {
    setBusy(mode);
    services.files
      .open(file, { download: mode === "download" })
      .catch((e) => notifyError(e))
      .finally(() => setBusy(null));
  };
  return (
    <>
      <Button onClick={() => run("view")} loading={busy === "view"} disabled={!!busy}>
        {busy !== "view" && <ExternalLink />} Visualizar
      </Button>
      <Button variant="primary" onClick={() => run("download")} loading={busy === "download"} disabled={!!busy}>
        {busy !== "download" && <Download />} Baixar
      </Button>
    </>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line-strong bg-sunken px-6 py-14 text-center">
      <FileText className="mb-3 size-8 text-fg-subtle" />
      <p className="max-w-sm text-[13px] text-fg-muted">{text}</p>
    </div>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const access = useAccess();
  const dir = useDirectory();
  const { data: doc, isLoading, isError, error, refetch } = useDocument(id);
  const { data: categories } = useDocumentCategories();
  useBreadcrumbTitle(`/documentos/${id}`, doc?.name);
  const [dialog, setDialog] = useState<"edit" | "share" | "version" | null>(null);
  const archive = useAction(() => services.documents.archive(id), { success: "Documento arquivado", successDescription: "Continua disponível para consulta em “Arquivados”." });
  const restore = useAction(() => services.documents.restore(id), { success: "Documento restaurado" });
  // Firebase: só baixa automaticamente o que a página consegue mostrar; o restante é baixado no clique.
  const currentFile = doc?.versions.at(-1)?.file ?? null;
  const preview = useFileObjectUrl(isDemoMode || isPreviewable(currentFile) ? currentFile : null);

  if (isLoading) return <PageSkeleton />;
  if (isError || !doc) return <RecordErrorState error={error} notFound="Documento não encontrado" backHref="/documentos" onRetry={() => refetch()} />;

  const current = doc.versions[doc.versions.length - 1];
  const ctx = access.ctx;
  const canEdit = !!ctx && canEditDocument(ctx, doc);
  const canArchive = !!ctx && canArchiveDocument(ctx, doc);
  const category = categories?.find((c) => c.id === doc.categoryId)?.name;

  return (
    <>
      <PageHeader
        back={{ href: "/documentos", label: "Documentos" }}
        eyebrow={category}
        title={doc.name}
        badge={
          <>
            <StatusBadge meta={DOCUMENT_STATUS[doc.status]} />
            {doc.sample && <DemoTag />}
            <OwnershipBadge record={doc} />
          </>
        }
        meta={
          <>
            <MetaItem icon={<Tag />}>Versão {doc.versions.length}</MetaItem>
            <MetaItem icon={<CalendarDays />}>Atualizado em {formatDateTime(doc.updatedAt)}</MetaItem>
            <MetaItem>{dir.department(doc.departmentId)?.name}</MetaItem>
          </>
        }
        actions={
          <>
            <CurrentFileButtons file={current.file} url={preview.url} />
            {canEdit && (
              <Button onClick={() => setDialog("share")}>
                <Share2 /> Compartilhar
              </Button>
            )}
          </>
        }
      />

      {doc.sample && (
        <DemoNotice className="mb-5">Este é um registro de exemplo criado para a demonstração. Não é um documento oficial da Atlética.</DemoNotice>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Panel title="Pré-visualização" description={current.file ? `${current.file.name} · ${formatBytes(current.file.size)}` : undefined}>
            <Preview file={current.file} sample={doc.sample} preview={preview} />
          </Panel>
          {doc.description && (
            <Panel title="Descrição">
              <p className="text-[13.5px] leading-relaxed text-fg-muted">{doc.description}</p>
            </Panel>
          )}
          <Panel
            title="Versões"
            description="Versões anteriores nunca são apagadas"
            actions={
              canEdit &&
              doc.status !== "archived" && (
                <Button size="sm" onClick={() => setDialog("version")}>
                  <FileUp /> Nova versão
                </Button>
              )
            }
            bodyClassName="py-1.5"
          >
            <ul className="divide-y divide-line">
              {[...doc.versions].reverse().map((v) => {
                return (
                  <li key={v.version} className="flex items-center gap-3 px-5 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[12px] font-semibold">v{v.version}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
                        {v.file?.name ?? "Sem arquivo"}
                        {v.version === doc.versions.length && <Badge tone="gold">Atual</Badge>}
                      </p>
                      <p className="truncate text-[12px] text-fg-subtle">
                        {dir.memberName(v.uploadedBy)} · {formatDateTimeShort(v.uploadedAt)}
                        {v.note && ` · ${v.note}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <FileActions file={v.file} label={`versão ${v.version}`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="Detalhes"
            actions={
              canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("edit")}>
                  <Pencil /> Editar
                </Button>
              )
            }
          >
            <DetailList
              items={[
                { label: "Categoria", value: category ?? "—" },
                { label: "Departamento", value: dir.department(doc.departmentId)?.name ?? "—" },
                { label: "Formato", value: current.file ? fileExtension(current.file.name) : "—" },
                { label: "Tamanho", value: current.file ? formatBytes(current.file.size) : "—" },
                { label: "Autor do envio", value: dir.memberName(doc.createdBy) },
                { label: "Data do envio", value: formatDateTime(doc.createdAt) },
                { label: "Situação", value: DOCUMENT_STATUS[doc.status].label },
              ]}
            />
            {(doc.links.eventId || doc.links.meetingId || doc.links.projectId) && (
              <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px]">
                <p className="eyebrow mb-2">Vinculado a</p>
                {doc.links.eventId && (
                  <Link href={`/eventos/${doc.links.eventId}`} className="flex items-center gap-2 text-gold-fg hover:underline">
                    <CalendarDays className="size-4" /> Evento relacionado
                  </Link>
                )}
                {doc.links.meetingId && (
                  <Link href={`/secretaria/${doc.links.meetingId}`} className="flex items-center gap-2 text-gold-fg hover:underline">
                    <ClipboardList className="size-4" /> Reunião relacionada
                  </Link>
                )}
                {doc.links.projectId && (
                  <Link href={`/extensao/${doc.links.projectId}`} className="flex items-center gap-2 text-gold-fg hover:underline">
                    <GraduationCap className="size-4" /> Projeto relacionado
                  </Link>
                )}
              </div>
            )}
          </Panel>
          <Panel
            title="Quem tem acesso"
            actions={
              canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("share")}>
                  <Share2 /> Alterar
                </Button>
              )
            }
          >
            <AudienceSummary module="documents" audience={doc.access} departmentId={doc.departmentId} labels={DOC_SCOPE_LABELS} alwaysIncluded={[doc.createdBy]} />
          </Panel>
          {canArchive && (
            <Panel title={doc.status === "archived" ? "Documento arquivado" : "Arquivar"}>
              <p className="mb-3 text-[13px] text-fg-muted">
                {doc.status === "archived" ? "Restaure para voltar a editar e enviar versões." : "Arquivar tira o documento da lista principal, sem apagar nada."}
              </p>
              {doc.status === "archived" ? (
                <Button onClick={() => restore.runSafe()} loading={restore.pending}>
                  <ArchiveRestore /> Restaurar
                </Button>
              ) : (
                <Button
                  variant="danger"
                  loading={archive.pending}
                  onClick={async () => {
                    if (await confirmAction({ title: "Arquivar documento?", description: "Ele continuará disponível em “Arquivados”, com todas as versões.", confirmLabel: "Arquivar", tone: "danger" }))
                      archive.runSafe();
                  }}
                >
                  <Archive /> Arquivar documento
                </Button>
              )}
            </Panel>
          )}
          <Panel title="Histórico">
            <HistoryTimeline entries={doc.history} />
          </Panel>
        </div>
      </div>

      <EditDocumentDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} doc={doc} />
      <ShareDocumentDialog open={dialog === "share"} onOpenChange={(o) => !o && setDialog(null)} doc={doc} />
      <NewVersionDialog open={dialog === "version"} onOpenChange={(o) => !o && setDialog(null)} doc={doc} />
    </>
  );
}
