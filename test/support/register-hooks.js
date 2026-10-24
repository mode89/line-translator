import { registerHooks } from "node:module";

// `cloudflare:workers` exists only in the Workers runtime; tests load a stand-in instead.
const cloudflareWorkersStub = new URL("./cloudflare-workers.js", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: cloudflareWorkersStub, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  }
});
