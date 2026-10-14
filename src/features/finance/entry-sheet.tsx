"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Ban, Download, Eye, Paperclip, Pencil, RotateCcw } from "lucide-react";
import type { FinanceEntry } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useCampaigns, useDirectory, useEvents, useFinanceCategories } from "@/hooks/use-data";
import { canEditEntry } from "@/lib/policies";
import { ENTRY_TYPE_LABELS, PAYMENT_METHOD_LABELS, entryStatusMeta } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { DetailList, SectionTitle } from "@/components/shared/page";
import { FileRow } from "@/components/shared/pickers";
import { HistoryTimeline } from "@/components/shared/history";
import { askReason, confirmAction } from "@/components/shared/confirm";
import { EntryFormDialog } from "./entry-form-dialog";

/** Painel de consulta de um lançamento, com as ações permitidas ao perfil. */
export function EntrySheet({ entry, onOpenChange }: { entry: FinanceEntry | null; onOpenChange: (o: boolean) => void }) {
  const access = useAccess();
  const dir = useDirectory();
  const { data: categories } = useFinanceCategories();
  const { data: events } = useEvents(access.canModule("events"));
  const { data: campaigns } = useCampaigns();
  const [editOpen, setEditOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const settle = useAction((id: string) => services.finance.setStatus(id, "settled"), { success: (e) => (e.type === "income" ? "Recebimento confirmado" : "Pagamento confirmado") });
  const reopen = useAction((id: string) => services.finance.setStatus(id, "pending"), { success: "Lançamento reaberto como pendente" });
  const cancel = useAction((id: string, reason: string) => services.finance.setStatus(id, "cancelled", reason), { success: "Lançamento cancelado", successDescription: "O registro continua no histórico." });
  const attach = useAction((id: string, file: File) => services.finance.attachReceipt(id, file), { success: "Comprovante anexado" });

  if (!entry) return <Sheet open={false} onOpenChange={onOpenChange} />;

  const meta = entryStatusMeta(entry.type, entry.status);
  const canEdit = !!access.ctx && canEditEntry(access.ctx, entry);
  const canApprove = access.can("finance.approve");
  const canArchive = access.can("finance.archive");
  const canAttach = access.can("finance.register") || access.can("finance.edit");
  const receiptUrl = services.files.getObjectUrl(entry.receipt?.blobId);
  const event = events?.find((e) => e.id === entry.eventId);
  const campaign = campaigns?.find((c) => c.id === entry.campaignId);

  const footer: React.ReactNode[] = [];
  if (entry.status === "pending" && canApprove)
    footer.push(
      <Button
        key="settle"
        variant="primary"
        loading={settle.pending}
        onClick={async () => {
          if (await confirmAction({ title: entry.type === "income" ? "Confirmar recebimento?" : "Confirmar pagamento?", description: `${entry.description} · ${formatMoney(entry.amount)}`, confirmLabel: "Confirmar" }))
            settle.runSafe(entry.id);
        }}
      >
        <BadgeCheck /> {entry.type === "income" ? "Confirmar recebimento" : "Confirmar pagamento"}
      </Button>,
    );
  if (canEdit)
    footer.push(
      <Button key="edit" onClick={() => setEditOpen(true)}>
        <Pencil /> Editar
      </Button>,
    );
  if ((entry.status === "settled" || entry.status === "cancelled") && canApprove)
    footer.push(
      <Button key="reopen" variant="ghost" loading={reopen.pending} onClick={() => reopen.runSafe(entry.id)}>
        <RotateCcw /> Reabrir como pendente
      </Button>,
    );
  if (entry.status !== "cancelled" && canArchive)
    footer.push(
      <Button
        key="cancel"
        variant="danger"
        loading={cancel.pending}
        onClick={async () => {
          const reason = await askReason({
            title: "Cancelar lançamento?",
            description: "O lançamento não é apagado: fica como cancelado, fora dos totais, com o motivo no histórico.",
            confirmLabel: "Cancelar lançamento",
            cancelLabel: "Manter",
            tone: "danger",
            reason: { label: "Motivo", placeholder: "Ex.: lançamento duplicado" },
          });
          if (reason) cancel.runSafe(entry.id, reason);
        }}
      >
        <Ban /> Cancelar
      </Button>,
    );

  return (
    <>
      <Sheet open={!!entry} onOpenChange={onOpenChange}>
        <SheetContent
          eyebrow={`${ENTRY_TYPE_LABELS[entry.type]} · ${entry.code}`}
          title={entry.description}
          description={<Badge tone={meta.tone} dot>{meta.label}</Badge>}
          footer={footer.length ? footer : undefined}
        >
          <div className="space-y-6">
            <div className="rounded-xl border border-line bg-sunken px-4 py-4">
              <p className="eyebrow">Valor</p>
              <p className={cn("tnum mt-2 font-mono text-[30px] leading-none font-semibold", entry.type === "income" ? "text-ok" : "text-fg", entry.status === "cancelled" && "line-through opacity-60")}>
                {entry.type === "income" ? "+" : "−"} {formatMoney(entry.amount)}
              </p>
              <p className="mt-2 text-[12px] text-fg-subtle">Valor fictício de demonstração</p>
            </div>
            <DetailList
              items={[
                { label: "Categoria", value: categories?.find((c) => c.id === entry.categoryId)?.name ?? "—" },
                { label: "Data", value: formatDate(entry.date) },
                { label: "Responsável", value: dir.memberName(entry.responsibleId) },
                { label: "Departamento", value: dir.department(entry.departmentId)?.name ?? "—" },
                { label: "Forma de pagamento", value: entry.paymentMethod ? PAYMENT_METHOD_LABELS[entry.paymentMethod] : "Não informada" },
                {
                  label: "Evento associado",
                  value: event ? (
                    <Link className="text-gold-fg hover:underline" href={`/eventos/${event.id}?aba=financeiro`}>
                      {event.name}
                    </Link>
                  ) : entry.eventId ? (
                    "Restrito ao seu perfil"
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Campanha associada",
                  value: campaign ? (
                    <Link className="text-gold-fg hover:underline" href={`/campanhas/${campaign.id}`}>
                      {campaign.name}
                    </Link>
                  ) : entry.campaignId ? (
                    "Restrita ao seu perfil"
                  ) : (
                    "—"
                  ),
                },
                { label: "Registrado por", value: `${dir.memberName(entry.createdBy)} · ${formatDateTime(entry.createdAt)}` },
              ]}
            />
            {entry.notes && (
              <div>
                <SectionTitle>Observações</SectionTitle>
                <p className="text-[13px] whitespace-pre-line text-fg-muted">{entry.notes}</p>
              </div>
            )}
            <div>
              <SectionTitle
                action={
                  canAttach &&
                  entry.status !== "cancelled" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} loading={attach.pending}>
                        <Paperclip /> {entry.receipt ? "Substituir" : "Anexar"}
                      </Button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*,application/pdf"
                        className="sr-only"
                        tabIndex={-1}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) attach.runSafe(entry.id, f);
                          e.target.value = "";
                        }}
                      />
                    </>
                  )
                }
              >
                Comprovante
              </SectionTitle>
              {entry.receipt ? (
                <FileRow
                  name={entry.receipt.name}
                  size={entry.receipt.size}
                  meta={receiptUrl ? "neste navegador" : "exemplo sem arquivo"}
                  actions={
                    receiptUrl && (
                      <>
                        <a href={receiptUrl} target="_blank" rel="noreferrer" aria-label="Visualizar comprovante" className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2">
                          <Eye className="size-4" />
                        </a>
                        <a href={receiptUrl} download={entry.receipt.name} aria-label="Baixar comprovante" className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2">
                          <Download className="size-4" />
                        </a>
                      </>
                    )
                  }
                />
              ) : (
                <p className="text-[13px] text-fg-subtle">Nenhum comprovante anexado.</p>
              )}
            </div>
            <div>
              <SectionTitle>Histórico</SectionTitle>
              <HistoryTimeline entries={entry.history} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <EntryFormDialog open={editOpen} onOpenChange={setEditOpen} entry={entry} />
    </>
  );
}
