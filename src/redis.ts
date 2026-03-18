import { createClient } from "redis";
import type { RedisProfile } from "./config.js";
import { DbxError, ExitCode } from "./errors.js";
import { withTimeout } from "./utils.js";

export const READONLY_REDIS_COMMANDS = new Set([
  "GET",
  "MGET",
  "HGET",
  "HMGET",
  "HGETALL",
  "HKEYS",
  "HVALS",
  "SMEMBERS",
  "SCARD",
  "ZRANGE",
  "ZREVRANGE",
  "ZSCORE",
  "ZCARD",
  "LRANGE",
  "LLEN",
  "TTL",
  "PTTL",
  "EXISTS",
  "TYPE",
  "SCAN",
  "KEYS",
  "INFO",
  "DBSIZE",
  "PING"
]);

function disconnectNow(client: ReturnType<typeof createClient>): void {
  const dynamicClient = client as unknown as {
    destroy?: () => void;
    disconnect?: () => void;
    close?: () => void;
  };

  if (typeof dynamicClient.destroy === "function") {
    dynamicClient.destroy();
    return;
  }
  if (typeof dynamicClient.disconnect === "function") {
    dynamicClient.disconnect();
    return;
  }
  if (typeof dynamicClient.close === "function") {
    dynamicClient.close();
  }
}

export async function runRedisCommand(
  profile: RedisProfile,
  command: string,
  args: string[]
): Promise<Record<string, unknown>> {
  const normalizedCommand = command.toUpperCase();
  if (profile.readonly && !READONLY_REDIS_COMMANDS.has(normalizedCommand)) {
    throw new DbxError(
      "READONLY_BLOCKED",
      `${normalizedCommand} is not allowed when readonly=true`,
      ExitCode.ReadonlyBlocked
    );
  }

  const timeoutMs = profile.timeout * 1000;
  const client = createClient({
    url: profile.url,
    socket: {
      connectTimeout: timeoutMs
    }
  });

  client.on("error", () => {
    // The command path returns explicit errors; suppress background event noise.
  });

  try {
    await withTimeout(
      async () => {
        await client.connect();
      },
      timeoutMs,
      () => {
        disconnectNow(client);
      }
    );

    const result = await withTimeout(
      async () => {
        return await client.sendCommand([normalizedCommand, ...args]);
      },
      timeoutMs,
      () => {
        disconnectNow(client);
      }
    );

    return {
      command: normalizedCommand,
      args,
      result
    };
  } catch (error) {
    if (error instanceof DbxError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DbxError(
      "EXECUTION_FAILED",
      `Redis command failed: ${message}`,
      ExitCode.ExecutionFailed
    );
  } finally {
    disconnectNow(client);
  }
}

export async function pingRedis(profile: RedisProfile): Promise<Record<string, unknown>> {
  return await runRedisCommand(
    {
      ...profile,
      readonly: false
    },
    "PING",
    []
  );
}
