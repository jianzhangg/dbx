import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { DbxError, ExitCode } from "./errors.js";
import { expandPath } from "./utils.js";

export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_CONFIG_PATH = "~/.config/dbx/profiles.yml";

const baseProfileSchema = z.object({
  readonly: z.boolean(),
  timeout: z.number().int().positive().default(DEFAULT_TIMEOUT_SECONDS)
});

const mysqlProfileSchema = baseProfileSchema.extend({
  kind: z.literal("mysql"),
  host: z.string().min(1),
  port: z.number().int().positive().default(3306),
  user: z.string().min(1),
  password: z.string(),
  database: z.string().min(1).optional()
});

const redisProfileSchema = baseProfileSchema.extend({
  kind: z.literal("redis"),
  url: z.string().min(1)
});

const profileSchema = z.discriminatedUnion("kind", [mysqlProfileSchema, redisProfileSchema]);

const configSchema = z.object({
  profiles: z.record(profileSchema)
});

export type MysqlProfile = z.infer<typeof mysqlProfileSchema>;
export type RedisProfile = z.infer<typeof redisProfileSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type DbxConfig = z.infer<typeof configSchema>;

export function resolveConfigPath(explicitPath?: string): string {
  const candidate = explicitPath ?? process.env.DBX_CONFIG ?? DEFAULT_CONFIG_PATH;
  if (candidate === DEFAULT_CONFIG_PATH) {
    return path.join(os.homedir(), ".config", "dbx", "profiles.yml");
  }
  return path.resolve(expandPath(candidate));
}

export function loadConfig(explicitPath?: string): { config: DbxConfig; path: string } {
  const resolvedPath = resolveConfigPath(explicitPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new DbxError(
      "CONFIG_NOT_FOUND",
      `Config file not found: ${resolvedPath}`,
      ExitCode.InvalidInput
    );
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DbxError("CONFIG_INVALID", `Invalid YAML: ${message}`, ExitCode.InvalidInput);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new DbxError(
      "CONFIG_INVALID",
      "Config file schema is invalid",
      ExitCode.InvalidInput,
      result.error.flatten()
    );
  }

  return {
    config: result.data,
    path: resolvedPath
  };
}

export function getProfile(config: DbxConfig, profileName: string): Profile {
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new DbxError(
      "PROFILE_NOT_FOUND",
      `Unknown profile: ${profileName}`,
      ExitCode.ProfileNotFound
    );
  }
  return profile;
}

function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    if (parsed.username && !parsed.password) {
      parsed.username = "***";
    }
    return parsed.toString();
  } catch {
    return "***";
  }
}

export function redactProfile(profile: Profile): Record<string, unknown> {
  if (profile.kind === "mysql") {
    return {
      ...profile,
      password: "***"
    };
  }

  return {
    ...profile,
    url: redactRedisUrl(profile.url)
  };
}

export function summarizeProfiles(config: DbxConfig): Array<Record<string, unknown>> {
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    kind: profile.kind,
    readonly: profile.readonly,
    timeout: profile.timeout
  }));
}
