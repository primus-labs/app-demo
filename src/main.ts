import { Command } from "commander";
import { ethers as EthersT, Wallet } from "ethers";
import { privyTokenABI } from "./privyTokenABIV2_1";
import 'dotenv/config';
import { requestEncrypt, requestDecrypt, FheType } from "@primuslabs/fhe-sdk/dist";
import { getACLContract as _getACLContract } from "@primuslabs/fhe-sdk/dist/utils";


const isMock = (process.env.MOCK_TEST == "ON");
const verbose = 0;
const program = new Command();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "";
const ACL_ADDRESS = process.env.ACL_ADDRESS || "";
const PRIVY_TOKEN_ADDRESS = process.env.PRIVY_TOKEN_ADDRESS || "";
const ALPHA_TRION_RPC_URL = process.env.ALPHA_TRION_RPC_URL || "";
if (verbose > 0) {
  if (verbose > 2) {
    console.log("PRIVATE_KEY ", PRIVATE_KEY);
  }
  console.log("RPC_URL ", RPC_URL);
  console.log("ACL_ADDRESS ", ACL_ADDRESS);
  console.log("PRIVY_TOKEN_ADDRESS ", PRIVY_TOKEN_ADDRESS);
  console.log("ALPHA_TRION_RPC_URL ", ALPHA_TRION_RPC_URL);
}


const provider = new EthersT.JsonRpcProvider(RPC_URL);
const signer = PRIVATE_KEY ? new EthersT.Wallet(PRIVATE_KEY, provider) : null;

// ================= Helpers =================

function getPrivyTokenContract() {
  return new EthersT.Contract(PRIVY_TOKEN_ADDRESS, privyTokenABI, signer ?? provider);
}
function getACLContract() {
  return _getACLContract(ACL_ADDRESS, signer ?? provider);
}

async function encrypt(value: number | bigint) {
  return await requestEncrypt(
    signer as Wallet,
    ACL_ADDRESS,
    value,
    FheType.ve_uint64,
    null,
    { isMock: isMock }
  );
}

async function decrypt(handle: string, timeout: number = 30000) {
  return await requestDecrypt(
    signer as Wallet,
    ACL_ADDRESS,
    FheType.ve_uint64,
    handle,
    { isMock: isMock, timeout: timeout }
  );
}

// ================= CLI Commands =================
program
  .name("npm run main --")
  .version("1.0.0");

program
  .command("name")
  .description("Returns the name of the token.")
  .action(async (_opts) => {
    const contract = getPrivyTokenContract();
    console.log("Token name:", await contract.name());
  });

program
  .command("symbol")
  .description("Returns the symbol of the token, a shorter version of the name.")
  .action(async (_opts) => {
    const contract = getPrivyTokenContract();
    console.log("Token symbol:", await contract.symbol());
  });

program
  .command("decimals")
  .description("Returns the number of decimals used to get its user representation.")
  .action(async (_opts) => {
    const contract = getPrivyTokenContract();
    console.log("Token decimals:", await contract.decimals());
  });

program
  .command("totalSupply")
  .description("Returns the value of tokens in existence.")
  .action(async (opts) => {
    const contract = getPrivyTokenContract();
    const totalSupplyHandle = await contract.totalSupply();
    console.log("TotalSupply handle", totalSupplyHandle);

    const supply = await decrypt(totalSupplyHandle);
    const decimals = await contract.decimals();
    console.log("TotalSupply:", EthersT.formatUnits(supply, decimals));
  });

program
  .command("balanceOf")
  .requiredOption("--account <address>", "Account address")
  .description("Returns the value of tokens owned by `account`.")
  .action(async (opts) => {
    const contract = getPrivyTokenContract();
    const balanceHandle = await contract.balanceOf(opts.account);
    console.log("Balance handle", balanceHandle);

    const balance = await decrypt(balanceHandle);
    const decimals = await contract.decimals();
    console.log("Balance", EthersT.formatUnits(balance, decimals));
  });

program
  .command("allowance")
  .requiredOption("--owner <address>", "Owner address")
  .requiredOption("--spender <address>", "Spender address")
  .description("Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner` through {transferFrom}.")
  .action(async (opts) => {
    const contract = getPrivyTokenContract();
    const allowanceHandle = await contract.allowance(opts.owner, opts.spender);
    console.log("Allowance handle", allowanceHandle);

    const allowance = await decrypt(allowanceHandle);
    const decimals = await contract.decimals();
    console.log("Allowance", EthersT.formatUnits(allowance, decimals));
  });


program
  .command("mint")
  .requiredOption("--amount <value>", "Token amount (human-readable)")
  .description("Creates a value `amount` of tokens and assigns them to msg.sender, by transferring it from address(0).")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for mint");
    const contract = getPrivyTokenContract();
    const decimals = await contract.decimals();

    const amountHandle = await encrypt(EthersT.parseUnits(opts.amount, decimals));
    console.log("Amount handle", "0x" + Buffer.from(amountHandle.handle).toString("hex"));
    const tx = await contract.mint(amountHandle);
    console.log("Mint tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });

program
  .command("burn")
  .requiredOption("--amount <value>", "Token amount (human-readable)")
  .description("Destroys a value `amount` of tokens from msg.sender, lowering the balance of msg.sender and the total supply.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for burn");
    const contract = getPrivyTokenContract();
    const decimals = await contract.decimals();

    const amountHandle = await encrypt(EthersT.parseUnits(opts.amount, decimals));
    console.log("Amount handle", "0x" + Buffer.from(amountHandle.handle).toString("hex"));
    const tx = await contract.burn(amountHandle);
    console.log("Burn tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });



program
  .command("transfer")
  .requiredOption("--to <address>", "Recipient address")
  .requiredOption("--amount <value>", "Token amount (human-readable)")
  .description("Moves a value `amount` of tokens from the caller's account to `to`.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for transfer");
    const contract = getPrivyTokenContract();
    const decimals = await contract.decimals();

    const amountHandle = await encrypt(EthersT.parseUnits(opts.amount, decimals));
    console.log("Amount handle", "0x" + Buffer.from(amountHandle.handle).toString("hex"));
    const tx = await contract.transfer(opts.to, amountHandle);
    console.log("Transfer tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });

program
  .command("approve")
  .requiredOption("--spender <address>", "Spender address")
  .requiredOption("--amount <value>", "Token amount (human-readable)")
  .description("Sets a value `amount` of tokens as the allowance of `spender` over the caller's tokens.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for approve");
    const contract = getPrivyTokenContract();
    const decimals = await contract.decimals();

    const amountHandle = await encrypt(EthersT.parseUnits(opts.amount, decimals));
    console.log("Amount handle", "0x" + Buffer.from(amountHandle.handle).toString("hex"));
    const tx = await contract.approve(opts.spender, amountHandle);
    console.log("Approve tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });

program
  .command("transferFrom")
  .requiredOption("--from <address>", "Sender address")
  .requiredOption("--to <address>", "Recipient address")
  .requiredOption("--amount <value>", "Token amount (human-readable)")
  .description("Moves a value `amount` of tokens from `from` to `to` using the allowance mechanism. `value` is then deducted from the caller's allowance.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for transferFrom");
    const contract = getPrivyTokenContract();
    const decimals = await contract.decimals();

    const amountHandle = await encrypt(EthersT.parseUnits(opts.amount, decimals));
    console.log("Amount handle", "0x" + Buffer.from(amountHandle.handle).toString("hex"));
    const tx = await contract.transferFrom(opts.from, opts.to, amountHandle);
    console.log("TransferFrom tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });


program
  .command("transferOwnership")
  .requiredOption("--to <address>", "The account of new owner")
  .description("Transfers the contract ownership to `to`.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for transferOwnership");
    const contract = getPrivyTokenContract();
    const tx = await contract.transferOwnership(opts.to);
    console.log("transferOwnership tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });

program
  .command("addToWhitelist")
  .requiredOption("--account <address>", "The account to add to whitelist")
  .description("Adds an `account` to the whitelist.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for addToWhitelist");
    const contract = getPrivyTokenContract();
    const tx = await contract.addToWhitelist(opts.account);
    console.log("addToWhitelist tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });

program
  .command("removeFromWhitelist")
  .requiredOption("--account <address>", "The account to remove from whitelist")
  .description("Removes an `account` from the whitelist.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for removeFromWhitelist");
    const contract = getPrivyTokenContract();
    const tx = await contract.removeFromWhitelist(opts.account);
    console.log("removeFromWhitelist tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed");
  });


program
  .command("isWhitelisted")
  .requiredOption("--account <address>", "The account address")
  .description("Determines whether the `account` is on the whitelist.")
  .action(async (opts) => {
    if (!signer) throw new Error("PRIVATE_KEY required for isWhitelisted");
    const contract = getPrivyTokenContract();
    const isWhitelisted = await contract.isWhitelisted(opts.account);
    console.log("isWhitelisted:", isWhitelisted);
  });

program
  .command("getFullWhitelist")
  .description("Retrieves the whitelist.")
  .action(async (opts) => {
    const contract = getPrivyTokenContract();
    const fullWhitelist = await contract.getFullWhitelist();
    console.log("Full whitelist", fullWhitelist);
  });

program
  .command("getTotalHandles")
  .description("Retrieves all handles for contract status variables, including historical values.")
  .action(async (opts) => {
    const contract = getPrivyTokenContract();
    const totalHandles = await contract.getTotalHandles();
    console.log("Total handles", totalHandles);
  });


program
  .command("allowForDecryption")
  .requiredOption("--handle <value>", "Ciphertext handle(bytes32)")
  .option("--account <address>", "The account to grant decryption permission to")
  .description("Grants decryption permission for the `handle` to the specified `account`. If no `account` is provided, the `handle` will be decryptable by anyone.")
  .action(async (opts) => {
    console.log("allowForDecryption called with:", opts);
    const contract = getACLContract();
    if (!opts.account) {
      const tx = await contract.allowForDecryption([opts.handle]);
      console.log("allowForDecryption tx:", tx.hash);
      await tx.wait();
      console.log("Confirmed");
    } else {
      const tx = await contract['accessPolicy(bytes32,address,uint8)'](opts.handle, opts.account, 2);
      console.log("allowForDecryption tx:", tx.hash);
      await tx.wait();
      console.log("Confirmed");
    }
  });


// program
//   .command("encrypt")
//   .requiredOption("--input <value>", "Plaintext value(integer)")
//   .description("Encrypts the `input` and return a `handle`.")
//   .action(async (opts) => {
//     const inputHandle = await encrypt(opts.input);
//     console.log("Handle", "0x" + Buffer.from(inputHandle.handle).toString("hex"));
//   });

program
  .command("decrypt")
  .requiredOption("--handle <value>", "Ciphertext handle(bytes32)")
  .description("Retrieves the plaintext corresponding to the `handle`.")
  .action(async (opts) => {
    const value = await decrypt(opts.handle);
    console.log("Decrypted:", value);
  });


// main.ts
program.parseAsync().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});