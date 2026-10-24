// Configuration, read from `env`:
// - LINE_CHANNEL_SECRET (secret): verifies that webhook calls come from LINE.
// - LINE_CHANNEL_ACCESS_TOKEN (secret): authorizes calls to the LINE API.
// - OPENROUTER_API_KEY (secret): authorizes calls to OpenRouter.
// - OPENROUTER_MODEL (var in wrangler.jsonc): OpenRouter model id used for
//   translation, optionally followed by ":<effort>" to set the reasoning
//   effort, e.g. "openai/gpt-5-mini:low".
// - ALLOWED_GROUP_ID (optional): when set, only this LINE group is served.
// - HISTORY_LENGTH (optional, default 5): messages kept per group, including
//   the new one, as translation context.

import {
  fetchGroupMemberName,
  isFromAllowedGroup,
  isFromGroup,
  isSignedByLine,
  isTextMessageWithReplyToken,
  replyToLine
} from "./line.js";
import { translateLatestMessage } from "./translation.js";

export { ChatHistory } from "./chat-history.js";

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
