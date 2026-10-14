"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import type { AccessSnapshot } from "@/types";
import { firebase } from "@/services/firebase/app";
import { setAccessSnapshot, useFirebaseSession } from "@/services/firebase/session";
import { useSession } from "@/stores/session";

/**
 * Ponte entre o Firebase Authentication e a sessão da interface.
 *
 *  - Observa o usuário autenticado e o retrato de acesso dele
 *    (`userAccess/{uid}`) em tempo real.
 *  - Conta desativada (ou sem cadastro na Central): encerra a sessão.
 *  - Permissões alteradas: recarrega os dados abertos.
 *  - Sessão revogada ou expirada (o Firebase deixa de renovar o token):
 *    volta ao login com o motivo.
 */
export function FirebaseSessionBridge() {
  const qc = useQueryClient();

  useEffect(() => {
    let auth;
    try {
      auth = firebase().auth;
    } catch (error) {
      console.error(error);
      useSession.setState({ userId: null, hydrated: true, method: null });
      return;
    }
    const { db } = firebase();
    let stopAccess: () => void = () => undefined;
    let lastVersion: number | null = null;

    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopAccess();
      lastVersion = null;
      if (!user) {
        const hadSession = !!useSession.getState().userId;
        setAccessSnapshot(null, null);
        if (hadSession) {
          const { endedReason } = useFirebaseSession.getState();
          if (!endedReason) useFirebaseSession.setState({ endedReason: "expired" });
          qc.clear();
        }
        useSession.setState({ userId: null, method: null, startedAt: null, hydrated: true });
        return;
      }
      stopAccess = onSnapshot(
        doc(db, `userAccess/${user.uid}`),
        (snap) => {
          const access = snap.exists() ? (snap.data() as AccessSnapshot) : null;
          if (!access || access.status !== "active") {
            useFirebaseSession.setState({ endedReason: access ? "disabled" : "not_enabled" });
            void signOut(auth);
            return;
          }
          if (lastVersion !== null && access.version !== lastVersion) {
            // Cargo ou permissões mudaram: tudo o que está aberto é recarregado.
            void qc.invalidateQueries();
          }
          lastVersion = access.version;
          setAccessSnapshot(user.uid, access);
          if (useSession.getState().userId !== user.uid) {
            useFirebaseSession.setState({ endedReason: null });
            useSession.setState({ userId: user.uid, method: "firebase", startedAt: new Date().toISOString(), hydrated: true });
          } else if (!useSession.getState().hydrated) {
            useSession.setState({ hydrated: true });
          }
        },
        () => {
          // Sem permissão de ler o próprio retrato: conta sem acesso efetivo.
          useFirebaseSession.setState({ endedReason: "not_enabled" });
          void signOut(auth);
        },
      );
    });
    return () => {
      stopAuth();
      stopAccess();
    };
  }, [qc]);

  return null;
}
