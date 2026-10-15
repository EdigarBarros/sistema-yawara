import { describe, expect, it } from "vitest";
import { stripUndefined } from "./call";

describe("stripUndefined", () => {
  it("remove campos undefined e mantém null explícito", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null, d: { e: undefined, f: "x" }, g: [{ h: undefined, i: 2 }] })).toEqual({
      a: 1,
      c: null,
      d: { f: "x" },
      g: [{ i: 2 }],
    });
  });
});
