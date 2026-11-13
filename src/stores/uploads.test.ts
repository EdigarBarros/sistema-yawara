import { afterEach, describe, expect, it, vi } from "vitest";
import { settleUploads, useUploads } from "./uploads";

afterEach(() => {
  vi.useRealTimers();
  useUploads.setState({ items: [] });
});

describe("fim da conferência dos envios", () => {
  it("só os envios em conferência citados terminam; envio ainda em andamento não muda", () => {
    vi.useFakeTimers();
    const { upsert } = useUploads.getState();
    upsert({ id: "a", name: "a.pdf", progress: 1, state: "verifying" });
    upsert({ id: "b", name: "b.pdf", progress: 0.4, state: "uploading" });
    upsert({ id: "c", name: "c.pdf", progress: 1, state: "verifying" });

    settleUploads(["a", "b"], true);
    const byId = Object.fromEntries(useUploads.getState().items.map((i) => [i.id, i.state]));
    expect(byId).toEqual({ a: "done", b: "uploading", c: "verifying" });

    settleUploads(["c"], false);
    expect(useUploads.getState().items.find((i) => i.id === "c")?.state).toBe("error");
    vi.advanceTimersByTime(5000);
    expect(useUploads.getState().items.map((i) => i.id)).toEqual(["b"]);
  });
});
