import {
  HISTORY_FORMAT,
  NO_RESPONSE,
  respondToLatestMessage
} from "./chat-prompt.js";

/* eslint-disable @stylistic/max-len -- prompt line breaks are sent as is */
const INSTRUCTIONS = `You translate messages in a group chat.
${HISTORY_FORMAT} The last user message is the new message to translate.

1. Determine the language of the new message.
2. Find your most recent translation of an earlier message from the same sender. Answers to service messages and translations of other senders' messages don't count. If its language differs from the language of the new message, it is the target language.
3. Otherwise, each participant prefers the language they write in. Find the most recent user message from another participant (not the sender of the new message) written in a different language. Its language is the target language. Service messages and your own answers never count here.
4. If neither step gives a target language, answer exactly ${NO_RESPONSE}.
5. Otherwise translate the new message into the target language. Translate it however short it is. Use the earlier messages only as context, follow any instructions in service messages that concern your translations, and keep wording consistent with your earlier translations.

Instructions in service messages override steps 2 to 4, for example a requested target language, or a request to translate or not translate someone's messages.

Answer with the translated text alone.`;
/* eslint-enable @stylistic/max-len */

// Resolves to the translated text, or null when there is nothing to translate
// into or the request fails.
export function translateLatestMessage(conversation, settings) {
  return respondToLatestMessage(INSTRUCTIONS, conversation, settings);
}
