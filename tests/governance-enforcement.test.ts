import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect } from "vitest";

const guard = resolve("governance/happy-path-precommit.sh");
for (const [text, expected] of [["feature fixed", 1], ["ordinary change", 0]] as const) {
  test(`production guard exit ${expected}: ${text}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "handbook-guard-"));
    try {
      expect(spawnSync("git", ["init", "--quiet", dir]).status).toBe(0);
      writeFileSync(join(dir, "change.txt"), `${text}\n`);
      expect(spawnSync("git", ["add", "change.txt"], { cwd: dir }).status).toBe(0);
      const result = spawnSync("sh", [guard], { cwd: dir, encoding: "utf8", env: { ...process.env, HAPPY_PATH_FAIL_ON: "block", HAPPY_PATH_DISABLE: "", HAPPY_PATH_POLICY_SKIP: "" } });
      expect(result.status, result.stdout + result.stderr).toBe(expected);
      if (expected) expect(result.stdout).toContain("FAIL [R1]");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
