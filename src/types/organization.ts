import type { ID, ISODateTime } from "./common";

export type ModuleKey =
  | "campaigns"
  | "events"
  | "documents"
  | "meetings"
  | "finance"
  | "marketing"
  | "extension"
  | "organization"
  | "settings";

export type PermissionAction =
  | "view"
  | "create"
  | "register"
  | "edit"
  | "approve"
  | "archive"
  | "export"
  | "admin";

export type Permission = `${ModuleKey}.${PermissionAction}`;

export interface Department {
  id: ID;
  name: string;
  shortName: string;
  description: string;
  active: boolean;
  createdAt: ISODateTime;
}

/** Nível hierárquico do cargo — usado nos públicos "diretores" e "diretores e assessores". */
export type RoleLevel = "presidency" | "director" | "advisor" | "member";

/** Qual página inicial o cargo recebe. */
export type HomePreset =
  | "presidency"
  | "secretary"
  | "finance"
  | "marketing"
  | "events"
  | "extension"
  | "advisor";

export interface Role {
  id: ID;
  name: string;
  description: string;
  departmentId: ID;
  level: RoleLevel;
  /** Faz parte da diretoria (público "Somente diretoria"). */
  isBoard: boolean;
  active: boolean;
  permissions: Permission[];
  homePreset: HomePreset;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface DemoProfileInfo {
  /** Rótulo exibido na seleção de perfil demonstrativo (ex.: "Presidência"). */
  label: string;
  description: string;
  order: number;
}

export interface Member {
  id: ID;
  name: string;
  /** E-mails fictícios no domínio reservado example.org. */
  email: string;
  roleId: ID;
  status: "active" | "inactive";
  joinedAt: ISODateTime;
  /** Presente nos integrantes que podem ser usados como perfil de demonstração. */
  demoProfile?: DemoProfileInfo;
}
