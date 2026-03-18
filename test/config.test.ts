import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_TIMEOUT_SECONDS, loadConfig, resolveConfigPath } from "../src/config.js";
import { DbxError } from "../src/errors.js";

function makeTempConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-config-"));
  const filePath = path.join(dir, "profiles.yml");
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

test("resolveConfigPath expands default home config", () => {
  const resolved = resolveConfigPath();
  assert.equal(resolved, path.join(os.homedir(), ".config", "dbx", "profiles.yml"));
});

test("loadConfig applies timeout default", () => {
  const configPath = makeTempConfig(`
profiles:
  prod:
    kind: mysql
    host: 127.0.0.1
    user: root
    password: secret
    readonly: true
`);

  const { config } = loadConfig(configPath);
  assert.equal(config.profiles.prod.timeout, DEFAULT_TIMEOUT_SECONDS);
});

test("loadConfig throws for invalid schema", () => {
  const configPath = makeTempConfig(`
profiles:
  bad:
    kind: redis
    readonly: true
`);

  assert.throws(() => loadConfig(configPath), (error: unknown) => {
    assert.ok(error instanceof DbxError);
    assert.equal(error.code, "CONFIG_INVALID");
    return true;
  });
});
