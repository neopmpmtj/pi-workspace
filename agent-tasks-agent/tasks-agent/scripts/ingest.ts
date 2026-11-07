// Records this agent's turns in logs/ledger.sqlite, read from Pi's session JSONL.
//
// The ledger is a derived cache: `sessions/` is the source of truth, and the ingest keeps a
// per-file byte offset, so a run that is late (or never happened) backfills every turn it
// missed. Nothing is lost by leaving this off for a while — it just is not visible yet.
//
// Run by the `pi-tasks-agent-ledger.timer` user timer, or by hand:
//   PI_CODING_AGENT_DIR=$PWD node --experimental-strip-types scripts/ingest.ts
import { ledgerPath, sessionsRoot } from "../ledger/env.ts";
import { syncSessions } from "../ledger/ingest.ts";
import { readRates } from "../ledger/rates.ts";
import { openLedger } from "../ledger/store.ts";

const rates = await readRates();
const ledger = openLedger(ledgerPath());
try {
  const stats = syncSessions(ledger, { sessionsRoot: sessionsRoot(), ratesVersion: rates.version });
  const stamp = new Date().toISOString();
  if (stats.files === 0 && stats.newCalls === 0) {
    console.log(`${stamp} up to date (rates ${rates.version})`);
  } else {
    console.log(
      `${stamp} files=${stats.files} newCalls=${stats.newCalls} newTurns=${stats.newTurns} merged=${stats.merged} (rates ${rates.version})`,
    );
  }
} finally {
  ledger.close();
}
