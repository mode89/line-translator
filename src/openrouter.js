const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REASONING_EFFORTS = ["xhigh", "high", "medium", "low", "minimal", "none"];

// Resolves to the model's trimmed answer, or null when the answer is empty or
// the request fails.
export async function askModel(messages, { apiKey, modelSetting }) {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ...parseModelSetting(modelSetting), messages })
    });

    if (!response.ok) {
      console.error(
        "OpenRouter request failed:",
        response.status,
        await response.text()
      );
      return null;
    }

    const { choices } = await response.json();
    return choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("OpenRouter request failed:", error);
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
