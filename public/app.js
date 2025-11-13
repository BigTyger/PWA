const API_BASE = window.location.origin + '/api';

const state = {
  fromName: 'Sender Name',
  fromEmail: 'sender@example.com',
  subject: 'Hello {Name} — special offer',
  content: '<h1>Hi {Name}</h1><p>Visit {Domain}</p>',
  isHtml: true,
  recipients: [],
  jobId: null,
  jobStatus: null,
  options: { delaySeconds: 2, rotateSMTP: true },
  logs: [],
  smtpProfiles: [],
  previewMode: 'desktop'
};

function render() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <h1>PWA Mailer</h1>
      <div class="top-actions">
        <button onclick="toggleSMTPManager()">SMTP Profiles (${state.smtpProfiles.length})</button>
      </div>
    </header>

    <main class="main-grid">
      <section class="left-col">
        ${recipientUploaderHTML()}
        ${editorPanelHTML()}
      </section>

      <section class="middle-col">
        ${previewPanelHTML()}
      </section>

      <aside class="right-col">
        ${sendControlsHTML()}
        ${logPanelHTML()}
      </aside>
    </main>

    <footer class="footer">
      <small>Use responsibly. Built with ❤️ — PWA offline-ready</small>
    </footer>

    <div id="smtp-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000">
      <div style="background:white;max-width:600px;margin:50px auto;padding:20px;border-radius:10px">
        ${smtpManagerHTML()}
        <button onclick="toggleSMTPManager()">Close</button>
      </div>
    </div>
  `;
}

function editorPanelHTML() {
  return `
    <div class="card">
      <h2>Compose</h2>
      <label>From Name
        <input type="text" value="${state.fromName}" onchange="state.fromName=this.value;render()">
      </label>
      <label>From Email
        <input type="email" value="${state.fromEmail}" onchange="state.fromEmail=this.value;render()">
      </label>
      <label>Subject
        <input type="text" value="${state.subject}" onchange="state.subject=this.value;render()">
      </label>
      <label>
        <input type="checkbox" ${state.isHtml ? 'checked' : ''} onchange="state.isHtml=this.checked;render()"> HTML content
      </label>
      <label>Content (use tags: {Email}, {Domain}, {Name})
        <textarea rows="14" onchange="state.content=this.value;render()">${state.content}</textarea>
      </label>
    </div>
  `;
}

function previewPanelHTML() {
  const previewHtml = state.isHtml ? state.content : `<pre style="white-space:pre-wrap">${escapeHtml(state.content)}</pre>`;
  return `
    <div class="card preview-card">
      <div class="preview-header">
        <h3>Live Preview</h3>
        <div class="preview-modes">
          <button class="${state.previewMode === 'desktop' ? 'active' : ''}" onclick="state.previewMode='desktop';render()">Desktop</button>
          <button class="${state.previewMode === 'mobile' ? 'active' : ''}" onclick="state.previewMode='mobile';render()">Mobile</button>
        </div>
      </div>
      <div class="emulator ${state.previewMode}">
        <iframe srcdoc="${escapeHtml(previewHtml)}" sandbox="allow-same-origin"></iframe>
      </div>
      <div style="margin-top:8px">
        <small>Tip: toggle Desktop/Mobile to emulate width</small>
      </div>
    </div>
  `;
}

function recipientUploaderHTML() {
  return `
    <div class="card">
      <h3>Recipients</h3>
      <div>
        <input type="file" accept=".txt" onchange="handleFileUpload(event)">
      </div>
      <div>
        <textarea id="paste-text" placeholder="Paste one email per line" rows="4"></textarea>
        <button onclick="addPastedRecipients()">Add Pasted</button>
      </div>
      <div>
        <h4>Preview (${state.recipients.length})</h4>
        <div class="recipient-list">
          ${state.recipients.slice(0, 100).map(r => `<div>${r}</div>`).join('')}
          ${state.recipients.length > 100 ? `<div>+ ${state.recipients.length - 100} more</div>` : ''}
        </div>
        ${state.recipients.length > 0 ? '<button onclick="state.recipients=[];render()">Clear All</button>' : ''}
      </div>
    </div>
  `;
}

function sendControlsHTML() {
  return `
    <div class="card">
      <h3>Send Controls</h3>
      <div>
        <label>Delay (seconds)
          <input type="number" value="${state.options.delaySeconds}" onchange="state.options.delaySeconds=Number(this.value);render()">
        </label>
        <label>
          <input type="checkbox" ${state.options.rotateSMTP ? 'checked' : ''} onchange="state.options.rotateSMTP=this.checked;render()"> Rotate SMTP
        </label>
      </div>
      <div style="margin-top:8px">
        <button ${state.recipients.length === 0 ? 'disabled' : ''} onclick="startSend()">Send (${state.recipients.length})</button>
        <button onclick="pauseJob()">Pause</button>
        <button onclick="resumeJob()">Resume</button>
      </div>
      <div style="margin-top:12px">
        <strong>Status</strong>
        <div>Total: ${state.jobStatus?.stats?.total ?? 0}</div>
        <div>Sent: ${state.jobStatus?.stats?.sent ?? 0}</div>
        <div>Failed: ${state.jobStatus?.stats?.failed ?? 0}</div>
      </div>
    </div>
  `;
}

function logPanelHTML() {
  const logs = state.jobStatus?.logs || state.logs;
  return `
    <div class="card">
      <h3>Logs</h3>
      <div class="log-window">
        ${logs.slice(0, 200).map(l => `
          <div class="log-line log-${l.level || 'info'}">
            <span class="ts">${new Date(l.t || Date.now()).toLocaleTimeString()}</span>
            <span class="msg">${l.msg}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function smtpManagerHTML() {
  return `
    <div class="card">
      <h3>SMTP Profiles</h3>
      <div class="smtp-list">
        ${state.smtpProfiles.map(p => `<div>${p.name} — ${p.host} (${p.user})</div>`).join('')}
      </div>
      <div class="smtp-form">
        <input id="smtp-host" placeholder="host" type="text">
        <input id="smtp-port" placeholder="port" type="number" value="587">
        <input id="smtp-user" placeholder="user" type="text">
        <input id="smtp-pass" placeholder="pass" type="password">
        <input id="smtp-name" placeholder="name" type="text">
        <div>
          <button onclick="testSMTP()">Test</button>
          <button onclick="addSMTP()">Add</button>
        </div>
      </div>
    </div>
  `;
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`${API_BASE}/recipients/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) {
      state.recipients = [...state.recipients, ...data.recipients];
      render();
    }
  } catch (err) {
    alert('Upload failed: ' + err.message);
  }
}

function addPastedRecipients() {
  const text = document.getElementById('paste-text').value;
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  state.recipients = [...state.recipients, ...lines];
  document.getElementById('paste-text').value = '';
  render();
}

async function startSend() {
  if (!state.recipients.length) return alert('No recipients');
  const payload = {
    fromName: state.fromName,
    fromEmail: state.fromEmail,
    subject: state.subject,
    content: state.content,
    isHtml: state.isHtml,
    recipients: state.recipients,
    options: state.options
  };
  try {
    const res = await fetch(`${API_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      state.jobId = data.jobId;
      state.logs = [{ t: Date.now(), level: 'info', msg: 'Job started', jobId: data.jobId }, ...state.logs];
      pollJob();
      render();
    } else {
      alert('Failed to start job');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function pauseJob() {
  if (!state.jobId) return;
  await fetch(`${API_BASE}/job/${state.jobId}/pause`, { method: 'POST' });
  state.logs = [{ t: Date.now(), level: 'warn', msg: 'Job paused' }, ...state.logs];
  render();
}

async function resumeJob() {
  if (!state.jobId) return;
  await fetch(`${API_BASE}/job/${state.jobId}/resume`, { method: 'POST' });
  state.logs = [{ t: Date.now(), level: 'info', msg: 'Job resumed' }, ...state.logs];
  pollJob();
  render();
}

let pollInterval;
function pollJob() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    if (!state.jobId) return;
    try {
      const res = await fetch(`${API_BASE}/job/${state.jobId}`);
      const data = await res.json();
      state.jobStatus = data.job;
      render();
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, 1500);
}

async function loadSMTPProfiles() {
  try {
    const res = await fetch(`${API_BASE}/smtp/list`);
    const data = await res.json();
    state.smtpProfiles = data.profiles || [];
    render();
  } catch (err) {
    console.error('Load SMTP error:', err);
  }
}

async function testSMTP() {
  const profile = {
    host: document.getElementById('smtp-host').value,
    port: document.getElementById('smtp-port').value,
    user: document.getElementById('smtp-user').value,
    pass: document.getElementById('smtp-pass').value
  };
  try {
    const res = await fetch(`${API_BASE}/smtp/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    });
    const data = await res.json();
    alert(data.ok ? 'SMTP Test OK!' : 'Test failed: ' + data.error);
  } catch (err) {
    alert('Test failed: ' + err.message);
  }
}

async function addSMTP() {
  const profile = {
    host: document.getElementById('smtp-host').value,
    port: document.getElementById('smtp-port').value,
    user: document.getElementById('smtp-user').value,
    pass: document.getElementById('smtp-pass').value,
    name: document.getElementById('smtp-name').value
  };
  try {
    const res = await fetch(`${API_BASE}/smtp/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    });
    const data = await res.json();
    if (data.ok) {
      await loadSMTPProfiles();
      alert('SMTP profile added!');
    }
  } catch (err) {
    alert('Add failed: ' + err.message);
  }
}

function toggleSMTPManager() {
  const modal = document.getElementById('smtp-modal');
  modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW register failed', err));
}

loadSMTPProfiles();
render();