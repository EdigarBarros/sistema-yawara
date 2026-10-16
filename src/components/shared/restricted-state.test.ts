/**
 * RestrictedState na rota de um módulo desativado: diz que o módulo foi
 * desativado (e não que falta permissão ao cargo). Sem navegador: a rota e o
 * acesso são substituídos, e o componente é chamado como função.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const route = vi.hoisted(() => ({ pathname: "/marketing", disabled: [] as string[] }));

vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/hooks/use-access", () => ({ useAccess: () => ({ moduleEnabled: (m: string) => !route.disabled.includes(m) }) }));

const { RestrictedState } = await import("./states");

type Props = { title: string; description?: unknown };
const render = (props: Parameters<typeof RestrictedState>[0] = {}) => (RestrictedState(props) as ReactElement<Props>).props;

beforeEach(() => {
  route.pathname = "/marketing";
  route.disabled = [];
});

describe("RestrictedState: módulo desativado x falta de permissão", () => {
  it("rota de módulo desativado (Marketing): avisa que foi desativado nas Configurações", () => {
    route.disabled = ["marketing"];
    const props = render();
    expect(props.title).toBe("Módulo desativado");
    expect(props.description).toBe("O módulo Marketing foi desativado nas Configurações. Os dados foram mantidos e voltam quando o módulo for reativado.");
  });

  it("sub-rota de outro módulo desativado também (Financeiro > Relatórios)", () => {
    route.pathname = "/financeiro/relatorios";
    route.disabled = ["finance"];
    expect(render({ title: "Relatórios restritos", description: "Texto da tela." }).title).toBe("Módulo desativado");
  });

  it("módulo ativo: mantém o aviso de permissão (padrão ou texto da tela)", () => {
    route.disabled = ["finance"];
    const props = render();
    expect(props.title).toBe("Área não disponível para este perfil");
    expect(String(props.description)).not.toMatch(/desativado/);
    expect(render({ title: "Auditoria restrita", description: "Texto da tela." })).toMatchObject({ title: "Auditoria restrita", description: "Texto da tela." });
  });
});
