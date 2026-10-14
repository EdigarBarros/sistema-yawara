/**
 * Autenticação real (Firebase Authentication, e-mail e senha).
 * O cadastro não é aberto ao público: contas são criadas por convite
 * (organizationApi.inviteMember → authApi.acceptInvitation).
 */
import {
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import type { AccessSnapshot, Department, Member, Role } from "@/types";
import type { AuthService, DemoProfile, InvitationPreview } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { fromSnap, mapFirestoreError } from "./convert";
import { useFirebaseSession } from "./session";

function mapAuthError(error: unknown): ServiceError {
  const code = (error as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
    case "auth/invalid-login-credentials":
      return new ServiceError("invalid", "E-mail ou senha incorretos.");
    case "auth/user-disabled":
      return new ServiceError("forbidden", "Esta conta está desativada. Procure a presidência da Atlética.");
    case "auth/too-many-requests":
      return new ServiceError("unavailable", "Muitas tentativas seguidas. Aguarde alguns minutos ou redefina a senha.");
    case "auth/network-request-failed":
      return new ServiceError("unavailable", "Sem conexão. Verifique a internet e tente novamente.");
    default:
      return new ServiceError("internal", "Não foi possível entrar agora. Tente novamente.");
  }
}

/** Perfil do integrante autenticado; recusa contas sem cadastro ou desativadas. */
export async function loadProfile(uid: string): Promise<DemoProfile> {
  const { db } = firebase();
  try {
    const accessSnap = await getDoc(doc(db, `userAccess/${uid}`));
    if (!accessSnap.exists()) throw new ServiceError("forbidden", "Sua conta ainda não foi habilitada na Central. Procure a presidência.");
    const access = accessSnap.data() as AccessSnapshot;
    if (access.status !== "active") throw new ServiceError("forbidden", "Sua conta está desativada. Procure a presidência para reativá-la.");
    const memberSnap = await getDoc(doc(db, `members/${uid}`));
    const member = fromSnap<Member>(memberSnap);
    const role = fromSnap<Role>(await getDoc(doc(db, `roles/${member.roleId}`)));
    const depSnap = await getDoc(doc(db, `departments/${role.departmentId}`));
    const privSnap = await getDoc(doc(db, `memberPrivate/${uid}`));
    return {
      member: { ...member, email: (privSnap.data()?.email as string | undefined) ?? "" },
      role,
      department: depSnap.exists() ? fromSnap<Department>(depSnap) : undefined,
    };
  } catch (error) {
    throw mapFirestoreError(error, "Sua conta não tem acesso à Central.");
  }
}

export const firebaseAuth: AuthService = {
  mode: "firebase",

  async signInWithPassword(email, password, options) {
    const { auth } = firebase();
    try {
      await setPersistence(auth, options?.remember === false ? browserSessionPersistence : browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      try {
        const profile = await loadProfile(cred.user.uid);
        // Registro do início de sessão na auditoria (melhor esforço).
        callApi("auth", "sessionStarted", {}).catch(() => undefined);
        return profile;
      } catch (error) {
        useFirebaseSession.setState({ endedReason: "not_enabled" });
        await fbSignOut(auth);
        throw error;
      }
    } catch (error) {
      throw error instanceof ServiceError ? error : mapAuthError(error);
    }
  },

  async listDemoProfiles() {
    return [];
  },

  async requestPasswordReset(email) {
    const { auth } = firebase();
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "auth/invalid-email" || code === "auth/missing-email") throw new ServiceError("invalid", "Informe um e-mail válido.");
      if (code === "auth/network-request-failed") throw new ServiceError("unavailable", "Sem conexão. Verifique a internet e tente novamente.");
      if (code === "auth/too-many-requests") throw new ServiceError("unavailable", "Muitas solicitações seguidas. Aguarde alguns minutos.");
      // Demais casos (ex.: e-mail não cadastrado): resposta neutra, sem revelar se a conta existe.
    }
    return { available: true };
  },

  async signOut() {
    useFirebaseSession.setState({ endedReason: "manual" });
    await fbSignOut(firebase().auth);
  },

  async previewInvitation(token) {
    return callApi<InvitationPreview>("auth", "previewInvitation", { token });
  },

  async acceptInvitation(token, password) {
    const requestId = takeRequestId();
    const result = await callApi<{ email: string }>("auth", "acceptInvitation", { token, password }, requestId);
    const { auth } = firebase();
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, result.email, password).catch((error) => {
      throw mapAuthError(error);
    });
    callApi("auth", "sessionStarted", {}).catch(() => undefined);
    return result;
  },
};
