import { appendFile, mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";

const STALE_MS = 30_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock(lockPath: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await fn();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_MS) await unlink(lockPath);
      } catch {
        // The owner released the lock between the stat and the unlink.
      }
      if (Date.now() - started > 10_000) {
        throw new Error(`Could not lock the run log: ${lockPath}`);
      }
      await sleep(20);
    }
  }
}

export async function appendJsonLine(logPath: string, record: unknown): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  await withFileLock(`${logPath}.lock`, async () => {
    await appendFile(logPath, line, "utf8");
  });
}
