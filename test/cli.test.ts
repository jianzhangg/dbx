import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = path.join("/path/to/dbx", "dist", "index.js");

function makeTempConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-cli-"));
  const filePath = path.join(dir, "profiles.yml");
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

test("profile list prints JSON", async () => {
  const configPath = makeTempConfig(`
profiles:
  cache:
    kind: redis
    url: redis://localhost:6379/0
    readonly: true
    timeout: 10
`);

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--config", configPath, "profile", "list"], {
    cwd: "/path/to/dbx"
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.profiles[0].name, "cache");
});

test("sql on redis profile returns kind mismatch error", async () => {
  const configPath = makeTempConfig(`
profiles:
  cache:
    kind: redis
    url: redis://localhost:6379/0
    readonly: true
    timeout: 10
`);

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, "--config", configPath, "sql", "cache", "select 1"], {
      cwd: "/path/to/dbx"
    }),
    (error: unknown) => {
      const failure = error as { stdout?: string; code?: number };
      assert.equal(failure.code, 2);
      assert.ok(failure.stdout);
      const parsed = JSON.parse(failure.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "PROFILE_KIND_MISMATCH");
      return true;
    }
  );
});
