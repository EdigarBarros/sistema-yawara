/**
 * DESPACHO DAS OPERAÇÕES (funções chamáveis)
 * ---------------------------------------------------------------------------
 * Cada módulo expõe UMA função chamável (ex.: `campaignsApi`) que recebe
 * `{ action, payload, requestId }`. Para cada ação:
 *
 *  1. Exige autenticação (exceto ações públicas, como aceitar convite).
 *  2. Valida o payload com Zod (mensagens em português).
 *  3. MUTAÇÕES rodam numa transação do Firestore que:
 *     a. verifica a idempotência (`idempotency/{uid}__{requestId}`): se a
 *        mesma requisição já foi concluída, nada é refeito e a resposta é
 *        montada a partir do resultado guardado. A repetição precisa trazer a
 *        mesma ação e os mesmos dados (resumo SHA-256 da entrada validada);
 *        dados diferentes com o mesmo identificador são recusados;
 *     b. carrega o autor (conta e cargo ativos) DENTRO da transação;
 *     c. executa a regra de negócio do módulo (`run`);
 *     d. grava as escritas pendentes (contadores, idempotência).
 *     Efeitos que não podem participar da transação (notificações, Auth)
 *     são executados depois que ela é confirmada (`ctx.after`).
 *  4. Erros de permissão em mutações geram auditoria "denied" — exceto quando
 *     a operação já foi confirmada e só a resposta foi negada (`present`).
 *  5. Erros inesperados viram mensagem genérica; o log não inclui o payload.
 *  6. Se a preparação ou a transação falharem, as compensações registradas
 *     (`onAbort`, ex.: apagar arquivo já movido) são executadas.
 *
 * REGRA DAS TRANSAÇÕES: todas as leituras (tx.get) precisam acontecer antes da
 * primeira escrita. Funções auxiliares que leem (loadActor, nextCode,
 * requireModuleEnabled...) devem ser chamadas no início de `run`.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import type { ModuleKey } from "@/types";
import { db, nowISO, timestampInDays } from "./admin";
import { buildActor, loadActor, type Actor } from "./actor";
import { auditDirect } from "./audit";
import { AppError, fail, normalizeError, toHttpsError } from "./errors";
import { ENFORCE_APP_CHECK } from "./params";
import { REGION } from "./admin";

export interface RunContext {
  requestId: string;
  /** Horário do servidor da operação (ISO). Use para createdAt/updatedAt/histórico. */
  now: string;
  /** Agenda um efeito para depois da confirmação da transação (notificações, Auth). */
  after(effect: () => Promise<void>): void;
  /** Agenda uma escrita para o fim da transação (usado por auxiliares que leem e depois gravam). */
  defer(write: (tx: Transaction) => void): void;
  /** Agenda uma limpeza caso a transação falhe (ex.: apagar arquivo já movido). */
  onAbort(cleanup: () => Promise<void>): void;
}

export interface PrepareContext {
  requestId: string;
  now: string;
  onAbort(cleanup: () => Promise<void>): void;
  /** Executado só depois da confirmação da transação (ex.: apagar a cópia temporária do envio). */
  afterCommit(fn: () => Promise<void>): void;
}

interface BaseAction<I> {
  module: ModuleKey | "auth" | "system";
  schema: z.ZodType<I>;
  /** Ação disponível sem login (ex.: aceitar convite). Use com extremo cuidado. */
  public?: boolean;
}

export interface MutationAction<I, R, P = undefined> extends BaseAction<I> {
  kind: "mutation";
  /**
   * Etapa opcional ANTES da transação (ex.: conferir e mover arquivos enviados).
   * Recebe o autor carregado fora da transação — a permissão é verificada de
   * novo dentro de `run`.
   */
  prepare?(actor: Actor, input: I, ctx: PrepareContext): Promise<P>;
  /** Regra de negócio. Retorna uma referência pequena, SEM dados pessoais (fica guardada para idempotência). */
  run(tx: Transaction, actor: Actor | null, input: I, ctx: RunContext, prepared: P): Promise<R>;
  /** Monta a resposta para o cliente a partir da referência (aplicando o que o autor pode ver). */
  present?(result: R, actor: Actor | null): Promise<unknown>;
}

export interface QueryAction<I, O> extends BaseAction<I> {
  kind: "query";
  run(actor: Actor | null, input: I, ctx: { requestId: string; now: string }): Promise<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = MutationAction<any, any, any> | QueryAction<any, any>;

export function mutation<I, R, P = undefined>(def: Omit<MutationAction<I, R, P>, "kind">): MutationAction<I, R, P> {
  return { ...def, kind: "mutation" };
}

export function query<I, O>(def: Omit<QueryAction<I, O>, "kind">): QueryAction<I, O> {
  return { ...def, kind: "query" };
}

const envelopeSchema = z.object({
  action: z.string().min(1).max(80),
  payload: z.unknown().optional(),
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,80}$/)
    .optional(),
});

/** Carrega o autor fora de uma transação (consultas e etapa de preparação). */
export async function loadActorOutsideTx(uid: string | undefined): Promise<Actor> {
  return db.runTransaction((tx) => loadActor(tx, uid), { readOnly: true });
}

const IDEMPOTENCY_TTL_DAYS = 2;

/** Forma canônica da entrada: chaves ordenadas, sem `undefined`. */
function canonical(value: unknown, key?: string): unknown {
  // O navegador reenvia o arquivo (novo tíquete) ao repetir a requisição: conta só se há arquivo.
  if (key === "uploadId") return value == null ? null : "arquivo";
  if (key === "uploadIds") return Array.isArray(value) ? value.map(() => "arquivo") : (value ?? null);
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort()
        .map((k) => [k, canonical(record[k], k)]),
    );
  }
  return value ?? null;
}

/** Resumo SHA-256 da entrada validada (JSON estável), guardado com o resultado da requisição. */
export function payloadFingerprint(input: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}

/**
 * A requisição já foi concluída? (mesma chave de idempotência usada abaixo,
 * `idempotency/{uid}__{requestId}`). Use na etapa `prepare`: num reenvio, o
 * despachante devolve o resultado guardado sem executar `run`, então a
 * preparação não deve mover arquivos nem recusar por um estado posterior.
 */
export async function alreadyCompleted(uid: string, requestId: string) {
  return (await db.doc(`idempotency/${uid}__${requestId}`).get()).exists;
}

/** Executa as compensações registradas; falhas vão só para o log (a limpeza diária cobre o resto). */
async function runAborts(aborts: (() => Promise<void>)[], action: string, requestId: string) {
  const results = await Promise.allSettled(aborts.map((fn) => fn()));
  for (const r of results) {
    if (r.status === "rejected") logger.warn("Compensação falhou", { action, requestId, error: (r.reason as Error)?.message });
  }
}

/** Erros lançados DEPOIS da confirmação (ao montar a resposta): a operação foi concluída. */
const COMMITTED_ERRORS = new WeakSet<object>();

function markCommitted(error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  COMMITTED_ERRORS.add(err);
  return err;
}

export function isCommittedError(error: unknown) {
  return typeof error === "object" && error !== null && COMMITTED_ERRORS.has(error);
}

async function runMutation(def: MutationAction<unknown, unknown, unknown>, uid: string | undefined, input: unknown, requestId: string) {
  const now = nowISO();
  const aborts: (() => Promise<void>)[] = [];
  const commits: (() => Promise<void>)[] = [];
  const prepareCtx: PrepareContext = { requestId, now, onAbort: (fn) => aborts.push(fn), afterCommit: (fn) => commits.push(fn) };

  let prepared: unknown;
  if (def.prepare) {
    if (!uid) fail("unauthenticated", "Sua sessão expirou. Entre novamente.");
    try {
      prepared = await def.prepare(await loadActorOutsideTx(uid), input, prepareCtx);
    } catch (error) {
      // Falha no meio da preparação (ex.: 2º arquivo recusado): desfaz o que já foi movido.
      await runAborts(aborts, actionKey(def), requestId);
      throw error;
    }
  }

  const payloadHash = payloadFingerprint(input);

  const idemRef: DocumentReference | null = uid ? db.doc(`idempotency/${uid}__${requestId}`) : null;
  let effects: (() => Promise<void>)[] = [];
  let replayed = false;
  let actor: Actor | null = null;

  let result: unknown;
  try {
    result = await db.runTransaction(async (tx) => {
      // Reinicia o estado a cada tentativa da transação.
      effects = [];
      replayed = false;
      const deferred: ((tx: Transaction) => void)[] = [];
      const txAborts: (() => Promise<void>)[] = [];

      if (idemRef) {
        const previous = await tx.get(idemRef);
        if (previous.exists) {
          const data = previous.data()!;
          if (data.action !== actionKey(def)) fail("conflict", "Identificador de requisição repetido para outra operação.");
          // Registros anteriores a esta conferência não têm o resumo (expiram em 2 dias).
          if (typeof data.payloadHash === "string" && data.payloadHash !== payloadHash) {
            fail("conflict", "Esta requisição já foi usada com outros dados.");
          }
          replayed = true;
          return data.result;
        }
      }

      actor = def.public && !uid ? null : await loadActor(tx, uid);
      const ctx: RunContext = {
        requestId,
        now,
        after: (fn) => effects.push(fn),
        defer: (fn) => deferred.push(fn),
        onAbort: (fn) => txAborts.push(fn),
      };
      const out = await def.run(tx, actor, input, ctx, prepared);
      for (const write of deferred) write(tx);
      if (idemRef) {
        tx.create(idemRef, { action: actionKey(def), payloadHash, result: out ?? null, createdAt: now, expireAt: timestampInDays(IDEMPOTENCY_TTL_DAYS) });
      }
      aborts.push(...txAborts);
      return out;
    });
  } catch (error) {
    await runAborts(aborts, actionKey(def), requestId);
    throw error;
  }

  for (const fn of commits) {
    try {
      await fn();
    } catch (error) {
      // Limpeza depois da confirmação (a rotina diária cobre o que sobrar).
      logger.warn("Limpeza pós-confirmação falhou", { action: actionKey(def), requestId, error: (error as Error).message });
    }
  }

  if (!replayed) {
    for (const effect of effects) {
      try {
        await effect();
      } catch (error) {
        // A operação principal já foi confirmada; o efeito secundário falhou.
        logger.error("Efeito pós-transação falhou", { action: actionKey(def), requestId, error: (error as Error).message });
      }
    }
  }

  if (!def.present) return result;
  // Na repetição, o autor é carregado de novo: conta ou cargo desativados são
  // uma recusa desta requisição (fora do try), não um erro "pós-confirmação".
  if (!actor && uid) actor = await loadActorOutsideTx(uid);
  try {
    return await def.present(result, actor);
  } catch (error) {
    // A operação já foi confirmada (agora ou na requisição original): o erro é
    // só da resposta (ex.: o autor deixou de ver o registro) e não é uma recusa.
    throw markCommitted(error);
  }
}

const ACTION_KEYS = new WeakMap<AnyAction, string>();
function actionKey(def: AnyAction) {
  return ACTION_KEYS.get(def) ?? "desconhecida";
}

export interface ApiRequestMeta {
  uid: string | undefined;
  requestId: string;
}

/** Executa uma ação já validada. Exportado para os testes chamarem sem HTTP. */
export async function executeAction(def: AnyAction, uid: string | undefined, rawPayload: unknown, requestId: string = randomUUID()) {
  if (!def.public && !uid) fail("unauthenticated", "Sua sessão expirou. Entre novamente.");
  const input = def.schema.parse(rawPayload ?? {});
  if (def.kind === "query") {
    const actor = def.public && !uid ? null : await loadActorOutsideTx(uid);
    return def.run(actor, input, { requestId, now: nowISO() });
  }
  return runMutation(def as MutationAction<unknown, unknown, unknown>, uid, input, requestId);
}

/**
 * Cria a função chamável de um módulo.
 * `name` identifica a API nos logs e na auditoria (ex.: "campaigns").
 */
export function createApi(name: string, actions: Record<string, AnyAction>) {
  for (const [key, def] of Object.entries(actions)) ACTION_KEYS.set(def, `${name}.${key}`);

  return onCall(
    {
      region: REGION,
      enforceAppCheck: ENFORCE_APP_CHECK,
      memory: "256MiB",
      timeoutSeconds: 120,
      maxInstances: 10,
      concurrency: 40,
    },
    async (request: CallableRequest<unknown>) => {
      const envelope = envelopeSchema.safeParse(request.data);
      if (!envelope.success) throw toHttpsError(new AppError("invalid", "Requisição inválida."));
      const { action, payload } = envelope.data;
      const requestId = envelope.data.requestId ?? randomUUID();
      const def = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : undefined;
      if (!def) throw toHttpsError(new AppError("invalid", "Operação desconhecida."));
      const uid = request.auth?.uid;

      try {
        return await executeAction(def, uid, payload, requestId);
      } catch (raw) {
        const committed = isCommittedError(raw);
        const error = normalizeError(raw);
        if (error.code === "internal") {
          logger.error("Erro inesperado", { api: name, action, uid, requestId, error: (raw as Error)?.message, stack: (raw as Error)?.stack });
        } else {
          logger.info(committed ? "Operação concluída; resposta recusada" : "Operação recusada", { api: name, action, uid, requestId, code: error.code });
        }
        // Já confirmada (e auditada como sucesso): não é uma tentativa recusada.
        if (error.code === "forbidden" && def.kind === "mutation" && uid && !committed) {
          await auditDirect(
            { uid, name: "" },
            {
              action: `${name}.${action}`,
              module: def.module === "system" ? "settings" : def.module,
              // Recurso genérico: a tentativa foi recusada antes de identificar o registro.
              resourceType: "operation",
              resourceId: null,
              summary: `Operação recusada por falta de permissão: ${error.message}`,
              outcome: "denied",
            },
            requestId,
          );
        }
        throw toHttpsError(committed ? new AppError(error.code, error.message, { ...(error.details ?? {}), committed: true }) : error);
      }
    },
  );
}

/** Para testes: registra os nomes das ações sem criar a função chamável. */
export function registerActionsForTests(name: string, actions: Record<string, AnyAction>) {
  for (const [key, def] of Object.entries(actions)) ACTION_KEYS.set(def, `${name}.${key}`);
  return actions;
}

export { buildActor };
