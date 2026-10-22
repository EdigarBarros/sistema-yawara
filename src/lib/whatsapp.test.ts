import { describe, expect, it } from "vitest";
import { whatsappLink, whatsappNumber } from "./whatsapp";

describe("whatsapp", () => {
  it("normaliza telefones brasileiros", () => {
    expect(whatsappNumber("(71) 99999-1234")).toBe("5571999991234");
    expect(whatsappNumber("071 3333-1234")).toBe("557133331234");
    expect(whatsappNumber("+55 71 99999-1234")).toBe("5571999991234");
  });

  it("ignora e-mail, vazio e números curtos", () => {
    expect(whatsappNumber("ana@example.org")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber("12345")).toBeNull();
  });

  it("monta o link com a mensagem codificada", () => {
    expect(whatsappLink("Oi, tudo bem?", "71999991234")).toBe("https://wa.me/5571999991234?text=Oi%2C%20tudo%20bem%3F");
    expect(whatsappLink("Números livres")).toBe("https://wa.me/?text=N%C3%BAmeros%20livres");
  });
});
