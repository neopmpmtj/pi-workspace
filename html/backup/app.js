
// ── State ──
let currentSettings = {};
let currentBlacklist = [];

// ── Helpers ──
// Base path: the dashboard is served at /backup/ by the Node server.
// Normalize so both 'api/x' and '/api/x' resolve identically regardless of
// trailing/leading slashes.
const API_BASE = window.location.pathname.replace(/\/+$/, '');

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const url = API_BASE + '/' + path.replace(/^\/+/, '');
  const res = await fetch(url, opts);
  return res.json();
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showStatus(msg, ok = true) {
  const dot = document.getElementById('statusDot');
  dot.className = 'dot ' + (ok ? 'ok' : 'err');
  document.getElementById('backupStatus').textContent = msg;
}

// ── Load ──
async function loadSettings() {
  const s = await api('GET', '/api/settings');
  currentSettings = s;
  currentBlacklist = [...(s.blacklist || [])];

  document.getElementById('gdriveFolder').value = s.gdriveFolder || 'backups';
  document.getElementById('retentionCount').value = s.retentionCount ?? 5;
  document.getElementById('useHostnameSubfolder').checked = !!s.useHostnameSubfolder;

  const ts = document.getElementById('tokenStatus');
  if (s.serviceAccountKeyExists) {
    ts.innerHTML = '🔐 Service account &nbsp;·&nbsp; <code style="font-size:0.78rem;color:var(--text-muted)">' + escHtml(s.serviceAccountKeyPath || '') + '</code> &nbsp;·&nbsp; <span style="color:var(--success)">no expiry</span>';
  } else if (s.tokenExists) {
    ts.innerHTML = '✅ OAuth token present &nbsp;·&nbsp; <code style="font-size:0.78rem;color:var(--text-muted)">' + (s.tokenFile || 'gdrive_token.json') + '</code> &nbsp;·&nbsp; <span style="color:var(--warning)">expires ~7 days</span>';
  } else {
    ts.innerHTML = '⚠️ No auth method configured — see .env.example';
  }

  document.getElementById('hostname').textContent = s.hostname || '...';
  renderBlacklist();
}

function renderBlacklist() {
  const container = document.getElementById('blacklistTags');
  container.innerHTML = currentBlacklist.map(item =>
    `<span class="tag">${escHtml(item)}</span>`
  ).join('');
  document.getElementById('blacklistCount').textContent =
    currentBlacklist.length + ' director' + (currentBlacklist.length === 1 ? 'y' : 'ies') + ' excluded from backup';
}

function addBlacklistItem() {
  const input = document.getElementById('newBlacklistItem');
  const val = input.value.trim();
  if (!val) return;
  if (!currentBlacklist.includes(val)) {
    currentBlacklist.push(val);
    renderBlacklist();
  }
  input.value = '';
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Save ──
async function saveSettings(e) {
  e.preventDefault();
  const data = {
    gdriveFolder: document.getElementById('gdriveFolder').value.trim() || 'backups',
    retentionCount: parseInt(document.getElementById('retentionCount').value) || 0,
    useHostnameSubfolder: document.getElementById('useHostnameSubfolder').checked,
  };
  const result = await api('POST', 'api/settings', data);
  if (result.error) {
    toast(result.error, 'error');
  } else {
    toast('Settings saved ✓');
    loadSettings();
  }
}

async function saveBlacklist() {
  const result = await api('POST', 'api/settings', { blacklist: currentBlacklist });
  if (result.error) {
    toast(result.error, 'error');
  } else {
    toast('Blacklist saved ✓');
    loadSettings();
  }
}

// ── Backup ──
let backupTimer = null;

async function runBackup() {
  const btn = document.getElementById('btnBackup');
  const statusEl = document.getElementById('backupStatus');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Starting...';
  showStatus('⏳ Starting backup...', true);

  // Live elapsed-time counter
  const startTime = Date.now();
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    statusEl.textContent = '⏳ Backup in progress (' + elapsed + 's elapsed)...';
  }, 1000);

  try {
    // 1) Kick off the backup (non-blocking — returns immediately)
    const kickoff = await api('POST', 'api/backup');
    if (kickoff.status === 'already_running') {
      clearInterval(backupTimer);
      backupTimer = null;
      btn.disabled = false;
      btn.innerHTML = '▶ Run Backup Now';
      showStatus('⚠️ A backup is already running (started at ' + kickoff.started_at + ')', false);
      toast('A backup is already in progress', 'error');
      return;
    }
    if (kickoff.status !== 'started') {
      throw new Error('Unexpected response: ' + JSON.stringify(kickoff));
    }

    // 2) Poll until complete
    let result = null;
    const maxPolls = 300; // 10 minutes max
    for (let i = 0; i < maxPolls; i++) {
      await sleep(2000);
      const poll = await api('GET', 'api/backup/status');
      if (poll.status === 'complete') {
        result = poll;
        break;
      }
      if (poll.status === 'idle') {
        // Job finished but result was already consumed? Try one more time.
        await sleep(500);
        const retry = await api('GET', 'api/backup/status');
        if (retry.status === 'complete') { result = retry; break; }
        throw new Error('Backup job disappeared unexpectedly');
      }
      // poll.status === 'running' — keep polling
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      statusEl.textContent = '⏳ Backup in progress (' + elapsed + 's elapsed)...';
    }

    clearInterval(backupTimer);
    backupTimer = null;
    btn.disabled = false;
    btn.innerHTML = '▶ Run Backup Now';

    if (!result) {
      showStatus('⏰ Backup timed out after 10 minutes', false);
      toast('Backup timed out', 'error');
      return;
    }

    // 3) Show results
    const detail = document.getElementById('historyLogDetail');
    let output = (result.stdout || '') + (result.stderr ? '\n' + result.stderr : '');
    if (!output.trim()) output = '(no output)';
    detail.style.display = 'block';
    detail.innerHTML = colorizeLog(output);

    await loadHistory();

    if (result.success) {
      showStatus('✅ Backup completed in ' +
        ((Date.now() - startTime) / 1000).toFixed(1) + 's!', true);
      toast('Backup completed successfully!');
    } else {
      showStatus('❌ Backup failed (exit code ' + result.exitCode + ')', false);
      toast('Backup failed — see log below', 'error');
    }
  } catch (err) {
    clearInterval(backupTimer);
    backupTimer = null;
    btn.disabled = false;
    btn.innerHTML = '▶ Run Backup Now';
    document.getElementById('historyLogDetail').style.display = 'block';
    document.getElementById('historyLogDetail').innerHTML =
      '<span class="error">Network error: ' + escHtml(err.message) + '</span>';
    showStatus('❌ Request failed: ' + err.message, false);
    toast('Request failed: ' + err.message, 'error');
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runAuth() {
  const btn = document.getElementById('btnAuth');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Starting auth...';
  showStatus('Opening browser for OAuth...', true);

  try {
    const result = await api('POST', 'api/auth');
    btn.disabled = false;
    btn.innerHTML = '🔑 Re-authorize Google';
    if (result.success) {
      toast('Authorization successful! Token saved.');
      await loadSettings();
    } else {
      toast('Authorization failed: ' + (result.error || 'unknown error'), 'error');
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '🔑 Re-authorize Google';
    toast('Request failed: ' + err.message, 'error');
  }
}

// ── History ──
let historyData = [];
let selectedRunId = null;

async function loadHistory() {
  try {
    const [stats, data] = await Promise.all([
      api('GET', 'api/stats'),
      api('GET', 'api/history?limit=30'),
    ]);

    // Stats bar
    const {total, succeeded, failed, period_days} = stats;
    document.getElementById('historyPeriod').textContent = `(last ${period_days} days)`;
    if (total === 0) {
      document.getElementById('statsBar').textContent = 'No backups recorded yet.';
    } else {
      const pct = total > 0 ? Math.round((succeeded / total) * 100) : 0;
      document.getElementById('statsBar').innerHTML =
        `<strong>${total}</strong> runs · <span style="color:var(--success)">${succeeded} passed</span>` +
        (failed > 0 ? ` · <span style="color:var(--danger)">${failed} failed</span>` : '') +
        ` · <strong>${pct}%</strong> success rate`;
    }

    // Table
    historyData = data.runs || [];
    renderHistoryTable();
  } catch (err) {
    document.getElementById('statsBar').textContent = 'Failed to load history.';
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById('historyBody');
  if (historyData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No backup history yet. Run your first backup!</td></tr>';
    return;
  }
  tbody.innerHTML = historyData.map(r => {
    const dt = new Date(r.timestamp);
    const dateStr = dt.toLocaleDateString(undefined, {month:'short',day:'numeric'})
      + ' ' + dt.toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'});
    const badgeCls = r.success ? 'ok' : 'fail';
    const badgeText = r.success ? '✓ Passed' : '✗ Failed';
    const size = r.archive_size_bytes ? formatBytes(r.archive_size_bytes) : '—';
    const dur = r.duration_seconds != null ? r.duration_seconds.toFixed(1) + 's' : '—';
    const triggerLabel = r.trigger_source || 'unknown';
    const selCls = r.id === selectedRunId ? ' selected' : '';
    return `<tr class="clickable${selCls}" onclick="selectRun(${r.id})">
      <td title="${r.timestamp}">${dateStr}</td>
      <td><span class="badge ${badgeCls}">${badgeText}</span></td>
      <td>${size}</td>
      <td>${dur}</td>
      <td><span class="trigger-tag ${triggerLabel}">${triggerLabel}</span></td>
    </tr>`;
  }).join('');
}

function selectRun(id) {
  selectedRunId = id;
  renderHistoryTable();
  const run = historyData.find(r => r.id === id);
  const detail = document.getElementById('historyLogDetail');
  if (run && run.output_log) {
    detail.style.display = 'block';
    detail.innerHTML = colorizeLog(run.output_log);
  } else if (run) {
    detail.style.display = 'block';
    detail.innerHTML = '<span style="color:var(--text-muted)">(no log output captured for this run)</span>';
  } else {
    detail.style.display = 'none';
  }
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function colorizeLog(text) {
  return text.split('\n').map(line => {
    if (line.includes('[ERROR]') || line.includes('Traceback') || /failed/i.test(line))
      return '<span class="error">' + escHtml(line) + '</span>';
    if (line.includes('[INFO]'))
      return '<span class="info">' + escHtml(line) + '</span>';
    return escHtml(line);
  }).join('\n');
}

// ── Init ──
loadSettings();
loadHistory();
