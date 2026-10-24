const LINE_MAX_TEXT_LENGTH = 5000;

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
      .filter(event => isFromAllowedGroup(event, env.ALLOWED_GROUP_ID));

    // LINE needs a fast 200; replies are sent after responding.
    ctx.waitUntil(
      Promise.all(
        messages.map(event =>
          replyToLine(
            env.LINE_CHANNEL_ACCESS_TOKEN,
            event.replyToken,
            event.message.text
          )
        )
      )
    );

    return new Response("OK", { status: 200 });
  }
};

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

function isFromAllowedGroup(event, allowedGroupId) {
  return !allowedGroupId || event.source?.groupId === allowedGroupId;
}

async function replyToLine(accessToken, replyToken, text) {
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
          messages: [{ type: "text", text: truncateForLine(text) }]
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
