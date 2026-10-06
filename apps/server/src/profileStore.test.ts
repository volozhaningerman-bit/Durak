import { describe, expect, it } from "vitest";
import { MemoryProfileStore } from "./profileStore.js";

describe("MemoryProfileStore", () => {
  it("records progression only once for the same match", async () => {
    const store = new MemoryProfileStore();
    await store.init();

    await store.recordMatch("m1", ["a", "b"], "b", false);
    await store.recordMatch("m1", ["a", "b"], "b", false);

    const a = await store.getProfile("a");
    const b = await store.getProfile("b");

    expect(a.games).toBe(1);
    expect(a.wins).toBe(1);
    expect(b.games).toBe(1);
    expect(b.losses).toBe(1);
  });

  it("keeps profiles between matches", async () => {
    const store = new MemoryProfileStore();

    await store.recordMatch("m1", ["a", "b"], "b", false);
    await store.recordMatch("m2", ["a", "b"], "a", false);

    const a = await store.getProfile("a");
    expect(a.games).toBe(2);
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);
  });
});
