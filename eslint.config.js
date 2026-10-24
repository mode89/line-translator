import stylistic from "@stylistic/eslint-plugin";

const testHeaderOnOneLine = {
  meta: {
    type: "layout",
    docs: { description: "Keep `it(\"name\", () => {` on a single line" },
    schema: [],
    messages: {
      wrapped:
        "Keep `it(\"name\", () => {` on one line; shorten the test name."
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "it") {
          return;
        }

        const callback = node.arguments.at(-1);
        const isFunction =
          callback?.type === "ArrowFunctionExpression" ||
          callback?.type === "FunctionExpression";

        const opensOnSameLine =
          node.loc.start.line === callback?.body.loc.start.line;

        if (isFunction && !opensOnSameLine) {
          context.report({ node, messageId: "wrapped" });
        }
      }
    };
  }
};

export default [
  { ignores: [".wrangler/"] },
  {
    files: ["**/*.js"],
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/max-len": ["error", { code: 80 }]
    }
  },
  {
    files: ["test/**/*.test.js"],
    plugins: {
      local: { rules: { "test-header-on-one-line": testHeaderOnOneLine } }
    },
    rules: {
      "local/test-header-on-one-line": "error"
    }
  }
];
