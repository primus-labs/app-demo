#!/usr/bin/env tsx
import { registerErc20TokenCommands } from "./erc20-commands";
import { Command } from "commander";
import { OZERC20Token } from "./token";

export function registerOZCLI(program: Command) {
  const token = new OZERC20Token();
  registerErc20TokenCommands(program, token);
}

if (require.main === module) {
  const program = new Command();
  registerOZCLI(program);
  program.parseAsync();
}
