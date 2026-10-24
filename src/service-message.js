import { HISTORY_FORMAT, respondToLatestMessage } from "./chat-prompt.js";

export const SERVICE_FAILURE_TEXT = "Sorry, I couldn't answer that right now.";

const DOTS = ".．。";
// Zero-width characters look blank but \s does not match them.
const BLANK = String.raw`\s\u200B-\u200D\u2060`;
// One dot, then text; two dots in a row, as in "...", start ordinary chat.
const SERVICE_PREFIX = new RegExp(
  `^[${DOTS}](?![${DOTS}])[${BLANK}]*(?=[^${BLANK}])`,
  "u"
);

/* eslint-disable @stylistic/max-len -- prompt line breaks are sent as is */
const INSTRUCTIONS = `You are the translator of a group chat. You translate each message into the language of the other participants. Each person's messages keep going into the language you last translated them into; a service message can change that. Instructions in service messages guide your translations for as long as they stay in the recent chat history you are shown.
${HISTORY_FORMAT} The last user message is a new service message for you.

Respond to it in the language it is written in, doing what it asks as well as you can. If it changes how you translate, briefly confirm how you will apply it.

Answer with the text to post in the chat alone.`;
/* eslint-enable @stylistic/max-len */

// Returns the text to store: a service message loses its dot and is flagged.
export function parseMessageText(text) {
  const prefix = text.match(SERVICE_PREFIX);
  return prefix
    ? { text: text.slice(prefix[0].length), isService: true }
    : { text };
}

// Resolves to the answer, or null when the request fails or yields none.
export function answerServiceMessage(conversation, settings) {
  return respondToLatestMessage(INSTRUCTIONS, conversation, settings);
}
