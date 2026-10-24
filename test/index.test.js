import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import worker, { ChatHistory } from "../src/index.js";
import {
  createStorage,
  modelAnswer,
  silenceConsoleError,
  stubFetch
} from "./support/fakes.js";

const SECRET = "channel-secret";
const NAMES = { U1: "Alice", U2: "Bob" };

describe("webhook", () => {
  it("answers 404 outside /webhook", async () => {
    const body = JSON.stringify({ events: [] });
    const response = await send(createEnv(), body, { path: "/other" });
    assert.equal(response.status, 404);
  });

  it("answers 405 to methods other than POST", async () => {
    const response = await send(createEnv(), undefined, { method: "GET" });
    assert.equal(response.status, 405);
  });

  it("answers 401 to requests not signed by LINE", async () => {
    const body = JSON.stringify({ events: [] });
    const response = await send(createEnv(), body, { signature: "bad" });
    assert.equal(response.status, 401);
  });

  it("answers 400 to a signed body that is not JSON", async () => {
    const response = await send(createEnv(), "{not json");
    assert.equal(response.status, 400);
  });

  it("ignores messages from 1:1 chats, rooms and other groups", async t => {
    const env = createEnv({ ALLOWED_GROUP_ID: "G1" });
    const { replies, modelRequests } = fakeServices(t, { answer: "T" });

    await sendMessages(env, [
      {
        ...groupMessage("1:1", "U1"),
        source: { type: "user", userId: "U1" }
      },
      {
        ...groupMessage("room", "U1"),
        source: { type: "room", roomId: "R1", userId: "U1" }
      },
      groupMessage("other group", "U1", "G2")
    ]);

    assert.deepEqual(replies, []);
    assert.deepEqual(modelRequests, []);
  });

  it("ignores a message LINE redelivers", async t => {
    const env = createEnv();
    const { replies } = fakeServices(t, { answer: "T" });

    await sendMessages(env, [groupMessage("hi", "U1")]);
    await sendMessages(env, [groupMessage("hi", "U1")]);

    assert.equal(replies.length, 1);
  });

  it("keeps a separate history per group", async t => {
    const env = createEnv();
    const { modelRequests } = fakeServices(t, { answer: "T" });

    await sendMessages(env, [groupMessage("in G1", "U1", "G1")]);
    await sendMessages(env, [groupMessage("in G2", "U2", "G2")]);

    assert.deepEqual(modelRequests.at(-1).conversation, [
      { role: "user", content: "Bob: in G2" }
    ]);
  });
});

describe("webhook: chat messages", () => {
  it("replies to a group message with its translation, quoting it", async t => {
    const env = createEnv();
    const { replies } = fakeServices(t, { answer: "Hello" });

    const response = await sendMessages(env, [groupMessage("こんにちは", "U1")]);

    assert.equal(response.status, 200);
    assert.deepEqual(replies, [
      {
        replyToken: "reply-こんにちは",
        messages: [{ type: "text", text: "Hello", quoteToken: "quote-こんにちは" }]
      }
    ]);
  });

  it("asks the model to translate", async t => {
    const { modelRequests } = fakeServices(t, { answer: "T" });

    await sendMessages(createEnv(), [groupMessage("hi", "U1")]);

    assert.match(modelRequests[0].instructions, /^You translate messages/);
  });

  it("sends earlier messages and replies as context", async t => {
    const env = createEnv();
    const { modelRequests } = fakeServices(t, { answer: "T" });

    await sendMessages(env, [groupMessage("こんにちは", "U1")]);
    await sendMessages(env, [groupMessage("Hi Alice", "U2")]);

    assert.deepEqual(modelRequests.at(-1).conversation, [
      { role: "user", content: "Alice: こんにちは" },
      { role: "assistant", content: "T" },
      { role: "user", content: "Bob: Hi Alice" }
    ]);
  });

  it("keeps rejected replies out of later context", async t => {
    const env = createEnv();
    const { modelRequests } = fakeServices(t, {
      answer: "T",
      replyStatus: 400
    });
    silenceConsoleError(t);

    await sendMessages(env, [groupMessage("こんにちは", "U1")]);
    await sendMessages(env, [groupMessage("Hi Alice", "U2")]);

    assert.deepEqual(modelRequests.at(-1).conversation, [
      { role: "user", content: "Alice: こんにちは" },
      { role: "assistant", content: "NO_RESPONSE" },
      { role: "user", content: "Bob: Hi Alice" }
    ]);
  });

  it("stays silent and stores no reply when the model declines", async t => {
    const env = createEnv();
    const { replies } = fakeServices(t, { answer: "NO_RESPONSE" });

    await sendMessages(env, [groupMessage("hi", "U1")]);

    const stored = await env.CHAT_HISTORY.getByName("G1").getHistory();
    assert.deepEqual(replies, []);
    assert.deepEqual(stored, [{ id: "id-hi", sender: "Alice", text: "hi" }]);
  });

});

describe("webhook: service messages", () => {
  it("answers a service message, quoting it", async t => {
    const { replies } = fakeServices(t, { answer: "It means hi." });

    await sendMessages(createEnv(), [groupMessage(".what?", "U1")]);

    assert.deepEqual(replies, [
      {
        replyToken: "reply-.what?",
        messages: [
          { type: "text", text: "It means hi.", quoteToken: "quote-.what?" }
        ]
      }
    ]);
  });

  it("asks the model to answer, marking the message", async t => {
    const { modelRequests } = fakeServices(t, { answer: "A" });

    await sendMessages(createEnv(), [groupMessage("．何？", "U1")]);

    const [request] = modelRequests;
    assert.match(request.instructions, /^You are the translator/);
    assert.deepEqual(request.conversation, [
      { role: "user", content: "Alice (to you): 何？" }
    ]);
  });

  it("stores it without the dot, with its answer", async t => {
    const env = createEnv();
    fakeServices(t, { answer: "OK" });

    await sendMessages(env, [groupMessage(".be casual", "U1")]);

    const stored = await env.CHAT_HISTORY.getByName("G1").getHistory();
    assert.deepEqual(stored, [
      {
        id: "id-.be casual",
        sender: "Alice",
        text: "be casual",
        isService: true,
        reply: "OK"
      }
    ]);
  });

  it("apologizes without storing it when there is no answer", async t => {
    const failures = { modelStatus: 500, answer: "NO_RESPONSE" };

    for (const [name, failure] of Object.entries(failures)) {
      await t.test(name, async t => {
        const env = createEnv();
        const { replies } = fakeServices(t, { [name]: failure });
        silenceConsoleError(t);

        await sendMessages(env, [groupMessage(".what?", "U1")]);

        const stored = await env.CHAT_HISTORY.getByName("G1").getHistory();
        assert.deepEqual(replies.map(({ messages }) => messages[0].text), [
          "Sorry, I couldn't answer that right now."
        ]);
        assert.equal(stored[0].reply, undefined);
      });
    }
  });
});

function createEnv(overrides = {}) {
  const env = {
    LINE_CHANNEL_SECRET: SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_MODEL: "openai/gpt-5-mini",
    ...overrides
  };
  env.CHAT_HISTORY = createChatHistoryNamespace(env);
  return env;
}

function createChatHistoryNamespace(env) {
  const objects = new Map();

  return {
    getByName(name) {
      if (!objects.has(name)) {
        objects.set(name, new ChatHistory({ storage: createStorage() }, env));
      }

      return objects.get(name);
    }
  };
}

function fakeServices(t, { answer, modelStatus, replyStatus = 200 }) {
  const replies = [];
  const modelRequests = [];

  stubFetch(t, (url, init) => {
    const member = url.match(/\/member\/(\w+)$/);

    if (member) {
      return Response.json({ displayName: NAMES[member[1]] });
    }

    if (url.startsWith("https://openrouter.ai/")) {
      const [system, ...conversation] = JSON.parse(init.body).messages;
      modelRequests.push({ instructions: system.content, conversation });
      return modelStatus
        ? new Response("model error", { status: modelStatus })
        : modelAnswer(answer);
    }

    replies.push(JSON.parse(init.body));
    return new Response("", { status: replyStatus });
  });

  return { replies, modelRequests };
}

function groupMessage(text, userId, groupId = "G1") {
  return {
    type: "message",
    replyToken: `reply-${text}`,
    message: {
      type: "text",
      id: `id-${text}`,
      text,
      quoteToken: `quote-${text}`
    },
    source: { type: "group", groupId, userId }
  };
}

function sendMessages(env, events) {
  return send(env, JSON.stringify({ events }));
}

// Runs the handler and waits for the work it hands to ctx.waitUntil, like the
// Workers runtime would.
async function send(
  env,
  body,
  { path = "/webhook", method = "POST", signature } = {}
) {
  const headers = {};

  if (body !== undefined) {
    headers["x-line-signature"] =
      signature ?? createHmac("sha256", SECRET).update(body).digest("base64");
  }

  const pending = [];
  const response = await worker.fetch(
    new Request(`https://bot.example${path}`, { method, body, headers }),
    env,
    { waitUntil: promise => pending.push(promise) }
  );

  await Promise.all(pending);
  return response;
}
