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
  Athlete,
  Competition,
  Match,
  SportCategory,
  SportTeam,
  TeamStatus,
  TrainingSlot,
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
  AuditPage,
  AuditQuery,
  FileRef,
  Invitation,
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

export interface InvitationPreview {
  name: string;
  email: string;
  roleName: string;
  expiresAt: string;
}

export interface AuthService {
  /** "demo": perfis fictícios sem senha; "firebase": Firebase Authentication. */
  readonly mode: "demo" | "firebase";
  /**
   * Login por e-mail e senha. Demonstração: só aceita e-mails de perfis
   * fictícios e NÃO verifica senha. Firebase: autenticação real.
   * `remember` = manter a sessão neste dispositivo (padrão) ou só nesta aba.
   */
  signInWithPassword(email: string, password: string, options?: { remember?: boolean }): Promise<DemoProfile>;
  listDemoProfiles(): Promise<DemoProfile[]>;
  /** Firebase: envia o e-mail oficial de redefinição (resposta neutra, sem revelar se o e-mail existe). */
  requestPasswordReset(email: string): Promise<{ available: boolean }>;
  signOut(): Promise<void>;
  previewInvitation(token: string): Promise<InvitationPreview>;
  /** Cria a conta a partir do convite e já inicia a sessão. */
  acceptInvitation(token: string, password: string): Promise<{ email: string }>;
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

export interface InviteInput {
  name: string;
  email: string;
  roleId: ID;
  /** Departamentos adicionais (além do departamento do cargo). */
  departmentIds: ID[];
}

export interface InvitationResult {
  invitation: Invitation;
  /** Link de uso único para enviar à pessoa. Só é exibido uma vez (null em reenvios da mesma requisição). */
  link: string | null;
}

/** Correção de conta feita pelo Suporte do sistema. Só os campos enviados mudam; `photo: null` remove a foto. */
export interface SupportAccountInput {
  name?: string;
  email?: string;
  password?: string;
  photo?: string | null;
}

export interface OrganizationService {
  snapshot(): Promise<OrganizationSnapshot>;
  createRole(input: RoleInput): Promise<Role>;
  updateRole(id: ID, input: Partial<RoleInput>): Promise<Role>;
  createDepartment(input: DepartmentInput): Promise<Department>;
  updateDepartment(id: ID, input: Partial<DepartmentInput>): Promise<Department>;
  /** Somente demonstração. Com o Firebase, integrantes entram por convite. */
  createMember(input: MemberInput): Promise<Member>;
  updateMember(id: ID, input: Partial<MemberInput> & { departmentIds?: ID[] }): Promise<Member>;
  /** Foto de perfil da própria conta (data URL pequena); `null` remove. */
  updateMyPhoto(photo: string | null): Promise<Member>;
  /** Exclui o perfil (conta de acesso e cadastro). Presidência; não vale para si. */
  deleteMember(id: ID): Promise<void>;
  listInvitations(): Promise<Invitation[]>;
  inviteMember(input: InviteInput): Promise<InvitationResult>;
  renewInvitation(id: ID): Promise<InvitationResult>;
  revokeInvitation(id: ID): Promise<Invitation>;
  /** Suporte do sistema: troca nome, foto, e-mail de acesso e senha de qualquer integrante. */
  supportUpdateAccount(id: ID, input: SupportAccountInput): Promise<Member>;
  /** Suporte do sistema: link de um convite pendente. */
  invitationLink(id: ID): Promise<string>;
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
  /** Evento relacionado (opcional). */
  eventId?: ID;
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
  /** Avisa quando a campanha ou as vendas dela mudam (tempo real). Retorna a função para cancelar. */
  subscribe?(campaignId: ID, onChange: () => void): () => void;
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
  /** Suporte do sistema: exclui o documento e os arquivos de todas as versões. Não tem volta. */
  remove(id: ID): Promise<void>;
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
  /** Participantes externos (apenas nomes). */
  guests?: string[];
  /** Evento relacionado (opcional). */
  eventId?: ID;
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
  /** Quem pode ver o conteúdo (padrão: todos os integrantes com acesso ao Marketing). */
  access?: Audience;
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

/* -------------------------------- Esportes ------------------------------- */

export interface TeamInput {
  name: string;
  sport: string;
  category: SportCategory;
  description: string;
  coach?: string;
  responsibleId: ID;
  access: Audience;
}

/** Item de uma lista da modalidade: com `id` atualiza; sem `id` inclui. */
export type ItemInput<T extends { id: ID }> = Omit<T, "id"> & { id?: ID };

export type TeamList = "trainings" | "athletes" | "matches" | "competitions";

export interface SportsService {
  list(): Promise<SportTeam[]>;
  get(id: ID): Promise<SportTeam>;
  create(input: TeamInput): Promise<SportTeam>;
  update(id: ID, input: Partial<TeamInput>): Promise<SportTeam>;
  setStatus(id: ID, status: TeamStatus): Promise<SportTeam>;
  saveTraining(id: ID, item: ItemInput<TrainingSlot>): Promise<SportTeam>;
  saveAthlete(id: ID, item: ItemInput<Athlete>): Promise<SportTeam>;
  saveMatch(id: ID, item: ItemInput<Match>): Promise<SportTeam>;
  saveCompetition(id: ID, item: ItemInput<Competition>): Promise<SportTeam>;
  removeItem(id: ID, list: TeamList, itemId: ID): Promise<SportTeam>;
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
  /** Avisa quando chegam notificações novas (tempo real). Retorna a função para cancelar. */
  subscribe?(onChange: () => void): () => void;
}

export interface SearchService {
  search(query: string): Promise<SearchResult[]>;
}

/* ------------------------------- Arquivos ------------------------------- */

export interface FileService {
  /** Demonstração: URL temporária de um arquivo escolhido nesta sessão, ou null. */
  getObjectUrl(blobId?: string): string | null;
  /** O conteúdo do arquivo pode ser aberto neste ambiente? */
  isAvailable(file: FileRef | null | undefined): boolean;
  /**
   * Abre (ou baixa) o arquivo. Firebase: o download é autenticado e só
   * funciona para quem pode ver o registro; nenhuma URL pública é criada.
   */
  open(file: FileRef, options?: { download?: boolean }): Promise<void>;
  /** URL local (blob:) para pré-visualizar o arquivo na página. Quem chama deve revogá-la ao desmontar. */
  loadObjectUrl(file: FileRef): Promise<string>;
}

/* ------------------------------- Auditoria ------------------------------ */

export interface ExportRecordInput {
  module: ModuleKey;
  resourceType: string;
  resourceId: ID;
  /** Ex.: "PDF interno com dados dos compradores (todos os números)". Sem dados pessoais. */
  summary: string;
  /** A exportação incluiu dados pessoais? */
  personalData: boolean;
}

export interface AuditService {
  /** Registros de auditoria (mais recentes primeiro), paginados. Exige `audit.view`. */
  list(query: AuditQuery): Promise<AuditPage>;
  /**
   * Registra na auditoria que um arquivo foi exportado (PDF/CSV/PNG gerado no
   * navegador a partir de dados que o perfil já podia ver). Melhor esforço:
   * falhas não impedem a exportação. Demonstração: não faz nada.
   */
  recordExport(input: ExportRecordInput): Promise<void>;
  /** Suporte do sistema: apaga registros da auditoria (até 100 por vez). */
  remove(ids: ID[]): Promise<void>;
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
  sports: SportsService;
  settings: SettingsService;
  notifications: NotificationService;
  search: SearchService;
  files: FileService;
  audit: AuditService;
}
