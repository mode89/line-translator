// Durable Object storage copies values in and out; structuredClone mimics that.
export function createStorage() {
  const values = new Map();

  return {
    get: async key => structuredClone(values.get(key)),
    put: async (key, value) => void values.set(key, structuredClone(value)),
    delete: async key => void values.delete(key)
  };
}

// Replaces global fetch for one test; `respond` gets (url, init) and returns
// a Response or throws.
export function stubFetch(t, respond) {
  const calls = [];

  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  });

  return calls;
}

// An OpenRouter chat completion whose answer is `content`.
export function modelAnswer(content) {
  return Response.json({ choices: [{ message: { content } }] });
}

export function silenceConsoleError(t) {
  return t.mock.method(console, "error", () => {});
}
