"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { onAuthStateChanged, signOut, type Auth } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import type { AccessSnapshot } from "@/types";
import { firebase } from "@/services/firebase/app";
import { setAccessSnapshot, useFirebaseSession } from "@/services/firebase/session";
import { toast } from "sonner";
import { isSupportRole } from "@/lib/support";
import { loadSavedViewAs, saveViewAs, useSession } from "@/stores/session";

/**
 * Ponte entre o Firebase Authentication e a sessão da interface.
 *
 *  - Observa o usuário autenticado e o retrato de acesso dele
 *    (`userAccess/{uid}`) em tempo real.
 *  - Conta desativada (ou sem cadastro na Central): encerra a sessão.
 *  - Permissões alteradas: recarrega os dados abertos.
 *  - Módulos ativados ou desativados nas Configurações (`settings/system`):
 *    recarrega as configurações, e o menu e as telas se ajustam na hora.
 *  - Sessão revogada ou expirada (o Firebase deixa de renovar o token):
 *    volta ao login com o motivo.
 *  - "Ver como" (só a conta de suporte): também observa o retrato de acesso
 *    da pessoa vista e o entrega às consultas; a interface passa a usar a
 *    identidade dela. O login continua sendo o do suporte.
 */
export function FirebaseSessionBridge() {
  const qc = useQueryClient();
  useEffect(() => startFirebaseSessionBridge(qc), [qc]);
  return null;
}

/** Liga os observadores da sessão; devolve a função que desliga todos. */
export function startFirebaseSessionBridge(qc: QueryClient): () => void {
  let auth: Auth;
  try {
    auth = firebase().auth;
  } catch (error) {
    console.error(error);
    useSession.setState({ userId: null, hydrated: true, method: null });
    return () => undefined;
  }
  const { db } = firebase();
  let stopAccess: () => void = () => undefined;
  let stopSettings: () => void = () => undefined;
  let stopTarget: () => void = () => undefined;
  let lastVersion: number | null = null;
  let currentUid: string | null = null;
  let realAccess: AccessSnapshot | null = null;
  let targetUid: string | null = null;
  let targetAccess: AccessSnapshot | null = null;

  /** Entrega às telas o retrato certo (o da pessoa vista, no "ver como") e a identidade efetiva. */
  const apply = () => {
    if (!currentUid || !realAccess) return;
    const va = useSession.getState().viewAs;
    const viewing = !!va && va.realUid === currentUid && va.uid === targetUid && !!targetAccess;
    setAccessSnapshot(currentUid, viewing ? targetAccess : realAccess);
    const effective = viewing ? va!.uid : currentUid;
    if (useSession.getState().userId !== effective) {
      useFirebaseSession.setState({ endedReason: null });
      useSession.setState({ userId: effective, method: "firebase", startedAt: new Date().toISOString(), hydrated: true });
    } else if (!useSession.getState().hydrated) {
      useSession.setState({ hydrated: true });
    }
  };

  const endViewAs = (message: string) => {
    if (useSession.getState().viewAs) {
      useSession.setState({ viewAs: null });
      toast.error(message);
    }
  };

  /** Liga/desliga a observação do retrato da pessoa vista conforme o "ver como". */
  const watchTarget = () => {
    const va = useSession.getState().viewAs;
    const want = va && currentUid && va.realUid === currentUid && realAccess && isSupportRole(realAccess.roleId) ? va.uid : null;
    if (va && !want && realAccess) {
      // Sessão de outra conta ou conta sem o cargo suporte: o "ver como" não vale.
      useSession.setState({ viewAs: null });
      return;
    }
    if (want === targetUid) return;
    stopTarget();
    stopTarget = () => undefined;
    targetUid = want;
    targetAccess = null;
    if (!want) {
      apply();
      return;
    }
    stopTarget = onSnapshot(
      doc(db, `userAccess/${want}`),
      (snap) => {
        const a = snap.exists() ? (snap.data() as AccessSnapshot) : null;
        if (!a || a.status !== "active") return endViewAs("A conta desta pessoa está desativada. Você voltou para a sua visão.");
        const changed = targetAccess !== null && targetAccess.version !== a.version;
        targetAccess = a;
        apply();
        if (changed) void qc.invalidateQueries();
      },
      () => endViewAs("Não foi possível carregar a visão desta pessoa. Você voltou para a sua visão."),
    );
  };

  const stopView = useSession.subscribe((s, prev) => {
    if (s.viewAs === prev.viewAs) return;
    saveViewAs(s.viewAs);
    watchTarget();
  });

  const stopAuth = onAuthStateChanged(auth, (user) => {
    stopAccess();
    stopSettings();
    stopTarget();
    stopAccess = () => undefined;
    stopSettings = () => undefined;
    stopTarget = () => undefined;
    lastVersion = null;
    currentUid = user?.uid ?? null;
    realAccess = null;
    targetUid = null;
    targetAccess = null;
    let watchingSettings = false;
    if (!user) {
      const hadSession = !!useSession.getState().userId;
      setAccessSnapshot(null, null);
      if (hadSession) {
        const { endedReason } = useFirebaseSession.getState();
        if (!endedReason) useFirebaseSession.setState({ endedReason: "expired" });
        qc.clear();
      }
      useSession.setState({ userId: null, method: null, startedAt: null, hydrated: true, viewAs: null });
      saveViewAs(null);
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
        realAccess = access;
        // Recarregou a aba no meio de um "ver como": retoma (o servidor confere de novo).
        if (!useSession.getState().viewAs && isSupportRole(access.roleId)) {
          const saved = loadSavedViewAs(user.uid);
          if (saved) useSession.setState({ viewAs: saved });
        }
        watchTarget();
        apply();
        if (!watchingSettings) {
          // Só depois de confirmar a conta ativa (as regras exigem isso para ler as configurações).
          watchingSettings = true;
          stopSettings = onSnapshot(
            doc(db, "settings/system"),
            () => {
              // Módulo ativado/desativado ou dado institucional alterado por outra pessoa.
              // (Qualquer visão aberta: a do próprio usuário ou a do "ver como".)
              void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === "settings" });
            },
            () => {
              // Sem leitura (ex.: conta desativada agora): o retrato de acesso encerra a sessão.
            },
          );
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
    stopView();
    stopAccess();
    stopSettings();
    stopTarget();
  };
}
