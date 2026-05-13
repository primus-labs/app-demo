import type { BenchmarkConfig, BenchmarkRuntime, BalanceSnapshot, TrackerStats, TxRecord } from "./types";
import { C } from "./colors";
import {
  computeObservedSettlements,
  fmt,
  formatTokenUnits,
  isTrackerComplete,
  markCompletedByRecipientSettlements,
  sleep,
} from "./metrics";
import { getDecryptedBalanceUnits } from "./runtime";

interface TrackerState {
  records: TxRecord[];
  isSendDone: () => boolean;
}

interface EventLogLike {
  transactionHash?: string;
  topics: readonly string[];
  data: string;
}

function addCompletionKey(keys: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return;
  keys.add(value.toLowerCase());
}

export function eventLogCompletionKeys(log: EventLogLike): string[] {
  const keys = new Set<string>();
  addCompletionKey(keys, log.transactionHash);
  for (const topic of log.topics) addCompletionKey(keys, topic);

  const data = log.data.replace(/^0x/i, "");
  for (let offset = 0; offset + 64 <= data.length; offset += 64) {
    addCompletionKey(keys, `0x${data.slice(offset, offset + 64)}`);
  }

  return [...keys];
}

export function findEventCompletionRecord(records: TxRecord[], keys: string[]): TxRecord | undefined {
  const normalizedKeys = new Set(keys.map(key => key.toLowerCase()));
  return records.find(record => {
    if (record.completedAt || record.error) return false;
    if (record.txHash && normalizedKeys.has(record.txHash.toLowerCase())) return true;
    return (record.eventKeys || []).some(key => normalizedKeys.has(key.toLowerCase()));
  });
}

export function markEventRecordComplete(record: TxRecord, observedAt: number): boolean {
  if (!record.onChainAt) return false;
  record.completedAt = Math.max(observedAt, record.onChainAt);
  return true;
}

function logMarked(records: TxRecord[], completedAt: number, mode: string) {
  for (const r of records.filter(r => r.completedAt === completedAt)) {
    const recordCompletedAt = r.completedAt!;
    const total = recordCompletedAt - r.initiatedAt;
    const offChain = recordCompletedAt - (r.onChainAt ?? r.initiatedAt);
    console.log(
      `${C.green}[TX ${r.id}] complete (${mode}) ` +
      `total=${fmt(total)} off-chain=${fmt(offChain)}${C.reset}`
    );
  }
}

export async function trackViaBalances(
  runtime: BenchmarkRuntime,
  config: BenchmarkConfig,
  snapshots: BalanceSnapshot[],
  state: TrackerState
): Promise<TrackerStats> {
  console.log(
    `\n${C.cyan}[tracker] balance mode, recipients=${snapshots.length}, ` +
    `poll=${config.pollIntervalMs}ms${C.reset}`
  );

  const observedByRecipient = new Map<string, number>();
  const stats: TrackerStats = {
    mode: "balance",
    polls: 0,
    decryptAttempts: 0,
    decryptFailures: 0,
    decryptLatenciesMs: [],
    pollIntervalMs: config.pollIntervalMs,
  };

  while (true) {
    await sleep(config.pollIntervalMs);
    stats.polls++;

    for (const snapshot of snapshots) {
      const decryptStartedAt = Date.now();
      stats.decryptAttempts++;
      const currentUnits = await getDecryptedBalanceUnits(runtime, config, snapshot.address);
      stats.decryptLatenciesMs.push(Date.now() - decryptStartedAt);
      if (currentUnits === null) {
        stats.decryptFailures++;
        console.log(`${C.yellow}[tracker] decrypt failed for ${snapshot.address}${C.reset}`);
        continue;
      }

      const observed = computeObservedSettlements(
        snapshot.baselineUnits,
        currentUnits,
        runtime.amountUnits
      );
      observedByRecipient.set(
        snapshot.address.toLowerCase(),
        Math.max(observedByRecipient.get(snapshot.address.toLowerCase()) || 0, observed)
      );

      const deltaUnits = currentUnits > snapshot.baselineUnits
        ? currentUnits - snapshot.baselineUnits
        : 0n;
      console.log(
        `${C.dim}[tracker] recipient=${snapshot.address} ` +
        `delta=${formatTokenUnits(deltaUnits, runtime.decimals)} ` +
        `settled=${observedByRecipient.get(snapshot.address.toLowerCase()) || 0}${C.reset}`
      );
    }

    const completedAt = Date.now();
    const marked = markCompletedByRecipientSettlements(state.records, observedByRecipient, completedAt);
    if (marked.length > 0) logMarked(marked, completedAt, "balance");

    const allSent = state.isSendDone();
    const allConfirmed = state.records.every(r => r.onChainAt || r.error);
    if (isTrackerComplete(state.records, allSent)) {
      console.log(`${C.green}[tracker] all transactions completed${C.reset}`);
      break;
    }

    const confirmedTimes = state.records.filter(r => r.onChainAt).map(r => r.onChainAt!);
    const lastConfirmedAt = confirmedTimes.length > 0 ? Math.max(...confirmedTimes) : 0;
    if (allSent && allConfirmed && lastConfirmedAt > 0 && Date.now() > lastConfirmedAt + config.settleTimeoutMs) {
      const pending = state.records.filter(r => r.onChainAt && !r.completedAt && !r.error);
      console.log(`${C.yellow}[tracker] settle timeout, pending=${pending.length}${C.reset}`);
      break;
    }
  }

  return stats;
}

export async function trackViaEvent(
  runtime: BenchmarkRuntime,
  config: BenchmarkConfig,
  state: TrackerState
): Promise<TrackerStats> {
  if (!runtime.settlementContract) {
    throw new Error("SETTLEMENT_ADDRESS is required for event mode");
  }

  console.log(`\n${C.cyan}[tracker] event mode, event=${config.settlementEvent}${C.reset}`);

  const stats: TrackerStats = {
    mode: "event",
    polls: 0,
    decryptAttempts: 0,
    decryptFailures: 0,
    decryptLatenciesMs: [],
    observedEvents: 0,
  };
  const pendingObservedAt = new Map<number, number>();

  const provider = runtime.provider;
  const contract = runtime.settlementContract;
  const eventTopic = contract.interface.getEvent(config.settlementEvent)?.topicHash;
  if (!eventTopic) throw new Error(`Event "${config.settlementEvent}" not found in settlement contract ABI`);
  const eventAddress = await contract.getAddress();
  console.log(`${C.dim}[tracker] event topic=${eventTopic}, contract=${eventAddress}${C.reset}`);

  let lastCheckedBlock = await provider.getBlockNumber();

  while (true) {
    await sleep(1000);
    stats.polls++;

    for (const [recordId, observedAt] of pendingObservedAt) {
      const record = state.records.find(r => r.id === recordId);
      if (!record || record.completedAt || record.error) {
        pendingObservedAt.delete(recordId);
        continue;
      }
      if (markEventRecordComplete(record, observedAt)) {
        pendingObservedAt.delete(recordId);
        stats.observedEvents = (stats.observedEvents || 0) + 1;
        console.log(`${C.green}[TX ${record.id}] complete (event) total=${fmt(record.completedAt! - record.initiatedAt)} off-chain=${fmt(record.completedAt! - record.onChainAt!)}${C.reset}`);
      }
    }

    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock > lastCheckedBlock) {
        const logs = await provider.getLogs({
          address: eventAddress,
          topics: [eventTopic],
          fromBlock: lastCheckedBlock + 1,
          toBlock: currentBlock,
        });
        for (const log of logs) {
          const keys = eventLogCompletionKeys(log);
          if (keys.length === 0) continue;
          const record = findEventCompletionRecord(state.records, keys);
          if (!record || record.completedAt || record.error) continue;
          const observedAt = Date.now();
          if (!markEventRecordComplete(record, observedAt)) {
            pendingObservedAt.set(record.id, observedAt);
            continue;
          }
          stats.observedEvents = (stats.observedEvents || 0) + 1;
          const completedAt = record.completedAt!;
          const total = completedAt - record.initiatedAt;
          const offChain = completedAt - (record.onChainAt ?? record.initiatedAt);
          console.log(
            `${C.green}[TX ${record.id}] complete (event) ` +
            `total=${fmt(total)} off-chain=${fmt(offChain)} ` +
            `key=${keys[0].slice(0, 12)}...${C.reset}`
          );
        }
        if (logs.length > 0) {
          console.log(
            `${C.dim}[tracker] poll #${stats.polls}: ${logs.length} log(s) in blocks ${lastCheckedBlock + 1}-${currentBlock}, ` +
            `observed=${stats.observedEvents}${C.reset}`
          );
        }
        lastCheckedBlock = currentBlock;
      }
    } catch (e: any) {
      console.log(`${C.yellow}[tracker] getLogs error: ${e?.message ?? e}${C.reset}`);
    }

    const allSent = state.isSendDone();
    const allConfirmed = state.records.every(r => r.onChainAt || r.error);
    if (isTrackerComplete(state.records, allSent)) break;

    const confirmedTimes = state.records.filter(r => r.onChainAt).map(r => r.onChainAt!);
    const lastConfirmedAt = confirmedTimes.length > 0 ? Math.max(...confirmedTimes) : 0;
    if (allSent && allConfirmed && lastConfirmedAt > 0 && Date.now() > lastConfirmedAt + config.settleTimeoutMs) {
      console.log(`${C.yellow}[tracker] settle timeout${C.reset}`);
      break;
    }
  }

  return stats;
}
