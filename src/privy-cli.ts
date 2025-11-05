#!/usr/bin/env tsx
import { registerPrivyTokenWithWhiteListCommands } from "./erc20-commands";
import { Command } from "commander";
import { PrivyTokenU64V2_1 } from "./token";

export function registerPrivyU64CLI(program: Command) {
  const token = new PrivyTokenU64V2_1();
  registerPrivyTokenWithWhiteListCommands(program, token);
}

if (require.main === module) {
  const program = new Command();
  registerPrivyU64CLI(program);
  program.parseAsync();
}
