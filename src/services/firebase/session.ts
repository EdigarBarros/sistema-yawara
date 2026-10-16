/**
 * Estado da sessão Firebase no navegador: o retrato de acesso do próprio
 * usuário (`userAccess/{uid}`), atualizado em tempo real.
 *
 * Esse retrato é usado para montar consultas compatíveis com as regras de
 * segurança (filtrar por `readers` com os marcadores do usuário). Ele NÃO é
 * uma barreira de segurança: as regras e o servidor conferem tudo de novo.
 */
import { create } from "zustand";
import type { AccessSnapshot } from "@/types";
import { ServiceError } from "../errors";

export type SessionEndReason = "manual" | "expired" | "disabled" | "not_enabled" | null;

interface FirebaseSessionState {
  uid: string | null;
  access: AccessSnapshot | null;
  /** Por que a última sessão terminou (exibido na tela de login). */
  endedReason: SessionEndReason;
}

export const useFirebaseSession = create<FirebaseSessionState>()(() => ({ uid: null, access: null, endedReason: null }));

let waiters: ((a: AccessSnapshot) => void)[] = [];

export function setAccessSnapshot(uid: string | null, access: AccessSnapshot | null) {
  useFirebaseSession.setState({ uid, access });
  if (access) {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(access);
  }
}

/** Retrato de acesso atual (espera o primeiro carregamento, por até 15 s). */
export function whenAccess(): Promise<AccessSnapshot> {
  const current = useFirebaseSession.getState().access;
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ServiceError("unauthenticated", "Sua sessão não está ativa. Entre novamente.")), 15000);
    waiters.push((a) => {
      clearTimeout(timer);
      resolve(a);
    });
  });
}

export function hasPerm(access: AccessSnapshot, permission: string) {
  return access.status === "active" && (access.permissions as string[]).includes(permission);
}
