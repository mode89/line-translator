import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatHistory, historyLength } from "../src/chat-history.js";
import { createStorage } from "./support/fakes.js";

const createChatHistory = (env = {}) =>
  new ChatHistory({ storage: createStorage() }, env);

const entry = id => ({ id, sender: "Alice", text: `text ${id}` });

describe("ChatHistory", () => {
  it("returns stored messages, oldest first, with the new one", async () => {
    const history = createChatHistory();

    await history.addMessage(entry("m1"));
    const conversation = await history.addMessage(entry("m2"));

    assert.deepEqual(conversation, [entry("m1"), entry("m2")]);
    assert.deepEqual(await history.getHistory(), conversation);
  });

  it("ignores a redelivered message and resolves to null", async () => {
    const history = createChatHistory();
    await history.addMessage(entry("m1"));

    assert.equal(await history.addMessage(entry("m1")), null);
    assert.deepEqual(await history.getHistory(), [entry("m1")]);
  });

  it("keeps only the latest HISTORY_LENGTH messages", async () => {
    const history = createChatHistory({ HISTORY_LENGTH: "3" });

    for (const id of ["m1", "m2", "m3", "m4"]) {
      await history.addMessage(entry(id));
    }

    assert.deepEqual(await history.getHistory(), [
      entry("m2"),
      entry("m3"),
      entry("m4")
    ]);
  });

  it("starts empty and can be cleared", async () => {
    const history = createChatHistory();
    assert.deepEqual(await history.getHistory(), []);

    await history.addMessage(entry("m1"));
    await history.clearHistory();

    assert.deepEqual(await history.getHistory(), []);
  });
});

describe("ChatHistory.recordTranslation", () => {
  it("stores the translation on the message with that id", async () => {
    const history = createChatHistory();
    await history.addMessage({ id: "m1", text: "こんにちは" });
    await history.addMessage({ id: "m2", text: "元気？" });

    await history.recordTranslation("m1", "Hello");

    assert.deepEqual(await history.getHistory(), [
      { id: "m1", text: "こんにちは", translation: "Hello" },
      { id: "m2", text: "元気？" }
    ]);
  });

  it("ignores a message that has left the history", async () => {
    const history = createChatHistory({ HISTORY_LENGTH: "1" });
    await history.addMessage({ id: "m1", text: "old" });
    await history.addMessage({ id: "m2", text: "new" });

    await history.recordTranslation("m1", "T");

    assert.deepEqual(await history.getHistory(), [{ id: "m2", text: "new" }]);
  });
});

describe("historyLength", () => {
  it("uses HISTORY_LENGTH when it is a positive whole number", () => {
    assert.equal(historyLength({ HISTORY_LENGTH: "3" }), 3);
    assert.equal(historyLength({ HISTORY_LENGTH: 8 }), 8);
  });

  it("falls back to 5 when HISTORY_LENGTH is missing or invalid", () => {
    for (const value of [undefined, "", "abc", "0", "-2", "2.5"]) {
      assert.equal(
        historyLength({ HISTORY_LENGTH: value }),
        5,
        `HISTORY_LENGTH=${value}`
      );
    }
  });
});
