import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  fetchGroupMemberName,
  isFromAllowedGroup,
  isFromGroup,
  isSignedByLine,
  isTextMessageWithReplyToken,
  replyToLine,
  truncateForLine
} from "../src/line.js";
import { silenceConsoleError, stubFetch } from "./support/fakes.js";

const SECRET = "channel-secret";
const BODY = new TextEncoder().encode('{"events":[]}');
const sign = (body, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("base64");

describe("isSignedByLine", () => {
  it("accepts a signature made with the channel secret", async () => {
    assert.equal(await isSignedByLine(BODY, sign(BODY), SECRET), true);
  });

  it("rejects a signature made with another secret", async () => {
    const signature = sign(BODY, "other");
    assert.equal(await isSignedByLine(BODY, signature, SECRET), false);
  });

  it("rejects a signature of a different body", async () => {
    assert.equal(await isSignedByLine(BODY, sign("tampered"), SECRET), false);
  });

  it("rejects a missing signature", async () => {
    assert.equal(await isSignedByLine(BODY, null, SECRET), false);
  });

  it("rejects a signature that is not base64", async () => {
    assert.equal(await isSignedByLine(BODY, "%%%", SECRET), false);
  });
});

describe("event filters", () => {
  const textMessage = {
    type: "message",
    replyToken: "reply-token",
    message: { type: "text", text: "hi" },
    source: { type: "group", groupId: "G1", userId: "U1" }
  };

  it("accepts text messages that can be replied to", () => {
    assert.equal(isTextMessageWithReplyToken(textMessage), true);
  });

  it("rejects non-text messages, other events and missing reply tokens", () => {
    for (const change of [
      { message: { type: "sticker" } },
      { type: "follow" },
      { replyToken: undefined }
    ]) {
      const event = { ...textMessage, ...change };
      assert.equal(isTextMessageWithReplyToken(event), false);
    }
  });

  it("tells group messages from 1:1 chats and rooms", () => {
    assert.equal(isFromGroup(textMessage), true);
    const chat = { source: { type: "user", userId: "U1" } };
    const room = { source: { type: "room", roomId: "R1" } };
    assert.equal(isFromGroup(chat), false);
    assert.equal(isFromGroup(room), false);
  });

  it("allows every group when no group is configured", () => {
    assert.equal(isFromAllowedGroup(textMessage, undefined), true);
    assert.equal(isFromAllowedGroup(textMessage, ""), true);
  });

  it("allows only the configured group", () => {
    assert.equal(isFromAllowedGroup(textMessage, "G1"), true);
    assert.equal(isFromAllowedGroup(textMessage, "G2"), false);
  });
});

describe("fetchGroupMemberName", () => {
  it("returns the member's display name in the group", async t => {
    const calls = stubFetch(t, () => Response.json({ displayName: "Alice" }));

    assert.equal(await fetchGroupMemberName("token", "G1", "U1"), "Alice");
    assert.equal(calls[0].url, "https://api.line.me/v2/bot/group/G1/member/U1");
    assert.equal(calls[0].init.headers.Authorization, "Bearer token");
  });

  it("returns Unknown without asking LINE if there is no user id", async t => {
    const calls = stubFetch(t, () => assert.fail("LINE should not be called"));

    const name = await fetchGroupMemberName("token", "G1", undefined);
    assert.equal(name, "Unknown");
    assert.equal(calls.length, 0);
  });

  it("returns Unknown and logs when LINE answers with an error", async t => {
    stubFetch(t, () => new Response("not found", { status: 404 }));
    const logged = silenceConsoleError(t);

    assert.equal(await fetchGroupMemberName("token", "G1", "U1"), "Unknown");
    assert.equal(logged.mock.callCount(), 1);
  });

  it("returns Unknown and logs when the request fails", async t => {
    stubFetch(t, () => {
      throw new Error("network down");
    });
    const logged = silenceConsoleError(t);

    assert.equal(await fetchGroupMemberName("token", "G1", "U1"), "Unknown");
    assert.equal(logged.mock.callCount(), 1);
  });
});

describe("replyToLine", () => {
  it("replies with the text, quoting the original message", async t => {
    const calls = stubFetch(t, () => new Response(""));

    const isReplied = await replyToLine(
      "token",
      "reply-token",
      "Hello",
      "quote-token"
    );

    assert.equal(isReplied, true);
    assert.equal(calls[0].url, "https://api.line.me/v2/bot/message/reply");
    assert.equal(calls[0].init.headers.Authorization, "Bearer token");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      replyToken: "reply-token",
      messages: [{ type: "text", text: "Hello", quoteToken: "quote-token" }]
    });
  });

  it("reports failure and logs when LINE answers with an error", async t => {
    stubFetch(t, () => new Response("invalid reply token", { status: 400 }));
    const logged = silenceConsoleError(t);

    assert.equal(await replyToLine("token", "reply-token", "Hello"), false);
    assert.equal(logged.mock.callCount(), 1);
  });

  it("reports failure and logs when the request fails", async t => {
    stubFetch(t, () => {
      throw new Error("network down");
    });
    const logged = silenceConsoleError(t);

    assert.equal(await replyToLine("token", "reply-token", "Hello"), false);
    assert.equal(logged.mock.callCount(), 1);
  });
});

describe("truncateForLine", () => {
  it("keeps text within LINE's 5000-character limit unchanged", () => {
    const text = "a".repeat(5000);
    assert.equal(truncateForLine(text), text);
  });

  it("cuts longer text to 5000 characters", () => {
    assert.equal(truncateForLine("a".repeat(6000)), "a".repeat(5000));
  });

  it("drops an emoji that would be split at the limit", () => {
    assert.equal(truncateForLine("a".repeat(4999) + "😀"), "a".repeat(4999));
  });
});
