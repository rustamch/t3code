import { describe, expect, it } from "vite-plus/test";

import { hearthFailure, threadOfRef } from "./HearthService.ts";

describe("hearthFailure", () => {
  it("keeps the reason and drops the brief Hearth quotes before it", () => {
    const stderr =
      "hearth: `t3 thread start x # Task\n\nsecret brief\n` failed: No T3 Code project matches 'x'.\n";
    expect(hearthFailure(stderr)).toBe("No T3 Code project matches 'x'.");
  });

  it("keeps a message with no quoted command", () => {
    expect(hearthFailure("hearth: no store\n")).toBe("hearth: no store");
    expect(hearthFailure("  ")).toBe("The hearth command failed.");
  });
});

describe("threadOfRef", () => {
  it("opens only T3 sessions", () => {
    expect(threadOfRef("t3:mcp:abc")).toBe("mcp:abc");
    expect(threadOfRef("codex:abc")).toBeNull();
    expect(threadOfRef(null)).toBeNull();
  });
});
