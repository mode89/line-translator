import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askModel, parseModelSetting } from "../src/openrouter.js";
import {
  modelAnswer,
  silenceConsoleError,
  stubFetch
} from "./support/fakes.js";

const MESSAGES = [{ role: "user", content: "Alice: hi" }];
const SETTINGS = { apiKey: "key", modelSetting: "openai/gpt-5-mini:low" };

describe("askModel", () => {
  it("asks OpenRouter with the model, effort and messages", async t => {
    const calls = stubFetch(t, () => modelAnswer("Hello"));

    await askModel(MESSAGES, SETTINGS);

    const { url, init } = calls[0];
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer key");
    assert.deepEqual(JSON.parse(init.body), {
      model: "openai/gpt-5-mini",
      reasoning: { effort: "low" },
      messages: MESSAGES
    });
  });

  it("returns the trimmed answer", async t => {
    stubFetch(t, () => modelAnswer("  How are you?\n"));

    assert.equal(await askModel(MESSAGES, SETTINGS), "How are you?");
  });

  it("returns null when the answer is empty", async t => {
    stubFetch(t, () => Response.json({ choices: [] }));

    assert.equal(await askModel(MESSAGES, SETTINGS), null);
  });

  it("returns null and logs when OpenRouter answers with an error", async t => {
    stubFetch(t, () => new Response("no credits", { status: 402 }));
    const logged = silenceConsoleError(t);

    assert.equal(await askModel(MESSAGES, SETTINGS), null);
    assert.equal(logged.mock.callCount(), 1);
  });

  it("returns null and logs when the request fails", async t => {
    stubFetch(t, () => {
      throw new Error("network down");
    });
    const logged = silenceConsoleError(t);

    assert.equal(await askModel(MESSAGES, SETTINGS), null);
    assert.equal(logged.mock.callCount(), 1);
  });
});

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
