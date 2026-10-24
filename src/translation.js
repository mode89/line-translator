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
export async function translateLatestMessage(conversation, { apiKey, modelSetting }) {
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
export function parseModelSetting(setting) {
  const separator = setting.lastIndexOf(":");
  const effort = setting.slice(separator + 1);

  if (separator > 0 && REASONING_EFFORTS.includes(effort)) {
    return { model: setting.slice(0, separator), reasoning: { effort } };
  }

  return { model: setting };
}

export function formatTranslationRequest(conversation) {
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
