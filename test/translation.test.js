import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseModelSetting,
  toPromptMessages,
  translateLatestMessage
} from "../src/translation.js";
import { silenceConsoleError, stubFetch } from "./support/fakes.js";

const CONVERSATION = [
  { sender: "Alice", text: "こんにちは", translation: "Hello" },
  { sender: "Bob", text: "Hi Alice" },
  { sender: "Alice", text: "元気？\n二行目" }
];

const SETTINGS = { apiKey: "key", modelSetting: "openai/gpt-5-mini:low" };

const answer = content =>
  Response.json({ choices: [{ message: { content } }] });

describe("parseModelSetting", () => {
  it("uses a plain model id as is", () => {
    assert.deepEqual(parseModelSetting("openai/gpt-5-mini"), {
      model: "openai/gpt-5-mini"
    });
  });

  it("splits off a reasoning effort suffix", () => {
    assert.deepEqual(parseModelSetting("openai/gpt-5-mini:low"), {
      model: "openai/gpt-5-mini",
      reasoning: { effort: "low" }
    });
  });

  it("keeps OpenRouter variant suffixes as part of the model id", () => {
    assert.deepEqual(parseModelSetting("deepseek/deepseek-r1:free"), {
      model: "deepseek/deepseek-r1:free"
    });
  });

  it("splits off an effort that follows a variant suffix", () => {
    assert.deepEqual(parseModelSetting("deepseek/deepseek-r1:free:high"), {
      model: "deepseek/deepseek-r1:free",
      reasoning: { effort: "high" }
    });
  });

  it("does not treat a bare effort as an effort suffix", () => {
    assert.deepEqual(parseModelSetting(":high"), { model: ":high" });
  });
});

describe("toPromptMessages", () => {
  it("follows each earlier message with the bot's answer", () => {
    assert.deepEqual(toPromptMessages(CONVERSATION), [
      { role: "user", content: "Alice: こんにちは" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Bob: Hi Alice" },
      { role: "assistant", content: "NO_RESPONSE" },
      { role: "user", content: "Alice: 元気？\n二行目" }
    ]);
  });

  it("sends only the new message when there is no history", () => {
    assert.deepEqual(toPromptMessages([{ sender: "Alice", text: "hi" }]), [
      { role: "user", content: "Alice: hi" }
    ]);
  });
});

describe("translateLatestMessage", () => {
  it("asks OpenRouter with the model, effort and conversation", async t => {
    const calls = stubFetch(t, () => answer("Hello"));

    await translateLatestMessage(CONVERSATION, SETTINGS);

    const { url, init } = calls[0];
    const body = JSON.parse(init.body);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer key");
    assert.equal(body.model, "openai/gpt-5-mini");
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.messages[0].role, "system");
    assert.deepEqual(body.messages.slice(1), toPromptMessages(CONVERSATION));
  });

  it("returns the trimmed translation", async t => {
    stubFetch(t, () => answer("  How are you?\n"));

    const translation = await translateLatestMessage(CONVERSATION, SETTINGS);
    assert.equal(translation, "How are you?");
  });

  it("returns null when the model finds nothing to translate into", async t => {
    stubFetch(t, () => answer("NO_RESPONSE"));

    assert.equal(await translateLatestMessage(CONVERSATION, SETTINGS), null);
  });

  it("returns null when the answer is empty", async t => {
    stubFetch(t, () => Response.json({ choices: [] }));

    assert.equal(await translateLatestMessage(CONVERSATION, SETTINGS), null);
  });

  it("returns null and logs when OpenRouter answers with an error", async t => {
    stubFetch(t, () => new Response("no credits", { status: 402 }));
    const logged = silenceConsoleError(t);

    assert.equal(await translateLatestMessage(CONVERSATION, SETTINGS), null);
    assert.equal(logged.mock.callCount(), 1);
  });

  it("returns null and logs when the request fails", async t => {
    stubFetch(t, () => {
      throw new Error("network down");
    });
    const logged = silenceConsoleError(t);

    assert.equal(await translateLatestMessage(CONVERSATION, SETTINGS), null);
    assert.equal(logged.mock.callCount(), 1);
  });
});
