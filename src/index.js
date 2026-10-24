// Configuration, read from `env`:
// - LINE_CHANNEL_SECRET (secret): verifies that webhook calls come from LINE.
// - LINE_CHANNEL_ACCESS_TOKEN (secret): authorizes calls to the LINE API.
// - OPENROUTER_API_KEY (secret): authorizes calls to OpenRouter.
// - OPENROUTER_MODEL (var in wrangler.jsonc): OpenRouter model id used for translation, optionally
//   followed by ":<effort>" to set the reasoning effort, e.g. "openai/gpt-5-mini:low".
// - ALLOWED_GROUP_ID (optional): when set, only this LINE group is served.
// - HISTORY_LENGTH (optional, default 5): messages kept per group, including the new one, as translation context.

import { DurableObject } from "cloudflare:workers";

const LINE_MAX_TEXT_LENGTH = 5000;
const UNKNOWN_SENDER = "Unknown";
const DEFAULT_HISTORY_LENGTH = 5;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" }
      });
    }

    const rawBody = await request.arrayBuffer();
    const signature = request.headers.get("x-line-signature");

    if (!(await isSignedByLine(rawBody, signature, env.LINE_CHANNEL_SECRET))) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload;

    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const messages = (payload?.events ?? [])
      .filter(isTextMessageWithReplyToken)
      .filter(isFromGroup)
      .filter(event => isFromAllowedGroup(event, env.ALLOWED_GROUP_ID));

    // LINE needs a fast 200; replies are sent after responding.
    ctx.waitUntil(
      Promise.all(messages.map(event => replyWithTranslation(env, event)))
    );

    return new Response("OK", { status: 200 });
  }
};

export class ChatHistory extends DurableObject {
  async addMessage(message) {
    const history = (await this.ctx.storage.get("history")) ?? [];
    history.push(message);
    const latest = history.slice(-historyLength(this.env));
    await this.ctx.storage.put("history", latest);
    return latest;
  }

  async getHistory() {
    return (await this.ctx.storage.get("history")) ?? [];
  }

  async clearHistory() {
    await this.ctx.storage.delete("history");
  }
}

function historyLength(env) {
  const length = Number(env.HISTORY_LENGTH);
  return Number.isInteger(length) && length > 0 ? length : DEFAULT_HISTORY_LENGTH;
}

async function replyWithTranslation(env, event) {
  const { groupId, userId } = event.source;
  const sender = await fetchGroupMemberName(
    env.LINE_CHANNEL_ACCESS_TOKEN,
    groupId,
    userId
  );

  const history = env.CHAT_HISTORY.getByName(groupId);
  const conversation = await history.addMessage({
    sender,
    text: event.message.text
  });

  const translation = await translateLatestMessage(conversation, {
    apiKey: env.OPENROUTER_API_KEY,
    modelSetting: env.OPENROUTER_MODEL
  });

  if (!translation) {
    return;
  }

  await replyToLine(
    env.LINE_CHANNEL_ACCESS_TOKEN,
    event.replyToken,
    translation,
    event.message.quoteToken
  );
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NO_TRANSLATION = "NO_TRANSLATION";
const HISTORY_SEPARATOR = "\n---\n";
const REASONING_EFFORTS = ["xhigh", "high", "medium", "low", "minimal", "none"];

const INSTRUCTIONS = `You translate messages in a group chat.
You get the recent chat history, oldest first, as "sender: text" entries separated by "---", followed by a new message to translate.

1. Determine the language of the new message.
2. Each participant prefers the language they write in. Find the most recent history message from another participant (not the sender of the new message) written in a different language. Its language is the target language.
3. If there is no such message, answer exactly ${NO_TRANSLATION}.
4. Otherwise translate the new message into the target language. Translate it however short it is. Use the history only as context.

Answer with the translated text alone.`;

// Resolves to the translated text, or null when there is nothing to translate into or the request fails.
async function translateLatestMessage(conversation, { apiKey, modelSetting }) {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...parseModelSetting(modelSetting),
        messages: [
          { role: "system", content: INSTRUCTIONS },
          { role: "user", content: formatTranslationRequest(conversation) }
        ]
      })
    });

    if (!response.ok) {
      console.error(
        "OpenRouter translation failed:",
        response.status,
        await response.text()
      );
      return null;
    }

    const answer = (await response.json()).choices?.[0]?.message?.content?.trim();

    return !answer || answer === NO_TRANSLATION ? null : answer;
  } catch (error) {
    console.error("OpenRouter translation failed:", error);
    return null;
  }
}

// OpenRouter model ids may already carry ":" variants (e.g. ":free"), so only a known effort suffix is split off.
function parseModelSetting(setting) {
  const separator = setting.lastIndexOf(":");
  const effort = setting.slice(separator + 1);

  if (separator > 0 && REASONING_EFFORTS.includes(effort)) {
    return { model: setting.slice(0, separator), reasoning: { effort } };
  }

  return { model: setting };
}

function formatTranslationRequest(conversation) {
  const history = conversation.slice(0, -1);
  const { sender, text } = conversation.at(-1);

  return [
    "History:",
    "",
    "```",
    history.map(formatHistoryEntry).join(HISTORY_SEPARATOR),
    "```",
    "",
    `Translate the following message of ${sender}:`,
    "",
    text
  ].join("\n");
}

function formatHistoryEntry({ sender, text }) {
  return `${sender}: ${text}`;
}

async function isSignedByLine(rawBody, signature, channelSecret) {
  if (!signature) {
    return false;
  }

  let sentDigest;

  try {
    sentDigest = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return crypto.subtle.verify("HMAC", key, sentDigest, rawBody);
}

function isTextMessageWithReplyToken(event) {
  return (
    event.type === "message" &&
    event.message?.type === "text" &&
    Boolean(event.replyToken)
  );
}

function isFromGroup(event) {
  return Boolean(event.source?.groupId);
}

function isFromAllowedGroup(event, allowedGroupId) {
  return !allowedGroupId || event.source?.groupId === allowedGroupId;
}

async function fetchGroupMemberName(accessToken, groupId, userId) {
  if (!userId) {
    return UNKNOWN_SENDER;
  }

  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      console.error(
        "LINE member lookup failed:",
        response.status,
        await response.text()
      );
      return UNKNOWN_SENDER;
    }

    return (await response.json()).displayName ?? UNKNOWN_SENDER;
  } catch (error) {
    console.error("LINE member lookup failed:", error);
    return UNKNOWN_SENDER;
  }
}

async function replyToLine(accessToken, replyToken, text, quoteToken) {
  try {
    const response = await fetch(
      "https://api.line.me/v2/bot/message/reply",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: "text", text: truncateForLine(text), quoteToken }]
        })
      }
    );

    if (!response.ok) {
      console.error(
        "LINE reply failed:",
        response.status,
        await response.text()
      );
    }
  } catch (error) {
    console.error("LINE reply failed:", error);
  }
}

function truncateForLine(text) {
  if (text.length <= LINE_MAX_TEXT_LENGTH) {
    return text;
  }

  const cut = text.slice(0, LINE_MAX_TEXT_LENGTH);
  const lastCode = cut.charCodeAt(cut.length - 1);

  // Drop a dangling high surrogate so an emoji is not split in half.
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut;
}
