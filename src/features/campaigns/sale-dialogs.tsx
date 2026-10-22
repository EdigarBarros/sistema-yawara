"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck } from "lucide-react";
import type { Campaign, PaymentMethod, Sale } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { canChangePaymentMethod, canChangeSeller, canSeeBuyer, canSellIn } from "@/lib/policies";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
import { formatNumberRanges } from "@/lib/raffle";
import { FILE_LIMIT_MB, isDemoMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberSelect, FilePicker } from "@/components/shared/pickers";
import { editSaleSchema, type EditSaleFormValues } from "./schemas";
import { CampaignNotice } from "./notice";

const METHODS = Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][];

function PaymentMethodSelect(props: React.SelectHTMLAttributes<HTMLSelectElement> & { allowEmpty?: boolean }) {
  const { allowEmpty, ...rest } = props;
  return (
    <Select {...rest}>
      {allowEmpty && <option value="">Ainda não definida</option>}
      {METHODS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}

/* ------------------------------- Editar venda ------------------------------- */

interface SaleDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: Campaign;
  sale: Sale;
}

export function EditSaleDialog(props: SaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <EditSaleBody {...props} />}
    </Dialog>
  );
}

function EditSaleBody({ onOpenChange, campaign, sale }: SaleDialogProps) {
  const access = useAccess();
  const dir = useDirectory();
  const buyerVisible = !!access.ctx && canSeeBuyer(access.ctx, campaign, sale) && !!sale.buyer;
  // Firebase: observações ficam junto dos dados pessoais; sem acesso a eles, o campo não aparece nem é enviado.
  const notesEditable = isDemoMode || buyerVisible;
  // Trocar o responsável dá a ele acesso aos dados do comprador: só quem já os vê pode transferir a venda.
  const sellerEditable = !!access.ctx && canChangeSeller(access.ctx, campaign, sale);
  const methodEditable = !!access.ctx && canChangePaymentMethod(access.ctx, sale);
  /** Mesma regra do servidor: novo responsável precisa poder registrar vendas nesta campanha. */
  const canBeSeller = (memberId: string) => {
    if (memberId === sale.sellerId) return true;
    const user = dir.member(memberId);
    const role = dir.roleOf(memberId);
    return !!user && !!role && canSellIn({ user, role, department: dir.department(role.departmentId) }, campaign);
  };
  const form = useForm<EditSaleFormValues>({
    resolver: zodResolver(editSaleSchema),
    defaultValues: {
      buyerName: sale.buyer?.name,
      buyerContact: sale.buyer?.contact,
      sellerId: sale.sellerId,
      paymentMethod: sale.paymentMethod ?? "",
      notes: sale.notes ?? "",
    },
  });
  const { register, handleSubmit, control, formState } = form;

  const save = useAction(
    (v: EditSaleFormValues) =>
      services.campaigns.updateSale(sale.id, {
        buyerName: buyerVisible ? v.buyerName : undefined,
        buyerContact: buyerVisible ? v.buyerContact : undefined,
        sellerId: sellerEditable ? v.sellerId : undefined,
        paymentMethod: methodEditable && v.paymentMethod ? (v.paymentMethod as PaymentMethod) : undefined,
        notes: notesEditable ? v.notes : undefined,
      }),
    { success: "Dados da venda atualizados" },
  );

  return (
    <DialogContent
        title="Editar dados da venda"
        description={`Números ${formatNumberRanges(sale.numbers, campaign.quantity)} · as alterações ficam no histórico`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={save.pending}
              onClick={handleSubmit(async (v) => {
                const r = await save.runSafe(v);
                if (r) onOpenChange(false);
              })}
            >
              Salvar alterações
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {buyerVisible ? (
            <>
              <Field label="Nome do comprador" required error={formState.errors.buyerName?.message}>
                <Input {...register("buyerName")} />
              </Field>
              <Field label="Contato" optional error={formState.errors.buyerContact?.message}>
                <Input {...register("buyerContact")} />
              </Field>
            </>
          ) : (
            <CampaignNotice
              className="sm:col-span-2"
              demo="Os dados pessoais deste comprador são restritos para o seu perfil e não podem ser editados."
              live="Os dados pessoais e as observações deste comprador são restritos para o seu perfil e não podem ser editados."
            />
          )}
          {sellerEditable ? (
            <Field label="Responsável pela venda" required className="sm:col-span-2" error={formState.errors.sellerId?.message}>
              <Controller control={control} name="sellerId" render={({ field }) => <MemberSelect value={field.value} onChange={field.onChange} filter={canBeSeller} />} />
            </Field>
          ) : (
            <Field
              label="Responsável pela venda"
              className="sm:col-span-2"
              hint="Só quem consulta os dados deste comprador pode transferir a venda para outro responsável."
            >
              <Input value={dir.memberName(sale.sellerId)} readOnly disabled />
            </Field>
          )}
          {sale.status !== "reserved" && (
            <Field
              label="Forma de pagamento"
              className="sm:col-span-2"
              hint={methodEditable ? undefined : "Pagamento já confirmado: somente quem confirma recebimentos altera a forma de pagamento."}
            >
              <PaymentMethodSelect allowEmpty disabled={!methodEditable} {...register("paymentMethod")} />
            </Field>
          )}
          {notesEditable && (
            <Field label="Observações" optional className="sm:col-span-2">
              <Textarea rows={2} {...register("notes")} />
            </Field>
          )}
        </div>
      </DialogContent>
  );
}

/* ---------------------------- Confirmar pagamento ---------------------------- */

export function ConfirmPaymentDialog(props: SaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ConfirmPaymentBody {...props} />}
    </Dialog>
  );
}

function ConfirmPaymentBody({ onOpenChange, campaign, sale }: SaleDialogProps) {
  const [method, setMethod] = useState<PaymentMethod>(sale.paymentMethod ?? "pix");
  const [file, setFile] = useState<File | null>(null);

  const confirm = useAction(() => services.campaigns.confirmPayment(sale.id, { paymentMethod: method, receipt: file ?? undefined }), {
    success: "Pagamento confirmado",
    successDescription: `Números ${formatNumberRanges(sale.numbers, campaign.quantity)} agora aparecem como pagos.`,
  });

  return (
    <DialogContent
        title="Confirmar recebimento"
        description={`${sale.numbers.length} número(s) · ${formatMoney(sale.numbers.length * campaign.unitPrice)}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={confirm.pending}
              onClick={async () => {
                const r = await confirm.runSafe();
                if (r) onOpenChange(false);
              }}
            >
              <BadgeCheck /> Confirmar pagamento
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Forma de pagamento" required>
            <PaymentMethodSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">
              Comprovante <span className="text-xs font-normal text-fg-subtle">(opcional)</span>
            </p>
            <FilePicker
              file={file}
              onChange={setFile}
              accept="image/*,application/pdf"
              hint={
                isDemoMode
                  ? "PDF ou imagem. Fica apenas neste navegador nesta etapa."
                  : `PDF ou imagem, até ${FILE_LIMIT_MB.saleReceipt} MB. Visível apenas para quem pode consultar os dados deste comprador.`
              }
            />
          </div>
          <p className="text-[12.5px] text-fg-muted">Confirme apenas valores que você conferiu. A confirmação fica registrada no histórico com seu nome.</p>
        </div>
      </DialogContent>
  );
}
