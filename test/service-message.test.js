import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answerServiceMessage,
  parseMessageText
} from "../src/service-message.js";
import { modelAnswer, stubFetch } from "./support/fakes.js";

const SETTINGS = { apiKey: "key", modelSetting: "openai/gpt-5-mini" };

describe("parseMessageText", () => {
  it("flags text after one dot as a service message", () => {
    const cases = {
      ".be casual": "be casual",
      "．カジュアルに": "カジュアルに",
      "。随便一点": "随便一点",
      ". be casual": "be casual",
      "．　カジュアルに": "カジュアルに",
      ".\nhi": "hi",
      ".…そうか": "…そうか"
    };

    for (const [text, request] of Object.entries(cases)) {
      const expected = { text: request, isService: true };
      assert.deepEqual(parseMessageText(text), expected, text);
    }
  });

  it("keeps ellipses and text without a leading dot as chat", () => {
    for (const text of ["...ok", "..ok", ".．ok", "。。。", "…そうか", "a.b"]) {
      assert.deepEqual(parseMessageText(text), { text }, text);
    }
  });

  it("keeps a dot followed only by blanks as chat", () => {
    for (const text of [".", "．", "。", ".  ", ".\u200B", "．　"]) {
      assert.deepEqual(parseMessageText(text), { text }, JSON.stringify(text));
    }
  });
});

describe("answerServiceMessage", () => {
  it("sends the service instructions", async t => {
    const calls = stubFetch(t, () => modelAnswer("It means hello."));
    const conversation = [{ sender: "Bob", text: "what?", isService: true }];

    await answerServiceMessage(conversation, SETTINGS);

    const [instructions] = JSON.parse(calls[0].init.body).messages;
    assert.match(instructions.content, /^You are the translator/);
  });
});
