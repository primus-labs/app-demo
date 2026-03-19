#!/usr/bin/env tsx
/**
 * eUSDC (PUSDCTokenV2_1) Concurrent / Multi-Round Test Script
 *
 * Strategy:
 *   Since all operations share the same private key (single wallet), true
 *   on-chain parallelism is not possible (nonce conflicts). Instead, this
 *   script simulates a multi-user workload by running N sequential rounds
 *   of { deposit → transfer → approveAndTransferFrom → claim } and verifying
 *   that balances remain consistent after every operation in every round.
 *
 * Prerequisites:
 *   1. .env is configured (PRIVATE_KEY, RPC_URL, PUSDC_TOKEN_ADDRESS,
 *      OZERC20_TOKEN_ADDRESS)
 *   2. npm install && npm run build has been run
 *   3. The account has enough OZ ERC20 balance for all deposit rounds
 *
 * Usage:
 *   npx tsx src/pusdc.test.core.ts
 *
 * Optional environment variables:
 *   ROUNDS=5            Number of rounds to run (default: 3)
 *   TEST_AMOUNT=0.01    Amount per operation (default: 0.01)
 *   TEST_RECIPIENT=0x.. Transfer recipient (default: self)
 *
 * Expected balance changes per round:
 *   deposit            → OZ ERC20 -amount, eUSDC +amount
 *   transfer           → self -amount, recipient +amount (net 0 if self-transfer)
 *   approveAndTransferFrom → self -amount, recipient +amount (net 0 if self-transfer)
 *   claim              → eUSDC +amount
 *
 * Net per round (self-transfer mode):
 *   OZ ERC20  : -TEST_AMOUNT  (from deposit)
 *   eUSDC     : +TEST_AMOUNT (deposit) + 0 (transfer) + 0 (transferFrom) + TEST_AMOUNT (claim) = +2*TEST_AMOUNT
 */

import { ethers } from "ethers";
import { PUSDCTokenV2_1, OZERC20Token } from "../src/token";
import 'dotenv/config';

// ─── Color utilities ───────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};
const section = (title: string) =>
  console.log(`\n${C.bold}${C.cyan}▶ ${title}${C.reset}`);
const log = (msg: string) =>
  console.log(`    ${C.dim}${msg}${C.reset}`);

// ─── Result tracking ───────────────────────────────────────────────────────────
interface RoundResult {
  round: number;
  op: string;
  status: "pass" | "fail";
  detail: string;
  error?: string;
}
const results: RoundResult[] = [];

function recordPass(round: number, op: string, detail: string) {
  results.push({ round, op, status: "pass", detail });
  console.log(`  ${C.green}✓${C.reset} [Round ${round}] ${op} → ${C.bold}${detail}${C.reset}`);
}

function recordFail(round: number, op: string, detail: string, error: string) {
  results.push({ round, op, status: "fail", detail, error });
  console.log(`  ${C.red}✗${C.reset} [Round ${round}] ${op} → ${detail}`);
  console.log(`    ${C.red}→ ${error}${C.reset}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Assertion helpers ─────────────────────────────────────────────────────────
function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assert failed: ${msg}`);
}

function assertBalanceEqual(actual: string, expected: string, label: string, tolerance = 0.000001) {
  const diff = Math.abs(parseFloat(actual) - parseFloat(expected));
  assert(diff <= tolerance, `${label}: expected ${expected}, got ${actual} (diff=${diff})`);
}

// ─── Configuration ─────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "";
const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
const OZERC20_TOKEN_ADDRESS = process.env.OZERC20_TOKEN_ADDRESS || "";
const ROUNDS = parseInt(process.env.ROUNDS || "1");
const TEST_AMOUNT = process.env.TEST_AMOUNT || "0.0001";
const TEST_AMOUNT_F = parseFloat(TEST_AMOUNT);

if (!PRIVATE_KEY || !RPC_URL || !PUSDC_TOKEN_ADDRESS) {
  console.error(`${C.red}Missing required env vars: PRIVATE_KEY / RPC_URL / PUSDC_TOKEN_ADDRESS${C.reset}`);
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const SELF_ADDRESS = wallet.address;
const RECIPIENT = process.env.TEST_RECIPIENT || SELF_ADDRESS;
const IS_SELF_TRANSFER = RECIPIENT.toLowerCase() === SELF_ADDRESS.toLowerCase();
const HAS_OZ_TOKEN = !!OZERC20_TOKEN_ADDRESS;

// ─── Balance helpers ───────────────────────────────────────────────────────────
async function getEBalance(token: PUSDCTokenV2_1, address: string): Promise<number> {
  await sleep(35000);
  const { formattedBalance } = await token.balanceOf(address);
  return parseFloat(formattedBalance);
}

async function getOZBalance(ozToken: OZERC20Token, address: string): Promise<number> {
  const { formattedBalance } = await ozToken.balanceOf(address);
  return parseFloat(formattedBalance);
}

// ─── Per-operation runners ─────────────────────────────────────────────────────

async function runDeposit(
  round: number,
  token: PUSDCTokenV2_1,
  ozToken: OZERC20Token,
  tokenSymbol: string
) {
  const op = "deposit()";
  try {
    const ozBefore = await getOZBalance(ozToken, SELF_ADDRESS);
    const eBefore = await getEBalance(token, SELF_ADDRESS);
    log(`OZ ERC20 before=${ozBefore}, eUSDC before=${eBefore}`);

    // Step 1: approve OZ ERC20 → eUSDC contract
    const { txHash: approveTx } = await ozToken.approve(PUSDC_TOKEN_ADDRESS, TEST_AMOUNT);
    assert(approveTx.startsWith("0x"), `invalid approveTx`);
    log(`approve tx: ${approveTx}`);

    // Step 2: deposit
    const { txHash: depositTx } = await token.deposit(TEST_AMOUNT);
    assert(depositTx.startsWith("0x"), `invalid depositTx`);
    log(`deposit tx: ${depositTx}`);

    // Verify: OZ ERC20 -TEST_AMOUNT
    const ozAfter = await getOZBalance(ozToken, SELF_ADDRESS);
    assertBalanceEqual(String(ozAfter), String(ozBefore - TEST_AMOUNT_F), "OZ balance after deposit");

    // Verify: eUSDC +TEST_AMOUNT
    const eAfter = await getEBalance(token, SELF_ADDRESS);
    assertBalanceEqual(String(eAfter), String(eBefore + TEST_AMOUNT_F), "eUSDC balance after deposit");

    recordPass(
      round, op,
      `OZ: ${ozBefore}→${ozAfter} (-${TEST_AMOUNT}), eUSDC: ${eBefore}→${eAfter} ${tokenSymbol} (+${TEST_AMOUNT})`
    );
  } catch (e: any) {
    recordFail(round, op, `amount=${TEST_AMOUNT}`, e?.message ?? String(e));
  }
}

async function runTransfer(
  round: number,
  token: PUSDCTokenV2_1,
  tokenSymbol: string
) {
  const op = "transfer()";
  try {
    const selfBefore = await getEBalance(token, SELF_ADDRESS);
    const recipientBefore = IS_SELF_TRANSFER
      ? selfBefore
      : await getEBalance(token, RECIPIENT);
    log(`self before=${selfBefore}, recipient before=${recipientBefore}`);

    const { txHash } = await token.transfer(RECIPIENT, TEST_AMOUNT);
    assert(txHash.startsWith("0x"), `invalid txHash`);
    log(`tx: ${txHash}`);

    const selfAfter = await getEBalance(token, SELF_ADDRESS);
    const recipientAfter = IS_SELF_TRANSFER
      ? selfAfter
      : await getEBalance(token, RECIPIENT);

    if (IS_SELF_TRANSFER) {
      // Net change should be 0
      assertBalanceEqual(String(selfAfter), String(selfBefore), "self balance after self-transfer");
      recordPass(round, op, `self: ${selfBefore}→${selfAfter} ${tokenSymbol} (self-transfer, net 0)`);
    } else {
      assertBalanceEqual(String(selfAfter), String(selfBefore - TEST_AMOUNT_F), "self balance after transfer");
      assertBalanceEqual(String(recipientAfter), String(recipientBefore + TEST_AMOUNT_F), "recipient balance after transfer");
      recordPass(round, op, `self: ${selfBefore}→${selfAfter}, recipient: ${recipientBefore}→${recipientAfter} ${tokenSymbol}`);
    }
  } catch (e: any) {
    recordFail(round, op, `amount=${TEST_AMOUNT}`, e?.message ?? String(e));
  }
}

async function runApproveAndTransferFrom(
  round: number,
  token: PUSDCTokenV2_1,
  tokenSymbol: string
) {
  const op = "approveAndTransferFrom()";
  try {
    const selfBefore = await getEBalance(token, SELF_ADDRESS);
    const recipientBefore = IS_SELF_TRANSFER
      ? selfBefore
      : await getEBalance(token, RECIPIENT);
    log(`self before=${selfBefore}, recipient before=${recipientBefore}`);

    // Step 1: approve
    const { txHash: approveTx } = await token.approve(SELF_ADDRESS, TEST_AMOUNT);
    assert(approveTx.startsWith("0x"), `invalid approveTx`);
    log(`approve tx: ${approveTx}`);

    // Verify allowance updated
    const { formattedAllowance } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
    assertBalanceEqual(formattedAllowance, TEST_AMOUNT, "allowance after approve");
    log(`allowance=${formattedAllowance} ✓`);

    // Step 2: transferFrom
    const { txHash: transferTx } = await token.transferFrom(SELF_ADDRESS, RECIPIENT, TEST_AMOUNT);
    assert(transferTx.startsWith("0x"), `invalid transferTx`);
    log(`transferFrom tx: ${transferTx}`);

    const selfAfter = await getEBalance(token, SELF_ADDRESS);
    const recipientAfter = IS_SELF_TRANSFER
      ? selfAfter
      : await getEBalance(token, RECIPIENT);

    if (IS_SELF_TRANSFER) {
      assertBalanceEqual(String(selfAfter), String(selfBefore), "self balance after self-transferFrom");
    } else {
      assertBalanceEqual(String(selfAfter), String(selfBefore - TEST_AMOUNT_F), "self balance after transferFrom");
      assertBalanceEqual(String(recipientAfter), String(recipientBefore + TEST_AMOUNT_F), "recipient balance after transferFrom");
    }

    // Verify allowance fully consumed
    const { formattedAllowance: allowanceAfter } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
    assertBalanceEqual(allowanceAfter, "0", "allowance should be 0 after transferFrom");
    log(`allowance after transferFrom=${allowanceAfter} ✓`);

    const detail = IS_SELF_TRANSFER
      ? `self: ${selfBefore}→${selfAfter} ${tokenSymbol} (net 0), allowance: ${TEST_AMOUNT}→0`
      : `self: ${selfBefore}→${selfAfter}, recipient: ${recipientBefore}→${recipientAfter} ${tokenSymbol}, allowance: ${TEST_AMOUNT}→0`;
    recordPass(round, op, detail);
  } catch (e: any) {
    recordFail(round, op, `amount=${TEST_AMOUNT}`, e?.message ?? String(e));
  }
}

async function runClaim(
  round: number,
  token: PUSDCTokenV2_1,
  tokenSymbol: string
) {
  const op = "claim()";
  try {
    const balanceBefore = await getEBalance(token, SELF_ADDRESS);
    log(`balance before=${balanceBefore}`);

    const { txHash } = await token.claim(SELF_ADDRESS, TEST_AMOUNT);
    assert(txHash.startsWith("0x"), `invalid txHash`);
    log(`tx: ${txHash}`);

    const balanceAfter = await getEBalance(token, SELF_ADDRESS);
    assertBalanceEqual(String(balanceAfter), String(balanceBefore - TEST_AMOUNT_F), "balance after claim");

    recordPass(round, op, `${balanceBefore}→${balanceAfter} ${tokenSymbol} (+${TEST_AMOUNT})`);
  } catch (e: any) {
    recordFail(round, op, `amount=${TEST_AMOUNT}`, e?.message ?? String(e));
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}eUSDC Multi-Round Concurrent Test${C.reset}`);
  console.log(`  Account   : ${SELF_ADDRESS}`);
  console.log(`  Recipient : ${RECIPIENT}`);
  console.log(`  Rounds    : ${ROUNDS}`);
  console.log(`  Amount    : ${TEST_AMOUNT} per operation`);
  console.log(`  Self-xfer : ${IS_SELF_TRANSFER}`);
  console.log(`  Has OZ    : ${HAS_OZ_TOKEN}`);

  const token = new PUSDCTokenV2_1();
  const ozToken = new OZERC20Token();
  const tokenSymbol = await token.symbol();

  // ── Initial state snapshot ─────────────────────────────────────────────────
  section("Initial State");
  const initEBalance = await getEBalance(token, SELF_ADDRESS);
  const initOZBalance = HAS_OZ_TOKEN ? await getOZBalance(ozToken, SELF_ADDRESS) : 0;
  console.log(`  eUSDC balance : ${initEBalance} ${tokenSymbol}`);
  if (HAS_OZ_TOKEN) {
    console.log(`  OZ ERC20      : ${initOZBalance}`);
    // Pre-flight check: enough OZ balance for all deposit rounds
    const requiredOZ = TEST_AMOUNT_F * ROUNDS;
    if (initOZBalance < requiredOZ) {
      console.error(
        `${C.red}Insufficient OZ ERC20 balance: have ${initOZBalance}, need ${requiredOZ} for ${ROUNDS} rounds${C.reset}`
      );
      process.exit(1);
    }
  }

  // ── Sequential rounds ──────────────────────────────────────────────────────
  for (let round = 1; round <= ROUNDS; round++) {
    section(`Round ${round} / ${ROUNDS}`);

    if (HAS_OZ_TOKEN) {
      await runDeposit(round, token, ozToken, tokenSymbol);
    } else {
      console.log(`  ${C.yellow}○${C.reset} [Round ${round}] deposit() (skipped — OZERC20_TOKEN_ADDRESS not set)`);
    }

    await runTransfer(round, token, tokenSymbol);
    await runApproveAndTransferFrom(round, token, tokenSymbol);
    await runClaim(round, token, tokenSymbol);
  }

  // ── Final state snapshot & overall balance verification ────────────────────
  section("Final State");
  const finalEBalance = await getEBalance(token, SELF_ADDRESS);
  const finalOZBalance = HAS_OZ_TOKEN ? await getOZBalance(ozToken, SELF_ADDRESS) : 0;
  console.log(`  eUSDC balance : ${finalEBalance} ${tokenSymbol}`);
  if (HAS_OZ_TOKEN) {
    console.log(`  OZ ERC20      : ${finalOZBalance}`);

    // Expected net across all rounds:
    //   OZ:    initial - TEST_AMOUNT * ROUNDS
    //   eUSDC: initial + TEST_AMOUNT * 2 * ROUNDS  (deposit + claim each round)
    const expectedOZ = initOZBalance;
    const expectedE = initEBalance;
    console.log(`\n  Expected OZ ERC20 : ${expectedOZ}`);
    console.log(`  Expected eUSDC    : ${expectedE} ${tokenSymbol}`);

    const ozOk = Math.abs(finalOZBalance - expectedOZ) <= 0.000001;
    const eOk = Math.abs(finalEBalance - expectedE) <= 0.000001;

    if (ozOk && eOk) {
      console.log(`  ${C.green}✓ Final balances match expected values${C.reset}`);
    } else {
      console.log(`  ${C.red}✗ Final balance mismatch`);
      if (!ozOk) console.log(`    OZ ERC20 : got ${finalOZBalance}, expected ${expectedOZ}${C.reset}`);
      if (!eOk)  console.log(`    eUSDC    : got ${finalEBalance}, expected ${expectedE}${C.reset}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalPass = results.filter(r => r.status === "pass").length;
  const totalFail = results.filter(r => r.status === "fail").length;

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${C.bold}Results: ${ROUNDS} rounds × 4 ops = ${results.length} operations  ` +
    `${C.green}${totalPass} passed${C.reset}  ${C.red}${totalFail} failed${C.reset}`
  );

  if (totalFail > 0) {
    console.log(`\n${C.red}${C.bold}Failed operations:${C.reset}`);
    results
      .filter(r => r.status === "fail")
      .forEach(r => console.log(`  ${C.red}✗${C.reset} [Round ${r.round}] ${r.op}: ${r.error}`));
    process.exit(1);
  } else {
    console.log(`\n${C.green}All ${results.length} operations passed across ${ROUNDS} rounds!${C.reset}`);
  }
}

main().catch(err => {
  console.error(`\n${C.red}Uncaught error: ${err?.message ?? err}${C.reset}`);
  process.exit(1);
});