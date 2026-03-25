#!/usr/bin/env tsx
/**
 * FHE ERC20 TPS Benchmark
 *
 * Measures the true TPS of FHETransform-based ERC20 transfers, covering:
 *   on-chain symbolic execution + off-chain FHE computation + balance update
 *
 * TPS Metrics (4 metrics, all with accurate denominators):
 *
 *   1. sendRate     = total sent  / (lastSentAt - firstSentAt)
 *      → Client broadcast rate, unaffected by chain or FHE latency
 *
 *   2. onChainTPS   = confirmed   / (lastConfirmedAt - firstConfirmedAt)
 *      → True chain throughput, window spans first-to-last on-chain confirmation
 *
 *   3. completeTPS  = completed   / (lastCompletedAt - firstConfirmedAt)
 *      → Full pipeline throughput, window starts at first on-chain confirmation
 *        and ends at last FHE settlement
 *
 *   4. effectiveTPS = completed   / (lastCompletedAt - firstInitiatedAt)
 *      → End-to-end user-perceived TPS; all delays are included in the denominator
 *
 * Send strategy:
 *   - Manually manage nonce
 *   - Fire-and-forget: move on immediately after broadcast
 *   - Wait for receipts concurrently in the background
 *
 * Completion detection (balance mode):
 *   - Poll balanceOf(RECIPIENT) periodically
 *   - balance delta / TPS_AMOUNT = number of newly settled txs
 *   - Mark completions in FIFO order
 *
 * Completion detection (event mode):
 *   - Listen for a specified settlement event
 *   - Each emission marks one tx as complete
 *
 * Usage:
 *   npx tsx test/tps-benchmark.ts
 *
 * Environment variables:
 *   TPS_DURATION=60           Test duration in seconds (default: 60)
 *   TPS_AMOUNT=0.000001       Amount per transfer (default: 0.000001)
 *   TPS_MODE=balance          Completion mode: "balance" or "event" (default: balance)
 *   TPS_POLL_INTERVAL=5000    Balance poll interval in ms (default: 5000)
 *   TPS_SETTLEMENT_EVENT=...  Settlement event name (event mode only)
 *   TPS_RECIPIENT=0x...       Recipient address (default: self)
 *   TPS_TX_DELAY=200          Delay between consecutive tx broadcasts in ms (default: 200)
 *   TPS_SETTLE_TIMEOUT=120    Seconds to wait for FHE settlement after last on-chain confirmation (default: 120)
 *   TPS_DECRYPT_TIMEOUT=30000 Single requestDecrypt timeout in ms (default: 30000)
 */

import { ethers } from "ethers";
import { requestEncrypt, FheType, estimateFheFee, requestDecrypt } from "@primuslabs/fhe-sdk";
import { PUSDCTokenV2_1_ABI } from "../src/abis/PUSDCTokenV2_1_ABI";
import 'dotenv/config';

// ─── Colors ────────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",  green:  "\x1b[32m", red:    "\x1b[31m",
  yellow: "\x1b[33m", cyan:   "\x1b[36m", bold:   "\x1b[1m",  dim: "\x1b[2m",
};

// ─── Config ────────────────────────────────────────────────────────────────────
const PRIVATE_KEY         = process.env.PRIVATE_KEY         || "";
const RPC_URL             = process.env.RPC_URL             || "";
const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
const ACL_ADDRESS         = process.env.ACL_ADDRESS         || "";

const TPS_DURATION         = parseInt(process.env.TPS_DURATION        || "60");
const TPS_AMOUNT           = process.env.TPS_AMOUNT                   || "0.000001";
const TPS_MODE             = process.env.TPS_MODE                     || "balance";
const TPS_POLL_INTERVAL    = parseInt(process.env.TPS_POLL_INTERVAL   || "5000");
const TPS_SETTLEMENT_EVENT = process.env.TPS_SETTLEMENT_EVENT         || "";
const TPS_TX_DELAY         = parseInt(process.env.TPS_TX_DELAY        || "200");
const TPS_SETTLE_TIMEOUT   = parseInt(process.env.TPS_SETTLE_TIMEOUT  || "120") * 1000;
const TPS_DECRYPT_TIMEOUT  = parseInt(process.env.TPS_DECRYPT_TIMEOUT || "30000");

if (!PRIVATE_KEY || !RPC_URL || !PUSDC_TOKEN_ADDRESS) {
  console.error(`${C.red}Missing: PRIVATE_KEY / RPC_URL / PUSDC_TOKEN_ADDRESS${C.reset}`);
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const SELF     = wallet.address;
const RECIPIENT        = process.env.TPS_RECIPIENT || SELF;
const IS_SELF_TRANSFER = RECIPIENT.toLowerCase() === SELF.toLowerCase();

const contract = new ethers.Contract(PUSDC_TOKEN_ADDRESS, PUSDCTokenV2_1_ABI, wallet);

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TxRecord {
  id:           number;
  txHash:       string;
  initiatedAt:  number;   // wall-clock: tx broadcast time
  onChainAt?:   number;   // wall-clock: on-chain receipt time
  completedAt?: number;   // wall-clock: off-chain FHE settlement time
  error?:       string;
}

const records: TxRecord[] = [];

// Timestamps of the first and last successfully broadcast tx (used for sendRate)
let firstSentAt = 0;
let lastSentAt  = 0;
// Set to Date.now() when the send loop exits; signals the tracker to begin its exit checks
let testEndTime = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function fmt(ms: number) {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Decrypts and returns the token balance of `address`.
 * Wraps requestDecrypt with a hard timeout so that a slow or overloaded
 * FHE node cannot stall the polling loop indefinitely.
 * Returns -1 on any error; callers should treat -1 as "skip this poll".
 */
async function getDecryptedBalance(address: string): Promise<number> {
  try {
    const handle           = await contract.balanceOf(address);
    const decimals: number = Number(await contract.decimals());

    const plain = await Promise.race([
      requestDecrypt(
        wallet, ACL_ADDRESS, FheType.ve_uint256, handle,
        { isMock: process.env.MOCK_TEST === "ON" }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`decrypt timeout after ${TPS_DECRYPT_TIMEOUT}ms`)),
          TPS_DECRYPT_TIMEOUT
        )
      ),
    ]);

    return parseFloat(ethers.formatUnits(plain as bigint, decimals));
  } catch (e: any) {
    console.log(`${C.yellow}[balance] getDecryptedBalance failed: ${e?.message ?? e}${C.reset}`);
    return -1;
  }
}

// ─── Broadcast a single transfer ───────────────────────────────────────────────
async function sendRawTransfer(nonce: number): Promise<ethers.TransactionResponse> {
  const decimals: number = Number(await contract.decimals());
  const amountRaw        = ethers.parseUnits(TPS_AMOUNT, decimals);
  const chainId          = Number((await provider.getNetwork()).chainId);

  const amountHandle = await requestEncrypt(
    wallet, ACL_ADDRESS, amountRaw, FheType.ve_uint256, chainId, null,
    { isMock: process.env.MOCK_TEST === "ON" }
  );

  const { totalFee } = await estimateFheFee(
    PUSDC_TOKEN_ADDRESS, "transfer", { chainId, verbose: 0 }
  );

  return contract.transfer(RECIPIENT, amountHandle, { value: totalFee, nonce });
}

// ─── Completion tracker: balance mode ─────────────────────────────────────────
/**
 * Polls the recipient's decrypted balance and marks txs complete in FIFO order
 * as the balance increases.
 *
 * `baseline` is captured in main() before the first tx is broadcast, ensuring
 * the tracker never counts balance changes that predate the test.
 *
 * Exit conditions:
 *   Normal  — send phase done + all txs on-chain confirmed + all txs completed/errored
 *   Timeout — more than TPS_SETTLE_TIMEOUT ms have elapsed since the last on-chain
 *             confirmation with no further FHE settlements
 */
async function trackViaBalance(baseline: number): Promise<void> {
  console.log(
    `\n${C.cyan}[tracker] balance mode — poll every ${TPS_POLL_INTERVAL}ms, baseline=${baseline}${C.reset}`
  );

  const decimals: number = Number(await contract.decimals());
  // Use integer arithmetic at token-unit precision to avoid floating-point drift
  const amountUnit = Math.round(parseFloat(TPS_AMOUNT) * 10 ** decimals);

  while (true) {
    await sleep(TPS_POLL_INTERVAL);

    const pending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);

    if (IS_SELF_TRANSFER) {
      // Balance is unchanged for self-transfers; use elapsed time since on-chain
      // confirmation as a proxy for FHE settlement
      for (const r of pending) {
        if (Date.now() - (r.onChainAt ?? r.initiatedAt) >= TPS_POLL_INTERVAL * 2) {
          r.completedAt = Date.now();
          const total    = r.completedAt - r.initiatedAt;
          const offChain = r.completedAt - (r.onChainAt ?? r.initiatedAt);
          console.log(
            `${C.green}[TX ${r.id}] ✓ complete (self-transfer) ` +
            `total=${fmt(total)} off-chain≈${fmt(offChain)}${C.reset}`
          );
        }
      }
    } else {
      const cur = await getDecryptedBalance(RECIPIENT);
      if (cur < 0) {
        // Decrypt timed out — skip this poll cycle and retry next interval
        console.log(
          `${C.yellow}[tracker] decrypt failed, skipping poll — pending=${pending.length}${C.reset}`
        );
        continue;
      }

      // Compute how many new settlements are reflected in the current balance
      const deltaUnit = Math.round((cur - baseline) * 10 ** decimals);
      const settled   = Math.floor(deltaUnit / amountUnit);

      // Log every poll for visibility and diagnostics
      console.log(
        `${C.dim}[tracker] cur=${cur} baseline=${baseline} ` +
        `delta=${(cur - baseline).toFixed(decimals)} settled=${settled} pending=${pending.length}${C.reset}`
      );

      if (settled > 0) {
        // Mark the oldest confirmed-but-not-yet-complete txs as done (FIFO)
        const toMark = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
        let n = 0;
        for (const r of toMark) {
          if (n >= settled) break;
          r.completedAt = Date.now();
          n++;
          const total    = r.completedAt - r.initiatedAt;
          const offChain = r.completedAt - (r.onChainAt ?? r.initiatedAt);
          console.log(
            `${C.green}[TX ${r.id}] ✓ complete ` +
            `total=${fmt(total)} off-chain=${fmt(offChain)}${C.reset}`
          );
        }
        baseline = cur;
      }
    }

    // ── Normal exit: send phase done, all txs confirmed and completed/errored ──
    const allSent      = testEndTime > 0;
    const hasTxs       = records.length > 0;
    const allConfirmed = records.every(r => r.onChainAt || r.error);
    const allDone      = records.every(r => r.completedAt || r.error);
    if (allSent && hasTxs && allConfirmed && allDone) {
      console.log(`${C.green}[tracker] all transactions completed — exiting tracker${C.reset}`);
      break;
    }

    // ── Safety timeout: no FHE settlement for TPS_SETTLE_TIMEOUT after last confirmation ──
    const confirmedTimes  = records.filter(r => r.onChainAt).map(r => r.onChainAt!);
    const lastConfirmedAt = confirmedTimes.length > 0 ? Math.max(...confirmedTimes) : 0;
    if (
      allSent && allConfirmed &&
      lastConfirmedAt > 0 &&
      Date.now() > lastConfirmedAt + TPS_SETTLE_TIMEOUT
    ) {
      const stillPending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
      console.log(
        `${C.yellow}[tracker] settle timeout — ${stillPending.length} tx(s) still pending${C.reset}`
      );
      break;
    }
  }
}

// ─── Completion tracker: event mode ───────────────────────────────────────────
/**
 * Listens for a settlement event emitted after each off-chain FHE computation.
 * Each event emission marks the oldest confirmed-but-not-yet-complete tx as done.
 */
async function trackViaEvent(eventName: string): Promise<void> {
  console.log(`\n${C.cyan}[tracker] event mode — listening for "${eventName}"${C.reset}\n`);

  contract.on(eventName, () => {
    const pending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
    if (!pending.length) return;
    const r        = pending[0];
    r.completedAt  = Date.now();
    const total    = r.completedAt - r.initiatedAt;
    const offChain = r.completedAt - (r.onChainAt ?? r.initiatedAt);
    console.log(
      `${C.green}[TX ${r.id}] ✓ complete (event) ` +
      `total=${fmt(total)} off-chain=${fmt(offChain)}${C.reset}`
    );
  });

  // Keep running until all confirmed txs are settled, or the settle timeout fires
  while (true) {
    await sleep(1000);
    const allSent      = testEndTime > 0;
    const stillPending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
    if (allSent && stillPending.length === 0) break;

    const confirmedTimes  = records.filter(r => r.onChainAt).map(r => r.onChainAt!);
    const lastConfirmedAt = confirmedTimes.length > 0 ? Math.max(...confirmedTimes) : 0;
    const allConfirmed    = records.every(r => r.onChainAt || r.error);
    if (
      allSent && allConfirmed &&
      lastConfirmedAt > 0 &&
      Date.now() > lastConfirmedAt + TPS_SETTLE_TIMEOUT
    ) {
      console.log(`${C.yellow}[tracker] settle timeout${C.reset}`);
      break;
    }
  }

  contract.removeAllListeners(eventName);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  FHE ERC20 TPS Benchmark${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}\n`);
  console.log(`  Account        : ${SELF}`);
  console.log(`  Recipient      : ${RECIPIENT}${IS_SELF_TRANSFER ? " (self-transfer)" : ""}`);
  console.log(`  Contract       : ${PUSDC_TOKEN_ADDRESS}`);
  console.log(`  Duration       : ${TPS_DURATION}s`);
  console.log(`  Amount         : ${TPS_AMOUNT}`);
  console.log(`  Mode           : ${TPS_MODE}`);
  console.log(`  TX delay       : ${TPS_TX_DELAY}ms`);
  console.log(`  Poll interval  : ${TPS_POLL_INTERVAL}ms`);
  console.log(`  Settle timeout : ${TPS_SETTLE_TIMEOUT / 1000}s`);
  console.log(`  Decrypt timeout: ${TPS_DECRYPT_TIMEOUT}ms\n`);

  // Whitelist SELF so it can decrypt the recipient's balance during polling
  if (!IS_SELF_TRANSFER) {
    const isWhitelisted: boolean = await contract.isWhitelisted(SELF);
    if (!isWhitelisted) {
      console.log(`${C.yellow}Adding ${SELF} to whitelist...${C.reset}`);
      const tx = await contract.addToWhitelist(SELF);
      await tx.wait();
      console.log(`${C.green}Whitelisted.${C.reset}\n`);
    } else {
      console.log(`${C.dim}Already whitelisted.${C.reset}\n`);
    }
  }

  const initBalance = await getDecryptedBalance(SELF);
  console.log(`${C.bold}Initial balance (SELF): ${initBalance}${C.reset}`);

  // Capture recipient baseline BEFORE the first tx is broadcast.
  // This guarantees the tracker never counts balance changes that predate the test.
  let recipientBaseline = 0;
  if (!IS_SELF_TRANSFER) {
    recipientBaseline = await getDecryptedBalance(RECIPIENT);
    if (recipientBaseline < 0) {
      console.error(`${C.red}Failed to fetch recipient baseline balance — aborting.${C.reset}`);
      process.exit(1);
    }
    console.log(`${C.bold}Initial balance (RECIPIENT): ${recipientBaseline}${C.reset}\n`);
  }

  // Start the completion tracker concurrently with the send loop.
  // The baseline is already locked in above, so there is no race condition.
  const trackerDone = TPS_MODE === "event"
    ? trackViaEvent(TPS_SETTLEMENT_EVENT)
    : trackViaBalance(recipientBaseline);

  let nonce = await provider.getTransactionCount(SELF, "pending");
  console.log(`${C.dim}Starting nonce: ${nonce}${C.reset}\n`);

  const testStart = Date.now();
  const testEndAt = testStart + TPS_DURATION * 1000;
  let txId = 1;

  console.log(`${C.bold}${C.green}▶ Sending transfers for ${TPS_DURATION}s...${C.reset}\n`);

  // ── Send loop: broadcast txs sequentially, confirm in the background ──────────
  const confirmPromises: Promise<void>[] = [];

  while (Date.now() < testEndAt) {
    const id          = txId++;
    const initiatedAt = Date.now();
    const record: TxRecord = { id, txHash: "", initiatedAt };
    records.push(record);

    try {
      const txResp  = await sendRawTransfer(nonce);
      record.txHash = txResp.hash;
      nonce++;

      // Track the actual send window (first and last successful broadcast timestamps)
      if (firstSentAt === 0) firstSentAt = initiatedAt;
      lastSentAt = initiatedAt;

      console.log(
        `${C.dim}[TX ${id}] sent nonce=${nonce - 1} hash=${txResp.hash.slice(0, 12)}...${C.reset}`
      );

      // Wait for on-chain confirmation in the background
      const confirmP = txResp.wait().then(receipt => {
        if (receipt) {
          record.onChainAt = Date.now();
          const t = record.onChainAt - record.initiatedAt;
          console.log(
            `${C.yellow}[TX ${id}] on-chain confirmed ${fmt(t)} block=${receipt.blockNumber}${C.reset}`
          );
        } else {
          record.error = "receipt is null";
        }
      }).catch((e: any) => {
        record.error = e?.message ?? String(e);
        console.error(`${C.red}[TX ${id}] confirmation failed: ${record.error}${C.reset}`);
      });

      confirmPromises.push(confirmP);
    } catch (e: any) {
      record.error = e?.message ?? String(e);
      console.error(`${C.red}[TX ${id}] send failed: ${record.error}${C.reset}`);
    }

    if (TPS_TX_DELAY > 0) await sleep(TPS_TX_DELAY);
  }

  // Signal the tracker that no more txs will be added
  testEndTime = Date.now();

  console.log(`\n${C.yellow}▶ Send phase done. Waiting for on-chain confirmations...${C.reset}`);
  await Promise.all(confirmPromises);

  console.log(`${C.yellow}▶ All confirmed on-chain. Waiting for off-chain FHE settlement...${C.reset}`);
  // The tracker manages its own settle timeout internally based on lastConfirmedAt,
  // so we simply await it here without a competing race.
  await trackerDone;

  // ─── Report ───────────────────────────────────────────────────────────────────
  const total     = records.length;
  const failed    = records.filter(r => r.error).length;
  const confirmed = records.filter(r => r.onChainAt).length;
  const completed = records.filter(r => r.completedAt).length;
  const done      = records.filter(r => r.completedAt);

  console.log(`\n${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Results${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}\n`);

  console.log(`${C.bold}Transaction summary:${C.reset}`);
  console.log(`  Initiated  : ${total}`);
  console.log(`  Failed     : ${C.red}${failed}${C.reset}`);
  console.log(`  Confirmed  : ${C.yellow}${confirmed}${C.reset}`);
  console.log(`  Completed  : ${C.green}${completed}${C.reset}\n`);

  if (completed === 0) {
    console.log(`${C.red}No completed transactions — cannot calculate TPS.${C.reset}`);
    process.exit(1);
  }

  // ── Latency breakdown (completed txs only) ────────────────────────────────────
  const onChainMs  = done.map(r => (r.onChainAt  ?? r.initiatedAt) - r.initiatedAt);
  const offChainMs = done.map(r => (r.completedAt ?? 0) - (r.onChainAt ?? r.initiatedAt));
  const totalMs    = done.map(r => (r.completedAt ?? 0) - r.initiatedAt);
  const avg        = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log(`${C.bold}Latency (completed txs only):${C.reset}`);
  console.log(`  Avg on-chain confirmation : ${fmt(avg(onChainMs))}`);
  console.log(`  Avg off-chain FHE compute : ${fmt(avg(offChainMs))}`);
  console.log(`  Avg end-to-end            : ${fmt(avg(totalMs))}`);
  console.log(`  Min end-to-end            : ${fmt(Math.min(...totalMs))}`);
  console.log(`  Max end-to-end            : ${fmt(Math.max(...totalMs))}\n`);

  // ── TPS metrics (4 indicators, each with a precise denominator) ───────────────
  //
  // 1. sendRate
  //    Numerator  : total txs broadcast
  //    Denominator: firstSentAt → lastSentAt (actual broadcast window, not the full loop duration)
  //    Meaning    : upper bound on client-side throughput, independent of chain/FHE
  const sendWindowS = firstSentAt > 0 && lastSentAt > firstSentAt
    ? (lastSentAt - firstSentAt) / 1000
    : (testEndTime - testStart) / 1000;
  const sendRate = total / sendWindowS;

  // 2. onChainTPS
  //    Numerator  : on-chain confirmed txs
  //    Denominator: firstConfirmedAt → lastConfirmedAt (chain processing window)
  //    Meaning    : true chain throughput, FHE excluded
  const confirmedRecords = records.filter(r => r.onChainAt);
  const firstConfirmedAt = Math.min(...confirmedRecords.map(r => r.onChainAt!));
  const lastConfirmedAt  = Math.max(...confirmedRecords.map(r => r.onChainAt!));
  const onChainWindowS   = (lastConfirmedAt - firstConfirmedAt) / 1000;
  // Guard against all txs landing in the same block (window = 0 → fallback to 1s)
  const onChainTPS = onChainWindowS > 0 ? confirmed / onChainWindowS : confirmed;

  // 3. completeTPS
  //    Numerator  : fully completed txs (on-chain + off-chain FHE)
  //    Denominator: firstConfirmedAt → lastCompletedAt (pipeline processing window)
  //    Meaning    : sustained throughput of the full on-chain + FHE pipeline
  const lastCompletedAt = Math.max(...done.map(r => r.completedAt!));
  const pipelineWindowS = (lastCompletedAt - firstConfirmedAt) / 1000;
  const completeTPS     = pipelineWindowS > 0 ? completed / pipelineWindowS : completed;

  // 4. effectiveTPS
  //    Numerator  : fully completed txs
  //    Denominator: firstInitiatedAt → lastCompletedAt (user-perceived end-to-end window)
  //    Meaning    : what the user experiences from first send to last settlement
  const firstInitiatedAt = records[0].initiatedAt;
  const e2eWindowS       = (lastCompletedAt - firstInitiatedAt) / 1000;
  const effectiveTPS     = completed / e2eWindowS;

  console.log(`${C.bold}${C.green}TPS metrics:${C.reset}\n`);

  console.log(`  ${C.bold}1. Send Rate${C.reset}       : ${C.yellow}${sendRate.toFixed(3)} tx/s${C.reset}`);
  console.log(
    `     Window : ${firstSentAt > 0 ? new Date(firstSentAt).toISOString() : "N/A"}` +
    ` → ${lastSentAt > 0 ? new Date(lastSentAt).toISOString() : "N/A"}` +
    ` (${sendWindowS.toFixed(2)}s)`
  );
  console.log(`     Note   : client broadcast rate; reflects requestEncrypt + RPC latency\n`);

  console.log(`  ${C.bold}2. On-chain TPS${C.reset}    : ${C.yellow}${onChainTPS.toFixed(3)} tx/s${C.reset}`);
  console.log(`     Window : ${fmt(onChainWindowS * 1000)} (first on-chain confirmation → last on-chain confirmation)`);
  console.log(`     Note   : true chain throughput, off-chain FHE not included\n`);

  console.log(`  ${C.bold}3. Complete TPS${C.reset}    : ${C.green}${completeTPS.toFixed(3)} tx/s${C.reset}`);
  console.log(`     Window : ${fmt(pipelineWindowS * 1000)} (first on-chain confirmation → last FHE settlement)`);
  console.log(`     Note   : full pipeline throughput (on-chain + off-chain FHE)\n`);

  console.log(`  ${C.bold}4. Effective TPS${C.reset}   : ${C.cyan}${effectiveTPS.toFixed(3)} tx/s${C.reset}`);
  console.log(`     Window : ${fmt(e2eWindowS * 1000)} (first tx broadcast → last FHE settlement)`);
  console.log(`     Note   : end-to-end user-perceived throughput; all delays included\n`);

  console.log(`${C.bold}Time windows detail:${C.reset}`);
  console.log(`  Send window     : ${sendWindowS.toFixed(2)}s`);
  console.log(`  On-chain window : ${onChainWindowS.toFixed(2)}s`);
  console.log(`  Pipeline window : ${pipelineWindowS.toFixed(2)}s`);
  console.log(`  E2E window      : ${e2eWindowS.toFixed(2)}s\n`);

  // ── Balance sanity check ──────────────────────────────────────────────────────
  const finalSelfBalance = await getDecryptedBalance(SELF);
  const expectedDelta    = IS_SELF_TRANSFER ? 0 : -(completed * parseFloat(TPS_AMOUNT));
  const expectedSelf     = initBalance + expectedDelta;
  const diffSelf         = Math.abs(finalSelfBalance - expectedSelf);

  console.log(`${C.bold}Balance check (SELF):${C.reset}`);
  console.log(`  Initial  : ${initBalance}`);
  console.log(`  Final    : ${finalSelfBalance}`);
  console.log(`  Expected : ${expectedSelf.toFixed(6)}`);
  console.log(`  Diff     : ${diffSelf < 0.000001 ? C.green : C.yellow}${diffSelf.toFixed(6)}${C.reset}`);
  if (diffSelf > 0.001) {
    console.log(`  ${C.yellow}⚠ Balance mismatch — some txs may still be settling off-chain${C.reset}`);
  }

  if (!IS_SELF_TRANSFER) {
    const finalRecipientBalance = await getDecryptedBalance(RECIPIENT);
    const expectedRecipient     = recipientBaseline + completed * parseFloat(TPS_AMOUNT);
    const diffRecipient         = Math.abs(finalRecipientBalance - expectedRecipient);
    console.log(`\n${C.bold}Balance check (RECIPIENT):${C.reset}`);
    console.log(`  Baseline : ${recipientBaseline}`);
    console.log(`  Final    : ${finalRecipientBalance}`);
    console.log(`  Expected : ${expectedRecipient.toFixed(6)}`);
    console.log(`  Diff     : ${diffRecipient < 0.000001 ? C.green : C.yellow}${diffRecipient.toFixed(6)}${C.reset}`);
    if (diffRecipient > 0.001) {
      console.log(`  ${C.yellow}⚠ Balance mismatch — some txs may still be settling off-chain${C.reset}`);
    }
  }

  console.log(`\n${C.bold}${C.green}✓ Benchmark complete${C.reset}\n`);
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Error: ${err?.message ?? err}${C.reset}`);
  console.error(err?.stack);
  process.exit(1);
});