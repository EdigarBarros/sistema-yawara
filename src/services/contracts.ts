/**
 * CONTRATOS DA CAMADA DE DADOS
 * ------------------------------------------------------------------
 * As telas só conhecem estas interfaces. Nesta etapa elas são
 * implementadas por serviços locais (src/services/local), que guardam os
 * dados de demonstração no navegador. Na Etapa 2, basta criar uma
 * implementação com Firebase (Auth, Firestore, Storage) que respeite os
 * mesmos contratos e trocá-la em src/services/index.ts.
 */
import type {
  AppNotification,
  AtleticaEvent,
  Audience,
  Campaign,
  CampaignAccess,
  CertificateStatus,
  Cents,
  Channel,
  ContentItem,
  ContentLink,
  ContentStatus,
  ContentType,
  DateOnly,
  Department,
  DocumentCategory,
  DocumentStatus,
  EntryStatus,
  EntryType,
  EventStatus,
  EventTask,
  EventType,
  ExtensionProject,
  ActivityType,
  FinanceCategory,
  FinanceEntry,
  ID,
  InstitutionalDocument,
  InstitutionSettings,
  Meeting,
  MeetingAction,
  MeetingMode,
  MeetingStatus,
  Member,
  ModuleKey,
  PaymentMethod,
  Permission,
  ProjectStatus,
  Role,
  RoleLevel,
  HomePreset,
  Sale,
  SaleStatus,
  ScheduleItem,
  SearchResult,
  Speaker,
  Supplier,
  SystemSettings,
  TaskStatus,
  TimeOnly,
} from "@/types";

/* ----------------------------- Autenticação ----------------------------- */

export interface DemoProfile {
  member: Member;
  role: Role;
  department: Department | undefined;
}

export interface AuthService {
  /**
   * Login por e-mail e senha. Nesta etapa só aceita e-mails de perfis de
   * demonstração e NÃO verifica senha — a tela deixa isso explícito.
   */
  signInWithPassword(email: string, password: string): Promise<DemoProfile>;
  listDemoProfiles(): Promise<DemoProfile[]>;
  /** Recuperação de senha: indisponível sem backend. */
  requestPasswordReset(email: string): Promise<{ available: false }>;
}

/* ----------------------------- Organização ------------------------------ */

export interface OrganizationSnapshot {
  departments: Department[];
  roles: Role[];
  members: Member[];
}

export interface RoleInput {
  name: string;
  description: string;
  departmentId: ID;
  level: RoleLevel;
  isBoard: boolean;
  active: boolean;
  homePreset: HomePreset;
  permissions: Permission[];
}

export interface DepartmentInput {
  name: string;
  shortName: string;
  description: string;
  active: boolean;
}

export interface MemberInput {
  name: string;
  email: string;
  roleId: ID;
  status: "active" | "inactive";
}

export interface OrganizationService {
  snapshot(): Promise<OrganizationSnapshot>;
  createRole(input: RoleInput): Promise<Role>;
  updateRole(id: ID, input: Partial<RoleInput>): Promise<Role>;
  createDepartment(input: DepartmentInput): Promise<Department>;
  updateDepartment(id: ID, input: Partial<DepartmentInput>): Promise<Department>;
  createMember(input: MemberInput): Promise<Member>;
  updateMember(id: ID, input: Partial<MemberInput>): Promise<Member>;
}

/* ------------------------------ Campanhas ------------------------------- */

export interface CampaignInput {
  name: string;
  description: string;
  prize: string;
  quantity: number;
  unitPrice: Cents;
  drawDate?: DateOnly;
  startDate?: DateOnly;
  endDate?: DateOnly;
  notes?: string;
  access: CampaignAccess;
}

export type CampaignUpdateInput = Partial<Omit<CampaignInput, "quantity" | "unitPrice">>;

export interface SaleInput {
  numbers: number[];
  buyerName: string;
  buyerContact: string;
  sellerId: ID;
  status: Exclude<SaleStatus, "cancelled">;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

export interface SaleUpdateInput {
  buyerName?: string;
  buyerContact?: string;
  sellerId?: ID;
  notes?: string;
  paymentMethod?: PaymentMethod;
}

export interface ConfirmPaymentInput {
  paymentMethod: PaymentMethod;
  receipt?: File;
}

export interface CampaignService {
  list(): Promise<Campaign[]>;
  get(id: ID): Promise<Campaign>;
  /** Vendas de uma campanha. Dados do comprador vêm `null` quando o perfil não pode consultá-los. */
  listSales(campaignId: ID): Promise<Sale[]>;
  /** Todas as vendas das campanhas visíveis (para indicadores). */
  listAllSales(): Promise<Sale[]>;
  create(input: CampaignInput): Promise<Campaign>;
  update(id: ID, input: CampaignUpdateInput): Promise<Campaign>;
  close(id: ID): Promise<Campaign>;
  reopen(id: ID): Promise<Campaign>;
  registerSale(campaignId: ID, input: SaleInput): Promise<Sale>;
  updateSale(saleId: ID, input: SaleUpdateInput): Promise<Sale>;
  /** Altera a situação: reservado → pendente, pendente → reservado etc. */
  setSaleStatus(saleId: ID, status: Exclude<SaleStatus, "cancelled" | "paid">): Promise<Sale>;
  confirmPayment(saleId: ID, input: ConfirmPaymentInput): Promise<Sale>;
  /** Desfaz uma confirmação de pagamento registrada por engano. */
  revertPayment(saleId: ID, reason: string): Promise<Sale>;
  cancelSale(saleId: ID, reason: string): Promise<Sale>;
  /** Libera os números de uma venda cancelada para nova venda. O registro cancelado é mantido. */
  releaseSale(saleId: ID): Promise<Sale>;
}

/* ------------------------------- Eventos -------------------------------- */

export interface EventInput {
  name: string;
  description: string;
  objective: string;
  type: EventType;
  date: DateOnly;
  time: TimeOnly;
  location: string;
  departmentId: ID;
  responsibleIds: ID[];
  notes?: string;
  access: Audience;
  budget?: Cents;
}

export interface TaskInput {
  title: string;
  description?: string;
  responsibleId?: ID;
  departmentId: ID;
  dueDate?: DateOnly;
  status: TaskStatus;
  notes?: string;
}

export interface EventService {
  list(): Promise<AtleticaEvent[]>;
  get(id: ID): Promise<AtleticaEvent>;
  create(input: EventInput): Promise<AtleticaEvent>;
  update(id: ID, input: Partial<EventInput>): Promise<AtleticaEvent>;
  setStatus(id: ID, status: EventStatus): Promise<AtleticaEvent>;
  /** Copia apenas a estrutura de planejamento (sem valores, vendas ou dados pessoais). */
  duplicate(id: ID, options: { name: string; date: DateOnly }): Promise<AtleticaEvent>;
  addTask(eventId: ID, input: TaskInput): Promise<EventTask>;
  updateTask(eventId: ID, taskId: ID, input: Partial<TaskInput>): Promise<EventTask>;
  addScheduleItem(eventId: ID, input: Omit<ScheduleItem, "id">): Promise<AtleticaEvent>;
  removeScheduleItem(eventId: ID, itemId: ID): Promise<AtleticaEvent>;
  addSupplier(eventId: ID, input: Omit<Supplier, "id">): Promise<AtleticaEvent>;
  updateSupplier(eventId: ID, supplierId: ID, input: Partial<Omit<Supplier, "id">>): Promise<AtleticaEvent>;
}

/* ------------------------------ Documentos ------------------------------ */

export interface DocumentInput {
  name: string;
  description: string;
  categoryId: ID;
  departmentId: ID;
  access: Audience;
  status: Exclude<DocumentStatus, "archived">;
  links?: { eventId?: ID; meetingId?: ID; projectId?: ID };
}

export interface DocumentService {
  listCategories(): Promise<DocumentCategory[]>;
  list(): Promise<InstitutionalDocument[]>;
  get(id: ID): Promise<InstitutionalDocument>;
  /** O arquivo fica apenas na memória deste navegador nesta etapa. */
  create(input: DocumentInput, file: File | Blob | null, fileName?: string): Promise<InstitutionalDocument>;
  update(id: ID, input: Partial<Omit<DocumentInput, "access">>): Promise<InstitutionalDocument>;
  setAccess(id: ID, access: Audience): Promise<InstitutionalDocument>;
  /** Adiciona nova versão; as anteriores continuam disponíveis no histórico. */
  addVersion(id: ID, file: File, note?: string): Promise<InstitutionalDocument>;
  archive(id: ID): Promise<InstitutionalDocument>;
  restore(id: ID): Promise<InstitutionalDocument>;
}

/* ------------------------------- Reuniões ------------------------------- */

export interface MeetingInput {
  title: string;
  date: DateOnly;
  startTime: TimeOnly;
  endTime?: TimeOnly;
  mode: MeetingMode;
  location: string;
  participantIds: ID[];
  agenda: string[];
  summary: string;
  decisions: string[];
  /** Encaminhamentos; `id` presente ao editar um item existente. */
  actions: (Omit<MeetingAction, "id"> & { id?: ID })[];
  documentIds: ID[];
  access: Audience;
}

export interface MeetingService {
  list(): Promise<Meeting[]>;
  get(id: ID): Promise<Meeting>;
  create(input: MeetingInput): Promise<Meeting>;
  update(id: ID, input: Partial<MeetingInput>): Promise<Meeting>;
  setStatus(id: ID, status: MeetingStatus): Promise<Meeting>;
}

/* ------------------------------ Financeiro ------------------------------ */

export interface FinanceEntryInput {
  type: EntryType;
  description: string;
  categoryId: ID;
  amount: Cents;
  date: DateOnly;
  responsibleId: ID;
  departmentId: ID;
  eventId?: ID;
  campaignId?: ID;
  paymentMethod?: PaymentMethod;
  status: Exclude<EntryStatus, "cancelled">;
  notes?: string;
}

export interface FinanceService {
  listCategories(): Promise<FinanceCategory[]>;
  list(): Promise<FinanceEntry[]>;
  /** Lançamentos de um evento — também disponível para a diretoria do departamento responsável. */
  listForEvent(eventId: ID): Promise<FinanceEntry[]>;
  get(id: ID): Promise<FinanceEntry>;
  create(input: FinanceEntryInput, receipt?: File): Promise<FinanceEntry>;
  update(id: ID, input: Partial<FinanceEntryInput>): Promise<FinanceEntry>;
  setStatus(id: ID, status: EntryStatus, reason?: string): Promise<FinanceEntry>;
  attachReceipt(id: ID, receipt: File): Promise<FinanceEntry>;
}

/* ------------------------------- Marketing ------------------------------ */

export interface ContentInput {
  title: string;
  type: ContentType;
  campaignId?: ID;
  eventId?: ID;
  responsibleId: ID;
  publishDate?: DateOnly;
  channels: Channel[];
  briefing: string;
  notes?: string;
  links: ContentLink[];
}

export interface MarketingService {
  list(): Promise<ContentItem[]>;
  get(id: ID): Promise<ContentItem>;
  create(input: ContentInput): Promise<ContentItem>;
  update(id: ID, input: Partial<ContentInput>): Promise<ContentItem>;
  setStatus(id: ID, status: ContentStatus): Promise<ContentItem>;
  addFiles(id: ID, files: File[]): Promise<ContentItem>;
}

/* --------------------------- Ensino e Extensão -------------------------- */

export interface ProjectInput {
  name: string;
  description: string;
  objective: string;
  activityType: ActivityType;
  responsibleId: ID;
  date: DateOnly;
  time?: TimeOnly;
  location: string;
  eventId?: ID;
  certificateHours?: number;
  access: Audience;
}

export interface ExtensionService {
  list(): Promise<ExtensionProject[]>;
  get(id: ID): Promise<ExtensionProject>;
  create(input: ProjectInput): Promise<ExtensionProject>;
  update(id: ID, input: Partial<ProjectInput> & { report?: string }): Promise<ExtensionProject>;
  setStatus(id: ID, status: ProjectStatus): Promise<ExtensionProject>;
  addSpeaker(id: ID, speaker: Omit<Speaker, "id">): Promise<ExtensionProject>;
  removeSpeaker(id: ID, speakerId: ID): Promise<ExtensionProject>;
  addScheduleItem(id: ID, item: Omit<ScheduleItem, "id">): Promise<ExtensionProject>;
  removeScheduleItem(id: ID, itemId: ID): Promise<ExtensionProject>;
  addAttendee(id: ID, name: string): Promise<ExtensionProject>;
  setAttendance(id: ID, attendeeId: ID, present: boolean): Promise<ExtensionProject>;
  setCertificateStatus(id: ID, status: CertificateStatus): Promise<ExtensionProject>;
  linkDocument(id: ID, documentId: ID): Promise<ExtensionProject>;
}

/* ---------------------------- Configurações ----------------------------- */

export interface SettingsService {
  get(): Promise<SystemSettings>;
  updateInstitution(input: Partial<InstitutionSettings>): Promise<SystemSettings>;
  setModuleEnabled(module: ModuleKey, enabled: boolean): Promise<SystemSettings>;
  createDocumentCategory(name: string): Promise<DocumentCategory>;
  renameDocumentCategory(id: ID, name: string): Promise<DocumentCategory>;
  createFinanceCategory(name: string, type: EntryType): Promise<FinanceCategory>;
  renameFinanceCategory(id: ID, name: string): Promise<FinanceCategory>;
  /** Apaga as alterações feitas no navegador e recria os dados de demonstração. */
  resetDemoData(): Promise<void>;
}

/* --------------------- Notificações e busca global ---------------------- */

export interface NotificationService {
  list(): Promise<AppNotification[]>;
  markRead(id: ID): Promise<void>;
  markAllRead(): Promise<void>;
}

export interface SearchService {
  search(query: string): Promise<SearchResult[]>;
}

/* ------------------------------- Arquivos ------------------------------- */

export interface FileService {
  /** URL temporária para visualizar/baixar um arquivo escolhido nesta sessão, ou null. */
  getObjectUrl(blobId?: string): string | null;
}

export interface Services {
  auth: AuthService;
  organization: OrganizationService;
  campaigns: CampaignService;
  events: EventService;
  documents: DocumentService;
  meetings: MeetingService;
  finance: FinanceService;
  marketing: MarketingService;
  extension: ExtensionService;
  settings: SettingsService;
  notifications: NotificationService;
  search: SearchService;
  files: FileService;
}
