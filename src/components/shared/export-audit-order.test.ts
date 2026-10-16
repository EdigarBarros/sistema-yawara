/**
 * Exportações com registro na auditoria: o registro é AGUARDADO antes de o
 * arquivo ser entregue. Se ele fosse disparado depois do download (sem
 * esperar), fechar ou recarregar a aba logo em seguida perdia o registro sem
 * aviso (por exemplo, durante o início a frio da função).
 *
 * Os testes rodam sem navegador; por isso esta verificação lê o código das
 * telas: em cada ponto de entrega, o trecho do `try` até a entrega precisa
 * conter `await ...recordExport(`. A ordem dentro dos certificados é testada
 * em src/features/extension/certificates.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Pontos de entrega de arquivo com dados que exigem registro de exportação. */
const DELIVERIES: { file: string; deliver: RegExp[] }[] = [
  { file: "src/app/(app)/extensao/[id]/page.tsx", deliver: [/\bdownloadCsv\(/g] },
  { file: "src/app/(app)/secretaria/[id]/page.tsx", deliver: [/\bexportMeetingPdf\(/g] },
  { file: "src/app/(app)/financeiro/relatorios/page.tsx", deliver: [/\bexportFinanceCsv\(/g, /\bdownloadBlob\(/g] },
  { file: "src/features/campaigns/export-dialog.tsx", deliver: [/\bexportCsv\(ctx\)/g, /\bexportPdf\(ctx\)/g, /\bexportPng\(ctx\)/g] },
];

const AWAITED_AUDIT = /await\s+(recordExport|services\.audit\s*\.recordExport)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("exportações: auditoria registrada antes da entrega do arquivo", () => {
  for (const { file, deliver } of DELIVERIES) {
    it(file, () => {
      const source = read(file);
      let found = 0;
      for (const pattern of deliver) {
        for (const match of source.matchAll(pattern)) {
          found++;
          const at = match.index!;
          const handler = source.slice(source.lastIndexOf("try {", at), at);
          expect(handler, `${file}: ${match[0]} sem registro aguardado antes`).toMatch(AWAITED_AUDIT);
        }
      }
      expect(found, `${file}: ponto de entrega não encontrado`).toBeGreaterThan(0);
    });
  }

  it("certificados: o registro é passado para rodar antes de salvar o PDF", () => {
    expect(read("src/app/(app)/extensao/[id]/page.tsx")).toMatch(/exportCertificatesPdf\([^;]*onBeforeSave:\s*\(count\)\s*=>\s*recordExport\(/);
  });

  it("nenhuma tela dispara o registro sem esperar por ele", () => {
    const offenders = sourceFiles("src")
      .filter((file) => !file.startsWith(join("src", "services")))
      .filter((file) => /void\s+(services\.audit|recordExport\()/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
