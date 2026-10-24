import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import worker, { ChatHistory } from "../src/index.js";
import { createStorage, stubFetch } from "./support/fakes.js";

const SECRET = "channel-secret";
const NAMES = { U1: "Alice", U2: "Bob" };

describe("webhook", () => {
  it("answers 404 outside /webhook", async () => {
    const response = await send(createEnv(), JSON.stringify({ events: [] }), { path: "/other" });
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

  it("replies to a group message with its translation, quoting it", async t => {
    const env = createEnv();
    const { replies } = fakeServices(t, { translation: "Hello" });

    const response = await sendMessages(env, [groupMessage("こんにちは", "U1")]);

    assert.equal(response.status, 200);
    assert.deepEqual(replies, [
      {
        replyToken: "reply-こんにちは",
        messages: [{ type: "text", text: "Hello", quoteToken: "quote-こんにちは" }]
      }
    ]);
  });

  it("sends the group's earlier messages and their senders as context", async t => {
    const env = createEnv();
    const { translationRequests } = fakeServices(t, { translation: "T" });

    await sendMessages(env, [groupMessage("こんにちは", "U1")]);
    await sendMessages(env, [groupMessage("Hi Alice", "U2")]);

    assert.match(translationRequests.at(-1), /```\nAlice: こんにちは\n```/);
    assert.match(translationRequests.at(-1), /Translate the following message of Bob:\n\nHi Alice$/);
  });

  it("keeps a separate history per group", async t => {
    const env = createEnv();
    const { translationRequests } = fakeServices(t, { translation: "T" });

    await sendMessages(env, [groupMessage("in G1", "U1", "G1")]);
    await sendMessages(env, [groupMessage("in G2", "U2", "G2")]);

    assert.doesNotMatch(translationRequests.at(-1), /in G1/);
  });

  it("stays silent when there is nothing to translate into", async t => {
    const { replies } = fakeServices(t, { translation: "NO_TRANSLATION" });

    await sendMessages(createEnv(), [groupMessage("hi", "U1")]);

    assert.deepEqual(replies, []);
  });

  it("ignores messages from 1:1 chats, rooms and other groups", async t => {
    const env = createEnv({ ALLOWED_GROUP_ID: "G1" });
    const { replies, translationRequests } = fakeServices(t, { translation: "T" });

    await sendMessages(env, [
      { ...groupMessage("1:1", "U1"), source: { type: "user", userId: "U1" } },
      { ...groupMessage("room", "U1"), source: { type: "room", roomId: "R1", userId: "U1" } },
      groupMessage("other group", "U1", "G2")
    ]);

    assert.deepEqual(replies, []);
    assert.deepEqual(translationRequests, []);
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

function fakeServices(t, { translation }) {
  const replies = [];
  const translationRequests = [];

  stubFetch(t, (url, init) => {
    const member = url.match(/\/member\/(\w+)$/);

    if (member) {
      return Response.json({ displayName: NAMES[member[1]] });
    }

    if (url.startsWith("https://openrouter.ai/")) {
      translationRequests.push(JSON.parse(init.body).messages[1].content);
      return Response.json({ choices: [{ message: { content: translation } }] });
    }

    replies.push(JSON.parse(init.body));
    return new Response("");
  });

  return { replies, translationRequests };
}

function groupMessage(text, userId, groupId = "G1") {
  return {
    type: "message",
    replyToken: `reply-${text}`,
    message: { type: "text", text, quoteToken: `quote-${text}` },
    source: { type: "group", groupId, userId }
  };
}

function sendMessages(env, events) {
  return send(env, JSON.stringify({ events }));
}

// Runs the handler and waits for the work it hands to ctx.waitUntil, like the Workers runtime would.
async function send(env, body, { path = "/webhook", method = "POST", signature } = {}) {
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
