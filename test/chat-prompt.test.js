import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { respondToLatestMessage } from "../src/chat-prompt.js";
import { modelAnswer, stubFetch } from "./support/fakes.js";

const SETTINGS = { apiKey: "key", modelSetting: "openai/gpt-5-mini" };

describe("respondToLatestMessage", () => {
  it("sends the instructions, then the conversation as turns", async t => {
    const calls = stubFetch(t, () => modelAnswer("A"));
    const conversation = [
      { sender: "Alice", text: "こんにちは", reply: "Hello" },
      { sender: "Bob", text: "Hi Alice" },
      { sender: "Alice", text: "元気？\n二行目" }
    ];

    await respondToLatestMessage("Do it.", conversation, SETTINGS);

    assert.deepEqual(JSON.parse(calls[0].init.body).messages, [
      { role: "system", content: "Do it." },
      { role: "user", content: "Alice: こんにちは" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Bob: Hi Alice" },
      { role: "assistant", content: "NO_RESPONSE" },
      { role: "user", content: "Alice: 元気？\n二行目" }
    ]);
  });

  it("marks service messages as addressed to the model", async t => {
    const calls = stubFetch(t, () => modelAnswer("A"));
    const conversation = [
      { sender: "Bob", text: "be casual", isService: true, reply: "OK" },
      { sender: "Bob", text: "what?", isService: true }
    ];

    await respondToLatestMessage("Do it.", conversation, SETTINGS);

    assert.deepEqual(JSON.parse(calls[0].init.body).messages.slice(1), [
      { role: "user", content: "Bob (to you): be casual" },
      { role: "assistant", content: "OK" },
      { role: "user", content: "Bob (to you): what?" }
    ]);
  });

  it("returns the model's answer", async t => {
    stubFetch(t, () => modelAnswer("Hello"));

    const conversation = [{ sender: "Alice", text: "hi" }];
    const reply = await respondToLatestMessage("", conversation, SETTINGS);
    assert.equal(reply, "Hello");
  });

  it("returns null when the model answers NO_RESPONSE", async t => {
    stubFetch(t, () => modelAnswer("NO_RESPONSE"));

    const conversation = [{ sender: "Alice", text: "hi" }];
    const reply = await respondToLatestMessage("", conversation, SETTINGS);
    assert.equal(reply, null);
  });
});
