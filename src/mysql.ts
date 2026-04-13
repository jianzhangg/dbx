import mysql from "mysql2/promise";
import type { FieldPacket } from "mysql2/promise";
import type { MysqlProfile } from "./config.js";
import { DbxError, ExitCode } from "./errors.js";
import { formatTimeoutMessage, withTimeout } from "./utils.js";

const ALLOWED_START = /^\s*(select|show|desc|describe|explain|with)\b/i;
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|replace|truncate|grant|revoke|set|use|load|call|commit|rollback|begin|start\s+transaction|lock|unlock|rename)\b/i;
const MYSQL_QUERY_TIMEOUT_ERRNO = 3024;
const MYSQL_QUERY_TIMEOUT_CODE = "ER_QUERY_TIMEOUT";

export function countSqlStatements(sql: string): number {
  let count = 0;
  let hasToken = false;
  let quote: "'" | '"' | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === "\\" && next !== undefined) {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "#") {
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      hasToken = true;
      continue;
    }

    if (char === ";") {
      if (hasToken) {
        count += 1;
        hasToken = false;
      }
      continue;
    }

    if (!/\s/.test(char)) {
      hasToken = true;
    }
  }

  if (hasToken) {
    count += 1;
  }

  return count;
}

export function validateReadonlySql(sql: string): string | undefined {
  if (!ALLOWED_START.test(sql)) {
    return "Only SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH statements are allowed when readonly=true";
  }
  if (FORBIDDEN_KEYWORDS.test(sql)) {
    return "Write or schema-changing SQL is not allowed when readonly=true";
  }
  return undefined;
}

export function isMysqlExecutionTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const mysqlError = error as {
    code?: unknown;
    errno?: unknown;
    message?: unknown;
  };

  if (mysqlError.code === MYSQL_QUERY_TIMEOUT_CODE || mysqlError.errno === MYSQL_QUERY_TIMEOUT_ERRNO) {
    return true;
  }

  return (
    typeof mysqlError.message === "string" &&
    /maximum statement execution time exceeded/i.test(mysqlError.message)
  );
}

function normalizeFields(fields: FieldPacket[] | undefined): Array<Record<string, unknown>> {
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.map((field) => ({
    name: field.name,
    columnType: field.columnType,
    table: field.table,
    schema: field.schema
  }));
}

export async function runSql(profile: MysqlProfile, sql: string): Promise<Record<string, unknown>> {
  if (countSqlStatements(sql) !== 1) {
    throw new DbxError(
      "ARGUMENT_ERROR",
      "Exactly one SQL statement is allowed per invocation",
      ExitCode.InvalidInput
    );
  }

  if (profile.readonly) {
    const message = validateReadonlySql(sql);
    if (message) {
      throw new DbxError("READONLY_BLOCKED", message, ExitCode.ReadonlyBlocked);
    }
  }

  const timeoutMs = profile.timeout * 1000;
  let connection: mysql.Connection | undefined;

  try {
    const result = await withTimeout(
      async () => {
        connection = await mysql.createConnection({
          host: profile.host,
          port: profile.port,
          user: profile.user,
          password: profile.password,
          database: profile.database,
          multipleStatements: false
        });

        await connection.query(`SET SESSION max_execution_time = ${timeoutMs}`);

        if (profile.readonly) {
          await connection.query("START TRANSACTION READ ONLY");
        }

        try {
          const [rows, fields] = await connection.query(sql);
          if (profile.readonly) {
            await connection.query("COMMIT");
          }
          return {
            rows,
            fields: normalizeFields(Array.isArray(fields) ? fields : undefined)
          };
        } catch (error) {
          if (profile.readonly) {
            try {
              await connection.query("ROLLBACK");
            } catch {
              // Ignore rollback failures after the query has already failed.
            }
          }
          throw error;
        }
      },
      timeoutMs,
      async () => {
        connection?.destroy();
      }
    );

    return result;
  } catch (error) {
    if (error instanceof DbxError) {
      throw error;
    }
    if (isMysqlExecutionTimeoutError(error)) {
      throw new DbxError("TIMEOUT", formatTimeoutMessage(timeoutMs), ExitCode.Timeout);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DbxError("EXECUTION_FAILED", `MySQL query failed: ${message}`, ExitCode.ExecutionFailed);
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        connection.destroy();
      }
    }
  }
}

export async function pingMysql(profile: MysqlProfile): Promise<Record<string, unknown>> {
  const result = await runSql(
    {
      ...profile,
      readonly: false
    },
    "SELECT 1 AS ok"
  );

  return {
    ping: "pong",
    result
  };
}
