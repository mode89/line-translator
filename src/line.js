const LINE_MAX_TEXT_LENGTH = 5000;
const UNKNOWN_SENDER = "Unknown";

export async function isSignedByLine(rawBody, signature, channelSecret) {
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

export function isTextMessageWithReplyToken(event) {
  return (
    event.type === "message" &&
    event.message?.type === "text" &&
    Boolean(event.replyToken)
  );
}

export function isFromGroup(event) {
  return Boolean(event.source?.groupId);
}

export function isFromAllowedGroup(event, allowedGroupId) {
  return !allowedGroupId || event.source?.groupId === allowedGroupId;
}

export async function fetchGroupMemberName(accessToken, groupId, userId) {
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

export async function replyToLine(accessToken, replyToken, text, quoteToken) {
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

export function truncateForLine(text) {
  if (text.length <= LINE_MAX_TEXT_LENGTH) {
    return text;
  }

  const cut = text.slice(0, LINE_MAX_TEXT_LENGTH);
  const lastCode = cut.charCodeAt(cut.length - 1);

  // Drop a dangling high surrogate so an emoji is not split in half.
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut;
}
