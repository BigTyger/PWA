
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const JOBS_DIR = path.join(__dirname, 'jobs');
const TEMPLATES_DIR = path.join(__dirname, 'public', 'templates');
const SMTP_STORE = path.join(__dirname, 'smtpStore.json');
const SMTP_HEALTH_STORE = path.join(__dirname, 'smtpHealth.json');

fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(JOBS_DIR);
fs.ensureDirSync(TEMPLATES_DIR);

if (!fs.existsSync(SMTP_STORE)) fs.writeJSONSync(SMTP_STORE, { profiles: [] }, { spaces: 2 });
if (!fs.existsSync(SMTP_HEALTH_STORE)) fs.writeJSONSync(SMTP_HEALTH_STORE, { health: {} }, { spaces: 2 });

const loadProfiles = () => fs.readJSONSync(SMTP_STORE).profiles;
const saveProfiles = (p) => fs.writeJSONSync(SMTP_STORE, { profiles: p }, { spaces: 2 });

const loadSMTPHealth = () => fs.readJSONSync(SMTP_HEALTH_STORE).health;
const saveSMTPHealth = (h) => fs.writeJSONSync(SMTP_HEALTH_STORE, { health: h }, { spaces: 2 });

const log = {
  info: (...args) => console.log('\x1b[34m[INFO]\x1b[0m', ...args),
  success: (...args) => console.log('\x1b[32m[OK]\x1b[0m', ...args),
  warn: (...args) => console.log('\x1b[33m[WARN]\x1b[0m', ...args),
  error: (...args) => console.log('\x1b[31m[ERR]\x1b[0m', ...args)
};

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({ 
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use((req, res, next) => {
  log.info(`${req.method} ${req.path}`);
  next();
});

app.get('/api/smtp/list', (req, res) => {
  try {
    const profiles = loadProfiles();
    const health = loadSMTPHealth();
    const profilesWithHealth = profiles.map(p => ({
      ...p,
      health: health[p.id] || { status: 'unknown', failCount: 0, lastCheck: null }
    }));
    res.json({ profiles: profilesWithHealth });
  } catch (err) {
    log.error('List profiles error:', err);
    res.status(500).json({ error: 'Failed to load profiles' });
  }
});

app.post('/api/smtp/add', (req, res) => {
  try {
    const { host, port, secure, user, pass, name } = req.body;
    if (!host || !user || !pass) {
      return res.status(400).json({ error: 'host, user, pass required' });
    }
    const profiles = loadProfiles();
    const created = { 
      id: uuidv4(), 
      host: String(host).trim(), 
      port: Number(port) || 587, 
      secure: !!secure, 
      user: String(user).trim(), 
      pass: String(pass), 
      name: name || user, 
      maxMessagesPerConn: 100 
    };
    profiles.push(created);
    saveProfiles(profiles);
    
    const health = loadSMTPHealth();
    health[created.id] = { status: 'active', failCount: 0, lastCheck: Date.now(), successCount: 0 };
    saveSMTPHealth(health);
    
    log.success('Added SMTP profile', created.host, created.user);
    res.json({ ok: true, profile: created });
  } catch (err) {
    log.error('Add SMTP error:', err);
    res.status(500).json({ error: 'Failed to add profile' });
  }
});

app.delete('/api/smtp/:id', (req, res) => {
  try {
    const profiles = loadProfiles();
    const filtered = profiles.filter(p => p.id !== req.params.id);
    if (profiles.length === filtered.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    saveProfiles(filtered);
    
    const health = loadSMTPHealth();
    delete health[req.params.id];
    saveSMTPHealth(health);
    
    log.success('Deleted SMTP profile', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    log.error('Delete SMTP error:', err);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

app.post('/api/smtp/test', async (req, res) => {
  const { host, port, secure, user, pass } = req.body;
  if (!host || !user || !pass) {
    return res.status(400).json({ error: 'missing fields' });
  }
  try {
    const transporter = nodemailer.createTransport({
      host, 
      port: Number(port) || 587, 
      secure: !!secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 10000
    });
    await transporter.verify();
    log.success('SMTP test success', host, user);
    res.json({ ok: true });
  } catch (err) {
    log.error('SMTP test failed', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/recipients/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const content = await fs.readFile(file.path, 'utf8');
    const addrs = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    await fs.remove(file.path);
    res.json({ ok: true, recipients: addrs });
  } catch (err) {
    log.error('Upload failed', err.message);
    res.status(500).json({ error: err.message });
  }
});

function parseRecipientVars(email) {
  const parts = email.split('@');
  const local = parts[0] || '';
  const domain = parts[1] || '';
  let name = local.replace(/[._\d-]+/g, ' ').trim();
  name = name.split(/\s+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ').trim();
  return { Email: email, Domain: domain, Name: name || '' };
}

function makeTransport(profile) {
  return nodemailer.createTransport({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: { user: profile.user, pass: profile.pass },
    pool: true,
    maxMessages: profile.maxMessagesPerConn || 100,
    maxConnections: 5,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000
  });
}

function markSMTPHealthy(profileId) {
  try {
    const health = loadSMTPHealth();
    if (!health[profileId]) {
      health[profileId] = { status: 'active', failCount: 0, successCount: 0, lastCheck: Date.now() };
    }
    health[profileId].status = 'active';
    health[profileId].successCount = (health[profileId].successCount || 0) + 1;
    health[profileId].failCount = 0;
    health[profileId].lastCheck = Date.now();
    saveSMTPHealth(health);
  } catch (err) {
    log.error('Error marking SMTP healthy:', err);
  }
}

function markSMTPFailed(profileId, error) {
  try {
    const health = loadSMTPHealth();
    if (!health[profileId]) {
      health[profileId] = { status: 'active', failCount: 0, successCount: 0, lastCheck: Date.now() };
    }
    health[profileId].failCount = (health[profileId].failCount || 0) + 1;
    health[profileId].lastError = error;
    health[profileId].lastCheck = Date.now();
    
    if (health[profileId].failCount >= 3) {
      health[profileId].status = 'dead';
      log.warn(`SMTP ${profileId} marked as DEAD after ${health[profileId].failCount} failures`);
    }
    saveSMTPHealth(health);
  } catch (err) {
    log.error('Error marking SMTP failed:', err);
  }
}

function getActiveSMTPProfiles() {
  const profiles = loadProfiles();
  const health = loadSMTPHealth();
  return profiles.filter(p => {
    const h = health[p.id];
    return !h || h.status !== 'dead';
  });
}

function saveJobToDisk(job) {
  try {
    const jobFile = path.join(JOBS_DIR, `${job.id}.json`);
    const wasActiveWhenSaved = activeJobs.has(job.id);
    const jobData = {
      id: job.id,
      sender: job.sender,
      recipients: job.recipients,
      options: job.options,
      stats: job.stats,
      paused: job.paused,
      wasActiveWhenSaved,
      logs: job.logs.slice(-500),
      savedAt: Date.now()
    };
    fs.writeJSONSync(jobFile, jobData, { spaces: 2 });
  } catch (err) {
    log.error('Failed to save job to disk:', err);
  }
}

function loadJobFromDisk(jobId) {
  try {
    const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
    if (fs.existsSync(jobFile)) {
      return fs.readJSONSync(jobFile);
    }
  } catch (err) {
    log.error('Failed to load job from disk:', err);
  }
  return null;
}

const jobs = new Map();

function restoreJobsFromDisk() {
  try {
    const jobFiles = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    let autoResumeCount = 0;
    
    for (const file of jobFiles) {
      const jobData = fs.readJSONSync(path.join(JOBS_DIR, file));
      
      if (jobData && jobData.stats.currentIndex < jobData.recipients.length) {
        jobs.set(jobData.id, jobData);
        
        const wasActive = jobData.wasActiveWhenSaved && !jobData.paused;
        
        if (wasActive) {
          log.info(`Auto-resuming job ${jobData.id} (was active at crash, ${jobData.stats.sent}/${jobData.stats.total} sent)`);
          jobData.paused = false;
          jobData.logs.push({ 
            t: Date.now(), 
            level: 'info', 
            msg: `Auto-resumed after server restart (recovered at ${jobData.stats.currentIndex}/${jobData.stats.total})` 
          });
          setImmediate(() => {
            startJob(jobData.id).catch(err => log.error('Auto-resume failed:', err));
          });
          autoResumeCount++;
        } else {
          log.info(`Restored paused job ${jobData.id} (${jobData.stats.sent}/${jobData.stats.total} sent)`);
          jobData.paused = true;
        }
      } else if (jobData) {
        log.info(`Skipping completed job ${jobData.id}`);
      }
    }
    
    if (autoResumeCount > 0) {
      log.success(`Auto-resumed ${autoResumeCount} active job(s)`);
    }
    if (jobs.size - autoResumeCount > 0) {
      log.warn(`Found ${jobs.size - autoResumeCount} paused job(s). Use resume API to continue.`);
    }
  } catch (err) {
    log.error('Failed to restore jobs from disk:', err);
  }
}

restoreJobsFromDisk();

app.post('/api/send', async (req, res) => {
  try {
    const { fromName, fromEmail, subject, content, isHtml, recipients, options, templateImage } = req.body;
    
    if (!fromName || !fromEmail) {
      return res.status(400).json({ error: 'fromName and fromEmail required' });
    }
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients required' });
    }
    if (recipients.length > 50000) {
      return res.status(400).json({ error: 'Maximum 50,000 recipients per job' });
    }
    
    const jobId = uuidv4();
    const job = {
      id: jobId,
      sender: { 
        fromName: String(fromName).trim(), 
        fromEmail: String(fromEmail).trim(), 
        subject: subject || 'No Subject', 
        content: content || '', 
        isHtml: !!isHtml,
        templateImage: templateImage || null
      },
      recipients,
      options: Object.assign({ delaySeconds: 2, rotateSMTP: true }, options || {}),
      stats: { total: recipients.length, sent: 0, failed: 0, currentIndex: 0 },
      paused: false,
      logs: [],
      createdAt: Date.now()
    };
    jobs.set(jobId, job);
    saveJobToDisk(job);
    
    startJob(jobId).catch(err => log.error('Job error', err));
    res.json({ ok: true, jobId });
  } catch (err) {
    log.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/job/:id/pause', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  job.paused = true;
  job.logs.push({ t: Date.now(), level: 'warn', msg: 'Job paused by user' });
  saveJobToDisk(job);
  res.json({ ok: true });
});

app.post('/api/job/:id/resume', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (activeJobs.has(req.params.id)) {
    return res.status(400).json({ error: 'job already running' });
  }
  job.paused = false;
  job.logs.push({ t: Date.now(), level: 'info', msg: 'Job resumed by user' });
  saveJobToDisk(job);
  startJob(req.params.id).catch(err => log.error('Resume error', err));
  res.json({ ok: true });
});

app.post('/api/job/:id/auto-resume', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (activeJobs.has(req.params.id)) {
    return res.status(400).json({ error: 'job already running' });
  }
  job.paused = false;
  job.logs.push({ t: Date.now(), level: 'info', msg: 'Job auto-resumed after recovery' });
  saveJobToDisk(job);
  startJob(req.params.id).catch(err => log.error('Auto-resume error', err));
  res.json({ ok: true });
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ job: sanitizeJob(job) });
});

function sanitizeJob(job) {
  return {
    id: job.id,
    stats: job.stats,
    paused: job.paused,
    options: job.options,
    logs: job.logs.slice(-200)
  };
}

let transporterCache = {};

const activeJobs = new Set();

async function startJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  
  if (activeJobs.has(jobId)) {
    log.warn('Job already running:', jobId);
    return;
  }
  
  let activeProfiles = getActiveSMTPProfiles();
  if (!activeProfiles || activeProfiles.length === 0) {
    job.logs.push({ t: Date.now(), level: 'error', msg: 'No active SMTP profiles available.' });
    log.error('No active SMTP profiles configured.');
    job.paused = true;
    saveJobToDisk(job);
    return;
  }

  activeJobs.add(jobId);
  saveJobToDisk(job);
  
  let currentProfileIndex = 0;
  
  while (job.stats.currentIndex < job.recipients.length) {
    if (job.paused) {
      log.warn('Job paused at index', job.stats.currentIndex);
      saveJobToDisk(job);
      break;
    }
    
    activeProfiles = getActiveSMTPProfiles();
    if (activeProfiles.length === 0) {
      job.logs.push({ t: Date.now(), level: 'error', msg: 'All SMTP servers marked as dead. Auto-pausing job.' });
      log.error('All SMTP servers dead. Auto-pausing job', jobId);
      job.paused = true;
      saveJobToDisk(job);
      break;
    }
    
    const recipient = job.recipients[job.stats.currentIndex];
    const vars = parseRecipientVars(recipient);
    const subject = applyVars(job.sender.subject, vars);
    let body = applyVars(job.sender.content, vars);
    
    if (job.options.rotateSMTP) {
      currentProfileIndex = job.stats.currentIndex % activeProfiles.length;
    }
    const profile = activeProfiles[currentProfileIndex];
    
    if (!transporterCache[profile.id]) {
      transporterCache[profile.id] = makeTransport(profile);
    }
    const transporter = transporterCache[profile.id];

    const mailOptions = {
      from: `${job.sender.fromName} <${job.sender.fromEmail}>`,
      to: recipient,
      subject,
      [job.sender.isHtml ? 'html' : 'text']: body
    };
    
    if (job.sender.templateImage) {
      mailOptions.attachments = [{
        filename: 'template.png',
        path: path.join(TEMPLATES_DIR, job.sender.templateImage),
        cid: 'template@image'
      }];
    }

    try {
      log.info(`Sending to ${recipient} via ${profile.host} (${profile.user})`);
      job.logs.push({ t: Date.now(), level: 'info', msg: `Sending to ${recipient} via ${profile.host}` });
      
      const info = await transporter.sendMail(mailOptions);
      
      job.stats.sent += 1;
      job.logs.push({ t: Date.now(), level: 'success', msg: `✓ Sent to ${recipient}` });
      log.success(`Sent ${recipient} (job ${job.id})`);
      
      markSMTPHealthy(profile.id);
      
    } catch (err) {
      job.stats.failed += 1;
      const errMsg = err.message || String(err);
      job.logs.push({ t: Date.now(), level: 'error', msg: `✗ Failed ${recipient}: ${errMsg}` });
      log.error(`Failed ${recipient}`, errMsg);
      
      markSMTPFailed(profile.id, errMsg);
      
      if (transporterCache[profile.id]) {
        try {
          transporterCache[profile.id].close();
        } catch (e) {}
        delete transporterCache[profile.id];
      }
    }

    job.stats.currentIndex += 1;
    saveJobToDisk(job);

    const delayMs = Math.max(0, (job.options.delaySeconds || 2) * 1000);
    await new Promise(r => setTimeout(r, delayMs));
  }

  if (job.stats.currentIndex >= job.recipients.length) {
    job.logs.push({ t: Date.now(), level: 'info', msg: `✓ Job complete. sent=${job.stats.sent} failed=${job.stats.failed}` });
    log.info('Job complete', job.id, job.stats);
    
    Object.values(transporterCache).forEach(t => {
      try { t.close && t.close(); } catch(e){}
    });
    transporterCache = {};
    saveJobToDisk(job);
  }
  
  activeJobs.delete(jobId);
}

function applyVars(template, vars){
  if (!template) return '';
  return template.replace(/\{(Email|Domain|Name)\}/g, (_, key) => vars[key] || '');
}

app.get('/api/templates/list', (req, res) => {
  try {
    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.png'));
    res.json({ templates: files });
  } catch (err) {
    log.error('List templates error:', err);
    res.json({ templates: [] });
  }
});

app.post('/api/templates/generate', async (req, res) => {
  try {
    const { style } = req.body;
    const filename = `template-${style || 'default'}-${Date.now()}.png`;
    const filepath = path.join(TEMPLATES_DIR, filename);
    
    const { createCanvas } = await import('canvas');
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    
    const gradients = {
      'blue': ['#1e3a8a', '#3b82f6'],
      'purple': ['#581c87', '#a855f7'],
      'green': ['#14532d', '#22c55e'],
      'orange': ['#7c2d12', '#f97316'],
      'default': ['#1e293b', '#475569']
    };
    
    const colors = gradients[style] || gradients.default;
    const gradient = ctx.createLinearGradient(0, 0, 800, 600);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 600);
    
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * 800;
      const y = Math.random() * 600;
      const size = Math.random() * 100 + 50;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Professional Email Template', 400, 280);
    
    ctx.font = '24px Arial';
    ctx.fillText('Powered by PWA Mailer', 400, 340);
    
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filepath, buffer);
    
    log.success('Generated template:', filename);
    res.json({ ok: true, filename });
  } catch (err) {
    log.error('Generate template error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/list', (req, res) => {
  try {
    const jobList = Array.from(jobs.values()).map(j => ({
      id: j.id,
      stats: j.stats,
      paused: j.paused,
      createdAt: j.createdAt
    }));
    res.json({ jobs: jobList });
  } catch (err) {
    log.error('List jobs error:', err);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

const buildPath = path.join(__dirname, 'public');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(buildPath, 'index.html'));
    } else {
      next();
    }
  });
}

app.use((err, req, res, next) => {
  log.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => log.success(`Backend listening on ${PORT}`));
