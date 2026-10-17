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
  | "settings"
  | "audit";

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
  /**
   * E-mail de acesso. Na demonstração, fictício (domínio example.org). Com o
   * Firebase, só é preenchido para quem pode administrar integrantes; para os
   * demais perfis vem vazio (dado administrativo).
   */
  email: string;
  roleId: ID;
  /**
   * Departamentos adicionais em que o integrante atua, além do departamento do
   * cargo. Entram no público "departamento" dos registros.
   */
  departmentIds?: ID[];
  /** Situação da conta: "inactive" = desativada (perde o acesso efetivo). */
  status: "active" | "inactive";
  joinedAt: ISODateTime;
  /** Foto de perfil (data URL pequena, até ~90 KB), escolhida pela própria pessoa. */
  photo?: string;
  /** Presente nos integrantes que podem ser usados como perfil de demonstração. */
  demoProfile?: DemoProfileInfo;
}

/** Convite para entrar na Central (o cadastro não é aberto ao público). */
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  id: ID;
  name: string;
  email: string;
  roleId: ID;
  departmentIds: ID[];
  status: InvitationStatus;
  expiresAt: ISODateTime;
  createdBy: ID;
  createdAt: ISODateTime;
  acceptedAt?: ISODateTime;
  acceptedUserId?: ID;
  revokedAt?: ISODateTime;
  revokedBy?: ID;
}

/**
 * Retrato da autorização efetiva de um integrante, calculado pelo servidor a
 * partir do cargo e da situação da conta. É a fonte usada pelas regras de
 * segurança do Firestore/Storage (coleção `userAccess`).
 */
export interface AccessSnapshot {
  uid: ID;
  status: "active" | "inactive";
  roleId: ID;
  level: RoleLevel;
  isBoard: boolean;
  /** Departamento do cargo seguido dos departamentos adicionais. */
  departmentIds: ID[];
  /** Vazio quando a conta ou o cargo estão desativados. */
  permissions: Permission[];
  /** Marcadores de público (ver src/lib/access-tokens.ts). Vazio quando inativo. */
  tokens: string[];
  version: number;
  updatedAt: ISODateTime;
}
