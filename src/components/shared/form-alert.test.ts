/**
 * FormAlert: o erro devolvido pelo servidor rola até ficar visível.
 *
 * Os testes rodam sem navegador: os hooks do React são substituídos para
 * capturar o efeito do componente e executá-lo com um elemento falso.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

type Effect = { run: () => void | (() => void); deps?: unknown[] };
const effects: Effect[] = [];
const ref: { current: unknown } = { current: null };

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (run: Effect["run"], deps?: unknown[]) => void effects.push({ run, deps }),
  useRef: () => ref,
}));

const { FormAlert } = await import("./form-alert");

function render(props: Parameters<typeof FormAlert>[0]) {
  effects.length = 0;
  const element = FormAlert(props) as ReactElement<{ role?: string }> | null;
  return { element, effect: effects[effects.length - 1] };
}

let reduceMotion = false;
beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("reduce") && reduceMotion }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  ref.current = null;
});

describe("FormAlert: aviso de erro do servidor sempre visível", () => {
  it("sem mensagem: não mostra nada nem rola", () => {
    const scrollIntoView = vi.fn();
    const { element, effect } = render({ message: undefined });
    expect(element).toBeNull();
    ref.current = { scrollIntoView };
    effect.run();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("quando o erro aparece, rola só o necessário até ele (block: nearest)", () => {
    const scrollIntoView = vi.fn();
    const { element, effect } = render({ message: "Este módulo está desativado nas configurações." });
    expect(element?.props.role).toBe("alert");
    ref.current = { scrollIntoView };
    effect.run();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });

  it("rola de novo quando a mensagem muda (dependência do efeito)", () => {
    expect(render({ message: "Primeiro erro." }).effect.deps).toEqual(["Primeiro erro."]);
    expect(render({ message: "Outro erro." }).effect.deps).toEqual(["Outro erro."]);
  });

  it("respeita a preferência por menos movimento", () => {
    reduceMotion = true;
    const scrollIntoView = vi.fn();
    const { effect } = render({ message: "Seu perfil não pode registrar vendas nesta campanha." });
    ref.current = { scrollIntoView };
    effect.run();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });
});

/** Formulários longos (rodapé fixo) e telas de acesso: o erro do servidor usa o FormAlert. */
const FORMS = [
  "src/app/login/page.tsx",
  "src/app/convite/page.tsx",
  "src/features/finance/entry-form-dialog.tsx",
  "src/features/events/event-form-dialog.tsx",
  "src/features/extension/project-form-dialog.tsx",
  "src/features/marketing/content-form-dialog.tsx",
  "src/features/campaigns/sale-dialogs.tsx",
  "src/features/documents/document-form-dialog.tsx",
  "src/app/(app)/configuracoes/page.tsx",
];

describe("formulários usam o FormAlert para o erro do servidor", () => {
  for (const file of FORMS) {
    it(file, () => {
      const source = readFileSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)), "utf8");
      expect(source).toMatch(/<FormAlert message=\{(serverError|error)\}/);
      // Nenhum aviso de erro do servidor montado à mão (sem rolar até ele).
      expect(source).not.toMatch(/\{(serverError|error) && \(?\s*<(p|div)\b[^>]*role="alert"/);
      expect(source).not.toMatch(/\{error && <p className="mt-3 text-\[13px\] text-danger">/);
    });
  }
});
