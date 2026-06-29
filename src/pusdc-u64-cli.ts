#!/usr/bin/env tsx
import { registerPrivyTokenWithWhiteListAndDepositCommands } from "./erc20-commands";
import { Command } from "commander";
import { PUSDCTokenU64V2_1 } from "./token";
import { removeCommandIfExists } from "./utils";

export function registerPUSDCCLI(program: Command) {
  const token = new PUSDCTokenU64V2_1();
  registerPrivyTokenWithWhiteListAndDepositCommands(program, token);

  removeCommandIfExists(program, 'mint');
  removeCommandIfExists(program, 'burn');
}

if (require.main === module) {
  const program = new Command();
  registerPUSDCCLI(program);

  program.parseAsync().then(() => {
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }).catch(err => {
    console.error("CLI error:", err);
    process.exit(1);
  });
}
