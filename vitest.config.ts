import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // E2E tests live under tests/e2e and are run by Playwright (see
    // playwright.config.ts). Exclude that directory so vitest does not
    // try to load Playwright's `test()` and fail with "did not expect
    // test() to be called here".
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "tests/e2e/**",
    ],
  },
});
