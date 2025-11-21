#!/usr/bin/env tsx
import { registerPrivyTokenWithWhiteListAndDepositCommands } from "./erc20-commands";
import { Command } from "commander";
import { PMUSDTokenV2_1 } from "./token";
import { removeCommandIfExists } from "./utils";

export function registerPMUSDCLI(program: Command) {
  const token = new PMUSDTokenV2_1();
  registerPrivyTokenWithWhiteListAndDepositCommands(program, token);

  removeCommandIfExists(program, 'mint');
  removeCommandIfExists(program, 'burn');
}

if (require.main === module) {
  const program = new Command();
  registerPMUSDCLI(program);
  program.parseAsync();
}
