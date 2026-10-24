import { DurableObject } from "cloudflare:workers";

const DEFAULT_HISTORY_LENGTH = 5;

export class ChatHistory extends DurableObject {
  async addMessage(message) {
    const history = (await this.ctx.storage.get("history")) ?? [];
    history.push(message);
    const latest = history.slice(-historyLength(this.env));
    await this.ctx.storage.put("history", latest);
    return latest;
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
  return Number.isInteger(length) && length > 0 ? length : DEFAULT_HISTORY_LENGTH;
}
