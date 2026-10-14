"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Archive, ArchiveRestore, CalendarDays, ClipboardList, Download, ExternalLink, FileText, FileUp, GraduationCap, Pencil, Share2, Tag } from "lucide-react";
import type { DocumentVersion } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocument, useDocumentCategories } from "@/hooks/use-data";
import { useBreadcrumbTitle } from "@/stores/breadcrumb";
import { canArchiveDocument, canEditDocument } from "@/lib/policies";
import { DOCUMENT_STATUS } from "@/lib/labels";
import { fileExtension, formatBytes, formatDateTime, formatDateTimeShort } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DetailList, MetaItem, PageHeader, Panel } from "@/components/shared/page";
import { ErrorState, PageSkeleton, DemoNotice } from "@/components/shared/states";
import { DemoTag, OwnershipBadge, StatusBadge } from "@/components/shared/badges";
import { AudienceSummary } from "@/components/shared/audience";
import { HistoryTimeline } from "@/components/shared/history";
import { confirmAction } from "@/components/shared/confirm";
import { EditDocumentDialog, NewVersionDialog, ShareDocumentDialog } from "@/features/documents/document-dialogs";
import { DOC_SCOPE_LABELS } from "@/features/documents/document-form-dialog";

function Preview({ version, sample }: { version: DocumentVersion; sample: boolean }) {
  const file = version.file;
  const url = services.files.getObjectUrl(file?.blobId);
  if (!file) return <Placeholder text="Este registro não tem arquivo anexado." />;
  if (!url)
    return (
      <Placeholder
        text={
          sample
            ? "Exemplo demonstrativo: não há um arquivo real anexado, apenas os dados do registro."
            : "O conteúdo deste arquivo ficou na memória de uma sessão anterior do navegador. Nesta etapa, os arquivos não são guardados em servidor."
        }
      />
    );
  if (file.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- arquivo local (blob) escolhido pela pessoa
    return <img src={url} alt={`Pré-visualização de ${file.name}`} className="max-h-[520px] w-full rounded-lg border border-line object-contain" />;
  }
  if (file.mimeType === "application/pdf") {
    return <iframe src={url} title={`Pré-visualização de ${file.name}`} className="h-[560px] w-full rounded-lg border border-line bg-white" />;
  }
  if (file.mimeType.startsWith("text/")) {
    return <iframe src={url} title={`Pré-visualização de ${file.name}`} className="h-[400px] w-full rounded-lg border border-line bg-white" />;
  }
  return <Placeholder text={`Pré-visualização indisponível para ${fileExtension(file.name)}. Use “Baixar”.`} />;
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

  if (isLoading) return <PageSkeleton />;
  if (isError || !doc) return <ErrorState message={errorMessage(error, "Documento não encontrado.")} onRetry={() => refetch()} />;

  const current = doc.versions[doc.versions.length - 1];
  const url = services.files.getObjectUrl(current.file?.blobId);
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
            {url && (
              <>
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-line-strong px-4 text-[13.5px] font-semibold hover:bg-surface-2">
                  <ExternalLink className="size-4" /> Visualizar
                </a>
                <a href={url} download={current.file?.name} className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-gold px-4 text-[13.5px] font-semibold text-gold-ink hover:bg-gold-hover">
                  <Download className="size-4" /> Baixar
                </a>
              </>
            )}
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
            <Preview version={current} sample={doc.sample} />
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
                const vurl = services.files.getObjectUrl(v.file?.blobId);
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
                    {vurl && (
                      <a href={vurl} download={v.file?.name} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={`Baixar versão ${v.version}`}>
                        <Download className="size-4" />
                      </a>
                    )}
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
            <AudienceSummary audience={doc.access} departmentId={doc.departmentId} labels={DOC_SCOPE_LABELS} alwaysIncluded={[doc.createdBy]} />
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
