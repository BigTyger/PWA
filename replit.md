# PWA Mailer Pro

## Overview
A professional Progressive Web App (PWA) for mass email sending with advanced features including SMTP health monitoring, automatic failover, job persistence, and template generation.

## Key Features

### 1. **Express.js Backend (Top-notch Architecture)**
- Security headers (XSS protection, frame options, content-type sniffing prevention)
- Proper error handling with middleware
- Request validation and input sanitization
- Comprehensive logging with color-coded output
- CORS configuration for PWA support
- Cache control headers for proper PWA behavior

### 2. **SMTP Health Monitoring & Auto-Recovery**
- Real-time health tracking for each SMTP profile
- Automatic marking of dead SMTP servers after 3 failures
- Smart rotation that skips dead servers and continues with active ones
- Auto-pause when all SMTP servers fail
- Health metrics: success count, fail count, last check timestamp
- Status indicators: active, dead, unknown

### 3. **Job Persistence & Backup**
- Automatic job backup to disk every 10 emails sent
- Jobs persist to `jobs/` directory as JSON files
- Automatic restoration of incomplete jobs on server restart
- Progress tracking: current index, sent count, failed count
- Full job history with timestamps

### 4. **Email Template Generation**
- Canvas-based image template generation
- 5 professional color schemes: blue, purple, green, orange, default
- Templates automatically saved to `public/templates/`
- Templates can be attached to emails as images
- Easy template selection from UI

### 5. **Offline Support (PWA)**
- Service Worker caches app shell for offline access
- API responses cached for offline viewing
- Automatic cache updates when online
- Version management with cache cleanup
- Fallback responses when offline

### 6. **Enhanced UI**
- Real-time SMTP health status display
- Progress bars showing email sending progress
- Color-coded logs (success, error, warning, info)
- Template manager with visual preview
- Responsive design (desktop/mobile preview)
- Modal dialogs for SMTP and template management

## Architecture

### Backend (`index.js`)
```
Express Server (Port 5000)
├── Middleware
│   ├── Security headers
│   ├── CORS
│   ├── Body parser
│   └── Request logging
├── SMTP Management
│   ├── Add/Delete/List profiles
│   ├── Health tracking
│   └── Test connectivity
├── Job Management
│   ├── Create sending jobs
│   ├── Pause/Resume
│   ├── Progress tracking
│   └── Disk persistence
├── Template Generation
│   ├── Canvas API
│   └── Multiple styles
└── Error Handling
```

### Frontend (`public/app.js`)
```
PWA Client
├── State Management
│   ├── Recipients
│   ├── SMTP profiles
│   ├── Templates
│   ├── Job status
│   └── Logs
├── UI Components
│   ├── Composer
│   ├── Preview
│   ├── Send controls
│   ├── SMTP manager
│   └── Template manager
└── Service Worker
    ├── Offline caching
    └── API fallback
```

### Data Persistence
```
/workspace
├── jobs/              # Job backup files
│   └── {jobId}.json
├── public/templates/  # Generated templates
│   └── template-{style}-{timestamp}.png
├── smtpStore.json     # SMTP profiles
└── smtpHealth.json    # SMTP health data
```

## Key Technical Decisions

### SMTP Failover Strategy
- Failed SMTP servers are marked after 3 consecutive failures
- Dead servers are automatically skipped during rotation
- Job auto-pauses when all servers are dead
- Health status persists across server restarts

### Job Persistence
- Jobs saved to disk every 10 emails
- Incomplete jobs automatically restored on restart
- Prevents data loss during crashes or restarts
- Full state preservation (progress, logs, stats)

### Template System
- Canvas API for server-side image generation
- Gradient backgrounds with decorative elements
- Templates accessible via static file serving
- Can be attached to emails using Content-ID

### Security Measures
- Security headers prevent XSS and clickjacking
- No cache headers for sensitive data
- Input validation on all endpoints
- SMTP credentials stored securely in JSON files

## Usage

### Adding SMTP Profiles
1. Click "SMTP" button in header
2. Fill in host, port, user, pass, name
3. Click "Test" to verify connectivity
4. Click "Add" to save profile

### Generating Templates
1. Click "Templates" button in header
2. Select a color scheme (blue, purple, green, orange, default)
3. Template is generated and saved automatically
4. Click template to select for use in emails

### Sending Emails
1. Upload or paste recipient emails
2. Compose your message (supports HTML and variables: {Email}, {Domain}, {Name})
3. Optionally select a template
4. Configure delay and SMTP rotation
5. Click "Send" to start the job
6. Monitor progress with real-time logs and statistics

### Job Recovery
- If server crashes during sending, restart the server
- Incomplete jobs automatically resume from last checkpoint
- Progress is preserved (sent count, current index, failed count)

## Environment Variables
- `PORT`: Server port (default: 5000)

## Dependencies
- express: Web framework
- nodemailer: Email sending
- canvas: Template generation
- fs-extra: File system operations
- multer: File uploads
- uuid: Unique IDs

## Recent Changes
- Enhanced Express architecture with security best practices
- Implemented SMTP health monitoring and auto-failover
- Added job persistence to disk
- Created template generation system with Canvas
- Improved offline support with enhanced service worker
- Added progress tracking and visual feedback

## User Preferences
None specified yet.
