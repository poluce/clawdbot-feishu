import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/accounts.ts",
        "src/policy.ts",
        "src/targets.ts",
        "src/mention.ts",
        "src/text/markdown-links.ts",
        "src/tools-config.ts",
        "src/config-schema.ts",
        "src/tools-common/tool-context.ts",
        "src/tools-common/tool-exec.ts",
        "src/tools-common/feishu-api.ts",
        "src/media-duration.ts",
        "src/voice-tools/actions.ts",
        "src/reply-dispatcher.ts",
        "src/tts.ts"
      ],
      exclude: ["src/**/__tests__/**", "src/**/index.ts"]
    }
  }
});
