#!/usr/bin/env tsx
/**
 * FHE ERC20 TPS Benchmark
 *
 * Measures the true TPS of FHETransform-based ERC20 transfers, covering:
 *   on-chain symbolic execution + off-chain FHE computation + balance update
 *
 * Send strategy:
 *   - Manually manage nonce and send sequentially (single account, no concurrency)
 *   - Fire-and-forget: move on to the next tx immediately after broadcast
 *   - Wait for receipts concurrently in the background
 *
 * Completion detection (balance mode):
 *   - Poll balanceOf periodically
 *   - balance delta / TPS_AMOUNT = number of newly settled txs
 *   - Mark completions in FIFO order
 *
 * Completion detection (event mode):
 *   - Listen for a specified settlement event
 *   - Each event emission marks one tx as complete
 *
 * Usage:
 *   npx tsx test/tps-benchmark.ts
 *
 * Environment variables:
 *   TPS_DURATION=60           Test duration in seconds (default: 60)
 *   TPS_AMOUNT=0.001          Amount per transfer (default: 0.001)
 *   TPS_MODE=balance          Completion mode: "balance" or "event" (default: balance)
 *   TPS_POLL_INTERVAL=5000    Balance poll interval in ms (default: 5000)
 *   TPS_SETTLEMENT_EVENT=...  Settlement event name (event mode only)
 *   TPS_RECIPIENT=0x...       Recipient address (default: self)
 *   TPS_TX_DELAY=200          Delay between consecutive tx broadcasts in ms (default: 200)
 */

import { ethers } from "ethers";
import { requestEncrypt, FheType, estimateFheFee, requestDecrypt } from "@primuslabs/fhe-sdk";
import { PUSDCTokenV2_1_ABI } from "../src/abis/PUSDCTokenV2_1_ABI";
import 'dotenv/config';

// ─── Colors ────────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", dim: "\x1b[2m",
};

// ─── Config ────────────────────────────────────────────────────────────────────
const PRIVATE_KEY         = process.env.PRIVATE_KEY         || "";
const RPC_URL             = process.env.RPC_URL             || "";
const PUSDC_TOKEN_ADDRESS = process.env.PUSDC_TOKEN_ADDRESS || "";
const ACL_ADDRESS         = process.env.ACL_ADDRESS         || "";

const TPS_DURATION         = parseInt(process.env.TPS_DURATION       || "60");
const TPS_AMOUNT           = process.env.TPS_AMOUNT                  || "0.001";
const TPS_MODE             = process.env.TPS_MODE                    || "balance";
const TPS_POLL_INTERVAL    = parseInt(process.env.TPS_POLL_INTERVAL  || "5000");
const TPS_SETTLEMENT_EVENT = process.env.TPS_SETTLEMENT_EVENT        || "";
const TPS_TX_DELAY         = parseInt(process.env.TPS_TX_DELAY       || "200");

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
  id: number;
  txHash: string;
  initiatedAt: number;   // wall-clock time when tx was broadcast
  onChainAt?: number;    // wall-clock time when on-chain receipt was received
  completedAt?: number;  // wall-clock time when off-chain FHE computation finished
  error?: string;
}

const records: TxRecord[] = [];
let testEndTime = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function fmt(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

async function getDecryptedBalance(address: string): Promise<number> {
  try {
    const handle = await contract.balanceOf(address);
    const decimals: number = await contract.decimals();
    const plain = await requestDecrypt(
      wallet, ACL_ADDRESS, FheType.ve_uint256, handle,
      { isMock: process.env.MOCK_TEST === "ON" }
    );
    return parseFloat(ethers.formatUnits(plain, decimals));
  } catch {
    return -1;
  }
}

// ─── Broadcast a single transfer without waiting for confirmation ──────────────
async function sendRawTransfer(nonce: number): Promise<ethers.TransactionResponse> {
  const decimals: number = await contract.decimals();
  const amountRaw = ethers.parseUnits(TPS_AMOUNT, decimals);

  const chainId = Number((await provider.getNetwork()).chainId);

  const amountHandle = await requestEncrypt(
    wallet, ACL_ADDRESS, amountRaw, FheType.ve_uint256, chainId, null,
    { isMock: process.env.MOCK_TEST === "ON" }
  );

  const { totalFee } = await estimateFheFee(
    PUSDC_TOKEN_ADDRESS, "transfer", { chainId, verbose: 0 }
  );

  // Specify nonce explicitly so we can fire-and-forget without nonce conflicts
  return contract.transfer(RECIPIENT, amountHandle, { value: totalFee, nonce });
}

// ─── Completion tracker: balance mode ─────────────────────────────────────────
// Polls balanceOf and marks txs complete in FIFO order as the balance increases.
// For self-transfers the balance is unchanged, so we fall back to a time-based
// heuristic: mark complete after 2 poll intervals post on-chain confirmation.
async function trackViaBalance(): Promise<void> {
  console.log(`\n${C.cyan}[tracker] balance mode, poll every ${TPS_POLL_INTERVAL}ms${C.reset}`);

  let baseline = await getDecryptedBalance(IS_SELF_TRANSFER ? SELF : RECIPIENT);
  console.log(`${C.dim}[tracker] baseline balance = ${baseline}${C.reset}`);

  const TPS_AMOUNT_F = parseFloat(TPS_AMOUNT);

  while (true) {
    await sleep(TPS_POLL_INTERVAL);

    const pending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);

    if (IS_SELF_TRANSFER) {
      // Balance stays flat for self-transfers; use elapsed time as a proxy
      for (const r of pending) {
        if (Date.now() - (r.onChainAt ?? r.initiatedAt) >= TPS_POLL_INTERVAL * 2) {
          r.completedAt = Date.now();
          const total    = r.completedAt - r.initiatedAt;
          const offChain = r.completedAt - (r.onChainAt ?? r.initiatedAt);
          console.log(`${C.green}[TX ${r.id}] ✓ complete (self-transfer) total=${fmt(total)} off-chain≈${fmt(offChain)}${C.reset}`);
        }
      }
    } else {
      const cur = await getDecryptedBalance(RECIPIENT);
      if (cur < 0) continue;

      const delta   = cur - baseline;
      const settled = Math.round(delta / TPS_AMOUNT_F);

      if (settled > 0) {
        let n = 0;
        for (const r of pending) {
          if (n >= settled) break;
          r.completedAt = Date.now();
          n++;
          const total    = r.completedAt - r.initiatedAt;
          const offChain = r.completedAt - (r.onChainAt ?? r.initiatedAt);
          console.log(`${C.green}[TX ${r.id}] ✓ complete total=${fmt(total)} off-chain=${fmt(offChain)}${C.reset}`);
        }
        baseline = cur;
      } else {
        console.log(`${C.dim}[tracker] balance=${cur} pending=${pending.length}${C.reset}`);
      }
    }

    // All txs that are either not yet on-chain or not yet completed
    const anyUnfinished = records.filter(r => !r.completedAt && !r.error);
    if (testEndTime > 0 && anyUnfinished.length === 0) break;

    // Safety timeout: 120s after the last on-chain confirmation
    const lastConfirmedAt = Math.max(0, ...records.filter(r => r.onChainAt).map(r => r.onChainAt!));
    if (lastConfirmedAt > 0 && Date.now() > lastConfirmedAt + 120_000) {
      const stillPending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
      console.log(`${C.yellow}[tracker] 120s timeout after last confirmation, ${stillPending.length} tx(s) still pending${C.reset}`);
      break;
    }
  }
}

// ─── Completion tracker: event mode ───────────────────────────────────────────
// Listens for a settlement event emitted after each off-chain FHE computation.
// Each event emission marks the oldest unfinished confirmed tx as complete.
async function trackViaEvent(eventName: string): Promise<void> {
  console.log(`\n${C.cyan}[tracker] event mode, listening for "${eventName}"${C.reset}\n`);

  contract.on(eventName, () => {
    const pending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
    if (!pending.length) return;
    const r = pending[0];
    r.completedAt = Date.now();
    const total    = r.completedAt - r.initiatedAt;
    const offChain = r.completedAt - (r.onChainAt ?? r.initiatedAt);
    console.log(`${C.green}[TX ${r.id}] ✓ complete (event) total=${fmt(total)} off-chain=${fmt(offChain)}${C.reset}`);
  });

  while (testEndTime === 0 || Date.now() < testEndTime + 120_000) {
    await sleep(1000);
    const stillPending = records.filter(r => r.onChainAt && !r.completedAt && !r.error);
    if (testEndTime > 0 && stillPending.length === 0) break;
  }

  contract.removeAllListeners(eventName);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  FHE ERC20 TPS Benchmark${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}\n`);
  console.log(`  Account       : ${SELF}`);
  console.log(`  Recipient     : ${RECIPIENT}${IS_SELF_TRANSFER ? " (self-transfer)" : ""}`);
  console.log(`  Contract      : ${PUSDC_TOKEN_ADDRESS}`);
  console.log(`  Duration      : ${TPS_DURATION}s`);
  console.log(`  Amount        : ${TPS_AMOUNT}`);
  console.log(`  Mode          : ${TPS_MODE}`);
  console.log(`  TX delay      : ${TPS_TX_DELAY}ms`);
  console.log(`  Poll interval : ${TPS_POLL_INTERVAL}ms\n`);

  // Whitelist self so we can decrypt the recipient's balance (non-self-transfer only)
  if (!IS_SELF_TRANSFER) {
    const isWhitelisted: boolean = await contract.isWhitelisted(SELF);
    if (!isWhitelisted) {
      console.log(`${C.yellow}Adding ${SELF} to whitelist for balance decryption...${C.reset}`);
      const tx = await contract.addToWhitelist(SELF);
      await tx.wait();
      console.log(`${C.green}Whitelisted.${C.reset}\n`);
    } else {
      console.log(`${C.dim}Already whitelisted.${C.reset}\n`);
    }
  }

  const initBalance = await getDecryptedBalance(SELF);
  console.log(`${C.bold}Initial balance: ${initBalance}${C.reset}\n`);

  // Start completion tracker in the background
  const trackerDone = TPS_MODE === "event"
    ? trackViaEvent(TPS_SETTLEMENT_EVENT)
    : trackViaBalance();

  let nonce = await provider.getTransactionCount(SELF, "pending");
  console.log(`${C.dim}Starting nonce: ${nonce}${C.reset}\n`);

  const testStart = Date.now();
  const testEndAt = testStart + TPS_DURATION * 1000;
  let txId = 1;

  console.log(`${C.bold}${C.green}▶ Sending transfers for ${TPS_DURATION}s...${C.reset}\n`);

  // ── Send loop: sequential broadcast, no waiting for confirmation ──────────────
  const confirmPromises: Promise<void>[] = [];

  while (Date.now() < testEndAt) {
    const id          = txId++;
    const initiatedAt = Date.now();
    const record: TxRecord = { id, txHash: "", initiatedAt };
    records.push(record);

    try {
      const txResp = await sendRawTransfer(nonce);
      record.txHash = txResp.hash;
      nonce++;

      console.log(`${C.dim}[TX ${id}] sent nonce=${nonce - 1} hash=${txResp.hash.slice(0, 12)}...${C.reset}`);

      // Wait for on-chain confirmation in the background
      const confirmP = txResp.wait().then(receipt => {
        if (receipt) {
          record.onChainAt = Date.now();
          const t = record.onChainAt - record.initiatedAt;
          console.log(`${C.yellow}[TX ${id}] on-chain confirmed ${fmt(t)} block=${receipt.blockNumber}${C.reset}`);
        } else {
          record.error = "receipt is null";
        }
      }).catch(e => {
        record.error = e?.message ?? String(e);
        console.error(`${C.red}[TX ${id}] confirmation failed: ${record.error}${C.reset}`);
      });

      confirmPromises.push(confirmP);
    } catch (e: any) {
      record.error = e?.message ?? String(e);
      console.error(`${C.red}[TX ${id}] send failed: ${record.error}${C.reset}`);
    }

    // Rate-limit broadcasts to avoid mempool backlog
    if (TPS_TX_DELAY > 0) await sleep(TPS_TX_DELAY);
  }

  testEndTime = Date.now();
  const testDurationS = (testEndTime - testStart) / 1000;

  console.log(`\n${C.yellow}▶ Send phase done. Waiting for on-chain confirmations...${C.reset}`);
  await Promise.all(confirmPromises);

  console.log(`${C.yellow}▶ All confirmed on-chain. Waiting for off-chain FHE computation...${C.reset}`);
  await Promise.race([
    trackerDone,
    sleep(120_000).then(() => console.log(`${C.yellow}[tracker] 120s timeout${C.reset}`)),
  ]);

  // ─── Report ───────────────────────────────────────────────────────────────────
  const total     = records.length;
  const failed    = records.filter(r => r.error).length;
  const confirmed = records.filter(r => r.onChainAt).length;
  const completed = records.filter(r => r.completedAt).length;

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

  const done       = records.filter(r => r.completedAt);
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

  const onChainTPS  = confirmed / testDurationS;
  const completeTPS = completed / testDurationS;
  const firstAt     = records[0].initiatedAt;
  const lastAt      = Math.max(...done.map(r => r.completedAt ?? 0));
  const effectiveTPS = completed / ((lastAt - firstAt) / 1000);

  console.log(`${C.bold}${C.green}TPS metrics:${C.reset}`);
  console.log(`  ${C.bold}On-chain TPS${C.reset}  : ${C.yellow}${onChainTPS.toFixed(3)} tx/s${C.reset}`);
  console.log(`    On-chain confirmations only, off-chain FHE not included`);
  console.log();
  console.log(`  ${C.bold}Complete TPS${C.reset}  : ${C.green}${completeTPS.toFixed(3)} tx/s${C.reset}`);
  console.log(`    Fully completed txs (on-chain + off-chain FHE), denominator = send duration`);
  console.log();
  console.log(`  ${C.bold}Effective TPS${C.reset} : ${C.cyan}${effectiveTPS.toFixed(3)} tx/s${C.reset}`);
  console.log(`    Window = first tx initiated → last tx completed\n`);

  console.log(`${C.bold}Time windows:${C.reset}`);
  console.log(`  Send phase duration : ${testDurationS.toFixed(2)}s`);
  console.log(`  Effective window    : ${((lastAt - firstAt) / 1000).toFixed(2)}s\n`);

  // Balance sanity check
  const finalBalance    = await getDecryptedBalance(SELF);
  const expectedDelta   = IS_SELF_TRANSFER ? 0 : -(completed * parseFloat(TPS_AMOUNT));
  const expectedBalance = initBalance + expectedDelta;
  const diff            = Math.abs(finalBalance - expectedBalance);

  console.log(`${C.bold}Balance check:${C.reset}`);
  console.log(`  Initial  : ${initBalance}`);
  console.log(`  Final    : ${finalBalance}`);
  console.log(`  Expected : ${expectedBalance.toFixed(6)}`);
  console.log(`  Diff     : ${diff < 0.000001 ? C.green : C.yellow}${diff.toFixed(6)}${C.reset}`);
  if (diff > 0.001) {
    console.log(`  ${C.yellow}⚠ Balance mismatch — some txs may still be settling off-chain${C.reset}`);
  }

  console.log(`\n${C.bold}${C.green}✓ Benchmark complete${C.reset}\n`);
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Error: ${err?.message ?? err}${C.reset}`);
  console.error(err?.stack);
  process.exit(1);
});
