
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.ensureDirSync(UPLOAD_DIR);
const upload = multer({ dest: UPLOAD_DIR });

const SMTP_STORE = path.join(__dirname, 'smtpStore.json');
if (!fs.existsSync(SMTP_STORE)) fs.writeJSONSync(SMTP_STORE, { profiles: [] }, { spaces: 2 });

const loadProfiles = () => fs.readJSONSync(SMTP_STORE).profiles;
const saveProfiles = (p) => fs.writeJSONSync(SMTP_STORE, { profiles: p }, { spaces: 2 });

// Logging helpers (colorama-like)
const log = {
  info: (...args) => console.log(chalk.blue('[INFO]'), ...args),
  success: (...args) => console.log(chalk.green('[OK]'), ...args),
  warn: (...args) => console.log(chalk.yellow('[WARN]'), ...args),
  error: (...args) => console.log(chalk.red('[ERR]'), ...args)
};

// ========== SMTP management endpoints ==========
app.get('/api/smtp/list', (req, res) => res.json({ profiles: loadProfiles() }));

app.post('/api/smtp/add', (req, res) => {
  const { host, port, secure, user, pass, name } = req.body;
  if (!host || !user || !pass) return res.status(400).json({ error: 'host, user, pass required' });
  const profiles = loadProfiles();
  const created = { id: uuidv4(), host, port: Number(port) || 587, secure: !!secure, user, pass, name: name || user, maxMessagesPerConn: 100 };
  profiles.push(created);
  saveProfiles(profiles);
  log.success('Added SMTP profile', created.host, created.user);
  res.json({ ok: true, profile: created });
});

app.post('/api/smtp/test', async (req, res) => {
  const { host, port, secure, user, pass } = req.body;
  if (!host || !user || !pass) return res.status(400).json({ error: 'missing fields' });
  try {
    const transporter = nodemailer.createTransport({
      host, port: Number(port) || 587, secure: !!secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
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

// Utility: parse recipient email to variables
function parseRecipientVars(email) {
  const parts = email.split('@');
  const local = parts[0] || '';
  const domain = parts[1] || '';
  let name = local.replace(/[._\d-]+/g, ' ').trim();
  name = name.split(/\s+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ').trim();
  return { Email: email, Domain: domain, Name: name || '' };
}

// Create transporter from a profile
function makeTransport(profile) {
  return nodemailer.createTransport({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: { user: profile.user, pass: profile.pass },
    pool: true,
    maxMessages: profile.maxMessagesPerConn || 100,
    tls: { rejectUnauthorized: false }
  });
}

const jobs = new Map();

app.post('/api/send', async (req, res) => {
  try {
    const { fromName, fromEmail, subject, content, isHtml, recipients, options } = req.body;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients required' });
    }
    const jobId = uuidv4();
    const job = {
      id: jobId,
      sender: { fromName, fromEmail, subject, content, isHtml: !!isHtml },
      recipients,
      options: Object.assign({ delaySeconds: 2, rotateSMTP: true }, options || {}),
      stats: { total: recipients.length, sent: 0, failed: 0, currentIndex: 0 },
      paused: false,
      logs: []
    };
    jobs.set(jobId, job);
    startJob(jobId).catch(err => log.error('Job error', err));
    res.json({ ok: true, jobId });
  } catch (err) {
    log.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/job/:id/pause', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  job.paused = true;
  res.json({ ok: true });
});

app.post('/api/job/:id/resume', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  job.paused = false;
  startJob(req.params.id).catch(err => log.error('Resume error', err));
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

async function startJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  const profiles = loadProfiles();
  if (!profiles || profiles.length === 0) {
    job.logs.push({ t: Date.now(), level: 'error', msg: 'No SMTP profiles. Add one before sending.' });
    log.error('No SMTP profiles configured.');
    return;
  }

  while (job.stats.currentIndex < job.recipients.length) {
    if (job.paused) {
      log.warn('Job paused at index', job.stats.currentIndex);
      break;
    }
    const recipient = job.recipients[job.stats.currentIndex];
    const vars = parseRecipientVars(recipient);
    const subject = applyVars(job.sender.subject, vars);
    const body = applyVars(job.sender.content, vars);

    const idx = job.stats.currentIndex % profiles.length;
    const profile = profiles[idx];
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

    try {
      log.info(`Sending to ${recipient} via ${profile.host} (${profile.user})`);
      job.logs.push({ t: Date.now(), level: 'info', msg: `Sending to ${recipient} via ${profile.host}` });
      const info = await transporter.sendMail(mailOptions);
      job.stats.sent += 1;
      job.logs.push({ t: Date.now(), level: 'success', msg: `Sent ${recipient} (id:${info.messageId || 'n/a'})` });
      log.success(`Sent ${recipient} (job ${job.id})`);
    } catch (err) {
      job.stats.failed += 1;
      job.logs.push({ t: Date.now(), level: 'error', msg: `Failed ${recipient}: ${err.message}` });
      log.error(`Failed ${recipient}`, err.message);
    }

    job.stats.currentIndex += 1;

    const delayMs = Math.max(0, (job.options.delaySeconds || 2) * 1000);
    await new Promise(r => setTimeout(r, delayMs));
  }

  if (job.stats.currentIndex >= job.recipients.length) {
    job.logs.push({ t: Date.now(), level: 'info', msg: `Job complete. sent=${job.stats.sent} failed=${job.stats.failed}` });
    log.info('Job complete', job.id, job.stats);
    Object.values(transporterCache).forEach(t => {
      try { t.close && t.close(); } catch(e){}
    });
    transporterCache = {};
  }
}

function applyVars(template, vars){
  if (!template) return '';
  return template.replace(/\{(Email|Domain|Name)\}/g, (_, key) => vars[key] || '');
}

const buildPath = path.join(__dirname, 'public');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => log.success(`Backend listening on ${PORT}`));
