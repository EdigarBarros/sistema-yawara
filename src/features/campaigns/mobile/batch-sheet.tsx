"use client";

import { useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, Save } from "lucide-react";
import type { Campaign, NumberSlot, PaymentMethod } from "@/types";
import { services, ServiceError } from "@/services";
import type { SaleInput } from "@/services/contracts";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { canSellIn } from "@/lib/policies";
import { formatNumberRanges, parseNumberList } from "@/lib/raffle";
import { optionalContactField } from "@/lib/validation";
import { errorMessage } from "@/lib/notify";
import { isFirebaseMode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { Dialog, BigSheetContent } from "@/components/ui/dialog";
import { MemberSelect } from "@/components/shared/pickers";
import { FormAlert } from "@/components/shared/form-alert";
import { BigButton, BigInput } from "./ui";

/** Limite do servidor por operação (ver functions/src/modules/campaigns.ts). */
const MAX_NUMBERS_PER_SALE = 100;

type Paid = "paid" | "pending";

interface Added {
  id: string;
  numbers: number[];
  name: string;
  paid: boolean;
}

interface BatchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  slots: NumberSlot[];
  onConflict?: () => void;
}

/**
 * "Passar vendas antigas": para colocar na Central as vendas que foram anotadas
 * no caderno ou no WhatsApp antes do sistema. Uma linha do caderno por vez,
 * telefone opcional, e a lista do que já foi passado fica visível.
 */
export function BatchSheet(props: BatchSheetProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <BatchBody {...props} />}
    </Dialog>
  );
}

function BatchBody({ campaign, slots, onConflict }: BatchSheetProps) {
  const access = useAccess();
  const dir = useDirectory();
  const canConfirm = access.can("campaigns.approve");
  const canBeSeller = (memberId: string) => {
    const user = dir.member(memberId);
    const role = dir.roleOf(memberId);
    return !!user && !!role && canSellIn({ user, role, department: dir.department(role.departmentId) }, campaign);
  };
  const me = access.user?.id ?? "";
  const numbersRef = useRef<HTMLInputElement>(null);

  const [typed, setTyped] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [paid, setPaid] = useState<Paid>(canConfirm ? "paid" : "pending");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [sellerId, setSellerId] = useState(canBeSeller(me) ? me : "");
  const [errors, setErrors] = useState<{ numbers?: string; name?: string; contact?: string }>({});
  const [serverError, setServerError] = useState<string>();
  const [added, setAdded] = useState<Added[]>([]);

  const availability = useMemo(() => new Map(slots.map((s) => [s.number, s.status])), [slots]);

  // Todos os dados entram como argumento: um reenvio só reaproveita o pedido anterior se nada mudou.
  const save = useAction((input: SaleInput) => services.campaigns.registerSale(campaign.id, input), { silentError: true, success: "Venda passada para o sistema" });

  const submit = async () => {
    setServerError(undefined);
    const next: typeof errors = {};
    const { numbers, invalid } = parseNumberList(typed);
    if (!typed.trim()) next.numbers = "Escreva os números desta venda.";
    else if (invalid.length) next.numbers = `Não entendi: ${invalid.join(", ")}. Escreva assim: 1, 5, 12 a 20.`;
    else {
      const out = numbers.filter((n) => n < 1 || n > campaign.quantity);
      const busy = numbers.filter((n) => availability.get(n) !== "available");
      if (out.length) next.numbers = `Esta rifa vai de 1 a ${campaign.quantity}. Fora disso: ${out.join(", ")}.`;
      else if (busy.length) next.numbers = `Já estão no sistema: ${formatNumberRanges(busy, campaign.quantity)}.`;
      else if (isFirebaseMode && numbers.length > MAX_NUMBERS_PER_SALE) next.numbers = `No máximo ${MAX_NUMBERS_PER_SALE} números de uma vez.`;
    }
    if (name.trim().length < 2) next.name = "Escreva o nome de quem comprou.";
    if (!optionalContactField.safeParse(contact).success) next.contact = "Confira o telefone (com DDD) ou deixe em branco.";
    if (!sellerId) next.name = next.name ?? "Escolha quem fez a venda.";
    setErrors(next);
    if (Object.keys(next).length) return;

    try {
      const sale = await save.run({
        numbers,
        buyerName: name.trim(),
        buyerContact: contact.trim(),
        sellerId,
        status: paid,
        paymentMethod: paid === "paid" ? method : undefined,
        notes: "Venda feita antes da Central (passada do caderno).",
      });
      setAdded((prev) => [{ id: sale.id, numbers: sale.numbers, name: name.trim(), paid: sale.status === "paid" }, ...prev]);
      setTyped("");
      setName("");
      setContact("");
      numbersRef.current?.focus();
    } catch (e) {
      setServerError(errorMessage(e));
      if (e instanceof ServiceError && e.code === "conflict") onConflict?.();
    }
  };

  const totalAdded = added.reduce((n, a) => n + a.numbers.length, 0);

  return (
    <BigSheetContent
      title="Passar vendas antigas"
      description="Para colocar no sistema o que foi vendido antes, no caderno ou no WhatsApp."
      modal
      footer={
        <BigButton onClick={submit} loading={save.pending}>
          <Save /> Salvar e passar a próxima
        </BigButton>
      }
    >
      <div className="space-y-5">
        {added.length > 0 && (
          <section aria-label="Já passadas agora" className="anim-pop rounded-2xl border border-ok/30 bg-ok/[0.07] p-3.5">
            <p className="mb-2 text-[14px] font-semibold text-ok">
              {added.length === 1 ? "1 venda passada" : `${added.length} vendas passadas`} · {totalAdded} {totalAdded === 1 ? "número" : "números"}
            </p>
            <ul className="max-h-32 space-y-1.5 overflow-y-auto">
              {added.map((a) => (
                <li key={a.id} className="anim-row flex items-center gap-2 text-[14px]">
                  <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
                  <span className="font-mono">{formatNumberRanges(a.numbers, campaign.quantity)}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-muted">
                    {a.name} · {a.paid ? "pago" : "falta pagar"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="anim-rise flex gap-3 rounded-2xl border border-gold/30 bg-gold/[0.07] p-3.5 text-[14px] leading-snug">
          <BookOpen className="mt-0.5 size-5 shrink-0 text-gold-fg" aria-hidden />
          <p>
            Copie <b>uma linha do caderno por vez</b>: os números, quem comprou e se já pagou. Depois toque em salvar e siga para a próxima.
          </p>
        </div>

        <BigInput
          ref={numbersRef}
          label="Números"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Ex.: 1, 5, 12 a 20"
          autoComplete="off"
          inputMode="text"
          error={errors.numbers}
          hint="Pode separar por vírgula e usar “a” para sequências."
        />
        <BigInput label="Nome de quem comprou" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" error={errors.name} />
        <BigInput
          label="Telefone (opcional)"
          type="tel"
          inputMode="tel"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Se tiver anotado"
          autoComplete="off"
          error={errors.contact}
          hint="Sem telefone não dá para cobrar pelo WhatsApp depois."
        />

        <div>
          <p className="mb-1.5 text-[15px] font-semibold">Já pagou?</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["paid", "Sim, já pagou"],
                ["pending", "Ainda não"],
              ] as [Paid, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                disabled={v === "paid" && !canConfirm}
                onClick={() => setPaid(v)}
                aria-pressed={paid === v}
                className={cn(
                  "press h-14 rounded-2xl border text-[16px] font-semibold disabled:opacity-40",
                  paid === v ? (v === "paid" ? "border-ok bg-ok/15 text-ok" : "border-warn bg-warn/15 text-warn") : "border-line-strong bg-surface-2/60",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {paid === "paid" && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ["pix", "Pix"],
                  ["cash", "Dinheiro"],
                  ["other", "Outro"],
                ] as [PaymentMethod, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMethod(v)}
                  aria-pressed={method === v}
                  className={cn("press h-11 rounded-xl border text-[14px] font-semibold", method === v ? "border-gold bg-gold/15 text-fg" : "border-line-strong text-fg-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!canConfirm && <p className="mt-1.5 text-[13px] text-fg-muted">Quem confirma os pagamentos marca como pago depois.</p>}
        </div>

        <div>
          <p className="mb-1.5 text-[15px] font-semibold">Quem vendeu?</p>
          <MemberSelect value={sellerId} onChange={setSellerId} filter={canBeSeller} />
        </div>

        <FormAlert message={serverError} icon className="py-3" />

      </div>
    </BigSheetContent>
  );
}
