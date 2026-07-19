// test/api.test.mjs — unit tests for backup/api.mjs
// Run: node --test (from ~/.pi/html/backup/)
//
// Uses only Node's built-in test runner; no external deps. The Python backup
// engine is never invoked (spawn is injected).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _internal, _setSpawnEngine } from '../api.mjs';

const { parseDotenv, writeDotenv, parseBoolEnv,
        startBackupAsync, getBackupStatus, runAuth, _resetBackupJob } = _internal;

// ── parseDotenv / writeDotenv ───────────────────────────────────────────────

test('parseDotenv: parses key=value pairs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, 'FOO=bar\nBAZ=qux\n');
  assert.deepEqual(parseDotenv(p), { FOO: 'bar', BAZ: 'qux' });
});

test('parseDotenv: ignores comments and blanks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, '# comment\n\nFOO=bar\n  # indented\nBAZ=1\n');
  assert.deepEqual(parseDotenv(p), { FOO: 'bar', BAZ: '1' });
});

test('parseDotenv: missing file returns empty object', () => {
  assert.deepEqual(parseDotenv(join(tmpdir(), 'definitely-missing.env')), {});
});

test('parseDotenv: preserves values with spaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, 'NAME=my folder name\n');
  assert.equal(parseDotenv(p).NAME, 'my folder name');
});

test('writeDotenv: updates existing managed key, preserves others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, 'FOO=old\nRETENTION_COUNT=0\nGOOGLE_CLIENT_ID=secret\n');
  writeDotenv(p, { RETENTION_COUNT: '5' });
  const text = readFileSync(p, 'utf-8');
  assert.ok(text.includes('RETENTION_COUNT=5'));
  assert.ok(text.includes('FOO=old'));
  assert.ok(text.includes('GOOGLE_CLIENT_ID=secret'));
});

test('writeDotenv: appends new key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, 'FOO=bar\n');
  writeDotenv(p, { NEW_KEY: 'val' });
  const text = readFileSync(p, 'utf-8');
  assert.ok(text.includes('NEW_KEY=val'));
  assert.ok(text.includes('FOO=bar'));
});

test('writeDotenv: creates file if missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  assert.ok(!existsSync(p));
  writeDotenv(p, { FOO: 'bar' });
  assert.equal(readFileSync(p, 'utf-8').trim(), 'FOO=bar');
});

test('writeDotenv: preserves comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, '# header\nFOO=bar\n# mid\nBAZ=1\n');
  writeDotenv(p, { FOO: 'updated' });
  const text = readFileSync(p, 'utf-8');
  assert.ok(text.includes('# header'));
  assert.ok(text.includes('# mid'));
  assert.ok(text.includes('FOO=updated'));
});

// ── parseBoolEnv ────────────────────────────────────────────────────────────

test('parseBoolEnv: truthy variants', () => {
  for (const v of ['true', 'True', 'TRUE', '1', 'yes', 'on']) {
    assert.equal(parseBoolEnv(v, false), true, `${v} should be true`);
  }
});

test('parseBoolEnv: falsy variants', () => {
  for (const v of ['false', '0', 'no', 'off']) {
    assert.equal(parseBoolEnv(v, true), false, `${v} should be false`);
  }
});

test('parseBoolEnv: empty/whitespace falls back to default', () => {
  assert.equal(parseBoolEnv('', true), true);
  assert.equal(parseBoolEnv('   ', true), true);
  assert.equal(parseBoolEnv('', false), false);
});

test('parseBoolEnv: unrecognized falls back to false', () => {
  assert.equal(parseBoolEnv('maybe', true), false);
});

test('parseBoolEnv: unset (null/undefined) falls back to default', () => {
  assert.equal(parseBoolEnv(null, true), true);
  assert.equal(parseBoolEnv(undefined, false), false);
});

// ── Async backup job tracker (spawn injected) ──────────────────────────────

// A fake spawn that resolves immediately with a controlled result.
function fakeSpawn(result) {
  return () => ({
    child: { kill() {} },
    done: Promise.resolve(result),
  });
}

// A fake spawn that never resolves until release() is called — to observe
// the "running" state.
function hangingSpawn() {
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  return { spawnFn: () => ({ child: { kill() {} }, done }), release };
}

test('job: starts and completes successfully', async () => {
  _resetBackupJob();
  _setSpawnEngine(fakeSpawn({ success: true, stdout: 'ok', stderr: '', exitCode: 0 }));
  assert.equal(startBackupAsync().status, 'started');
  // Allow the microtask to settle.
  await new Promise((r) => setTimeout(r, 0));
  const s = getBackupStatus();
  assert.equal(s.status, 'complete');
  assert.equal(s.success, true);
  assert.equal(s.exitCode, 0);
  assert.equal(s.stdout, 'ok');
});

test('job: status is running while in progress', async () => {
  _resetBackupJob();
  const { spawnFn, release } = hangingSpawn();
  _setSpawnEngine(spawnFn);
  assert.equal(startBackupAsync().status, 'started');
  // While unresolved, status must be "running".
  const s = getBackupStatus();
  assert.equal(s.status, 'running');
  assert.ok(s.started_at);
  release({ success: true, stdout: '', stderr: '', exitCode: 0 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(getBackupStatus().status, 'complete');
});

test('job: rejects double start', async () => {
  _resetBackupJob();
  const { spawnFn, release } = hangingSpawn();
  _setSpawnEngine(spawnFn);
  assert.equal(startBackupAsync().status, 'started');
  const r2 = startBackupAsync();
  assert.equal(r2.status, 'already_running');
  assert.ok(r2.started_at);
  release({ success: true, stdout: '', stderr: '', exitCode: 0 });
  await new Promise((r) => setTimeout(r, 0));
});

test('job: failure is recorded as complete', async () => {
  _resetBackupJob();
  _setSpawnEngine(fakeSpawn({ success: false, stdout: '', stderr: 'boom', exitCode: 2 }));
  startBackupAsync();
  await new Promise((r) => setTimeout(r, 0));
  const s = getBackupStatus();
  assert.equal(s.status, 'complete');
  assert.equal(s.success, false);
  assert.equal(s.exitCode, 2);
  assert.equal(s.stderr, 'boom');
});

test('job: idle when no job has run', () => {
  _resetBackupJob();
  assert.equal(getBackupStatus().status, 'idle');
});

test('job: result returned only once', async () => {
  _resetBackupJob();
  _setSpawnEngine(fakeSpawn({ success: true, stdout: 'x', stderr: '', exitCode: 0 }));
  startBackupAsync();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(getBackupStatus().status, 'complete');
  // After being consumed once, must not return the result again.
  assert.equal(getBackupStatus().status, 'idle');
});

test('job: spawn exception is caught (done rejects) and recorded as failure', async () => {
  _resetBackupJob();
  _setSpawnEngine(() => ({
    child: { kill() {} },
    done: Promise.reject(new Error('crash')),
  }));
  startBackupAsync();
  await new Promise((r) => setTimeout(r, 10));
  // Must not hang in 'running' — the rejection is caught and recorded.
  const s = getBackupStatus();
  assert.equal(s.status, 'complete');
  assert.equal(s.success, false);
  assert.equal(s.exitCode, -1);
  assert.ok(s.stderr.includes('crash'));
});

// ── runAuth: synchronous-ish, returns the spawn result ─────────────────────

test('runAuth: returns the spawn result', async () => {
  _resetBackupJob();
  _setSpawnEngine(fakeSpawn({ success: true, stdout: '', stderr: '', exitCode: 0 }));
  const r = await runAuth();
  assert.equal(r.success, true);
  assert.equal(r.exitCode, 0);
});

test('runAuth: spawn failure surfaces', async () => {
  _resetBackupJob();
  _setSpawnEngine(fakeSpawn({ success: false, stdout: '', stderr: 'denied', exitCode: 1 }));
  const r = await runAuth();
  assert.equal(r.success, false);
  assert.equal(r.stderr, 'denied');
});
