import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_TIMEOUT_SECONDS,
  ensureConfigFile,
  getProfile,
  loadConfig,
  redactProfile,
  resolveConfigPath,
  resolveDefaultConfigPath,
  resolveTemplatePath,
  summarizeProfiles
} from "../src/config.js";
import { DbxError } from "../src/errors.js";

function makeTempConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-config-"));
  const filePath = path.join(dir, "profiles.yml");
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

test("resolveConfigPath expands default home config", () => {
  const resolved = resolveConfigPath();
  assert.equal(resolved, resolveDefaultConfigPath());
});

test("resolveDefaultConfigPath uses unix config dir on mac and linux", () => {
  assert.equal(
    resolveDefaultConfigPath("darwin", {}, "/Users/tester"),
    path.join("/Users/tester", ".config", "dbx", "profiles.yml")
  );
  assert.equal(
    resolveDefaultConfigPath("linux", {}, "/home/tester"),
    path.join("/home/tester", ".config", "dbx", "profiles.yml")
  );
});

test("resolveDefaultConfigPath uses APPDATA on windows", () => {
  assert.equal(
    resolveDefaultConfigPath("win32", { APPDATA: "C:\\Users\\tester\\AppData\\Roaming" }, "C:\\Users\\tester"),
    path.join("C:\\Users\\tester\\AppData\\Roaming", "dbx", "profiles.yml")
  );
});

test("resolveDefaultConfigPath falls back to home AppData on windows", () => {
  assert.equal(
    resolveDefaultConfigPath("win32", {}, "C:\\Users\\tester"),
    path.join("C:\\Users\\tester", "AppData", "Roaming", "dbx", "profiles.yml")
  );
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

test("ensureConfigFile creates the config directory and copies the template", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-init-"));
  const configPath = path.join(dir, "nested", "profiles.yml");

  const result = ensureConfigFile(configPath);

  assert.equal(result.path, configPath);
  assert.equal(result.created, true);
  assert.equal(fs.existsSync(configPath), true);
  assert.equal(fs.readFileSync(configPath, "utf8").includes("profiles:"), true);
});

test("loadConfig auto-creates missing config files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-load-init-"));
  const configPath = path.join(dir, "profiles.yml");

  const { config, path: loadedPath, created } = loadConfig(configPath);

  assert.equal(loadedPath, configPath);
  assert.equal(created, true);
  assert.equal(Object.keys(config.profiles).length > 0, true);
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
    assert.ok(error.details);
    return true;
  });
});

test("resolveConfigPath uses DBX_CONFIG when provided", () => {
  const previous = process.env.DBX_CONFIG;
  process.env.DBX_CONFIG = "/tmp/dbx-profiles.yml";

  try {
    assert.equal(resolveConfigPath(), "/tmp/dbx-profiles.yml");
  } finally {
    if (previous === undefined) {
      delete process.env.DBX_CONFIG;
    } else {
      process.env.DBX_CONFIG = previous;
    }
  }
});

test("resolveTemplatePath points to the bundled template", () => {
  const templatePath = resolveTemplatePath();
  assert.equal(fs.existsSync(templatePath), true);
  assert.equal(templatePath.endsWith("profiles.example.yml"), true);
});

test("getProfile throws when profile is missing", () => {
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

  assert.throws(() => getProfile(config, "missing"), (error: unknown) => {
    assert.ok(error instanceof DbxError);
    assert.equal(error.code, "PROFILE_NOT_FOUND");
    assert.equal(error.message, "Unknown profile: missing");
    return true;
  });
});

test("redactProfile hides mysql and redis secrets", () => {
  const mysqlRedacted = redactProfile({
    kind: "mysql",
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "secret",
    database: "app",
    readonly: true,
    timeout: 30
  });
  const redisRedacted = redactProfile({
    kind: "redis",
    url: "redis://default:secret@localhost:6379/0",
    readonly: true,
    timeout: 30
  });

  assert.equal(mysqlRedacted.password, "***");
  assert.equal(redisRedacted.url, "redis://default:***@localhost:6379/0");
});

test("summarizeProfiles keeps only safe public fields", () => {
  const configPath = makeTempConfig(`
profiles:
  prod:
    kind: mysql
    host: 127.0.0.1
    user: root
    password: secret
    readonly: false
    timeout: 12
`);

  const { config } = loadConfig(configPath);
  const summary = summarizeProfiles(config);

  assert.deepEqual(summary, [
    {
      name: "prod",
      kind: "mysql",
      readonly: false,
      timeout: 12
    }
  ]);
});
