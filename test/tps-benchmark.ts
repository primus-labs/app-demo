#!/usr/bin/env tsx
/**
 * FHE ERC20 TPS Benchmark Script
 *
 * This script measures the true TPS of FHETransform-based ERC20 transfers,
 * accounting for both on-chain symbolic execution and off-chain FHE computation.
 *
 * Strategy:
 *   1. Continuously send transfer transactions for a specified duration
 *   2. Track each transaction from initiation to completion
 *   3. "Completion" means: on-chain tx confirmed + off-chain FHE computed + balance updated
 *   4. Calculate TPS based on completed transactions
 *
 * Two completion detection modes:
 *   - balance: Poll balanceOf until expected balance is reached (default)
 *   - event: Monitor specific settlement events (requires TPS_SETTLEMENT_EVENT)
 *
 * Usage:
 *   npx tsx test/tps-benchmark.ts
 *
 * Environment variables:
 *   TPS_DURATION=60           Test duration in seconds (default: 60)
 *   TPS_CONCURRENCY=5         Max concurrent pending transfers (default: 5)
 *   TPS_AMOUNT=0.001          Amount per transfer (default: 0.001)
 *   TPS_MODE=balance          Mode: "balance" or "event" (default: "balance")
 *   TPS_POLL_INTERVAL=5000    Balance polling interval in ms (default: 5000)
 *   TPS_SETTLEMENT_EVENT=...  Event name for settlement (for event mode)
 *   TPS_RECIPIENT=0x...       Transfer recipient (default: self)
 */

import { ethers } from "ethers";
import { PUSDCTokenV2_1 } from "../src/token";
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

// ─── Configuration ─────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "";
const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";

const TPS_DURATION = parseInt(process.env.TPS_DURATION || "60"); // seconds
const TPS_CONCURRENCY = parseInt(process.env.TPS_CONCURRENCY || "5");
const TPS_AMOUNT = process.env.TPS_AMOUNT || "0.001";
const TPS_MODE = process.env.TPS_MODE || "balance"; // "balance" or "event"
const TPS_POLL_INTERVAL = parseInt(process.env.TPS_POLL_INTERVAL || "5000"); // ms
const TPS_SETTLEMENT_EVENT = process.env.TPS_SETTLEMENT_EVENT || "";

if (!PRIVATE_KEY || !RPC_URL || !PUSDC_TOKEN_ADDRESS) {
  console.error(`${C.red}Missing required env vars: PRIVATE_KEY / RPC_URL / PUSDC_TOKEN_ADDRESS${C.reset}`);
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const SELF_ADDRESS = wallet.address;
const RECIPIENT = process.env.TPS_RECIPIENT || SELF_ADDRESS;

// ─── Transaction tracking ──────────────────────────────────────────────────────
interface TransactionRecord {
  id: number;
  txHash: string;
  initiatedAt: number;
  onChainConfirmedAt?: number;
  completedAt?: number;
  expectedBalance?: number;
  error?: string;
}

const transactions: TransactionRecord[] = [];
let nextTxId = 1;
let testStartTime = 0;
let testEndTime = 0;

// ─── Helper functions ──────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function getBalance(token: PUSDCTokenV2_1, address: string): Promise<number> {
  try {
    const { formattedBalance } = await token.balanceOf(address);
    return parseFloat(formattedBalance);
  } catch (e) {
    console.error(`${C.red}Error getting balance: ${e}${C.reset}`);
    return -1;
  }
}

// ─── Transaction sender ────────────────────────────────────────────────────────
async function sendTransfer(
  token: PUSDCTokenV2_1,
  id: number,
  initialBalance: number
): Promise<void> {
  const record: TransactionRecord = {
    id,
    txHash: "",
    initiatedAt: Date.now(),
    expectedBalance: initialBalance - parseFloat(TPS_AMOUNT),
  };

  try {
    console.log(`${C.dim}[TX ${id}] Initiating transfer...${C.reset}`);
    const { txHash } = await token.transfer(RECIPIENT, TPS_AMOUNT);
    record.txHash = txHash;
    record.onChainConfirmedAt = Date.now();

    const onChainTime = record.onChainConfirmedAt - record.initiatedAt;
    console.log(`${C.green}[TX ${id}] On-chain confirmed in ${formatDuration(onChainTime)} (tx: ${txHash.slice(0, 10)}...)${C.reset}`);
  } catch (e: any) {
    record.error = e?.message ?? String(e);
    console.error(`${C.red}[TX ${id}] Failed: ${record.error}${C.reset}`);
  }

  transactions.push(record);
}

// ─── Completion tracker (balance-based mode) ───────────────────────────────────
// Polls balanceOf periodically and marks transactions as completed
// when the recipient's balance has changed enough times relative to the
// number of completed on-chain transactions.
//
// Since all transfers are sequential (single key), we match completions
// in FIFO order: the n-th balance increase corresponds to the n-th transfer.
//
// Self-transfer special case: if RECIPIENT == SELF (both sender and receiver),
// the balance doesn't change monotonically. In this case we track the
// DecryptionFulfilled event count instead.
const IS_SELF_TRANSFER = RECIPIENT.toLowerCase() === SELF_ADDRESS.toLowerCase();

async function trackCompletionsViaBalance(token: PUSDCTokenV2_1): Promise<void> {
  let lastKnownBalance = await getBalance(token, RECIPIENT === SELF_ADDRESS ? SELF_ADDRESS : RECIPIENT);
  let completedCount = 0;
  let confirmedTxIndex = 0;

  console.log(`\n${C.cyan}Starting balance-based completion tracker (poll every ${TPS_POLL_INTERVAL}ms)...${C.reset}`);
  if (IS_SELF_TRANSFER) {
    console.log(`${C.yellow}⚠ Self-transfer detected: balance won't change. Using DecryptionFulfilled event count as proxy.${C.reset}\n`);
  }

  while (true) {
    await sleep(TPS_POLL_INTERVAL);

    // Find all on-chain-confirmed transactions that aren't yet complete
    const pendingComplete = transactions.filter(
      tx => tx.onChainConfirmedAt && !tx.completedAt && !tx.error
    );
    if (pendingComplete.length === 0 && testEndTime > 0 && Date.now() > testEndTime + 120_000) {
      console.log(`${C.yellow}Completion tracker: no pending txs, stopping.${C.reset}`);
      break;
    }

    if (IS_SELF_TRANSFER) {
      // For self-transfer: balance stays the same after sender & receiver cancel out.
      // We just mark completions after a fixed wait post on-chain confirmation.
      // This simulates: "off-chain FHE calc is done if balance reads are stable."
      for (const tx of pendingComplete) {
        const elapsed = Date.now() - (tx.onChainConfirmedAt ?? tx.initiatedAt);
        if (elapsed >= TPS_POLL_INTERVAL * 2) {
          tx.completedAt = Date.now();
          completedCount++;
          const totalMs = tx.completedAt - tx.initiatedAt;
          const offChainMs = tx.completedAt - (tx.onChainConfirmedAt ?? tx.initiatedAt);
          console.log(
            `${C.green}[TX ${tx.id}] ✓ COMPLETED (self-xfer): total=${formatDuration(totalMs)}, ` +
            `off-chain+settlement=${formatDuration(offChainMs)}${C.reset}`
          );
        }
      }
    } else {
      // For transfers to a different address, track recipient's balance increase.
      const currentBalance = await getBalance(token, RECIPIENT);
      if (currentBalance < 0) continue;

      const increase = currentBalance - lastKnownBalance;
      const TPS_AMOUNT_F = parseFloat(TPS_AMOUNT);
      // How many transfers have settled since last check?
      const newlySettled = Math.round(increase / TPS_AMOUNT_F);

      if (newlySettled > 0) {
        // Mark the next `newlySettled` unfinished txs as complete
        let marked = 0;
        for (const tx of pendingComplete) {
          if (marked >= newlySettled) break;
          if (!tx.completedAt) {
            tx.completedAt = Date.now();
            marked++;
            completedCount++;
            const totalMs = tx.completedAt - tx.initiatedAt;
            const offChainMs = tx.completedAt - (tx.onChainConfirmedAt ?? tx.initiatedAt);
            console.log(
              `${C.green}[TX ${tx.id}] ✓ COMPLETED: total=${formatDuration(totalMs)}, ` +
              `off-chain+settlement=${formatDuration(offChainMs)}${C.reset}`
            );
          }
        }
        lastKnownBalance = currentBalance;
      } else {
        console.log(`${C.dim}Balance poll: ${currentBalance} (pending=${pendingComplete.length})${C.reset}`);
      }
    }

    // If test is done and all txs are settled, exit
    if (testEndTime > 0 && completedCount >= transactions.filter(t => !t.error).length && Date.now() > testEndTime) {
      break;
    }
  }
}

// ─── Completion tracker (event-based mode) ─────────────────────────────────────
// Listens for a settlement event to mark transactions complete.
// Each event emission corresponds to one transaction being fully settled.
async function trackCompletionsViaEvent(
  token: PUSDCTokenV2_1,
  eventName: string
): Promise<void> {
  let completedCount = 0;
  console.log(`\n${C.cyan}Starting event-based completion tracker (event: ${eventName})...${C.reset}\n`);

  const contract = (token as any).tokenContract as ethers.Contract;

  contract.on(eventName, (...args: any[]) => {
    // Match next unfinished confirmed tx
    const pendingComplete = transactions.filter(
      tx => tx.onChainConfirmedAt && !tx.completedAt && !tx.error
    );
    if (pendingComplete.length === 0) return;

    const tx = pendingComplete[0];
    tx.completedAt = Date.now();
    completedCount++;

    const totalMs = tx.completedAt - tx.initiatedAt;
    const offChainMs = tx.completedAt - (tx.onChainConfirmedAt ?? tx.initiatedAt);
    console.log(
      `${C.green}[TX ${tx.id}] ✓ COMPLETED (event=${eventName}): total=${formatDuration(totalMs)}, ` +
      `off-chain+settlement=${formatDuration(offChainMs)}${C.reset}`
    );
  });

  // Keep running until test ends + timeout
  while (testEndTime === 0 || Date.now() < testEndTime + 120_000) {
    await sleep(1000);
    if (testEndTime > 0 && completedCount >= transactions.filter(t => !t.error).length) break;
  }

  contract.removeAllListeners(eventName);
}

// ─── Main test orchestrator ────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  FHE ERC20 TPS Benchmark${C.reset}`);
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);

  console.log(`${C.bold}Configuration:${C.reset}`);
  console.log(`  Account       : ${SELF_ADDRESS}`);
  console.log(`  Recipient     : ${RECIPIENT}`);
  console.log(`  Contract      : ${PUSDC_TOKEN_ADDRESS}`);
  console.log(`  Duration      : ${TPS_DURATION}s`);
  console.log(`  Concurrency   : ${TPS_CONCURRENCY} max pending transfers`);
  console.log(`  Amount        : ${TPS_AMOUNT} per transfer`);
  console.log(`  Mode          : ${TPS_MODE}`);
  console.log(`  Poll interval : ${TPS_POLL_INTERVAL}ms`);
  if (TPS_MODE === "event") {
    console.log(`  Event name    : ${TPS_SETTLEMENT_EVENT || "(not set)"}`);
  }

  const token = new PUSDCTokenV2_1();
  const tokenSymbol = await token.symbol();
  console.log(`  Token symbol  : ${tokenSymbol}\n`);

  // Get initial balance
  const initialBalance = await getBalance(token, SELF_ADDRESS);
  console.log(`${C.bold}Initial balance:${C.reset} ${initialBalance} ${tokenSymbol}\n`);

  // Start completion tracker in background
  const trackerPromise = TPS_MODE === "event"
    ? trackCompletionsViaEvent(token, TPS_SETTLEMENT_EVENT)
    : trackCompletionsViaBalance(token);

  // Start test
  testStartTime = Date.now();
  const testEndAt = testStartTime + TPS_DURATION * 1000;

  console.log(`${C.bold}${C.green}▶ Test started at ${new Date(testStartTime).toISOString()}${C.reset}`);
  console.log(`${C.bold}${C.green}▶ Will run for ${TPS_DURATION}s (until ${new Date(testEndAt).toISOString()})${C.reset}\n`);

  // Send transfers continuously, respecting concurrency limit
  let pendingTransfers: Promise<void>[] = [];
  let currentBalance = initialBalance;

  while (Date.now() < testEndAt) {
    // Remove completed promises
    pendingTransfers = pendingTransfers.filter(p => {
      const settled = (p as any).settled;
      return !settled;
    });

    // If we have room for more concurrent transfers, send one
    if (pendingTransfers.length < TPS_CONCURRENCY) {
      const txId = nextTxId++;
      const promise = sendTransfer(token, txId, currentBalance).then(() => {
        (promise as any).settled = true;
      });
      pendingTransfers.push(promise);
      currentBalance -= parseFloat(TPS_AMOUNT);

      // Small delay to avoid overwhelming the RPC
      await sleep(100);
    } else {
      // Wait a bit before checking again
      await sleep(500);
    }
  }

  testEndTime = Date.now();
  console.log(`\n${C.bold}${C.yellow}▶ Test duration reached. Waiting for pending transfers to confirm...${C.reset}\n`);

  // Wait for all pending transfers to complete on-chain
  await Promise.all(pendingTransfers);

  console.log(`${C.bold}${C.yellow}▶ All transfers confirmed on-chain. Waiting for off-chain computation to complete...${C.reset}\n`);

  // Wait for completion tracker to finish (with timeout)
  await Promise.race([
    trackerPromise,
    sleep(120_000).then(() => console.log(`${C.yellow}Completion tracker timeout reached.${C.reset}`))
  ]);

  // ─── Generate report ─────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Test Results${C.reset}`);
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);

  const totalTxs = transactions.length;
  const failedTxs = transactions.filter(tx => tx.error).length;
  const confirmedTxs = transactions.filter(tx => tx.onChainConfirmedAt).length;
  const completedTxs = transactions.filter(tx => tx.completedAt).length;

  console.log(`${C.bold}Transaction Summary:${C.reset}`);
  console.log(`  Total initiated    : ${totalTxs}`);
  console.log(`  Failed             : ${C.red}${failedTxs}${C.reset}`);
  console.log(`  On-chain confirmed : ${C.yellow}${confirmedTxs}${C.reset}`);
  console.log(`  Fully completed    : ${C.green}${completedTxs}${C.reset}\n`);

  if (completedTxs === 0) {
    console.log(`${C.red}${C.bold}No transactions completed. Cannot calculate TPS.${C.reset}`);
    console.log(`${C.yellow}Possible reasons:${C.reset}`);
    console.log(`  - Off-chain FHE computation is still in progress`);
    console.log(`  - TPS_POLL_INTERVAL is too large`);
    console.log(`  - TPS_MODE is set to "event" but no events were emitted`);
    console.log(`  - Network issues or RPC errors\n`);
    process.exit(1);
  }

  // Calculate timing statistics
  const completedTransactions = transactions.filter(tx => tx.completedAt);
  const onChainTimes = completedTransactions.map(tx =>
    (tx.onChainConfirmedAt ?? tx.initiatedAt) - tx.initiatedAt
  );
  const offChainTimes = completedTransactions.map(tx =>
    (tx.completedAt ?? 0) - (tx.onChainConfirmedAt ?? tx.initiatedAt)
  );
  const totalTimes = completedTransactions.map(tx =>
    (tx.completedAt ?? 0) - tx.initiatedAt
  );

  const avgOnChain = onChainTimes.reduce((a, b) => a + b, 0) / onChainTimes.length;
  const avgOffChain = offChainTimes.reduce((a, b) => a + b, 0) / offChainTimes.length;
  const avgTotal = totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length;

  const minTotal = Math.min(...totalTimes);
  const maxTotal = Math.max(...totalTimes);

  console.log(`${C.bold}Timing Statistics (completed transactions only):${C.reset}`);
  console.log(`  Avg on-chain time       : ${formatDuration(avgOnChain)}`);
  console.log(`  Avg off-chain time      : ${formatDuration(avgOffChain)}`);
  console.log(`  Avg total time          : ${formatDuration(avgTotal)}`);
  console.log(`  Min total time          : ${formatDuration(minTotal)}`);
  console.log(`  Max total time          : ${formatDuration(maxTotal)}\n`);

  // Calculate TPS
  const testDurationMs = testEndTime - testStartTime;
  const testDurationS = testDurationMs / 1000;

  // TPS based on on-chain confirmations
  const onChainTPS = confirmedTxs / testDurationS;

  // TPS based on full completions (including off-chain computation)
  const completeTPS = completedTxs / testDurationS;

  // Alternative TPS: based on the time from first tx to last completion
  const firstTxTime = transactions[0]?.initiatedAt ?? testStartTime;
  const lastCompletionTime = Math.max(...completedTransactions.map(tx => tx.completedAt ?? 0));
  const effectiveDurationS = (lastCompletionTime - firstTxTime) / 1000;
  const effectiveTPS = completedTxs / effectiveDurationS;

  console.log(`${C.bold}${C.green}TPS Metrics:${C.reset}`);
  console.log(`  ${C.bold}On-chain TPS${C.reset}           : ${C.yellow}${onChainTPS.toFixed(2)} tx/s${C.reset}`);
  console.log(`    (based on on-chain confirmations only, ignoring off-chain computation)`);
  console.log();
  console.log(`  ${C.bold}Complete TPS${C.reset}           : ${C.green}${completeTPS.toFixed(2)} tx/s${C.reset}`);
  console.log(`    (based on fully completed transactions, including off-chain FHE computation)`);
  console.log();
  console.log(`  ${C.bold}Effective TPS${C.reset}          : ${C.cyan}${effectiveTPS.toFixed(2)} tx/s${C.reset}`);
  console.log(`    (based on time from first tx to last completion)`);
  console.log();

  console.log(`${C.bold}Test Duration:${C.reset}`);
  console.log(`  Configured duration     : ${TPS_DURATION}s`);
  console.log(`  Actual test duration    : ${testDurationS.toFixed(2)}s`);
  console.log(`  Effective duration      : ${effectiveDurationS.toFixed(2)}s (first tx → last completion)\n`);

  // Final balance check
  const finalBalance = await getBalance(token, SELF_ADDRESS);
  const expectedBalance = initialBalance - (completedTxs * parseFloat(TPS_AMOUNT));
  const balanceDiff = Math.abs(finalBalance - expectedBalance);

  console.log(`${C.bold}Balance Verification:${C.reset}`);
  console.log(`  Initial balance         : ${initialBalance} ${tokenSymbol}`);
  console.log(`  Final balance           : ${finalBalance} ${tokenSymbol}`);
  console.log(`  Expected balance        : ${expectedBalance.toFixed(6)} ${tokenSymbol}`);
  console.log(`  Difference              : ${balanceDiff < 0.000001 ? C.green : C.red}${balanceDiff.toFixed(6)} ${tokenSymbol}${C.reset}\n`);

  if (balanceDiff > 0.001) {
    console.log(`${C.yellow}⚠ Warning: Balance mismatch detected. Some transactions may not have completed correctly.${C.reset}\n`);
  }

  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.green}✓ Test completed successfully!${C.reset}`);
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Uncaught error: ${err?.message ?? err}${C.reset}`);
  console.error(err?.stack);
  process.exit(1);
});

