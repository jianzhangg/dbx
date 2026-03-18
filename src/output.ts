import process from "node:process";
import { DbxError, ExitCode } from "./errors.js";

export type SuccessResult = {
  ok: true;
  profile?: string;
  kind?: string;
  readonly?: boolean;
  data: unknown;
};

export type ErrorResult = {
  ok: false;
  profile?: string;
  kind?: string;
  readonly?: boolean;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type CommandContext = {
  profile?: string;
  kind?: string;
  readonly?: boolean;
};

export function successResult(data: unknown, context: CommandContext = {}): SuccessResult {
  return {
    ok: true,
    ...context,
    data
  };
}

export function errorResult(error: DbxError, context: CommandContext = {}): ErrorResult {
  return {
    ok: false,
    ...context,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  };
}

export function printJson(value: SuccessResult | ErrorResult): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function failWithJson(error: DbxError, context: CommandContext = {}): never {
  printJson(errorResult(error, context));
  process.exit(error.exitCode);
}

export function okWithJson(data: unknown, context: CommandContext = {}): never {
  printJson(successResult(data, context));
  process.exit(ExitCode.Success);
}
