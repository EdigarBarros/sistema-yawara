"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Clock3, Hourglass, Plus, X } from "lucide-react";
import type { Campaign, NumberSlot, PaymentMethod, Sale } from "@/types";
import { services, ServiceError } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { canChangePaymentMethod, canChangeSeller, canSeeBuyer, canSellIn } from "@/lib/policies";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
import { formatNumberRanges, padNumber, parseNumberList } from "@/lib/raffle";
import { errorMessage } from "@/lib/notify";
import { isDemoMode, isFirebaseMode } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceCards, Field, Input, Select, Textarea } from "@/components/ui/form";
import { MemberSelect, FilePicker } from "@/components/shared/pickers";
import { FormAlert } from "@/components/shared/form-alert";
import { editSaleSchema, saleSchema, type EditSaleFormValues, type SaleFormValues } from "./schemas";
import { CampaignNotice } from "./notice";

/** Limite do servidor por operação (ver functions/src/modules/campaigns.ts). */
const MAX_NUMBERS_PER_SALE = 100;

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

/* ------------------------------ Registrar venda ------------------------------ */

interface RegisterSaleDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: Campaign;
  slots: NumberSlot[];
  initialNumbers: number[];
  onRegistered: () => void;
  /** Outra pessoa ocupou algum número: a tela recarrega a grade na hora. */
  onConflict?: () => void;
}

export function RegisterSaleDialog(props: RegisterSaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <RegisterSaleBody {...props} />}
    </Dialog>
  );
}

function RegisterSaleBody({ onOpenChange, campaign, slots, initialNumbers, onRegistered, onConflict }: RegisterSaleDialogProps) {
  const access = useAccess();
  const canConfirm = access.can("campaigns.approve");
  const [numbers, setNumbers] = useState<number[]>(() => [...initialNumbers].sort((a, b) => a - b));
  const [typed, setTyped] = useState("");
  const [numbersError, setNumbersError] = useState<string>();
  const [serverError, setServerError] = useState<string>();

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: { buyerName: "", buyerContact: "", sellerId: access.user?.id ?? "", status: "pending", paymentMethod: "pix", notes: "" },
  });
  const { register, handleSubmit, control, formState } = form;
  const status = useWatch({ control, name: "status" });

  const availability = useMemo(() => new Map(slots.map((s) => [s.number, s.status])), [slots]);

  const addTyped = () => {
    const { numbers: parsed, invalid } = parseNumberList(typed);
    if (invalid.length) {
      setNumbersError(`Não entendi: ${invalid.join(", ")}. Use números separados por vírgula ou intervalos como 10-15.`);
      return;
    }
    const outOfRange = parsed.filter((n) => n < 1 || n > campaign.quantity);
    const busy = parsed.filter((n) => availability.get(n) && availability.get(n) !== "available");
    if (outOfRange.length) {
      setNumbersError(`Fora da campanha (1 a ${campaign.quantity}): ${outOfRange.join(", ")}.`);
      return;
    }
    if (busy.length) {
      setNumbersError(`Já ocupados: ${formatNumberRanges(busy, campaign.quantity)}. Escolha números disponíveis.`);
      return;
    }
    setNumbers((prev) => [...new Set([...prev, ...parsed])].sort((a, b) => a - b));
    setTyped("");
    setNumbersError(undefined);
  };

  const sale = useAction(
    (v: SaleFormValues) =>
      services.campaigns.registerSale(campaign.id, {
        numbers,
        buyerName: v.buyerName,
        buyerContact: v.buyerContact,
        sellerId: v.sellerId,
        status: v.status,
        paymentMethod: v.paymentMethod ? (v.paymentMethod as PaymentMethod) : undefined,
        notes: v.notes,
      }),
    {
      silentError: true,
      success: (s) => (s.status === "reserved" ? "Reserva registrada" : "Venda registrada"),
      successDescription: (s) => `Números ${formatNumberRanges(s.numbers, campaign.quantity)} atualizados na grade.`,
    },
  );

  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    if (numbers.length === 0) {
      setNumbersError("Selecione pelo menos um número.");
      return;
    }
    if (isFirebaseMode && numbers.length > MAX_NUMBERS_PER_SALE) {
      setNumbersError(
        `Uma venda pode ter no máximo ${MAX_NUMBERS_PER_SALE} números por operação (${numbers.length} selecionados). Divida a seleção em vendas separadas.`,
      );
      return;
    }
    try {
      await sale.run(v);
      onRegistered();
      onOpenChange(false);
    } catch (e) {
      setServerError(errorMessage(e));
      if (e instanceof ServiceError && e.code === "conflict") {
        // Atualiza a grade e tira da seleção os números que outra pessoa ocupou.
        onConflict?.();
        const taken = (e.details as { numbers?: unknown } | undefined)?.numbers;
        if (Array.isArray(taken)) setNumbers((prev) => prev.filter((n) => !taken.includes(n)));
      }
    }
  });

  const total = numbers.length * campaign.unitPrice;

  return (
    <DialogContent
        size="lg"
        modal
        title="Registrar venda"
        description={`${campaign.name} · ${formatMoney(campaign.unitPrice)} por número`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={onSubmit} loading={sale.pending} disabled={numbers.length === 0}>
              {status === "reserved" ? "Registrar reserva" : "Registrar venda"} {numbers.length > 0 && `(${numbers.length})`}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <section>
            <p className="mb-2 text-[13px] font-medium">
              Números <span className="text-gold-fg">*</span>
            </p>
            <div className="rounded-lg border border-line-strong bg-sunken p-3">
              {numbers.length === 0 ? (
                <p className="text-[13px] text-fg-subtle">Nenhum número selecionado ainda.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5" aria-label="Números que serão afetados">
                  {numbers.map((n) => (
                    <li key={n} className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 py-0.5 pr-1 pl-2 font-mono text-[13px] text-fg">
                      {padNumber(n, campaign.quantity)}
                      <button
                        type="button"
                        onClick={() => setNumbers((prev) => prev.filter((x) => x !== n))}
                        className="grid size-5 place-items-center rounded text-fg-subtle hover:text-fg"
                        aria-label={`Remover número ${padNumber(n, campaign.quantity)}`}
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <Input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTyped();
                    }
                  }}
                  placeholder="Adicionar números: 12, 15-18"
                  aria-label="Adicionar números digitando"
                  className="h-9"
                />
                <Button size="md" className="h-9" onClick={addTyped} disabled={!typed.trim()}>
                  <Plus /> Adicionar
                </Button>
              </div>
            </div>
            {numbersError && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                {numbersError}
              </p>
            )}
            {numbers.length > 1 && (
              <p className="mt-2 text-[12.5px] text-fg-muted">
                Os <b className="text-fg">{numbers.length} números</b> ficarão na mesma venda, para o mesmo comprador. Total:{" "}
                <b className="tnum font-mono text-fg">{formatMoney(total)}</b>
              </p>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do comprador" required error={formState.errors.buyerName?.message}>
              <Input autoComplete="off" {...register("buyerName")} />
            </Field>
            <Field label="Contato" required hint="Telefone com DDD ou e-mail." error={formState.errors.buyerContact?.message}>
              <Input autoComplete="off" placeholder="(00) 90000-0000" {...register("buyerContact")} />
            </Field>
            <Field label="Responsável pela venda" required error={formState.errors.sellerId?.message} className="sm:col-span-2">
              <Controller control={control} name="sellerId" render={({ field }) => <MemberSelect value={field.value} onChange={field.onChange} />} />
            </Field>
          </section>

          <section>
            <p className="mb-2 text-[13px] font-medium">Situação do pagamento</p>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <ChoiceCards
                  name="sale-status"
                  columns={3}
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "reserved", label: "Reservado", description: "Separado para o comprador; ainda não vendido.", icon: <Clock3 className="size-3.5 text-ice" /> },
                    { value: "pending", label: "Vendido — pendente", description: "Venda feita; pagamento ainda não recebido.", icon: <Hourglass className="size-3.5 text-warn" /> },
                    {
                      value: "paid",
                      label: "Pago",
                      description: canConfirm ? "Pagamento já recebido e conferido." : "Somente quem confirma recebimentos.",
                      icon: <BadgeCheck className="size-3.5 text-ok" />,
                      disabled: !canConfirm,
                    },
                  ]}
                />
              )}
            />
          </section>

          {status !== "reserved" && (
            <Field label="Forma de pagamento" required={status === "paid"} optional={status === "pending"} error={formState.errors.paymentMethod?.message}>
              <PaymentMethodSelect allowEmpty={status === "pending"} {...register("paymentMethod")} />
            </Field>
          )}

          <Field label="Observações" optional error={formState.errors.notes?.message}>
            <Textarea rows={2} {...register("notes")} />
          </Field>

          <FormAlert message={serverError} icon className="py-3" />
          <CampaignNotice
            demo="A demonstração impede vender o mesmo número duas vezes neste navegador. O bloqueio entre pessoas e celulares diferentes será feito pelo backend."
            live={`Os números são conferidos no servidor no momento do registro: se alguém ocupar um deles antes, a venda inteira é recusada (nada é registrado pela metade) e a grade é atualizada. Até ${MAX_NUMBERS_PER_SALE} números por venda.`}
          />
        </form>
      </DialogContent>
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
              <Field label="Contato" required error={formState.errors.buyerContact?.message}>
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
                  : "PDF ou imagem, até 10 MB. Visível apenas para quem pode consultar os dados deste comprador."
              }
            />
          </div>
          <p className="text-[12.5px] text-fg-muted">Confirme apenas valores que você conferiu. A confirmação fica registrada no histórico com seu nome.</p>
        </div>
      </DialogContent>
  );
}
