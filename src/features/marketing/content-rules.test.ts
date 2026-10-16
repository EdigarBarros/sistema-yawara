/**
 * Regras de Marketing que o modo demonstração e a interface aplicam como o
 * servidor (functions/src/modules/marketing.ts): depois de "Aprovado" (e em
 * "Publicado"), só quem aprova altera dados e arquivos do material.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ContentItem } from "@/types";
import { buildSeed } from "@/data/demo/seed";
import { USR } from "@/data/demo/organization";
import { allowedContentStatuses, canChangeContent, canEditContent, canSeeContent } from "@/lib/policies";
import { getDB, setDBForTests } from "@/services/local/db";
import { accessContext, disableLatencyForTests, setActorForTests } from "@/services/local/context";
import { localMarketing as marketing } from "@/services/local/marketing";

disableLatencyForTests();

const BRIEFING = "Arte de divulgação da Calourada para o feed e os stories.";

function stored(id: string) {
  return getDB().contents.find((c) => c.id === id)!;
}

/** Contexto de acesso de um perfil da demonstração (para conferir as políticas usadas pela interface). */
function ctxOf(userId: string) {
  setActorForTests(userId);
  return accessContext(getDB());
}

function jpeg(name = "arte.jpg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: "image/jpeg" });
}

async function approvedByLivia(): Promise<ContentItem> {
  // Júlia: Assessora de Marketing (marketing.view/create/edit, sem marketing.approve).
  setActorForTests(USR.julia);
  const c = await marketing.create({ title: "Arte principal de teste", type: "arte", responsibleId: USR.julia, channels: ["instagram_feed"], briefing: BRIEFING, links: [] });
  await marketing.setStatus(c.id, "review");
  setActorForTests(USR.livia);
  const approved = await marketing.setStatus(c.id, "approved");
  setActorForTests(USR.julia);
  return approved;
}

beforeEach(() => {
  setDBForTests(buildSeed(new Date("2026-10-14T15:00:00-03:00")));
  setActorForTests(USR.julia);
});

describe("material aprovado (demonstração)", () => {
  it("quem não aprova não altera nem anexa depois da aprovação; publicar mantém o que foi aprovado", async () => {
    const approved = await approvedByLivia();

    await expect(marketing.update(approved.id, { briefing: "Texto totalmente diferente, nunca aprovado." })).rejects.toMatchObject({
      code: "conflict",
      message: "Este material já foi aprovado. Peça a quem aprova para devolvê-lo à revisão antes de alterar.",
    });
    await expect(marketing.addFiles(approved.id, [jpeg("arte-nao-aprovada.jpg")])).rejects.toMatchObject({ code: "conflict" });
    expect(stored(approved.id)).toMatchObject({ status: "approved", briefing: BRIEFING, files: [] });
    expect(stored(approved.id).history).toHaveLength(approved.history.length);

    const published = await marketing.setStatus(approved.id, "published");
    expect(published).toMatchObject({ status: "published", briefing: BRIEFING });
    await expect(marketing.update(approved.id, { title: "Arte trocada depois de publicada" })).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/já foi publicado.*Em revisão/),
    });
    await expect(marketing.addFiles(approved.id, [jpeg()])).rejects.toMatchObject({ code: "conflict" });

    // Devolve para revisão, altera e precisa de nova aprovação.
    await marketing.setStatus(approved.id, "review");
    const changed = await marketing.update(approved.id, { briefing: "Briefing revisado depois da publicação." });
    expect(changed.status).toBe("review");
    expect((await marketing.addFiles(approved.id, [jpeg()])).files).toHaveLength(1);
    await expect(marketing.setStatus(approved.id, "published")).rejects.toMatchObject({ code: "forbidden" });
    setActorForTests(USR.livia);
    await marketing.setStatus(approved.id, "approved");
    setActorForTests(USR.julia);
    expect(await marketing.setStatus(approved.id, "published")).toMatchObject({ status: "published", briefing: "Briefing revisado depois da publicação." });
  });

  it("quem aprova altera e anexa arquivos a um material aprovado, que continua aprovado", async () => {
    const approved = await approvedByLivia();
    setActorForTests(USR.livia);
    expect(await marketing.update(approved.id, { title: "Arte ajustada pela diretoria" })).toMatchObject({ status: "approved", title: "Arte ajustada pela diretoria" });
    const withFile = await marketing.addFiles(approved.id, [jpeg()]);
    expect(withFile).toMatchObject({ status: "approved" });
    expect(withFile.files).toHaveLength(1);
  });

  it("a política usada pela interface acompanha o serviço (Editar e Anexar somem depois da aprovação para quem não aprova)", async () => {
    const approved = await approvedByLivia();
    const julia = ctxOf(USR.julia);
    const livia = ctxOf(USR.livia);
    expect(canEditContent(julia, approved)).toBe(true);
    expect(canChangeContent(julia, approved)).toBe(false);
    expect(canChangeContent(julia, { ...approved, status: "published" })).toBe(false);
    expect(canChangeContent(julia, { ...approved, status: "review" })).toBe(true);
    expect(canChangeContent(livia, approved)).toBe(true);
    // Sem poder editar, também não altera (mesmo com o material em produção).
    expect(canChangeContent(ctxOf(USR.marina), { ...approved, status: "production" })).toBe(false);
    // De "Publicado", quem não aprova pode devolver para revisão (para então alterar).
    expect(allowedContentStatuses(julia, { ...approved, status: "published" })).toContain("review");

    // Em todo o seed: quem não pode alterar pela política também é recusado pelo serviço.
    let checked = 0;
    for (const member of getDB().members.filter((m) => m.status === "active")) {
      const ctx = ctxOf(member.id);
      for (const item of getDB().contents) {
        if (!canSeeContent(ctx, item) || !canEditContent(ctx, item) || canChangeContent(ctx, item)) continue;
        checked++;
        await expect(marketing.update(item.id, { notes: "Tentativa de ajuste" })).rejects.toMatchObject({ code: "conflict" });
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
