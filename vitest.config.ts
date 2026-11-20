import { defineConfig } from "vitest/config";

// `npm test` deixa tests/e2e de fora; `npm run test:e2e` roda só eles.
const e2e = process.env.npm_lifecycle_event === "test:e2e";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: e2e ? ["node_modules/**"] : ["tests/e2e/**", "node_modules/**"],
  },
});
