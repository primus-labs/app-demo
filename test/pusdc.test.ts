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
 *   npx tsx test-pusdc.ts
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

async function test(label: string, fn: () => Promise<void>, opts?: { skip?: boolean }) {
  if (onlyFilter && !label.toLowerCase().includes(onlyFilter)) { skip(label); skipped++; return; }
  if (opts?.skip) { skip(label); skipped++; return; }
  try {
    await fn();
    pass(label);
    passed++;
  } catch (e: any) {
    fail(label, e);
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
  await test("name() returns a non-empty string", async () => {
    tokenName = await token.name();
    assert(typeof tokenName === "string" && tokenName.length > 0, `name=${tokenName}`);
    console.log(`    → ${tokenName}`);
  });

  let tokenSymbol = "";
  await test("symbol() returns a non-empty string", async () => {
    tokenSymbol = await token.symbol();
    assert(typeof tokenSymbol === "string" && tokenSymbol.length > 0, `symbol=${tokenSymbol}`);
    console.log(`    → ${tokenSymbol}`);
  });

  let tokenDecimals = 0;
  await test("decimals() returns a positive integer", async () => {
    tokenDecimals = await token.decimals();
    assert(Number(tokenDecimals) > 0, `decimals=${tokenDecimals}`);
    console.log(`    → ${tokenDecimals}`);
  });

  await test("totalSupply() decrypts and returns a non-negative value", async () => {
    const { formattedtotalSupply, totalSupplyHandle } = await token.totalSupply();
    assert(totalSupplyHandle !== undefined, "handle is undefined");
    assert(parseFloat(formattedtotalSupply) >= 0, `invalid totalSupply=${formattedtotalSupply}`);
    console.log(`    → totalSupply=${formattedtotalSupply} ${tokenSymbol}`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("2. Whitelist Operations");
  // ──────────────────────────────────────────────────────────────────────────

  // Record whether self was already whitelisted before the test, so we can
  // restore the original state at the end of this section.
  let wasWhitelisted = false;
  await test("isWhitelisted(self) returns a boolean (record initial state)", async () => {
    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(typeof isWhitelisted === "boolean", `isWhitelisted=${isWhitelisted}`);
    wasWhitelisted = isWhitelisted;
    console.log(`    → initial isWhitelisted=${isWhitelisted}`);
  });

  await test("getFullWhitelist() returns an array", async () => {
    const { fullWhitelist } = await token.getFullWhitelist();
    assert(Array.isArray(fullWhitelist), "fullWhitelist is not an array");
    console.log(`    → ${fullWhitelist.length} address(es)`);
  });

  await test("getTotalHandles() returns data", async () => {
    const { totalHandles } = await token.getTotalHandles();
    assert(totalHandles !== undefined, "totalHandles is undefined");
    console.log(`    → ${JSON.stringify(totalHandles).slice(0, 80)}...`);
  });

  await test("addToWhitelist(self) → isWhitelisted returns true", async () => {
    // If already whitelisted, skip adding to avoid a redundant tx
    if (!wasWhitelisted) {
      const { txHash } = await token.addToWhitelist(SELF_ADDRESS);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → addToWhitelist tx: ${txHash}`);
    } else {
      console.log(`    → self was already whitelisted, skipping addToWhitelist`);
    }
    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(isWhitelisted === true, `expected true, got ${isWhitelisted}`);
    console.log(`    → isWhitelisted=${isWhitelisted} ✓`);

    // Also verify self appears in the full whitelist
    const { fullWhitelist } = await token.getFullWhitelist();
    assert(
      fullWhitelist.map((a: string) => a.toLowerCase()).includes(SELF_ADDRESS.toLowerCase()),
      "self not found in fullWhitelist after addToWhitelist"
    );
    console.log(`    → self found in fullWhitelist ✓`);
  });

  await test("removeFromWhitelist(self) → isWhitelisted returns false", async () => {
    const { txHash } = await token.removeFromWhitelist(SELF_ADDRESS);
    assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
    console.log(`    → removeFromWhitelist tx: ${txHash}`);

    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(isWhitelisted === false, `expected false, got ${isWhitelisted}`);
    console.log(`    → isWhitelisted=${isWhitelisted} ✓`);

    // Also verify self no longer appears in the full whitelist
    const { fullWhitelist } = await token.getFullWhitelist();
    assert(
      !fullWhitelist.map((a: string) => a.toLowerCase()).includes(SELF_ADDRESS.toLowerCase()),
      "self still found in fullWhitelist after removeFromWhitelist"
    );
    console.log(`    → self not found in fullWhitelist ✓`);
  });

  await test("restore initial whitelist state for self", async () => {
    // If self was whitelisted before the test started, add it back
    if (wasWhitelisted) {
      const { txHash } = await token.addToWhitelist(SELF_ADDRESS);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → restored: addToWhitelist tx: ${txHash}`);
    } else {
      console.log(`    → self was not whitelisted initially, no restore needed`);
    }
    const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
    assert(isWhitelisted === wasWhitelisted, `expected ${wasWhitelisted}, got ${isWhitelisted}`);
    console.log(`    → isWhitelisted restored to ${isWhitelisted} ✓`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("3. Initial Balance & Allowance Snapshot");
  // ──────────────────────────────────────────────────────────────────────────

  let selfBalance = 0;
  await test("balanceOf(self) decrypts and returns a non-negative value", async () => {
    selfBalance = await getBalance(token, SELF_ADDRESS);
    assert(selfBalance >= 0, `invalid balance=${selfBalance}`);
    console.log(`    → self balance=${selfBalance} ${tokenSymbol}`);
  });

  let recipientBalance = 0;
  await test("balanceOf(recipient) decrypts and returns a non-negative value", async () => {
    recipientBalance = await getBalance(token, RECIPIENT);
    assert(recipientBalance >= 0, `invalid balance=${recipientBalance}`);
    console.log(`    → recipient balance=${recipientBalance} ${tokenSymbol}`);
  });

  await test("allowance(self, self) decrypts and returns a non-negative value", async () => {
    const { formattedAllowance, allowanceHandle } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
    assert(allowanceHandle !== undefined, "allowance handle is undefined");
    assert(parseFloat(formattedAllowance) >= 0, `invalid allowance=${formattedAllowance}`);
    console.log(`    → allowance=${formattedAllowance} ${tokenSymbol}`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("4. Deposit Flow (OZERC20 approve → eUSDC deposit)");
  // ──────────────────────────────────────────────────────────────────────────

  const hasOzToken = !!OZERC20_TOKEN_ADDRESS;
  await test(
    `deposit ${TEST_AMOUNT} → self balance should increase by ${TEST_AMOUNT}`,
    async () => {
      const balanceBefore = await getBalance(token, SELF_ADDRESS);
      console.log(`    → balance before: ${balanceBefore} ${tokenSymbol}`);

      // Step 1: approve the eUSDC contract to pull the underlying OZ ERC20
      const ozToken = new OZERC20Token();
      const { txHash: approveTx } = await ozToken.approve(PUSDC_TOKEN_ADDRESS, TEST_AMOUNT);
      assert(approveTx.startsWith("0x"), `invalid approveTx=${approveTx}`);
      console.log(`    → OZ approve tx: ${approveTx}`);

      // Step 2: deposit into eUSDC
      const { txHash: depositTx } = await token.deposit(TEST_AMOUNT);
      assert(depositTx.startsWith("0x"), `invalid depositTx=${depositTx}`);
      console.log(`    → deposit tx: ${depositTx}`);

      // Verify: self balance should have increased by TEST_AMOUNT
      const balanceAfter = await getBalance(token, SELF_ADDRESS);
      console.log(`    → balance after: ${balanceAfter} ${tokenSymbol}`);
      assertBalanceEqual(
        String(balanceAfter),
        String(balanceBefore + TEST_AMOUNT_F),
        "self balance after deposit"
      );

      // Update snapshot for subsequent tests
      selfBalance = balanceAfter;
    },
    { skip: !hasOzToken }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("5. Transfer");
  // ──────────────────────────────────────────────────────────────────────────

  await test(
    `transfer ${TEST_AMOUNT} to recipient → self -${TEST_AMOUNT}${IS_SELF_TRANSFER ? ", net 0 (self-transfer)" : `, recipient +${TEST_AMOUNT}`}`,
    async () => {
      const selfBefore = await getBalance(token, SELF_ADDRESS);
      const recipientBefore = IS_SELF_TRANSFER ? selfBefore : await getBalance(token, RECIPIENT);
      console.log(`    → self before: ${selfBefore} ${tokenSymbol}`);
      console.log(`    → recipient before: ${recipientBefore} ${tokenSymbol}`);

      const { txHash } = await token.transfer(RECIPIENT, TEST_AMOUNT);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      const selfAfter = await getBalance(token, SELF_ADDRESS);
      const recipientAfter = IS_SELF_TRANSFER ? selfAfter : await getBalance(token, RECIPIENT);
      console.log(`    → self after: ${selfAfter} ${tokenSymbol}`);
      console.log(`    → recipient after: ${recipientAfter} ${tokenSymbol}`);

      if (IS_SELF_TRANSFER) {
        // Self-transfer: balance should be unchanged
        assertBalanceEqual(String(selfAfter), String(selfBefore), "self balance after self-transfer");
      } else {
        assertBalanceEqual(String(selfAfter), String(selfBefore - TEST_AMOUNT_F), "self balance after transfer");
        assertBalanceEqual(String(recipientAfter), String(recipientBefore + TEST_AMOUNT_F), "recipient balance after transfer");
      }

      // Update snapshots
      selfBalance = selfAfter;
      recipientBalance = recipientAfter;
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("6. Approve & TransferFrom");
  // ──────────────────────────────────────────────────────────────────────────

  await test(
    `approve ${TEST_AMOUNT} for self → allowance should equal ${TEST_AMOUNT}`,
    async () => {
      const { txHash } = await token.approve(SELF_ADDRESS, TEST_AMOUNT);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      // Verify allowance updated correctly
      const { formattedAllowance } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
      console.log(`    → allowance after approve: ${formattedAllowance} ${tokenSymbol}`);
      assertBalanceEqual(formattedAllowance, TEST_AMOUNT, "allowance after approve");
    }
  );

  await test(
    `transferFrom self → recipient ${TEST_AMOUNT} → balances change correctly`,
    async () => {
      const selfBefore = await getBalance(token, SELF_ADDRESS);
      const recipientBefore = IS_SELF_TRANSFER ? selfBefore : await getBalance(token, RECIPIENT);
      console.log(`    → self before: ${selfBefore} ${tokenSymbol}`);
      console.log(`    → recipient before: ${recipientBefore} ${tokenSymbol}`);

      const { txHash } = await token.transferFrom(SELF_ADDRESS, RECIPIENT, TEST_AMOUNT);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      const selfAfter = await getBalance(token, SELF_ADDRESS);
      const recipientAfter = IS_SELF_TRANSFER ? selfAfter : await getBalance(token, RECIPIENT);
      console.log(`    → self after: ${selfAfter} ${tokenSymbol}`);
      console.log(`    → recipient after: ${recipientAfter} ${tokenSymbol}`);

      if (IS_SELF_TRANSFER) {
        assertBalanceEqual(String(selfAfter), String(selfBefore), "self balance after self-transferFrom");
      } else {
        assertBalanceEqual(String(selfAfter), String(selfBefore - TEST_AMOUNT_F), "self balance after transferFrom");
        assertBalanceEqual(String(recipientAfter), String(recipientBefore + TEST_AMOUNT_F), "recipient balance after transferFrom");
      }

      // Verify allowance is consumed (should be 0 after transferFrom)
      const { formattedAllowance } = await token.allowance(SELF_ADDRESS, SELF_ADDRESS);
      console.log(`    → allowance after transferFrom: ${formattedAllowance} ${tokenSymbol}`);
      assertBalanceEqual(formattedAllowance, "0", "allowance should be 0 after transferFrom");

      // Update snapshots
      selfBalance = selfAfter;
      recipientBalance = recipientAfter;
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("7. Claim");
  // ──────────────────────────────────────────────────────────────────────────

  await test(
    `claim ${TEST_AMOUNT} to self → self balance should increase by ${TEST_AMOUNT}`,
    async () => {
      const balanceBefore = await getBalance(token, SELF_ADDRESS);
      console.log(`    → balance before: ${balanceBefore} ${tokenSymbol}`);

      const { txHash } = await token.claim(SELF_ADDRESS, TEST_AMOUNT);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      const balanceAfter = await getBalance(token, SELF_ADDRESS);
      console.log(`    → balance after: ${balanceAfter} ${tokenSymbol}`);

      assertBalanceEqual(
        String(balanceAfter),
        String(balanceBefore + TEST_AMOUNT_F),
        "self balance after claim"
      );

      selfBalance = balanceAfter;
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  section("8. Decryption (allowForDecryption + userDecrypt)");
  // ──────────────────────────────────────────────────────────────────────────

  let balanceHandle = "";
  await test("balanceOf(self) returns a non-empty handle", async () => {
    const result = await token.balanceOf(SELF_ADDRESS);
    balanceHandle = result.balanceHandle;
    assert(balanceHandle.length > 0, "empty handle");
    console.log(`    → handle: ${balanceHandle}`);
  });

  await test("allowForDecryption grants public decryption access", async () => {
    if (!balanceHandle) throw new Error("balanceHandle is empty, cannot proceed");
    const { txHash } = await token.allowForDecryption(balanceHandle);
    assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
    console.log(`    → tx: ${txHash}`);
  });

  await test("userDecrypt(handle) returns plaintext matching current balance", async () => {
    if (!balanceHandle) throw new Error("balanceHandle is empty, cannot proceed");
    const plaintext = await token.userDecrypt(balanceHandle);
    assert(plaintext !== undefined && plaintext !== null, "plaintext is null");
    const decimals = await token.decimals();
    const decryptedBalance = parseFloat(ethers.formatUnits(plaintext, decimals));
    console.log(`    → decrypted balance: ${decryptedBalance} ${tokenSymbol}`);
    console.log(`    → expected balance : ${selfBalance} ${tokenSymbol}`);
    // The decrypted value should match what balanceOf already returned
    assertBalanceEqual(String(decryptedBalance), String(selfBalance), "userDecrypt balance matches balanceOf");
  });

  // ──────────────────────────────────────────────────────────────────────────
  section("9. Owner-only Operations (set SKIP_OWNER_TESTS=true to skip)");
  // ──────────────────────────────────────────────────────────────────────────

  // A burn address used as a dummy oracle for add/remove testing
  const DUMMY_ORACLE = "0x000000000000000000000000000000000000dEaD";

  await test(
    "addToWhitelist(self) → isWhitelisted returns true",
    async () => {
      const { txHash } = await token.addToWhitelist(SELF_ADDRESS);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
      assert(isWhitelisted === true, `expected true, got ${isWhitelisted}`);
      console.log(`    → isWhitelisted=${isWhitelisted} ✓`);
    },
    { skip: SKIP_OWNER }
  );

  await test(
    "removeFromWhitelist(self) → isWhitelisted returns false",
    async () => {
      const { txHash } = await token.removeFromWhitelist(SELF_ADDRESS);
      assert(txHash.startsWith("0x"), `invalid txHash=${txHash}`);
      console.log(`    → tx: ${txHash}`);

      const { isWhitelisted } = await token.isWhitelisted(SELF_ADDRESS);
      assert(isWhitelisted === false, `expected false, got ${isWhitelisted}`);
      console.log(`    → isWhitelisted=${isWhitelisted} ✓`);
    },
    { skip: SKIP_OWNER }
  );

  await test(
    "addOracle(dummyAddr) → removeOracle(dummyAddr) round-trip",
    async () => {
      const { txHash: addTx } = await token.addOracle(DUMMY_ORACLE);
      assert(addTx.startsWith("0x"), `invalid addTx=${addTx}`);
      console.log(`    → addOracle tx: ${addTx}`);

      const { txHash: removeTx } = await token.removeOracle(DUMMY_ORACLE);
      assert(removeTx.startsWith("0x"), `invalid removeTx=${removeTx}`);
      console.log(`    → removeOracle tx: ${removeTx}`);
    },
    { skip: SKIP_OWNER }
  );

  // transferOwnership is destructive — skipped by default to prevent accidents
  await test(
    "transferOwnership (dangerous — skipped by default)",
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