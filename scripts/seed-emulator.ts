/**
 * SEED DO FIREBASE EMULATOR SUITE (somente desenvolvimento e testes)
 * ---------------------------------------------------------------------------
 * Carrega os dados FICTÍCIOS da demonstração nos emuladores locais, no mesmo
 * formato usado em produção, e cria contas de teste no emulador de Auth.
 *
 * Proteções:
 *  - Recusa-se a rodar se as variáveis dos emuladores não estiverem definidas.
 *  - Recusa-se a rodar com um projeto que não comece com "demo-" (projetos
 *    "demo-*" nunca acessam recursos reais do Firebase).
 *  - Nunca use este script contra um projeto real. Para preparar um ambiente
 *    real, use scripts/bootstrap.ts.
 *
 * Uso (com os emuladores rodando: npm run emulators):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run seed:emulator
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { buildSeed } from "../src/data/demo/seed";
import { computeAccess, intersects } from "../src/lib/access-tokens";
import { audienceTokens } from "../src/lib/access-tokens";
import {
  campaignDoc,
  campaignStats,
  contentDoc,
  documentDoc,
  eventDoc,
  financeEntryDoc,
  meetingDoc,
  numberLocks,
  projectDocs,
  saleBuyerDoc,
  salePublicDoc,
} from "../src/lib/firestore-model";
import { searchEntryFor, type SearchIndexEntry } from "../src/lib/search-entries";
import { termsFor } from "../src/lib/search-terms";

const PROJECT = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-yawara";
export const DEMO_PASSWORD = "Yawara-demo-2026";

function guard() {
  const missing = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Recusado: defina ${missing.join(", ")} (este script só roda contra os emuladores).`);
    process.exit(1);
  }
  if (!PROJECT.startsWith("demo-")) {
    console.error(`Recusado: o projeto "${PROJECT}" não é um projeto de demonstração ("demo-*").`);
    process.exit(1);
  }
}

async function clearEmulators() {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}

export async function seedEmulator({ quiet = false } = {}) {
  guard();
  const app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, `seed-${Date.now()}`);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  const auth = getAuth(app);
  await clearEmulators();

  const data = buildSeed();
  const writes: [string, object][] = [];
  const put = (path: string, value: object) => writes.push([path, value]);

  put("settings/system", data.settings);
  for (const d of data.departments) put(`departments/${d.id}`, { ...d, id: undefined });
  for (const r of data.roles) put(`roles/${r.id}`, { ...r, id: undefined });
  for (const c of data.documentCategories) put(`documentCategories/${c.id}`, { name: c.name, description: c.description });
  for (const c of data.financeCategories) put(`financeCategories/${c.id}`, { name: c.name, type: c.type });

  const roleMap = new Map(data.roles.map((r) => [r.id, r]));
  const accessByUser = new Map<string, ReturnType<typeof computeAccess>>();
  for (const m of data.members) {
    put(`members/${m.id}`, { name: m.name, roleId: m.roleId, departmentIds: m.departmentIds ?? [], status: m.status, joinedAt: m.joinedAt, updatedAt: m.joinedAt });
    put(`memberPrivate/${m.id}`, { email: m.email, createdAt: m.joinedAt });
    const access = computeAccess(m, roleMap.get(m.roleId), 0, data.seededAt);
    accessByUser.set(m.id, access);
    put(`userAccess/${m.id}`, access);
  }

  const index = (e: SearchIndexEntry) =>
    put(`searchIndex/${e.kind}__${e.id}`, { kind: e.kind, module: e.module, recordId: e.id, title: e.title, subtitle: e.subtitle, href: e.href, at: e.at, readers: e.readers, archived: !!e.archived, terms: termsFor([e.title, ...e.text]) });

  for (const c of data.campaigns) {
    const sales = data.sales.filter((s) => s.campaignId === c.id);
    put(`campaigns/${c.id}`, campaignDoc(c, campaignStats(c, sales)));
    for (const s of sales) {
      put(`campaigns/${c.id}/sales/${s.id}`, salePublicDoc(s));
      put(`campaigns/${c.id}/buyers/${s.id}`, saleBuyerDoc(c, s));
      for (const lock of numberLocks(s)) put(`campaigns/${c.id}/numbers/${lock.id}`, lock.data);
    }
    index(searchEntryFor.campaign(c));
  }
  for (const e of data.events) {
    put(`events/${e.id}`, eventDoc(e));
    index(searchEntryFor.event(e));
  }
  const catName = new Map(data.documentCategories.map((c) => [c.id, c.name]));
  for (const d of data.documents) {
    put(`documents/${d.id}`, documentDoc(d));
    index(searchEntryFor.document(d, catName.get(d.categoryId)));
  }
  for (const m of data.meetings) {
    put(`meetings/${m.id}`, meetingDoc(m));
    index(searchEntryFor.meeting(m));
  }
  for (const f of data.financeEntries) {
    put(`financeEntries/${f.id}`, financeEntryDoc(f));
    index(searchEntryFor.finance(f));
  }
  for (const c of data.contents) {
    put(`contents/${c.id}`, contentDoc(c));
    index(searchEntryFor.content(c));
  }
  for (const p of data.projects) {
    const { project, attendance } = projectDocs(p);
    put(`projects/${p.id}`, project);
    put(`projects/${p.id}/private/attendance`, attendance);
    index(searchEntryFor.project(p));
  }

  // Notificações da demonstração: uma por destinatário (o público vira lista de pessoas).
  const expireAt = Timestamp.fromMillis(Date.now() + 180 * 24 * 60 * 60 * 1000);
  for (const n of data.notifications) {
    const tokens = audienceTokens(n.audience);
    for (const m of data.members) {
      const access = accessByUser.get(m.id)!;
      if (m.id === n.actorId || !intersects(access.tokens, tokens)) continue;
      put(`notifications/${n.id}__${m.id}`, {
        recipientId: m.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href,
        actorId: n.actorId ?? null,
        createdAt: n.createdAt,
        readAt: n.readBy.includes(m.id) ? Timestamp.fromDate(new Date(n.createdAt)) : null,
        expireAt,
      });
    }
  }

  const year = new Date().getFullYear();
  for (const [prefix, value] of Object.entries(data.counters)) put(`counters/${prefix === "LAN" ? prefix : `${prefix}-${year}`}`, { value });

  // Grava em lotes de até 400 operações.
  let batch: WriteBatch = db.batch();
  let count = 0;
  for (const [path, value] of writes) {
    batch.set(db.doc(path), value);
    if (++count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();

  for (const m of data.members) {
    await auth.createUser({ uid: m.id, email: m.email, password: DEMO_PASSWORD, displayName: m.name, disabled: m.status !== "active" });
  }

  if (!quiet) {
    console.log(`Emulador "${PROJECT}" carregado com ${writes.length} documentos fictícios.`);
    console.log(`Contas de teste (senha para todas: ${DEMO_PASSWORD}):`);
    for (const m of data.members.filter((x) => x.demoProfile)) console.log(`  ${m.demoProfile!.label.padEnd(22)} ${m.email}`);
  }
  return { documents: writes.length, members: data.members };
}

const invokedDirectly = process.argv[1]?.endsWith("seed-emulator.ts");
if (invokedDirectly) {
  seedEmulator().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
