import { DurableObject } from "cloudflare:workers";

// Also sets how long instructions in service messages stay in effect.
const DEFAULT_HISTORY_LENGTH = 100;

// Entries are {id, sender, text, isService?, reply?}, where reply is the
// bot's reply to that message that LINE accepted.
export class ChatHistory extends DurableObject {
  // Resolves to null when LINE redelivers a message that is already stored.
  async addMessage(message) {
    const history = await this.getHistory();

    if (history.some(({ id }) => id === message.id)) {
      return null;
    }

    history.push(message);
    const latest = history.slice(-historyLength(this.env));
    await this.ctx.storage.put("history", latest);
    return latest;
  }

  // The message may have left the history already; then nothing is recorded.
  async recordReply(messageId, reply) {
    const history = await this.getHistory();
    const message = history.find(({ id }) => id === messageId);

    if (message) {
      message.reply = reply;
      await this.ctx.storage.put("history", history);
    }
  }

  async getHistory() {
    return (await this.ctx.storage.get("history")) ?? [];
  }

  async clearHistory() {
    await this.ctx.storage.delete("history");
  }
}

export function historyLength(env) {
  const length = Number(env.HISTORY_LENGTH);
  const isValid = Number.isInteger(length) && length > 0;
  return isValid ? length : DEFAULT_HISTORY_LENGTH;
}
