#!/usr/bin/env tsx
import { Command } from "commander";

export function removeCommandIfExists(program: Command, name: string) {
  const cmds = program.commands as Command[];
  const index = cmds.findIndex(cmd => cmd.name() === name);
  if (index >= 0) {
    cmds.splice(index, 1);
  }
}
