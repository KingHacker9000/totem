import { describe, expect, it } from "vitest";
import { parseArgs, parseServiceSpec, summarize } from "./live-validation.mjs";

describe("live validation helpers", () => {
  it("parses providers, workspace and destructive interrupt opt-in", () => {
    const options = parseArgs([
      "--base-url",
      "http://localhost:9999",
      "--provider",
      "codex",
      "--provider",
      "claude-code",
      "--workspace",
      "/tmp/workspace",
      "--exercise-interrupt",
      "--timeout-ms",
      "5000",
      "--poll-ms",
      "25",
    ]);

    expect(options).toMatchObject({
      baseUrl: "http://localhost:9999",
      providers: ["codex", "claude-code"],
      workspace: "/tmp/workspace",
      exerciseInterrupt: true,
      timeoutMs: 5000,
      pollMs: 25,
    });
  });

  it("keeps live-service secrets out of the service spec", () => {
    const service = parseServiceSpec(
      "github|https://api.github.com/user|GH_TOKEN",
      {
        GH_TOKEN: "super-secret",
      },
    );

    expect(service).toEqual({
      id: "github",
      url: "https://api.github.com/user",
      tokenEnv: "GH_TOKEN",
      token: "super-secret",
    });
    expect(
      JSON.stringify(service).replace(service.token, "<redacted>"),
    ).not.toContain("super-secret");
  });

  it("reports failure only when a capability fails", () => {
    const summary = summarize([
      { capability: "provider:codex", status: "PASS", detail: "available" },
      { capability: "service:spotify", status: "SKIP", detail: "no token" },
    ]);
    expect(summary.ok).toBe(true);
    expect(summary.counts).toEqual({ PASS: 1, SKIP: 1, FAIL: 0 });
  });
});
