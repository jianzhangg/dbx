import { Command, CommanderError } from "commander";
import {
  ensureConfigFile,
  getProfile,
  loadConfig,
  redactProfile,
  summarizeProfiles
} from "./config.js";
import type { Profile } from "./config.js";
import { DbxError, ExitCode, toDbxError } from "./errors.js";
import { runSql, pingMysql } from "./mysql.js";
import { successResult, printJson, errorResult } from "./output.js";
import { pingRedis, runRedisCommand } from "./redis.js";

type GlobalOptions = {
  config?: string;
};

function profileContext(profileName: string, profile: Profile) {
  return {
    profile: profileName,
    kind: profile.kind,
    readonly: profile.readonly
  };
}

async function withCliResult(
  action: () => Promise<unknown>,
  context: { profile?: string; kind?: string; readonly?: boolean } = {}
): Promise<void> {
  try {
    const data = await action();
    printJson(successResult(data, context));
  } catch (error) {
    const dbxError = toDbxError(error);
    printJson(errorResult(dbxError, context));
    process.exit(dbxError.exitCode);
  }
}

function loadProfileFromCommand(command: Command, profileName: string): { profile: Profile; configPath: string } {
  const options = command.optsWithGlobals<GlobalOptions>();
  const { config, path } = loadConfig(options.config);
  return {
    profile: getProfile(config, profileName),
    configPath: path
  };
}

function createConfigCommand(program: Command): void {
  program
    .command("config")
    .description("Show or initialize the profiles.yml file")
    .action(async function action(this: Command) {
      await withCliResult(async () => {
        const options = this.optsWithGlobals<GlobalOptions>();
        const configFile = ensureConfigFile(options.config);
        return {
          configPath: configFile.path,
          created: configFile.created,
          templatePath: configFile.templatePath,
          howToConfigure: [
            "Open the config file and replace the placeholder connection values.",
            "Use kind=mysql or kind=redis for each profile.",
            "Set readonly to true or false for each profile.",
            "Set timeout to the number of seconds before dbx times out the operation."
          ]
        };
      });
    });
}

function createProfileCommands(program: Command): void {
  const profile = program.command("profile").description("Inspect configured profiles");

  profile
    .command("list")
    .description("List configured profiles")
    .action(async function action(this: Command) {
      await withCliResult(async () => {
        const options = this.optsWithGlobals<GlobalOptions>();
        const { config, path } = loadConfig(options.config);
        return {
          configPath: path,
          profiles: summarizeProfiles(config)
        };
      });
    });

  profile
    .command("show")
    .description("Show a profile with secrets redacted")
    .argument("<profile>", "Profile name")
    .action(async function action(this: Command, profileName: string) {
      await withCliResult(async () => {
        const options = this.optsWithGlobals<GlobalOptions>();
        const { config, path } = loadConfig(options.config);
        const profileData = getProfile(config, profileName);
        return {
          configPath: path,
          name: profileName,
          profile: redactProfile(profileData)
        };
      });
    });
}

function createPingCommand(program: Command): void {
  program
    .command("ping")
    .description("Ping a profile")
    .argument("<profile>", "Profile name")
    .action(async function action(this: Command, profileName: string) {
      const { profile } = loadProfileFromCommand(this, profileName);
      await withCliResult(async () => {
        if (profile.kind === "mysql") {
          return await pingMysql(profile);
        }
        return await pingRedis(profile);
      }, profileContext(profileName, profile));
    });
}

function createSqlCommand(program: Command): void {
  program
    .command("sql")
    .description("Run a single MySQL statement")
    .argument("<profile>", "MySQL profile name")
    .argument("<sql>", "SQL statement")
    .action(async function action(this: Command, profileName: string, sql: string) {
      const { profile } = loadProfileFromCommand(this, profileName);
      if (profile.kind !== "mysql") {
        throw new DbxError(
          "PROFILE_KIND_MISMATCH",
          `${profileName} is not a mysql profile`,
          ExitCode.InvalidInput
        );
      }

      await withCliResult(
        async () => {
          return await runSql(profile, sql);
        },
        profileContext(profileName, profile)
      );
    });
}

function createRedisCommand(program: Command): void {
  program
    .command("redis")
    .description("Run a single Redis command")
    .argument("<profile>", "Redis profile name")
    .argument("<command>", "Redis command")
    .argument("[args...]", "Redis command arguments")
    .action(async function action(
      this: Command,
      profileName: string,
      commandName: string,
      args: string[]
    ) {
      const { profile } = loadProfileFromCommand(this, profileName);
      if (profile.kind !== "redis") {
        throw new DbxError(
          "PROFILE_KIND_MISMATCH",
          `${profileName} is not a redis profile`,
          ExitCode.InvalidInput
        );
      }

      await withCliResult(
        async () => {
          return await runRedisCommand(profile, commandName, args);
        },
        profileContext(profileName, profile)
      );
    });
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("dbx")
    .description("Unified MySQL and Redis CLI")
    .option("-c, --config <path>", "Path to profiles.yml");

  createConfigCommand(program);
  createProfileCommands(program);
  createPingCommand(program);
  createSqlCommand(program);
  createRedisCommand(program);

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();
  program.exitOverride();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed") {
        return;
      }
      const dbxError = new DbxError(
        "ARGUMENT_ERROR",
        error.message,
        ExitCode.InvalidInput
      );
      printJson(errorResult(dbxError));
      process.exit(dbxError.exitCode);
    }

    const dbxError = toDbxError(error);
    printJson(errorResult(dbxError));
    process.exit(dbxError.exitCode);
  }
}
