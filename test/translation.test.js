import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translateLatestMessage } from "../src/translation.js";
import { modelAnswer, stubFetch } from "./support/fakes.js";

const SETTINGS = { apiKey: "key", modelSetting: "openai/gpt-5-mini" };

describe("translateLatestMessage", () => {
  it("sends the translation instructions", async t => {
    const calls = stubFetch(t, () => modelAnswer("やあ"));

    await translateLatestMessage([{ sender: "Bob", text: "Hi" }], SETTINGS);

    const [instructions] = JSON.parse(calls[0].init.body).messages;
    assert.match(instructions.content, /^You translate messages/);
  });
});
