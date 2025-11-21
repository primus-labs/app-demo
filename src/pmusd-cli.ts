#!/usr/bin/env tsx
import { registerPrivyTokenWithWhiteListCommands } from "./erc20-commands";
import { Command } from "commander";
import { PMUSDTokenV2_1 } from "./token";

function removeCommandIfExists(program: Command, name: string) {
  const cmds = program.commands as Command[];
  const index = cmds.findIndex(cmd => cmd.name() === name);
  if (index >= 0) {
    cmds.splice(index, 1);
  }
}

export function registerPMUSDCLI(program: Command) {
  const token = new PMUSDTokenV2_1();
  registerPrivyTokenWithWhiteListCommands(program, token);

  removeCommandIfExists(program, 'mint');
  removeCommandIfExists(program, 'burn');

  program
    .command("deposit")
    .description("Deposit a `amount` amount of tokens from erc20 to eUSDC contract")
    .requiredOption("-a, --amount <amount>", "Amount to deposit")
    .action(async (opts) => {
      await token.deposit(opts.amount);
    });

  program
    .command("claim")
    .description("Claim a `amount` amount of tokens to `to`")
    .requiredOption("-t, --to <address>", "Recipient address")
    .requiredOption("-a, --amount <amount>", "Amount to claim")
    .action(async (opts) => {
      await token.claim(opts.to, opts.amount);
    });

  program
    .command("addOracle")
    .description("Add a `oracle` (only onwer)")
    .requiredOption("-o, --oracle <address>", "Oracle address")
    .action(async (opts) => {
      await token.addOracle(opts.oracle);
    });

  program
    .command("removeOracle")
    .description("Remove a `oracle` (only onwer)")
    .requiredOption("-o, --oracle <address>", "Oracle address")
    .action(async (opts) => {
      await token.removeOracle(opts.oracle);
    });
}

if (require.main === module) {
  const program = new Command();
  registerPMUSDCLI(program);
  program.parseAsync();
}
