import { doc, getDoc } from "firebase/firestore";
import { defaultSystemSettings } from "@/data/structure/default-structure";
import type { DocumentCategory, FinanceCategory, SystemSettings } from "@/types";
import type { SettingsService } from "../contracts";
import { ServiceError } from "../errors";
import { firebase } from "./app";
import { callApi, takeRequestId } from "./call";
import { mapFirestoreError } from "./convert";
import { whenAccess } from "./session";

export const firebaseSettings: SettingsService = {
  async get() {
    await whenAccess();
    try {
      const snap = await getDoc(doc(firebase().db, "settings/system"));
      if (!snap.exists()) {
        console.warn("[Central] settings/system não existe: rode o script de implantação inicial (npm run bootstrap).");
        return defaultSystemSettings();
      }
      const data = snap.data() as SystemSettings;
      return { institution: { ...defaultSystemSettings().institution, ...data.institution }, modules: { ...defaultSystemSettings().modules, ...data.modules } };
    } catch (error) {
      throw mapFirestoreError(error);
    }
  },
  async updateInstitution(input) {
    const rid = takeRequestId();
    return callApi<SystemSettings>("system", "updateInstitution", input, rid);
  },
  async setModuleEnabled(module, enabled) {
    const rid = takeRequestId();
    return callApi<SystemSettings>("system", "setModuleEnabled", { module, enabled }, rid);
  },
  async createDocumentCategory(name) {
    const rid = takeRequestId();
    return callApi<DocumentCategory>("system", "createDocumentCategory", { name }, rid);
  },
  async renameDocumentCategory(id, name) {
    const rid = takeRequestId();
    return callApi<DocumentCategory>("system", "renameDocumentCategory", { id, name }, rid);
  },
  async createFinanceCategory(name, type) {
    const rid = takeRequestId();
    return callApi<FinanceCategory>("system", "createFinanceCategory", { name, type }, rid);
  },
  async renameFinanceCategory(id, name) {
    const rid = takeRequestId();
    return callApi<FinanceCategory>("system", "renameFinanceCategory", { id, name }, rid);
  },
  async resetDemoData() {
    throw new ServiceError("unavailable", "Não existe “restaurar dados” no ambiente real.");
  },
};
