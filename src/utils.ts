#!/usr/bin/env tsx
import { Command } from "commander";
import { ethers as EthersT, Interface } from "ethers";

export function removeCommandIfExists(program: Command, name: string) {
  const cmds = program.commands as Command[];
  const index = cmds.findIndex(cmd => cmd.name() === name);
  if (index >= 0) {
    cmds.splice(index, 1);
  }
}

export class ErrorParser {
  private interfaces: Interface[] = [];

  addAbi(abi: EthersT.Interface | EthersT.InterfaceAbi) {
    this.interfaces.push(abi instanceof Interface ? abi : new Interface(abi));
    return this;
  }

  parseError(errorData: string): { name: string; args: any } | null {
    for (const iface of this.interfaces) {
      try {
        const parsed = iface.parseError(errorData); if (parsed) {
          const argsStr = Object.values(parsed.args)
            .map(v => typeof v === 'bigint' ? v.toString() : JSON.stringify(v))
            .join(', ');
          return { name: parsed.name, args: argsStr };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  getMessage(error: any): string {
    if (error?.data && error.data !== '0x') {
      const parsed = this.parseError(error.data);
      if (parsed) return `${parsed.name}(${parsed.args})`;
    }
    return error?.reason || error?.shortMessage || error?.message || 'Transaction failed';
  }

  catch = (error: any): never => {
    console.error('Original error:', error);
    throw new Error(this.getMessage(error));
  }
}
