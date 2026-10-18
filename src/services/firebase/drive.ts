/**
 * Conexão com o Google Drive da Atlética (FILE_STORAGE=drive): situação e
 * início da autorização. O servidor guarda o acesso; o navegador nunca vê o token.
 */
import { callApi } from "./call";

export interface DriveStatus {
  clientConfigured: boolean;
  connected: boolean;
  source: "env" | "database" | null;
  connectedAt: string | null;
  connectedByName: string | null;
}

export function getDriveStatus() {
  return callApi<DriveStatus>("system", "driveStatus", {});
}

/** Leva o navegador para a autorização do Google; o retorno volta para Configurações → Ambiente. */
export async function startDriveConnection() {
  const { url } = await callApi<{ url: string }>("system", "driveConnectUrl", {});
  window.location.assign(url);
}
