import { askModel } from "./openrouter.js";

export const NO_RESPONSE = "NO_RESPONSE";

/* eslint-disable @stylistic/max-len -- prompt line breaks are sent as is */
export const HISTORY_FORMAT = `Each user message is a group message as "sender: text", oldest first. A sender marked "(to you)" wrote a service message: anything addressed to you rather than to the group, such as a question, a request or an instruction. Each of your answers is what you replied to the message before it: a translation, an answer to a service message, or ${NO_RESPONSE} when you did not reply. After a service message, ${NO_RESPONSE} means you could not answer it and the sender was told so.`;
/* eslint-enable @stylistic/max-len */

// Resolves to the bot's reply to the last message of the conversation, or
// null when the model answers NO_RESPONSE or nothing, or the request fails.
export async function respondToLatestMessage(
  instructions,
  conversation,
  settings
) {
  const answer = await askModel(
    [
      { role: "system", content: instructions },
      ...toPromptMessages(conversation)
    ],
    settings
  );

  return answer === NO_RESPONSE ? null : answer;
}

// Turns alternate user/assistant; the new message is last, unanswered.
function toPromptMessages(conversation) {
  const earlierMessages = conversation.slice(0, -1);
  const newMessage = conversation.at(-1);

  return [
    ...earlierMessages.flatMap(message => [
      toUserMessage(message),
      toAssistantMessage(message)
    ]),
    toUserMessage(newMessage)
  ];
}

function toUserMessage({ sender, text, isService }) {
  const author = isService ? `${sender} (to you)` : sender;
  return { role: "user", content: `${author}: ${text}` };
}

function toAssistantMessage({ reply }) {
  return { role: "assistant", content: reply ?? NO_RESPONSE };
}
