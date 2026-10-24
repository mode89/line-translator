import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatHistory, historyLength } from "../src/chat-history.js";
import { createStorage } from "./support/fakes.js";

const createChatHistory = (env = {}) =>
  new ChatHistory({ storage: createStorage() }, env);

describe("ChatHistory", () => {
  it("returns stored messages, oldest first, with the new one", async () => {
    const history = createChatHistory();

    await history.addMessage("first");
    assert.deepEqual(await history.addMessage("second"), ["first", "second"]);
    assert.deepEqual(await history.getHistory(), ["first", "second"]);
  });

  it("keeps only the latest HISTORY_LENGTH messages", async () => {
    const history = createChatHistory({ HISTORY_LENGTH: "3" });

    for (const message of [1, 2, 3, 4]) {
      await history.addMessage(message);
    }

    assert.deepEqual(await history.getHistory(), [2, 3, 4]);
  });

  it("starts empty and can be cleared", async () => {
    const history = createChatHistory();
    assert.deepEqual(await history.getHistory(), []);

    await history.addMessage("hi");
    await history.clearHistory();

    assert.deepEqual(await history.getHistory(), []);
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
