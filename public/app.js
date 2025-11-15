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
  previewMode: 'desktop',
  templates: [],
  selectedTemplate: null,
  showTemplateManager: false,
  savedJobs: []
};

function render() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <h1>🚀 PWA Mailer Pro</h1>
      <div class="top-actions">
        <button onclick="toggleSMTPManager()">SMTP (${state.smtpProfiles.filter(p => !p.health || p.health.status !== 'dead').length}/${state.smtpProfiles.length})</button>
        <button onclick="toggleTemplateManager()">Templates (${state.templates.length})</button>
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
      <small>🔒 Secure • 📡 Offline-ready • 🔄 Auto-backup • Built with ❤️</small>
    </footer>

    <div id="smtp-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000">
      <div style="background:white;max-width:700px;margin:50px auto;padding:20px;border-radius:10px;max-height:80vh;overflow:auto">
        ${smtpManagerHTML()}
        <button onclick="toggleSMTPManager()">Close</button>
      </div>
    </div>

    <div id="template-modal" style="display:${state.showTemplateManager ? 'block' : 'none'};position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000">
      <div style="background:white;max-width:700px;margin:50px auto;padding:20px;border-radius:10px;max-height:80vh;overflow:auto">
        ${templateManagerHTML()}
        <button onclick="toggleTemplateManager()">Close</button>
      </div>
    </div>
  `;
}

function editorPanelHTML() {
  return `
    <div class="card">
      <h2>✉️ Compose</h2>
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
        <textarea rows="12" onchange="state.content=this.value;render()">${state.content}</textarea>
      </label>
      ${state.selectedTemplate ? `<div style="padding:8px;background:#f0fdf4;border-radius:6px;margin-top:8px">
        <small style="color:#16a34a">✓ Template attached: ${state.selectedTemplate.split('-')[1]}</small>
      </div>` : ''}
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
  const stats = state.jobStatus?.stats || { total: 0, sent: 0, failed: 0, currentIndex: 0 };
  const progress = stats.total > 0 ? Math.round((stats.currentIndex / stats.total) * 100) : 0;
  
  const incompleteSavedJobs = state.savedJobs.filter(j => j.stats.currentIndex < j.stats.total && j.paused);
  
  return `
    <div class="card">
      <h3>🎮 Send Controls</h3>
      ${incompleteSavedJobs.length > 0 ? `
        <div style="padding:8px;background:#fef3c7;border-radius:6px;margin-bottom:12px">
          <strong style="color:#92400e">⚠️ Restored Jobs (${incompleteSavedJobs.length})</strong>
          ${incompleteSavedJobs.map(j => `
            <div style="font-size:12px;margin:4px 0;display:flex;justify-content:space-between;align-items:center">
              <span>${j.stats.sent}/${j.stats.total} sent</span>
              <button onclick="resumeSavedJob('${j.id}')" style="background:#3b82f6;padding:2px 6px;font-size:11px">▶️ Resume</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div>
        <label>Delay (seconds)
          <input type="number" min="0" max="60" value="${state.options.delaySeconds}" onchange="state.options.delaySeconds=Number(this.value);render()">
        </label>
        <label>
          <input type="checkbox" ${state.options.rotateSMTP ? 'checked' : ''} onchange="state.options.rotateSMTP=this.checked;render()"> 🔄 Rotate SMTP
        </label>
      </div>
      <div style="margin-top:8px">
        <button ${state.recipients.length === 0 ? 'disabled' : ''} onclick="startSend()" style="background:#16a34a">🚀 Send (${state.recipients.length})</button>
        <button onclick="pauseJob()" style="background:#f59e0b">⏸️ Pause</button>
        <button onclick="resumeJob()" style="background:#3b82f6">▶️ Resume</button>
      </div>
      <div style="margin-top:12px;padding:12px;background:#f9fafb;border-radius:6px">
        <strong>📊 Status</strong>
        ${stats.total > 0 ? `
          <div style="margin:8px 0">
            <div style="background:#e5e7eb;height:20px;border-radius:10px;overflow:hidden">
              <div style="background:#16a34a;height:100%;width:${progress}%;transition:width 0.3s"></div>
            </div>
            <small>${progress}% complete</small>
          </div>
        ` : ''}
        <div>Total: <strong>${stats.total}</strong></div>
        <div style="color:#16a34a">✓ Sent: <strong>${stats.sent}</strong></div>
        <div style="color:#ef4444">✗ Failed: <strong>${stats.failed}</strong></div>
        ${state.jobStatus?.paused ? '<div style="color:#f59e0b;font-weight:bold">⏸️ PAUSED</div>' : ''}
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
      <h3>🔧 SMTP Profiles</h3>
      <div class="smtp-list" style="margin-bottom:16px">
        ${state.smtpProfiles.map(p => {
          const health = p.health || { status: 'unknown', failCount: 0 };
          const statusIcon = health.status === 'active' ? '✓' : health.status === 'dead' ? '✗' : '?';
          const statusColor = health.status === 'active' ? '#22c55e' : health.status === 'dead' ? '#ef4444' : '#6b7280';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid #e5e7eb;border-radius:6px;margin:4px 0">
              <div>
                <span style="color:${statusColor};font-weight:bold">${statusIcon}</span>
                <strong>${p.name}</strong> — ${p.host} (${p.user})
                ${health.successCount ? `<br><small style="color:#10b981">✓ ${health.successCount} sent</small>` : ''}
                ${health.failCount > 0 ? `<small style="color:#ef4444"> ✗ ${health.failCount} fails</small>` : ''}
              </div>
              <button onclick="deleteSMTP('${p.id}')" style="background:#ef4444;padding:4px 8px;font-size:12px">Delete</button>
            </div>
          `;
        }).join('')}
      </div>
      <hr>
      <h4>Add New SMTP Profile</h4>
      <div class="smtp-form">
        <input id="smtp-host" placeholder="smtp.example.com" type="text">
        <input id="smtp-port" placeholder="port" type="number" value="587">
        <input id="smtp-user" placeholder="user@example.com" type="text">
        <input id="smtp-pass" placeholder="password" type="password">
        <input id="smtp-name" placeholder="Profile Name" type="text">
        <div>
          <button onclick="testSMTP()">🧪 Test</button>
          <button onclick="addSMTP()">➕ Add</button>
        </div>
      </div>
    </div>
  `;
}

function templateManagerHTML() {
  return `
    <div class="card">
      <h3>🎨 Email Templates</h3>
      <div style="margin:16px 0">
        <h4>Generate New Template</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:8px 0">
          <button onclick="generateTemplate('blue')" style="background:#3b82f6">Blue</button>
          <button onclick="generateTemplate('purple')" style="background:#a855f7">Purple</button>
          <button onclick="generateTemplate('green')" style="background:#22c55e">Green</button>
          <button onclick="generateTemplate('orange')" style="background:#f97316">Orange</button>
          <button onclick="generateTemplate('default')" style="background:#475569">Default</button>
        </div>
      </div>
      <hr>
      <h4>Available Templates (${state.templates.length})</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px">
        ${state.templates.map(t => `
          <div style="border:2px solid ${state.selectedTemplate === t ? '#0b5cff' : '#e5e7eb'};border-radius:8px;padding:8px;cursor:pointer" onclick="selectTemplate('${t}')">
            <img src="/templates/${t}" style="width:100%;height:100px;object-fit:cover;border-radius:4px">
            <div style="font-size:11px;margin-top:4px;text-align:center">${t.split('-')[1]}</div>
            ${state.selectedTemplate === t ? '<div style="text-align:center;color:#0b5cff;font-weight:bold">✓ Selected</div>' : ''}
          </div>
        `).join('')}
      </div>
      ${state.templates.length === 0 ? '<p style="text-align:center;color:#6b7280">No templates yet. Generate one above!</p>' : ''}
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
    options: state.options,
    templateImage: state.selectedTemplate
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
      state.logs = [{ t: Date.now(), level: 'success', msg: `✓ Job ${data.jobId.substring(0,8)}... started` }, ...state.logs];
      pollJob();
      render();
    } else {
      alert('Failed to start job: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    state.logs = [{ t: Date.now(), level: 'error', msg: '✗ Error: ' + err.message }, ...state.logs];
    render();
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

function toggleTemplateManager() {
  state.showTemplateManager = !state.showTemplateManager;
  render();
}

async function deleteSMTP(id) {
  if (!confirm('Delete this SMTP profile?')) return;
  try {
    const res = await fetch(`${API_BASE}/smtp/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadSMTPProfiles();
      alert('SMTP profile deleted');
    }
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

async function generateTemplate(style) {
  try {
    const res = await fetch(`${API_BASE}/templates/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style })
    });
    const data = await res.json();
    if (data.ok) {
      await loadTemplates();
      state.logs = [{ t: Date.now(), level: 'success', msg: `✓ Generated ${style} template` }, ...state.logs];
      render();
    }
  } catch (err) {
    alert('Generate failed: ' + err.message);
  }
}

async function loadTemplates() {
  try {
    const res = await fetch(`${API_BASE}/templates/list`);
    const data = await res.json();
    state.templates = data.templates || [];
  } catch (err) {
    console.error('Load templates error:', err);
  }
}

function selectTemplate(filename) {
  state.selectedTemplate = state.selectedTemplate === filename ? null : filename;
  render();
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

async function loadSavedJobs() {
  try {
    const res = await fetch(`${API_BASE}/jobs/list`);
    const data = await res.json();
    state.savedJobs = data.jobs || [];
  } catch (err) {
    console.error('Load jobs error:', err);
  }
}

async function resumeSavedJob(jobId) {
  try {
    const res = await fetch(`${API_BASE}/job/${jobId}/auto-resume`, { method: 'POST' });
    if (res.ok) {
      state.jobId = jobId;
      state.logs = [{ t: Date.now(), level: 'info', msg: `▶️ Resumed saved job ${jobId.substring(0,8)}...` }, ...state.logs];
      await loadSavedJobs();
      pollJob();
      render();
    }
  } catch (err) {
    alert('Resume failed: ' + err.message);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW register failed', err));
}

loadSMTPProfiles();
loadTemplates();
loadSavedJobs();
render();