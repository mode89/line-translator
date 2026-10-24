const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NO_RESPONSE = "NO_RESPONSE";
const REASONING_EFFORTS = ["xhigh", "high", "medium", "low", "minimal", "none"];

/* eslint-disable @stylistic/max-len -- prompt line breaks are sent as is */
const INSTRUCTIONS = `You translate messages in a group chat.
Each user message is a group message as "sender: text", oldest first. Each of your answers is what you replied to the message before it: a translation, or ${NO_RESPONSE} when you did not reply. The last user message is the new message to translate.

1. Determine the language of the new message.
2. Each participant prefers the language they write in. Find the most recent user message from another participant (not the sender of the new message) written in a different language. Its language is the target language. Your own answers never count here.
3. If there is no such message, answer exactly ${NO_RESPONSE}.
4. Otherwise translate the new message into the target language. Translate it however short it is. Use the earlier messages only as context, and keep wording consistent with your earlier translations.

Answer with the translated text alone.`;
/* eslint-enable @stylistic/max-len */

// Resolves to the translated text, or null when there is nothing to translate
// into or the request fails.
export async function translateLatestMessage(
  conversation,
  { apiKey, modelSetting }
) {
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
          ...toPromptMessages(conversation)
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

    const { choices } = await response.json();
    const answer = choices?.[0]?.message?.content?.trim();

    return !answer || answer === NO_RESPONSE ? null : answer;
  } catch (error) {
    console.error("OpenRouter translation failed:", error);
    return null;
  }
}

// OpenRouter model ids may already carry ":" variants (e.g. ":free"), so only
// a known effort suffix is split off.
export function parseModelSetting(setting) {
  const separator = setting.lastIndexOf(":");
  const effort = setting.slice(separator + 1);

  if (separator > 0 && REASONING_EFFORTS.includes(effort)) {
    return { model: setting.slice(0, separator), reasoning: { effort } };
  }

  return { model: setting };
}

// Turns alternate user/assistant; the new message is last, unanswered.
export function toPromptMessages(conversation) {
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

function toUserMessage({ sender, text }) {
  return { role: "user", content: `${sender}: ${text}` };
}

function toAssistantMessage({ translation }) {
  return { role: "assistant", content: translation ?? NO_RESPONSE };
}
