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
    expect(await store.getHistory("a", 10)).toHaveLength(1);
  });

  it("keeps profiles between matches", async () => {
    const store = new MemoryProfileStore();

    await store.recordMatch("m1", ["a", "b"], "b", false);
    await store.recordMatch("m2", ["a", "b"], "a", false);

    const a = await store.getProfile("a");
    expect(a.games).toBe(2);
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);

    const history = await store.getHistory("a", 10);
    expect(history).toHaveLength(2);
    expect(history[0].matchId).toBe("m2");
    expect(history[0].result).toBe("loss");
  });

  it("records casual matches without changing Elo", async () => {
    const store = new MemoryProfileStore();

    await store.recordMatch("casual-1", ["a", "b"], "b", false, false);

    const a = await store.getProfile("a");
    const b = await store.getProfile("b");
    expect(a.rating).toBe(1000);
    expect(b.rating).toBe(1000);
    expect(a.wins).toBe(1);
    expect(b.losses).toBe(1);

    const history = await store.getHistory("a", 10);
    expect(history[0].ranked).toBe(false);
    expect(history[0].ratingBefore).toBe(history[0].ratingAfter);
  });

  it("stores public identity and orders leaderboard by rating", async () => {
    const store = new MemoryProfileStore();
    await store.upsertIdentity("a", {
      displayName: "Alice",
      username: "alice"
    });
    await store.upsertIdentity("b", {
      displayName: "Bob"
    });

    await store.recordMatch("m1", ["a", "b"], "b", false);

    const leaderboard = await store.getLeaderboard(10);
    expect(leaderboard[0].playerId).toBe("a");
    expect(leaderboard[0].displayName).toBe("Alice");
    expect(leaderboard[0].username).toBe("alice");
    expect(leaderboard[1].displayName).toBe("Bob");
  });
  it("remembers recent opponents for repeat invitations", async () => {
    const store = new MemoryProfileStore();
    await store.upsertIdentity("a", { displayName: "Alice", username: "alice" });
    await store.upsertIdentity("b", { displayName: "Bob", username: "bob" });
    await store.upsertIdentity("c", { displayName: "Carol" });

    await store.touchContacts(["a", "b", "c"]);

    const contacts = await store.getRecentContacts("a", 10);
    expect(contacts).toHaveLength(2);
    expect(contacts.map((entry) => entry.playerId).sort()).toEqual(["b", "c"]);
    expect(contacts.find((entry) => entry.playerId === "b")?.displayName).toBe("Bob");
  });

  it("uses finish order when splitting ranked rewards", async () => {
    const store = new MemoryProfileStore();
    await store.recordMatch(
      "ranked-order",
      ["a", "b", "c", "d"],
      "d",
      false,
      true,
      ["b", "c", "a"]
    );

    expect((await store.getProfile("b")).rating).toBe(1015);
    expect((await store.getProfile("c")).rating).toBe(1010);
    expect((await store.getProfile("a")).rating).toBe(1005);
    expect((await store.getProfile("d")).rating).toBe(970);
  });

});
