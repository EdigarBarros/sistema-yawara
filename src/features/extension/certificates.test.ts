import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionProject } from "@/types";

/** Ordem dos acontecimentos: registro na auditoria x entrega do arquivo. */
const events: string[] = [];

vi.mock("@/lib/export/common", () => {
  const fakeDoc = new Proxy(
    {
      internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
      splitTextToSize: (text: string) => [text],
      save: (name: string) => events.push(`save:${name}`),
    } as Record<string, unknown>,
    // Demais métodos do jsPDF viram funções vazias ("then" fica de fora: não é uma promessa).
    { get: (target, key: string) => (key in target ? target[key] : key === "then" ? undefined : () => undefined) },
  );
  return {
    createPdf: async () => fakeDoc,
    loadLogo: async () => null,
    PDF_COLORS: { navy: [0, 0, 0], gold: [0, 0, 0] },
    slugify: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
  };
});

const { attendanceRows, exportCertificatesPdf } = await import("./certificates");

function project(): ExtensionProject {
  return {
    id: "prj-teste",
    code: "EXT-2026-001",
    name: "Palestra Teste",
    activityType: "palestra",
    date: "2026-10-10",
    attendees: [
      { id: "a1", name: "Participante Fictício Um", present: true },
      { id: "a2", name: "Participante Fictício Dois", present: false },
      { id: "a3", name: "Participante Fictício Três", present: true },
    ],
  } as unknown as ExtensionProject;
}

beforeEach(() => {
  events.length = 0;
});

describe("certificados: a auditoria vem antes da entrega do arquivo", () => {
  it("aguarda o registro (com o número de certificados) antes de salvar o PDF", async () => {
    const n = await exportCertificatesPdf(project(), "Responsável Fictícia", {
      onBeforeSave: async (count) => {
        await new Promise((r) => setTimeout(r, 20));
        events.push(`audit:${count}`);
      },
    });
    expect(n).toBe(2);
    expect(events).toEqual(["audit:2", "save:certificados-palestra-teste.pdf"]);
  });

  it("sem participantes presentes: nada é registrado nem salvo", async () => {
    const p = project();
    p.attendees.forEach((a) => (a.present = false));
    const onBeforeSave = vi.fn();
    await expect(exportCertificatesPdf(p, "Responsável Fictícia", { onBeforeSave })).rejects.toThrow(/Nenhum participante/);
    expect(onBeforeSave).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("lista de presença em CSV usa os dados registrados", () => {
    expect(attendanceRows(project())).toEqual([
      ["participante", "presenca"],
      ["Participante Fictício Um", "Presente"],
      ["Participante Fictício Dois", "Ausente"],
      ["Participante Fictício Três", "Presente"],
    ]);
  });
});
