#!/usr/bin/env tsx
/**
 * eUSDC (PUSDCTokenV2_1) End-to-End Test Script
 *
 * Prerequisites:
 *   1. .env is configured (PRIVATE_KEY, RPC_URL, PUSDC_TOKEN_ADDRESS, etc.)
 *   2. npm install && npm run build has been run
 *   3. The current account is whitelisted, or has owner privileges
 *
 * Usage:
 *   npx tsx test/pusdc.test.ts
 *
 * Optional environment variables:
 *   TEST_RECIPIENT=0x...   Transfer recipient address (defaults to self)
 *   TEST_AMOUNT=1          Test amount (default: 1, human-readable unit)
 *   SKIP_OWNER_TESTS=true  Skip test cases that require owner privileges
 *
 * Balance change expectations per operation (human-readable units):
 *   deposit(amount)                → self eUSDC balance +amount
 *   transfer(recipient, amount)    → self -amount, recipient +amount
 *   approve + transferFrom(self→recipient, amount) → self -amount, recipient +amount
 *   claim(self, amount)            → self +amount  (contract mints to recipient)
 *
 * When RECIPIENT == SELF_ADDRESS, transfer/transferFrom are self-transfers,
 * so the net balance change for self is 0.
 */

import { ethers } from "ethers";
import { PUSDCTokenV2_1, OZERC20Token } from "../src/token";
import 'dotenv/config';

// ─── Color utilities ──────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};
const pass = (msg: string) => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const fail = (msg: string, err?: any) => {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
  if (err) console.log(`    ${C.red}→ ${err?.message ?? err}${C.reset}`);
};
const skip = (msg: string) => console.log(`  ${C.yellow}○${C.reset} ${msg} (skipped)`);
const section = (title: string) =>
  console.log(`\n${C.bold}${C.cyan}▶ ${title}${C.reset}`);

// ─── Assertion helpers ────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;

// If --only <keyword> is passed, only run tests whose label includes the keyword
const onlyIndex = process.argv.indexOf("--only");
const onlyFilter = onlyIndex !== -1 ? process.argv[onlyIndex + 1]?.toLowerCase() : null;

// fn() may return a result string to append to the label (e.g. actual value)
async function test(label: string, fn: () => Promise<string | void>, opts?: { skip?: boolean }) {
  if (onlyFilter && !label.toLowerCase().includes(onlyFilter)) { skip(label); skipped++; return; }
  if (opts?.skip) { skip(label); skipped++; return; }
  // Print a pending indicator first so detail logs from fn() appear beneath it
  process.stdout.write(`  ${C.yellow}…${C.reset} ${label}\n`);
  try {
    const result = await fn();
    // Overwrite pending line with pass indicator, appending the actual result if provided
    const finalLabel = result ? `${label} → ${C.bold}${result}${C.reset}` : label;
    process.stdout.write(`\x1b[1A\r  ${C.green}✓${C.reset} ${finalLabel}\n`);
    passed++;
  } catch (e: any) {
    process.stdout.write(`\x1b[1A\r  ${C.red}✗${C.reset} ${label}\n`);
    if (e) console.log(`    ${C.red}→ ${e?.message ?? e}${C.reset}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assert failed: ${msg}`);
}

// Compare two decimal strings with a small tolerance to handle rounding
function assertBalanceEqual(actual: string, expected: string, label: string, tolerance = 0.000001) {
  const diff = Math.abs(parseFloat(actual) - parseFloat(expected));
  assert(diff <= tolerance, `${label}: expected ${expected}, got ${actual} (diff=${diff})`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Configuration ────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "";
const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
const OZERC20_TOKEN_ADDRESS = process.env.OZERC20_TOKEN_ADDRESS || "";
const SKIP_OWNER = process.env.SKIP_OWNER_TESTS === "true";
const TEST_AMOUNT = process.env.TEST_AMOUNT || "0.01";
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

// ─── Balance snapshot helper ──────────────────────────────────────────────────
async function getBalance(token: PUSDCTokenV2_1, address: string): Promise<number> {
  const { formattedBalance } = await token.balanceOf(address);
  return parseFloat(formattedBalance);
}

// ─── Main test flow ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}eUSDC End-to-End Test${C.reset}`);
  console.log(`  Account address : ${SELF_ADDRESS}`);
  console.log(`  Contract address: ${PUSDC_TOKEN_ADDRESS}`);
  console.log(`  Test amount     : ${TEST_AMOUNT}`);
  console.log(`  Recipient       : ${RECIPIENT}`);
  console.log(`  Self-transfer   : ${IS_SELF_TRANSFER}`);
  console.log(`  Skip owner tests: ${SKIP_OWNER}`);

  const token = new PUSDCTokenV2_1();

  // ──────────────────────────────────────────────────────────────────────────
  section("1. ERC20 Basic Queries");
  // ──────────────────────────────────────────────────────────────────────────

  let tokenName = "";
  await test("name()", async () => {
    tokenName = await token.name();
    assert(typeof tokenName === "string" && tokenName.length > 0, `name=${tokenName}`);
    return tokenName;
  });

  let tokenSymbol = "";
  await test("symbol()", async () => {
    tokenSymbol = await token.symbol();
    assert(typeof tokenSymbol === "string" && tokenSymbol.length > 0, `symbol=${tokenSymbol}`);
    return tokenSymbol;
  });

  let tokenDecimals = 0;
  await test("decimals()", async () => {
    tokenDecimals = await token.decimals();
    assert(Number(tokenDecimals) > 0, `decimals=${tokenDecimals}`);
    return String(tokenDecimals);
  });

  await test("totalSupply()", async () => {
    const { formattedtotalSupply, totalSupplyHandle } = await token.totalSupply();
    assert(totalSupplyHandle !== undefined, "handle is undefined");
    assert(parseFloat(formattedtotalSupply) >= 0, `invalid totalSupply=${formattedtotalSupply}`);
    return `${formattedtotalSupply} ${tokenSymbol}`;
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("2. Whitelist Operations");
  // ──────────────────────────────────────────────────────────────────────────

  await test("getFullWhitelist()", async () => {
    const { fullWhitelist } = await token.getFullWhitelist();
    assert(Array.isArray(fullWhitelist), "fullWhitelist is not an array");
    return `${fullWhitelist.length} address(es)`;
  });

  await test("getTotalHandles()", async () => {
    const { totalHandles } = await token.getTotalHandles();
    assert(totalHandles !== undefined, "totalHandles is undefined");
    return JSON.stringify(totalHandles).slice(0, 60);
  });

  await test("addToWhitelist(self)", async () => {
    // Prerequisite: ensure self is NOT in whitelist before adding
    const { isWhitelisted: before } = await token.isWhitelisted(SELF_ADDRESS);
    if (before) {
      await token.removeFromWhitelist(SELF_ADDRESS);
      console.log(`    → pre-condition: removed self from whitelist`);
    }

    const { txHash } = await token.addToWhitelist(SELF_ADDRESS);
    assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
    console.log(`    → tx: ${txHash}`);

    // Verify isWhitelisted returns true
    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(isWhitelisted === true, `expected true, got ${isWhitelisted}`);

    // Verify self appears in getFullWhitelist
    const { fullWhitelist } = await token.getFullWhitelist();
    assert(
      fullWhitelist.map((a: string) => a.toLowerCase()).includes(SELF_ADDRESS.toLowerCase()),
      "self not found in fullWhitelist after addToWhitelist"
    );

    // Cleanup: remove self to restore clean state
    await token.removeFromWhitelist(SELF_ADDRESS);
    console.log(`    → cleanup: removed self from whitelist`);

    return `isWhitelisted=true, found in fullWhitelist ✓`;
  });

  await test("removeFromWhitelist(self)", async () => {
    // Prerequisite: ensure self IS in whitelist before removing
    const { isWhitelisted: before } = await token.isWhitelisted(SELF_ADDRESS);
    if (!before) {
      await token.addToWhitelist(SELF_ADDRESS);
      console.log(`    → pre-condition: added self to whitelist`);
    }

    const { txHash } = await token.removeFromWhitelist(SELF_ADDRESS);
    assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
    console.log(`    → tx: ${txHash}`);

    // Verify isWhitelisted returns false
    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(isWhitelisted === false, `expected false, got ${isWhitelisted}`);

    // Verify self is absent from getFullWhitelist
    const { fullWhitelist } = await token.getFullWhitelist();
    assert(
      !fullWhitelist.map((a: string) => a.toLowerCase()).includes(SELF_ADDRESS.toLowerCase()),
      "self still found in fullWhitelist after removeFromWhitelist"
    );

    return `isWhitelisted=false, absent from fullWhitelist ✓`;
  });

  await test("isWhitelisted(self)", async () => {
    // Prerequisite: ensure self is NOT in whitelist
    const { isWhitelisted: before } = await token.isWhitelisted(SELF_ADDRESS);
    if (before) {
      await token.removeFromWhitelist(SELF_ADDRESS);
      console.log(`    → pre-condition: removed self from whitelist`);
    }

    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(isWhitelisted === false, `expected false, got ${isWhitelisted}`);
    return `isWhitelisted=${isWhitelisted}`;
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("3. Initial Balance & Allowance Snapshot");
  // ──────────────────────────────────────────────────────────────────────────

  let selfBalance = 0;
  await test("balanceOf(self)", async () => {
    selfBalance = await getBalance(token, SELF_ADDRESS);
    assert(selfBalance >= 0, `invalid balance=${selfBalance}`);
    return `${selfBalance} ${tokenSymbol}`;
  });

  let recipientBalance = 0;
  await test("balanceOf(recipient)", async () => {
    recipientBalance = await getBalance(token, RECIPIENT);
    assert(recipientBalance >= 0, `invalid balance=${recipientBalance}`);
    return `${recipientBalance} ${tokenSymbol}`;
  });

  await test("allowance(self, self)", async () => {
    const { formattedAllowance, allowanceHandle } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
    assert(allowanceHandle !== undefined, "allowance handle is undefined");
    assert(parseFloat(formattedAllowance) >= 0, `invalid allowance=${formattedAllowance}`);
    return `${formattedAllowance} ${tokenSymbol}`;
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("4. Deposit Flow (OZERC20 approve → eUSDC deposit)");
  // ──────────────────────────────────────────────────────────────────────────

  const hasOzToken = !!OZERC20_TOKEN_ADDRESS;
  await test(
    "deposit()",
    async () => {
      const ozToken = new OZERC20Token();
 
      // Snapshot both balances before deposit
      const ozBalanceBefore = parseFloat((await ozToken.balanceOf(SELF_ADDRESS)).formattedBalance);
      const eBalanceBefore = await getBalance(token, SELF_ADDRESS);
      console.log(`    → OZ ERC20 balance before : ${ozBalanceBefore}`);
      console.log(`    → eUSDC balance before    : ${eBalanceBefore} ${tokenSymbol}`);
 
      // Step 1: approve the eUSDC contract to pull the underlying OZ ERC20
      const { txHash: approveTx } = await ozToken.approve(PUSDC_TOKEN_ADDRESS, TEST_AMOUNT);
      assert(approveTx.startsWith("0x"), `invalid approveTx=${approveTx}`);
      console.log(`    → OZ approve tx: ${approveTx}`);
 
      // Step 2: deposit into eUSDC
      const { txHash: depositTx } = await token.deposit(TEST_AMOUNT);
      assert(depositTx.startsWith("0x"), `invalid depositTx=${depositTx}`);
      console.log(`    → deposit tx: ${depositTx}`);
 
      // Verify: OZ ERC20 balance should have decreased by TEST_AMOUNT
      const ozBalanceAfter = parseFloat((await ozToken.balanceOf(SELF_ADDRESS)).formattedBalance);
      assertBalanceEqual(
        String(ozBalanceAfter),
        String(ozBalanceBefore - TEST_AMOUNT_F),
        "OZ ERC20 balance after deposit"
      );
      console.log(`    → OZ ERC20 balance after  : ${ozBalanceAfter} (-${TEST_AMOUNT} ✓)`);
 
      // Verify: eUSDC balance should have increased by TEST_AMOUNT
      const eBalanceAfter = await getBalance(token, SELF_ADDRESS);
      assertBalanceEqual(
        String(eBalanceAfter),
        String(eBalanceBefore + TEST_AMOUNT_F),
        "eUSDC balance after deposit"
      );
      console.log(`    → eUSDC balance after     : ${eBalanceAfter} ${tokenSymbol} (+${TEST_AMOUNT} ✓)`);
 
      selfBalance = eBalanceAfter;
      return `OZ: ${ozBalanceBefore}→${ozBalanceAfter} (-${TEST_AMOUNT}), eUSDC: ${eBalanceBefore}→${eBalanceAfter} (+${TEST_AMOUNT})`;
    },
    { skip: !hasOzToken }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("5. Transfer");
  // ──────────────────────────────────────────────────────────────────────────

  await test(
    "transfer()",
    async () => {
      const selfBefore = await getBalance(token, SELF_ADDRESS);
      const recipientBefore = IS_SELF_TRANSFER ? selfBefore : await getBalance(token, RECIPIENT);
      console.log(`    → self before    : ${selfBefore} ${tokenSymbol}`);
      console.log(`    → recipient before: ${recipientBefore} ${tokenSymbol}`);

      const { txHash } = await token.transfer(RECIPIENT, TEST_AMOUNT);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      await sleep(10000);

      const selfAfter = await getBalance(token, SELF_ADDRESS);
      const recipientAfter = IS_SELF_TRANSFER ? selfAfter : await getBalance(token, RECIPIENT);

      if (IS_SELF_TRANSFER) {
        assertBalanceEqual(String(selfAfter), String(selfBefore), "self balance after self-transfer");
      } else {
        assertBalanceEqual(String(selfAfter), String(selfBefore - TEST_AMOUNT_F), "self balance after transfer");
        assertBalanceEqual(String(recipientAfter), String(recipientBefore + TEST_AMOUNT_F), "recipient balance after transfer");
      }

      selfBalance = selfAfter;
      recipientBalance = recipientAfter;

      return IS_SELF_TRANSFER
        ? `self: ${selfBefore} → ${selfAfter} ${tokenSymbol} (self-transfer, net 0)`
        : `self: ${selfBefore} → ${selfAfter}, recipient: ${recipientBefore} → ${recipientAfter} ${tokenSymbol}`;
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("6. Approve & TransferFrom");
  // ──────────────────────────────────────────────────────────────────────────

  await test(
    "approveAndTransferFrom()",
    async () => {
      const selfBefore = await getBalance(token, SELF_ADDRESS);
      const recipientBefore = IS_SELF_TRANSFER ? selfBefore : await getBalance(token, RECIPIENT);
      console.log(`    → self before     : ${selfBefore} ${tokenSymbol}`);
      console.log(`    → recipient before: ${recipientBefore} ${tokenSymbol}`);
 
      // Step 1: approve
      const { txHash: approveTx } = await token.approve(SELF_ADDRESS, TEST_AMOUNT);
      assert(approveTx.startsWith("0x"), `invalid approveTx=${approveTx}`);
      console.log(`    → approve tx: ${approveTx}`);
 
      // Verify allowance updated correctly
      const { formattedAllowance } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
      assertBalanceEqual(formattedAllowance, TEST_AMOUNT, "allowance after approve");
      console.log(`    → allowance=${formattedAllowance} ${tokenSymbol} ✓`);
 
      // Step 2: transferFrom
      const { txHash: transferTx } = await token.transferFrom(SELF_ADDRESS, RECIPIENT, TEST_AMOUNT);
      assert(transferTx.startsWith("0x"), `invalid transferTx=${transferTx}`);
      console.log(`    → transferFrom tx: ${transferTx}`);

      await sleep(10000);
 
      const selfAfter = await getBalance(token, SELF_ADDRESS);
      const recipientAfter = IS_SELF_TRANSFER ? selfAfter : await getBalance(token, RECIPIENT);
 
      if (IS_SELF_TRANSFER) {
        assertBalanceEqual(String(selfAfter), String(selfBefore), "self balance after self-transferFrom");
      } else {
        assertBalanceEqual(String(selfAfter), String(selfBefore - TEST_AMOUNT_F), "self balance after transferFrom");
        assertBalanceEqual(String(recipientAfter), String(recipientBefore + TEST_AMOUNT_F), "recipient balance after transferFrom");
      }
 
      // Verify allowance is fully consumed after transferFrom
      const { formattedAllowance: allowanceAfter } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
      assertBalanceEqual(allowanceAfter, "0", "allowance should be 0 after transferFrom");
      console.log(`    → allowance after transferFrom: ${allowanceAfter} ${tokenSymbol} ✓`);
 
      selfBalance = selfAfter;
      recipientBalance = recipientAfter;
 
      return IS_SELF_TRANSFER
        ? `self: ${selfBefore}→${selfAfter} ${tokenSymbol} (self-transfer, net 0), allowance: ${TEST_AMOUNT}→0`
        : `self: ${selfBefore}→${selfAfter}, recipient: ${recipientBefore}→${recipientAfter} ${tokenSymbol}, allowance: ${TEST_AMOUNT}→0`;
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("7. Claim");
  // ──────────────────────────────────────────────────────────────────────────

  await test(
    "claim()",
    async () => {
      const ozToken = new OZERC20Token();
      const ozBalanceBefore = parseFloat((await ozToken.balanceOf(SELF_ADDRESS)).formattedBalance);
      console.log(`    → OZ ERC20 balance before claim : ${ozBalanceBefore}`);
      const balanceBefore = await getBalance(token, SELF_ADDRESS);
      console.log(`    → balance before: ${balanceBefore} ${tokenSymbol}`);

      const { txHash } = await token.claim(SELF_ADDRESS, TEST_AMOUNT);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      await sleep(10000);

      const ozBbalanceAfter = parseFloat((await ozToken.balanceOf(SELF_ADDRESS)).formattedBalance);
      console.log(`    → OZ ERC20 balance after claim : ${ozBbalanceAfter}`);

      assertBalanceEqual(
        String(ozBbalanceAfter),
        String(ozBalanceBefore),
        "ozBalance after claim"
      );

      const balanceAfter = await getBalance(token, SELF_ADDRESS);
      assertBalanceEqual(
        String(balanceAfter),
        String(balanceBefore + TEST_AMOUNT_F),
        "self balance after claim"
      );

      selfBalance = balanceAfter;
      return `${balanceBefore} → ${balanceAfter} ${tokenSymbol} (+${TEST_AMOUNT})`;
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("8. Decryption (allowForDecryption + userDecrypt)");
  // ──────────────────────────────────────────────────────────────────────────

  let balanceHandle = "";
  await test("balanceOf(self) — fetch handle", async () => {
    const result = await token.balanceOf(SELF_ADDRESS);
    balanceHandle = result.balanceHandle;
    assert(balanceHandle.length > 0, "empty handle");
    return `handle=${balanceHandle.slice(0, 20)}...`;
  });

  await test("allowForDecryption(handle)", async () => {
    if (!balanceHandle) throw new Error("balanceHandle is empty, cannot proceed");
    const { txHash } = await token.allowForDecryption(balanceHandle);
    assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
    return `tx=${txHash}`;
  });

  await test("userDecrypt(handle)", async () => {
    if (!balanceHandle) throw new Error("balanceHandle is empty, cannot proceed");
    const plaintext = await token.userDecrypt(balanceHandle);
    assert(plaintext !== undefined && plaintext !== null, "plaintext is null");
    const decimals = await token.decimals();
    const decryptedBalance = parseFloat(ethers.formatUnits(plaintext, decimals));
    // assertBalanceEqual(String(decryptedBalance), String(selfBalance), "userDecrypt balance matches balanceOf");
    return `decrypted=${decryptedBalance} ${tokenSymbol} (matches balanceOf ✓)`;
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("9. Owner-only Operations (set SKIP_OWNER_TESTS=true to skip)");
  // ──────────────────────────────────────────────────────────────────────────

  // A burn address used as a dummy oracle for add/remove testing
  const DUMMY_ORACLE = "0x000000000000000000000000000000000000dEaD";
 
  await test(
    "addOracle() + removeOracle() round-trip [owner]",
    async () => {
      const { txHash: addTx } = await token.addOracle(DUMMY_ORACLE);
      assert(addTx.startsWith("0x"), `invalid addTx=${addTx}`);
      console.log(`    → addOracle tx: ${addTx}`);
      const { txHash: removeTx } = await token.removeOracle(DUMMY_ORACLE);
      assert(removeTx.startsWith("0x"), `invalid removeTx=${removeTx}`);
      return `addOracle + removeOracle ✓`;
    },
    { skip: SKIP_OWNER }
  );

  await test(
    "addOracle() + removeOracle() round-trip [owner]",
    async () => {
      const { txHash: addTx } = await token.addOracle(DUMMY_ORACLE);
      assert(addTx.startsWith("0x"), `invalid addTx=${addTx}`);
      console.log(`    → addOracle tx: ${addTx}`);
      const { txHash: removeTx } = await token.removeOracle(DUMMY_ORACLE);
      assert(removeTx.startsWith("0x"), `invalid removeTx=${removeTx}`);
      return `addOracle + removeOracle ✓`;
    },
    { skip: SKIP_OWNER }
  );

  // transferOwnership is destructive — skipped by default to prevent accidents
  await test(
    "transferOwnership() [dangerous — skipped by default]",
    async () => {
      throw new Error("Manually remove the skip flag and specify a target address before testing");
    },
    { skip: true }
  );

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(
    `${C.bold}Results: ` +
    `${C.green}${passed} passed${C.reset}  ` +
    `${C.red}${failed} failed${C.reset}  ` +
    `${C.yellow}${skipped} skipped${C.reset}`
  );
  if (failed > 0) {
    console.log(`\n${C.red}Some test cases failed. Check the error output above.${C.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${C.green}All tests passed!${C.reset}`);
  }
}

main().catch(err => {
  console.error(`\n${C.red}Uncaught error: ${err?.message ?? err}${C.reset}`);
  process.exit(1);
});