// app.js — Codebase Summary dashboard frontend

// ── Helpers ────────────────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const d = Math.floor(hr / 24);
  return d + 'd ago';
}

function fmtTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString();
}

// ── Extract summary text from pi output ────────────────────────────────────

function extractSummaryText(summary) {
  if (!summary) return '(empty)';

  // pi --print -p output: { type: "message", message: { content: [...] } }
  // The actual text is typically in message.content[1].text (after thinking block)
  if (summary.type === 'message' && summary.message && Array.isArray(summary.message.content)) {
    // Find the first text content block
    const textBlocks = summary.message.content.filter(c => c.type === 'text' && c.text);
    if (textBlocks.length > 0) {
      return textBlocks.map(c => c.text).join('\n\n');
    }
  }

  // Fallback: if it's a string, use directly
  if (typeof summary === 'string') return summary;

  // Fallback: if it has a .raw field
  if (summary.raw) return summary.raw;

  // Fallback: stringify
  try { return JSON.stringify(summary, null, 2); }
  catch { return String(summary); }
}

// ── Simple Markdown to HTML renderer ──────────────────────────────────────

function renderMarkdown(md) {
  if (!md) return '<p class="md-empty">(empty)</p>';

  let html = escHtml(md);

  // Code blocks (fenced) — must come before inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
    return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>';
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic (must come after bold to avoid conflicts)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Tables — convert pipe tables to HTML
  html = html.replace(/\n(\|[^\n]+\|)\n\|[\s\-:|]+\|\n((?:\|[^\n]+\|\n?)*)/g, function(m, header, body) {
    const headerCells = header.split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>');
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>');
      return '<tr>' + cells.join('') + '</tr>';
    });
    return '\n<table><thead><tr>' + headerCells.join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>\n';
  });

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');
  html = html.replace(/^___$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/((?:^- .+\n?)+)/gm, function(m) {
    const items = m.trim().split('\n').map(function(line) {
      return '<li>' + line.replace(/^- /, '') + '</li>';
    });
    return '<ul>' + items.join('') + '</ul>';
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, function(m) {
    const items = m.trim().split('\n').map(function(line) {
      return '<li>' + line.replace(/^\d+\. /, '') + '</li>';
    });
    return '<ol>' + items.join('') + '</ol>';
  });

  // Blockquotes
  html = html.replace(/((?:^&gt; .+\n?)+)/gm, function(m) {
    const content = m.replace(/^&gt; /gm, '').trim();
    return '<blockquote>' + content + '</blockquote>';
  });

  // Headings (must come after other line-based patterns)
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Paragraphs — wrap remaining text lines
  const lines = html.split('\n');
  const out = [];
  let buf = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<h') || trimmed.startsWith('<table') ||
        trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<hr') ||
        trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('</tbody>') || trimmed.startsWith('</table>') ||
        trimmed.startsWith('<li') || trimmed.startsWith('</ul') || trimmed.startsWith('</ol')) {
      if (buf.length) { out.push('<p>' + buf.join('<br>') + '</p>'); buf = []; }
      out.push(line);
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push('<p>' + buf.join('<br>') + '</p>');

  html = out.join('\n');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  return html;
}

// ── State ──────────────────────────────────────────────────────────────────

let currentView = 'markdown'; // 'markdown' | 'json'
let currentSummary = null;

// ── DOM refs ───────────────────────────────────────────────────────────────

const btnUpdate = $('#btn-update');
const statusEl = $('#status-text');
const statusDot = $('#status-dot');
const contentArea = $('#content-area');
const toggleMd = $('#toggle-md');
const toggleJson = $('#toggle-json');
const historySection = $('#history-section');
const historyList = $('#history-list');

// ── Render content ─────────────────────────────────────────────────────────

function renderContent(summary) {
  currentSummary = summary;

  if (!summary) {
    contentArea.innerHTML = `
      <div class="content-empty">
        <div class="empty-icon">📋</div>
        <div class="empty-text">No summary yet</div>
        <div class="empty-text" style="font-size:0.8rem">Click "Update" to generate a summary of this codebase</div>
      </div>`;
    return;
  }

  if (currentView === 'json') {
    const formatted = JSON.stringify(summary, null, 2);
    contentArea.innerHTML = '<pre class="raw-json">' + escHtml(formatted) + '</pre>';
    return;
  }

  // Markdown view: extract text and render
  const text = extractSummaryText(summary);
  const html = renderMarkdown(text);
  contentArea.innerHTML = '<div class="md-content">' + html + '</div>';
}

// ── Toggle view ────────────────────────────────────────────────────────────

function setView(view) {
  currentView = view;
  if (view === 'markdown') {
    toggleMd.classList.add('active');
    toggleJson.classList.remove('active');
  } else {
    toggleJson.classList.add('active');
    toggleMd.classList.remove('active');
  }
  renderContent(currentSummary);
}

toggleMd.addEventListener('click', () => setView('markdown'));
toggleJson.addEventListener('click', () => setView('json'));

// ── Status ─────────────────────────────────────────────────────────────────

function setStatus(running, lastRun) {
  if (running) {
    statusDot.className = 'status-dot running';
    statusEl.textContent = 'Running update...';
  } else {
    statusDot.className = lastRun ? 'status-dot idle' : 'status-dot idle';
    statusEl.textContent = lastRun
      ? 'Last updated ' + timeAgo(lastRun) + ' (' + fmtTimestamp(lastRun) + ')'
      : 'Never run';
  }
  btnUpdate.disabled = running;
  if (running) {
    btnUpdate.innerHTML = '<span class="spinner"></span> Running...';
  } else {
    btnUpdate.innerHTML = '&#x21bb; Update';
  }
}

// ── History ────────────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const res = await fetch('/codebase-summary/api/history');
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No previous snapshots yet</div>';
      return;
    }

    historyList.innerHTML = history.map(function(entry, idx) {
      const text = extractSummaryText(entry.summary);
      const preview = text ? text.replace(/\n/g, ' ').substring(0, 100) + '...' : '(no preview)';
      const iso = entry.timestamp || '';
      return `
        <div class="history-item" data-idx="${idx}">
          <div class="history-item-left">
            <span class="history-timestamp">${fmtTimestamp(iso)}</span>
            <span class="history-preview">${escHtml(preview)}</span>
          </div>
          <span class="history-arrow">→</span>
        </div>`;
    }).join('');

    // Wire click handlers
    historyList.querySelectorAll('.history-item').forEach(function(item) {
      item.addEventListener('click', function() {
        const idx = parseInt(this.dataset.idx);
        const entry = history[idx];
        if (entry && entry.summary) {
          renderContent(entry.summary);
          // Visual feedback
          historyList.querySelectorAll('.history-item').forEach(function(el) {
            el.style.borderColor = 'var(--border)';
          });
          this.style.borderColor = 'var(--accent)';
        }
      });
    });
  } catch (e) {
    historyList.innerHTML = '<div class="history-empty">Failed to load history</div>';
  }
}

// ── Polling ────────────────────────────────────────────────────────────────

let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch('/codebase-summary/api/status');
      const data = await res.json();
      setStatus(data.running, data.lastRun);

      if (!data.running) {
        // Update complete — stop polling and refresh content
        stopPolling();
        if (data.current) {
          renderContent(data.current);
        }
        loadHistory();
      }
    } catch (e) {
      // Silently retry
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Update button ──────────────────────────────────────────────────────────

btnUpdate.addEventListener('click', async () => {
  try {
    const res = await fetch('/codebase-summary/api/update', { method: 'POST' });
    const data = await res.json();

    if (data.status === 'already_running') {
      setStatus(true, data.lastRun);
      startPolling();
      return;
    }

    if (data.status === 'started') {
      setStatus(true, data.lastRun);
      startPolling();
    }
  } catch (e) {
    statusEl.textContent = 'Error starting update: ' + e.message;
  }
});

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch('/codebase-summary/api/status');
    const data = await res.json();

    setStatus(data.running, data.lastRun);

    if (data.current) {
      renderContent(data.current);
    }

    if (data.running) {
      startPolling();
    }

    loadHistory();
  } catch (e) {
    statusEl.textContent = 'Failed to load status';
    contentArea.innerHTML = `
      <div class="content-empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-text">Failed to load: ${escHtml(e.message)}</div>
      </div>`;
  }
}

init();
