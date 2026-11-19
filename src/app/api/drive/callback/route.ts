/**
 * Retorno do Google depois de "Conectar Google Drive" (Configurações → Ambiente).
 * Não recebe login do Firebase (é uma navegação vinda do Google): quem iniciou a
 * conexão é identificado pelo `state` de uso único gravado no servidor, e a
 * permissão é conferida de novo. O refresh token nunca passa pelo navegador.
 */
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { finishDriveConnection } = await import("../../../../../functions/src/modules/system");
  const q = request.nextUrl.searchParams;
  const result = await finishDriveConnection({ code: q.get("code"), state: q.get("state"), error: q.get("error") });
  const back = new URL("/configuracoes", request.nextUrl.origin);
  back.searchParams.set("secao", "ambiente");
  back.searchParams.set("drive", result);
  return NextResponse.redirect(back, { headers: { "Cache-Control": "no-store" } });
}
