import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateRepository } from "./release-docs.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "totem-release-docs-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { check: "echo check", "release:verify": "echo verify" } }),
  );
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n");
  return root;
}

test("accepts valid relative links and documented package scripts", () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, "README.md"),
      "# Fixture\n\n[Guide](docs/guide.md#top)\n\n```bash\npnpm check\nnpm run release:verify\n```\n",
    );
    assert.deepEqual(validateRepository(root).failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports broken relative links", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "README.md"), "[Missing](docs/missing.md)\n");
    assert.match(validateRepository(root).failures.join("\n"), /broken relative link/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports package-script command drift", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "README.md"), "```bash\npnpm release:missing\n```\n");
    assert.match(validateRepository(root).failures.join("\n"), /release:missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects links from public docs into private Portal repositories", () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, "README.md"),
      "[Private Portal theme](https://github.com/KingHacker9000/totem-portal-theme)\n",
    );
    assert.match(validateRepository(root).failures.join("\n"), /private repository totem-portal-theme/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
