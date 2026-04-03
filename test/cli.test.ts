import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(testDir, "..");
const cliPath = path.join(cwd, "dist", "index.js");

function makeTempConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-cli-"));
  const filePath = path.join(dir, "profiles.yml");
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

async function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  return await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env
  });
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

  const { stdout } = await runCli(["--config", configPath, "profile", "list"]);

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.profiles[0].name, "cache");
  assert.equal(parsed.data.profiles[0].timeout, 10);
});

test("config command creates a missing config file from the template", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-cli-config-"));
  const configPath = path.join(dir, "nested", "profiles.yml");

  const { stdout } = await runCli(["--config", configPath, "config"]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.configPath, configPath);
  assert.equal(parsed.data.created, true);
  assert.equal(Array.isArray(parsed.data.howToConfigure), true);
  assert.equal(fs.existsSync(configPath), true);
  const contents = fs.readFileSync(configPath, "utf8");
  assert.match(contents, /prod_mysql_ro:/);
  assert.match(contents, /prod_mysql_rw:/);
  assert.match(contents, /cache_redis_ro:/);
  assert.match(contents, /cache_redis_rw:/);
});

test("config command shows an existing config path without overwriting it", async () => {
  const configPath = makeTempConfig(`
profiles:
  cache:
    kind: redis
    url: redis://localhost:6379/0
    readonly: true
    timeout: 10
`);

  const before = fs.readFileSync(configPath, "utf8");
  const { stdout } = await runCli(["--config", configPath, "config"]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.configPath, configPath);
  assert.equal(parsed.data.created, false);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
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
    runCli(["--config", configPath, "sql", "cache", "select 1"]),
    (error: unknown) => {
      const failure = error as { stdout?: string; code?: number };
      assert.equal(failure.code, 2);
      assert.ok(failure.stdout);
      const parsed = JSON.parse(failure.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "PROFILE_KIND_MISMATCH");
      assert.match(parsed.error.message, /not a mysql profile/i);
      return true;
    }
  );
});

test("profile show redacts mysql passwords", async () => {
  const configPath = makeTempConfig(`
profiles:
  prod_mysql:
    kind: mysql
    host: 127.0.0.1
    user: root
    password: secret
    database: app
    readonly: true
    timeout: 10
`);

  const { stdout } = await runCli(["--config", configPath, "profile", "show", "prod_mysql"]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.profile.password, "***");
});

test("profile show redacts redis password in url", async () => {
  const configPath = makeTempConfig(`
profiles:
  cache:
    kind: redis
    url: redis://default:secret@localhost:6379/0
    readonly: true
    timeout: 10
`);

  const { stdout } = await runCli(["--config", configPath, "profile", "show", "cache"]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.profile.url, "redis://default:***@localhost:6379/0");
});

test("cli returns message and details for invalid config schema", async () => {
  const configPath = makeTempConfig(`
profiles:
  broken:
    kind: redis
    readonly: true
`);

  await assert.rejects(
    runCli(["--config", configPath, "profile", "list"]),
    (error: unknown) => {
      const failure = error as { stdout?: string; code?: number };
      assert.equal(failure.code, 2);
      assert.ok(failure.stdout);
      const parsed = JSON.parse(failure.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "CONFIG_INVALID");
      assert.equal(parsed.error.message, "Config file schema is invalid");
      assert.ok(parsed.error.details);
      return true;
    }
  );
});

test("cli returns profile not found error with message", async () => {
  const configPath = makeTempConfig(`
profiles:
  cache:
    kind: redis
    url: redis://localhost:6379/0
    readonly: true
    timeout: 10
`);

  await assert.rejects(
    runCli(["--config", configPath, "ping", "missing_profile"]),
    (error: unknown) => {
      const failure = error as { stdout?: string; code?: number };
      assert.equal(failure.code, 6);
      assert.ok(failure.stdout);
      const parsed = JSON.parse(failure.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "PROFILE_NOT_FOUND");
      assert.equal(parsed.error.message, "Unknown profile: missing_profile");
      return true;
    }
  );
});

test("cli loads config from DBX_CONFIG environment variable", async () => {
  const configPath = makeTempConfig(`
profiles:
  cache:
    kind: redis
    url: redis://localhost:6379/0
    readonly: true
    timeout: 9
`);

  const { stdout } = await runCli(["profile", "list"], {
    DBX_CONFIG: configPath
  });
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.configPath, configPath);
  assert.equal(parsed.data.profiles[0].timeout, 9);
});

test("profile list auto-creates the config file when it is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-cli-autocreate-"));
  const configPath = path.join(dir, "profiles.yml");

  const { stdout } = await runCli(["--config", configPath, "profile", "list"]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.configPath, configPath);
  assert.equal(fs.existsSync(configPath), true);
  assert.deepEqual(
    parsed.data.profiles.map((profile: { name: string }) => profile.name),
    ["prod_mysql_ro", "prod_mysql_rw", "cache_redis_ro", "cache_redis_rw"]
  );
});
