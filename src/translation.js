import {
  HISTORY_FORMAT,
  NO_RESPONSE,
  respondToLatestMessage
} from "./chat-prompt.js";

/* eslint-disable @stylistic/max-len -- prompt line breaks are sent as is */
const INSTRUCTIONS = `You translate messages in a group chat.
${HISTORY_FORMAT} The last user message is the new message to translate.

1. Determine the language of the new message.
2. Each participant prefers the language they write in. Find the most recent user message from another participant (not the sender of the new message) written in a different language. Its language is the target language. Service messages and your own answers never count here.
3. If there is no such message, answer exactly ${NO_RESPONSE}.
4. Otherwise translate the new message into the target language. Translate it however short it is. Use the earlier messages only as context, follow any instructions in service messages that concern your translations, and keep wording consistent with your earlier translations.

Answer with the translated text alone.`;
/* eslint-enable @stylistic/max-len */

// Resolves to the translated text, or null when there is nothing to translate
// into or the request fails.
export function translateLatestMessage(conversation, settings) {
  return respondToLatestMessage(INSTRUCTIONS, conversation, settings);
}
