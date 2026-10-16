/**
 * ROTA DE API DO SERVIDOR (implantação gratuita, sem Cloud Functions)
 * ---------------------------------------------------------------------------
 * Executa no servidor da hospedagem (ex.: Vercel) exatamente as mesmas
 * operações das Cloud Functions (functions/src): validação, permissões,
 * transações, auditoria e idempotência. O navegador envia
 * `{ action, payload, requestId }` com o token de login no cabeçalho
 * `Authorization: Bearer <token>`; o usuário é identificado SOMENTE pelo token
 * verificado aqui, nunca pelo corpo da requisição.
 *
 * As credenciais do Admin SDK ficam em variáveis de ambiente do servidor
 * (ver functions/src/core/admin.ts) e nunca chegam ao navegador.
 */
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable" | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 400,
  unavailable: 503,
  internal: 500,
};

function errorResponse(code: ErrorCode, message: string, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, details: details ?? {} } }, { status: STATUS[code], headers: { "Cache-Control": "no-store" } });
}

/** Token de login do Firebase (Bearer). Ausente = chamada anônima (só operações públicas, como aceitar convite). */
async function verifiedUid(request: NextRequest): Promise<{ uid?: string; invalid?: boolean }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return {};
  const { adminAuth } = await import("../../../../functions/src/core/admin");
  try {
    // checkRevoked: conta desativada ou sessões revogadas pelo servidor deixam de valer na hora.
    const decoded = await adminAuth.verifyIdToken(match[1], true);
    return { uid: decoded.uid };
  } catch {
    return { invalid: true };
  }
}

/** App Check (opcional): exigido quando ENFORCE_APP_CHECK=true no servidor. */
async function appCheckOk(request: NextRequest) {
  if (process.env.ENFORCE_APP_CHECK !== "true") return true;
  const token = request.headers.get("x-firebase-appcheck");
  if (!token) return false;
  const { getAppCheck } = await import("firebase-admin/app-check");
  await import("../../../../functions/src/core/admin");
  try {
    await getAppCheck().verifyToken(token);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ api: string }> }) {
  const { api } = await context.params;
  const [{ API_ACTIONS, isApiName }, { handleApiCall }, { normalizeError }] = await Promise.all([
    import("../../../../functions/src/apis"),
    import("../../../../functions/src/core/dispatch"),
    import("../../../../functions/src/core/errors"),
  ]);
  if (!isApiName(api)) return errorResponse("not_found", "Operação desconhecida.");
  if (!(await appCheckOk(request))) return errorResponse("unauthenticated", "Não foi possível confirmar a origem da requisição. Atualize a página e tente novamente.");

  const auth = await verifiedUid(request);
  if (auth.invalid) return errorResponse("unauthenticated", "Sua sessão expirou. Entre novamente.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid", "Requisição inválida.");
  }

  try {
    const result = await handleApiCall(api, API_ACTIONS[api], body, auth.uid);
    return NextResponse.json({ data: result ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (raw) {
    const error = normalizeError(raw);
    return errorResponse(error.code, error.message, error.details);
  }
}
