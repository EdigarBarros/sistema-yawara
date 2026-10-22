"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Banknote, Clock3, CreditCard, Hourglass, MessageCircle, Plus, QrCode, Wallet, X } from "lucide-react";
import type { Campaign, NumberSlot, PaymentMethod, Sale } from "@/types";
import { services, ServiceError } from "@/services";
import type { SaleInput } from "@/services/contracts";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory } from "@/hooks/use-data";
import { canSellIn } from "@/lib/policies";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
import { formatNumberRanges, padNumber, parseNumberList } from "@/lib/raffle";
import { contactField } from "@/lib/validation";
import { errorMessage } from "@/lib/notify";
import { isFirebaseMode } from "@/lib/mode";
import { whatsappLink, whatsappNumber } from "@/lib/whatsapp";
import { Dialog, BigSheetContent } from "@/components/ui/dialog";
import { MemberSelect } from "@/components/shared/pickers";
import { FormAlert } from "@/components/shared/form-alert";
import { saleConfirmationText } from "../share-text";
import { BigButton, BigInput, ChoiceRow, StepDots, SuccessBurst, bigButtonClasses } from "./ui";
import { NumberPad } from "./number-pad";

/** Limite do servidor por operação (ver functions/src/modules/campaigns.ts). */
const MAX_NUMBERS_PER_SALE = 100;

type Payment = { status: "paid"; method: PaymentMethod } | { status: "pending" } | { status: "reserved" };

const STEPS = ["Quais números?", "Quem comprou?", "Já pagou?", "Confere?"] as const;

const PAID_CHOICES: { method: PaymentMethod; icon: React.ReactNode; color: string; title: string }[] = [
  { method: "pix", icon: <QrCode />, color: "#3fcf8e", title: "Pagou no Pix" },
  { method: "cash", icon: <Banknote />, color: "#7fd9b0", title: "Pagou em dinheiro" },
  { method: "card", icon: <CreditCard />, color: "#8fb0ec", title: "Pagou no cartão" },
  { method: "other", icon: <Wallet />, color: "#c5cde6", title: "Pagou de outro jeito" },
];

interface SaleWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  slots: NumberSlot[];
  initialNumbers: number[];
  /** Outra pessoa ocupou algum número: a tela recarrega a grade na hora. */
  onConflict?: () => void;
}

/** Registrar venda no celular: uma pergunta por tela, botões grandes e confirmação no fim. */
export function SaleWizard(props: SaleWizardProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <SaleWizardBody {...props} />}
    </Dialog>
  );
}

function SaleWizardBody({ onOpenChange, campaign, slots, initialNumbers, onConflict }: SaleWizardProps) {
  const access = useAccess();
  const dir = useDirectory();
  const canConfirm = access.can("campaigns.approve");
  const canBeSeller = (memberId: string) => {
    const user = dir.member(memberId);
    const role = dir.roleOf(memberId);
    return !!user && !!role && canSellIn({ user, role, department: dir.department(role.departmentId) }, campaign);
  };
  const me = access.user?.id ?? "";

  const [step, setStep] = useState(initialNumbers.length > 0 ? 1 : 0);
  const [back, setBack] = useState(false);
  const [numbers, setNumbers] = useState<Set<number>>(() => new Set(initialNumbers));
  const [typed, setTyped] = useState("");
  const [numbersError, setNumbersError] = useState<string>();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [buyerErrors, setBuyerErrors] = useState<{ name?: string; contact?: string }>({});
  const [sellerId, setSellerId] = useState(canBeSeller(me) ? me : "");
  const [changeSeller, setChangeSeller] = useState(!canBeSeller(me));
  const [payment, setPayment] = useState<Payment | null>(null);
  const [serverError, setServerError] = useState<string>();
  const [done, setDone] = useState<Sale | null>(null);

  const availability = useMemo(() => new Map(slots.map((s) => [s.number, s.status])), [slots]);
  const free = useMemo(() => slots.filter((s) => s.status === "available" || numbers.has(s.number)), [slots, numbers]);
  const list = [...numbers].sort((a, b) => a - b);
  const total = list.length * campaign.unitPrice;

  const go = (to: number) => {
    setBack(to < step);
    setStep(to);
  };

  const toggle = (n: number) => {
    if (availability.get(n) !== "available") return;
    setNumbersError(undefined);
    setNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const addTyped = () => {
    const { numbers: parsed, invalid } = parseNumberList(typed);
    if (invalid.length) return setNumbersError(`Não entendi: ${invalid.join(", ")}. Escreva assim: 12, 15 a 18.`);
    const outOfRange = parsed.filter((n) => n < 1 || n > campaign.quantity);
    if (outOfRange.length) return setNumbersError(`Esta rifa vai de 1 a ${campaign.quantity}. Fora disso: ${outOfRange.join(", ")}.`);
    const busy = parsed.filter((n) => availability.get(n) !== "available");
    if (busy.length) return setNumbersError(`Já estão ocupados: ${formatNumberRanges(busy, campaign.quantity)}.`);
    setNumbers((prev) => new Set([...prev, ...parsed]));
    setTyped("");
    setNumbersError(undefined);
  };

  const nextFromNumbers = () => {
    if (numbers.size === 0) return setNumbersError("Toque em pelo menos um número livre.");
    if (isFirebaseMode && numbers.size > MAX_NUMBERS_PER_SALE) return setNumbersError(`No máximo ${MAX_NUMBERS_PER_SALE} números por venda. Divida em vendas menores.`);
    go(1);
  };

  const nextFromBuyer = () => {
    const errors: typeof buyerErrors = {};
    if (name.trim().length < 2) errors.name = "Escreva o nome de quem comprou.";
    const c = contactField.safeParse(contact);
    if (!c.success) errors.contact = contact.trim() ? "Confira o telefone: coloque o DDD (ex.: 71 99999-1234)." : "Coloque o telefone (WhatsApp) de quem comprou.";
    if (!sellerId) errors.name = errors.name ?? "Escolha quem fez a venda.";
    setBuyerErrors(errors);
    if (Object.keys(errors).length === 0) go(2);
  };

  // Todos os dados entram como argumento: um reenvio só reaproveita o pedido anterior se nada mudou.
  // Sem aviso flutuante: a tela de "Pronto!" já confirma a venda.
  const sale = useAction((input: SaleInput) => services.campaigns.registerSale(campaign.id, input), { silentError: true });

  const submit = async () => {
    if (!payment) return go(2);
    setServerError(undefined);
    try {
      const s = await sale.run({
        numbers: list,
        buyerName: name.trim(),
        buyerContact: contact.trim(),
        sellerId,
        status: payment.status,
        paymentMethod: payment.status === "paid" ? payment.method : undefined,
      });
      setDone(s);
    } catch (e) {
      setServerError(errorMessage(e));
      if (e instanceof ServiceError && e.code === "conflict") {
        onConflict?.();
        const taken = (e.details as { numbers?: unknown } | undefined)?.numbers;
        if (Array.isArray(taken)) setNumbers((prev) => new Set([...prev].filter((n) => !taken.includes(n))));
        go(0);
        setNumbersError("Alguém vendeu um desses números agora há pouco. Escolha outro número.");
      }
    }
  };

  const restart = () => {
    setDone(null);
    setNumbers(new Set());
    setName("");
    setContact("");
    setPayment(null);
    setServerError(undefined);
    setBack(false);
    setStep(0);
  };

  if (done) {
    const hasPhone = !!whatsappNumber(done.buyer?.contact ?? contact);
    return (
      <BigSheetContent title="Pronto!" description={campaign.name}>
        <SuccessBurst
          title={done.status === "reserved" ? "Reserva registrada!" : "Venda registrada!"}
          description={
            <>
              {done.numbers.length > 1 ? "Números" : "Número"} <b className="font-mono text-fg">{formatNumberRanges(done.numbers, campaign.quantity)}</b> para <b className="text-fg">{name.trim()}</b>
            </>
          }
        />
        <div className="mt-6 flex flex-col gap-2.5">
          {hasPhone && (
            <a
              href={whatsappLink(saleConfirmationText(campaign, { ...done, buyer: { name: name.trim(), contact } }), contact)}
              target="_blank"
              rel="noreferrer"
              className={bigButtonClasses("whatsapp", "anim-rise")}
              style={{ animationDelay: "420ms" }}
            >
              <MessageCircle /> Mandar confirmação no WhatsApp
            </a>
          )}
          <BigButton tone="secondary" onClick={restart} className="anim-rise" style={{ animationDelay: "480ms" }}>
            <Plus /> Registrar outra venda
          </BigButton>
          <BigButton tone="secondary" onClick={() => onOpenChange(false)} className="anim-rise border-transparent bg-transparent" style={{ animationDelay: "540ms" }}>
            Voltar para a rifa
          </BigButton>
        </div>
      </BigSheetContent>
    );
  }

  const footer =
    step === 0 ? (
      <BigButton onClick={nextFromNumbers} disabled={numbers.size === 0}>
        {numbers.size === 0 ? "Escolha os números" : `Continuar com ${numbers.size} ${numbers.size === 1 ? "número" : "números"}`} <ArrowRight />
      </BigButton>
    ) : step === 1 ? (
      <BigButton onClick={nextFromBuyer}>
        Continuar <ArrowRight />
      </BigButton>
    ) : step === 3 ? (
      <BigButton onClick={submit} loading={sale.pending}>
        {payment?.status === "reserved" ? "Registrar reserva" : "Registrar venda"}
      </BigButton>
    ) : undefined;

  return (
    <BigSheetContent title={STEPS[step]} description={`${campaign.name} · ${formatMoney(campaign.unitPrice)} cada`} onBack={step > 0 ? () => go(step - 1) : undefined} footer={footer} modal>
      <StepDots step={step} total={STEPS.length} />
      <div key={step} className="anim-step" data-back={back || undefined}>
        {step === 0 && (
          <div className="space-y-4">
            <div className="min-h-[52px] rounded-2xl border border-line bg-sunken p-3">
              {list.length === 0 ? (
                <p className="py-1.5 text-[14px] text-fg-muted">Toque nos números livres abaixo.</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Números escolhidos">
                    {list.map((n) => (
                      <li key={n} className="anim-pop">
                        <button
                          type="button"
                          onClick={() => toggle(n)}
                          className="press inline-flex h-9 items-center gap-1 rounded-xl bg-gold pr-2 pl-3 font-mono text-[15px] font-bold text-gold-ink"
                          aria-label={`Tirar o número ${padNumber(n, campaign.quantity)}`}
                        >
                          {padNumber(n, campaign.quantity)} <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[14px] text-fg-muted">
                    Total: <b className="text-fg tnum">{formatMoney(total)}</b>
                  </p>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTyped();
                  }
                }}
                inputMode="text"
                placeholder="Ou digite: 12, 15 a 18"
                aria-label="Digitar números"
                className="h-12 min-w-0 flex-1 rounded-2xl border border-line-strong bg-sunken px-4 text-[16px] focus:border-gold/70 focus:outline-none"
              />
              <button type="button" onClick={addTyped} disabled={!typed.trim()} className="press h-12 shrink-0 rounded-2xl bg-surface-3 px-4 text-[15px] font-semibold disabled:opacity-45">
                Adicionar
              </button>
            </div>
            {numbersError && (
              <p role="alert" className="text-[14px] font-medium text-danger">
                {numbersError}
              </p>
            )}
            {free.length === 0 ? (
              <p className="rounded-2xl border border-line bg-sunken p-4 text-center text-[15px] text-fg-muted">Todos os números já foram vendidos. 🎉</p>
            ) : (
              <NumberPad slots={free} total={campaign.quantity} selected={numbers} onTap={toggle} />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <BigInput label="Nome de quem comprou" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus error={buyerErrors.name} />
            <BigInput
              label="Telefone (WhatsApp)"
              type="tel"
              inputMode="tel"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="(71) 99999-1234"
              autoComplete="off"
              error={buyerErrors.contact}
              hint="Serve para mandar a confirmação e lembrar do pagamento."
            />
            <div className="rounded-2xl border border-line bg-sunken p-3.5">
              {changeSeller ? (
                <>
                  <p className="mb-2 text-[15px] font-semibold">Quem fez a venda?</p>
                  <MemberSelect value={sellerId} onChange={setSellerId} filter={canBeSeller} />
                </>
              ) : (
                <p className="flex items-center justify-between gap-3 text-[14px] text-fg-muted">
                  <span>
                    Vendido por <b className="text-fg">você</b>
                  </span>
                  <button type="button" onClick={() => setChangeSeller(true)} className="shrink-0 font-semibold text-gold-fg">
                    Foi outra pessoa?
                  </button>
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2.5">
            {canConfirm && (
              <>
                <p className="mb-1 text-[14px] font-semibold text-fg-muted">Sim, já pagou:</p>
                {PAID_CHOICES.map(({ method, icon, color, title }, i) => (
                  <ChoiceRow
                    key={method}
                    index={i}
                    icon={icon}
                    color={color}
                    title={title}
                    selected={payment?.status === "paid" && payment.method === method}
                    onClick={() => {
                      setPayment({ status: "paid", method });
                      go(3);
                    }}
                  />
                ))}
                <p className="mt-4 mb-1 text-[14px] font-semibold text-fg-muted">Ainda não pagou:</p>
              </>
            )}
            <ChoiceRow
              index={4}
              icon={<Hourglass />}
              color="#f2a93b"
              title="Vai pagar depois"
              description="A venda fica marcada como “falta pagar”."
              selected={payment?.status === "pending"}
              onClick={() => {
                setPayment({ status: "pending" });
                go(3);
              }}
            />
            <ChoiceRow
              index={5}
              icon={<Clock3 />}
              color="#94b6d0"
              title="Só reservar o número"
              description="Guarda o número para a pessoa, sem contar como vendido."
              selected={payment?.status === "reserved"}
              onClick={() => {
                setPayment({ status: "reserved" });
                go(3);
              }}
            />
            {!canConfirm && <p className="pt-2 text-[13px] text-fg-muted">Quem confirma os pagamentos marca como pago depois.</p>}
          </div>
        )}

        {step === 3 && payment && (
          <div className="space-y-4">
            <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-sunken">
              {[
                ["Números", <span key="v" className="font-mono">{formatNumberRanges(list, campaign.quantity)}</span>, 0],
                ["Comprador", name.trim(), 1],
                ["Telefone", contact.trim(), 1],
                ["Vendido por", sellerId === me ? "Você" : dir.memberName(sellerId), 1],
                ["Pagamento", payment.status === "paid" ? `Pago (${PAYMENT_METHOD_LABELS[payment.method]})` : payment.status === "pending" ? "Falta pagar" : "Só reserva", 2],
              ].map(([label, value, to]) => (
                <div key={label as string} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <dt className="text-[14px] text-fg-muted">{label}</dt>
                  <dd className="flex min-w-0 items-center gap-3 text-right text-[15.5px] font-semibold">
                    <span className="truncate">{value}</span>
                    <button type="button" onClick={() => go(to as number)} className="shrink-0 text-[13px] font-semibold text-gold-fg">
                      Mudar
                    </button>
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-4">
                <dt className="text-[15px] font-semibold">Total</dt>
                <dd className="font-display text-[26px] font-extrabold text-gold-fg tnum">{formatMoney(total)}</dd>
              </div>
            </dl>
            <FormAlert message={serverError} icon className="py-3" />
          </div>
        )}
      </div>
    </BigSheetContent>
  );
}
