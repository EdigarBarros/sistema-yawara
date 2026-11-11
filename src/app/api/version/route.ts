/**
 * Versão publicada da Central (identificador do build). As abas abertas
 * comparam com a versão que estão rodando para oferecer "Atualizar" quando
 * sai uma versão nova (src/components/layout/update-notice.tsx).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, { headers: { "Cache-Control": "no-store" } });
}
