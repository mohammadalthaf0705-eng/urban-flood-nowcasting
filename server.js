import express from 'express'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { areaDirectory, drainNodes, initialAlerts, zones } from './src/data/cityData.js'
import { calculateZoneRisk, confidenceForHorizon, estimateDepth, getRiskMeta } from './src/utils/floodModel.js'
import { detectHotspots, runWhatIfSimulation } from './src/utils/floodAnalytics.js'

const app = express()
const port = Number(process.env.PORT || 5173)
const clientPath = resolve(dirname(fileURLToPath(import.meta.url)), 'dist')
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const storePath = resolve(dirname(fileURLToPath(import.meta.url)), 'data/store.json')
const defaultStore = { reports: [], settings: { alertThreshold: 70 }, callLogs: [], voiceAgent: { lastRisks: {}, lastDispatchAt: 0, lastEvent: null } }
const store = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : defaultStore
const reports = store.reports || []
const settings = store.settings || defaultStore.settings
const callLogs = store.callLogs || []
const voiceAgent = store.voiceAgent || defaultStore.voiceAgent
const saveStore = () => writeFileSync(storePath, JSON.stringify({ reports, settings, callLogs, voiceAgent }, null, 2))

app.use(express.json({ limit: '200kb' }))
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  if (request.method === 'OPTIONS') return response.sendStatus(204)
  next()
})

app.get('/api/health', (request, response) => response.json({ ok: true, service: 'floodpulse-api', time: new Date().toISOString() }))

app.get('/api/areas', (request, response) => {
  const query = String(request.query.q || '').trim().toLowerCase()
  const matches = query
    ? areaDirectory.filter(area => area.name.toLowerCase().includes(query)).slice(0, 20)
    : areaDirectory
  response.json({ areas: matches })
})

app.get('/api/nowcast', (request, response) => {
  const storm = clamp(Number(request.query.storm || 38), 12, 76)
  const horizon = clamp(Number(request.query.horizon || 30), 10, 180)
  const forecast = zones.map(zone => {
    const risk = calculateZoneRisk(zone, storm, horizon)
    return { ...zone, risk, depth: estimateDepth(risk, storm), ...getRiskMeta(risk) }
  })
  response.json({ storm, horizon, confidence: confidenceForHorizon(horizon), zones: forecast, drains: drainNodes })
})

app.get('/api/mcp/tools', (request, response) => response.json({
  server: 'floodpulse-analytics',
  tools: ['get_rainfall_data', 'get_drainage_capacity', 'get_elevation_data', 'run_flood_simulation', 'calculate_flood_depth', 'calculate_flood_spread', 'estimate_flood_time', 'detect_hotspots', 'calculate_hotspot_score'],
}))

app.post('/api/mcp/simulate', (request, response) => {
  const { rainfall, duration, blockage, pumpFailure, zoneId } = request.body || {}
  if (![rainfall, duration, blockage].every(value => Number.isFinite(Number(value)))) return response.status(400).json({ error: 'Rainfall, duration and blockage must be numeric' })
  response.json({ tool: 'run_flood_simulation', result: runWhatIfSimulation({ rainfall, duration, blockage, pumpFailure, zoneId }) })
})

app.get('/api/mcp/hotspots', (request, response) => {
  const storm = clamp(Number(request.query.storm || 38), 12, 76)
  const horizon = clamp(Number(request.query.horizon || 30), 10, 180)
  response.json({ tool: 'detect_hotspots', hotspots: detectHotspots({ storm, horizon }) })
})

app.get('/api/alerts', (request, response) => response.json({ alerts: initialAlerts }))
app.get('/api/notifications/calls', (request, response) => response.json({ calls: callLogs.slice(0, 20) }))
const normalizeRecipients = values => Array.isArray(values)
  ? [...new Set(values.map(value => String(value).trim()).filter(Boolean))]
  : []
const supportedVoiceLanguages = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }
const normalizeVoiceLanguage = value => supportedVoiceLanguages[String(value)] ? String(value) : 'en'

const dispatchVoiceCall = async ({ recipients, message, language = 'en', source = 'manual', zone = '' }) => {
  const twilioReady = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
  const call = { id: Date.now(), recipients, message, language, source, zone, mode: twilioReady ? 'twilio' : 'demo', status: twilioReady ? 'queued' : 'simulated', createdAt: new Date().toISOString() }
  if (twilioReady) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls.json`
    const results = await Promise.allSettled(recipients.map(async to => {
      const form = new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Twiml: `<Response><Say language="${supportedVoiceLanguages[language]}">${message.replace(/[<>&'\"]/g, '')}</Say></Response>` })
      const twilioResponse = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
      if (!twilioResponse.ok) throw new Error(`Twilio rejected ${to}`)
      return twilioResponse.json()
    }))
    call.status = results.every(result => result.status === 'fulfilled') ? 'queued' : 'partial-failure'
  }
  callLogs.unshift(call)
  saveStore()
  return call
}

app.post('/api/notifications/call', async (request, response) => {
  const recipients = normalizeRecipients(request.body?.recipients)
  const message = String(request.body?.message || '').trim()
  const language = normalizeVoiceLanguage(request.body?.language)
  if (!recipients.length || recipients.length > 50) return response.status(400).json({ error: 'Provide between 1 and 50 recipients' })
  if (recipients.some(phone => !/^\+[1-9]\d{7,14}$/.test(phone))) return response.status(400).json({ error: 'Use E.164 phone numbers, for example +919876543210' })
  if (!message || message.length > 500) return response.status(400).json({ error: 'Message is required and must be under 500 characters' })
  try {
    const call = await dispatchVoiceCall({ recipients, message, language })
    response.status(201).json({ call })
  } catch (error) {
    response.status(502).json({ error: error.message || 'Voice provider unavailable' })
  }
})

const voiceRecipients = () => normalizeRecipients(String(process.env.VOICE_AGENT_RECIPIENTS || '').split(/[,\n]+/))
const voiceWarning = ({ zone, risk, confidence, source, language }) => {
  const messages = {
    en: source === 'citizen-report' ? `A citizen report confirms possible flooding in ${zone}. This is a safety warning. Move now to higher ground or the nearest open shelter. Do not walk or drive through moving water. Keep away from electricity and call 112 if anyone is trapped. Forecast confidence is ${confidence} percent.` : `FloodPulse predicts ${risk} percent flood risk in ${zone}. This is a safety warning. Move now to higher ground or the nearest open shelter. Do not walk or drive through moving water. Keep away from electricity and call 112 if anyone is trapped. Forecast confidence is ${confidence} percent.`,
    hi: source === 'citizen-report' ? `${zone} में नागरिक ने संभावित बाढ़ की सूचना दी है। यह सुरक्षा चेतावनी है। तुरंत ऊंची जगह या निकटतम खुले आश्रय स्थल पर जाएं। बहते पानी में पैदल या वाहन से न जाएं। बिजली के उपकरणों से दूर रहें और किसी के फंसे होने पर 112 पर कॉल करें।` : `FloodPulse को ${zone} में बाढ़ का खतरा ${risk} प्रतिशत होने का अनुमान है। यह सुरक्षा चेतावनी है। तुरंत ऊंची जगह या निकटतम खुले आश्रय स्थल पर जाएं। बहते पानी में पैदल या वाहन से न जाएं। बिजली के उपकरणों से दूर रहें और किसी के फंसे होने पर 112 पर कॉल करें।`,
    te: source === 'citizen-report' ? `${zone} ప్రాంతంలో వరదలు వచ్చే అవకాశం ఉందని పౌరుల నివేదిక నిర్ధారించింది. ఇది భద్రతా హెచ్చరిక. వెంటనే ఎత్తైన ప్రదేశానికి లేదా సమీపంలోని తెరిచి ఉన్న ఆశ్రయానికి వెళ్లండి. ప్రవహించే నీటిలో నడవకండి, వాహనం నడపకండి. విద్యుత్ పరికరాలకు దూరంగా ఉండండి. ఎవరైనా చిక్కుకుపోతే 112కు కాల్ చేయండి.` : `FloodPulse ప్రకారం ${zone} ప్రాంతంలో వరద ప్రమాదం ${risk} శాతం ఉంది. ఇది భద్రతా హెచ్చరిక. వెంటనే ఎత్తైన ప్రదేశానికి లేదా సమీపంలోని తెరిచి ఉన్న ఆశ్రయానికి వెళ్లండి. ప్రవహించే నీటిలో నడవకండి, వాహనం నడపకండి. విద్యుత్ పరికరాలకు దూరంగా ఉండండి. ఎవరైనా చిక్కుకుపోతే 112కు కాల్ చేయండి.`
  }
  return messages[language]
}

app.post('/api/notifications/evaluate', async (request, response) => {
  const storm = clamp(Number(request.body?.storm || 38), 12, 76)
  const horizon = clamp(Number(request.body?.horizon || 30), 10, 180)
  const confidence = confidenceForHorizon(horizon)
  const language = normalizeVoiceLanguage(request.body?.language)
  const recipients = normalizeRecipients(request.body?.recipients).length ? normalizeRecipients(request.body.recipients) : voiceRecipients()
  const source = request.body?.source === 'citizen-report' ? 'citizen-report' : 'prediction'
  const force = request.body?.force === true
  const forecast = zones.map(zone => ({ ...zone, risk: calculateZoneRisk(zone, storm, horizon) }))
  const threshold = Number(settings.alertThreshold || 70)
  const candidate = forecast.sort((left, right) => right.risk - left.risk).find(zone => zone.risk >= threshold)
  if (!candidate) return response.json({ triggered: false, reason: 'No zone is above the alert threshold', threshold })
  const previousRisk = Number(voiceAgent.lastRisks[candidate.id] || 0)
  const cooldownActive = Date.now() - Number(voiceAgent.lastDispatchAt || 0) < 15 * 60 * 1000
  const transitioned = previousRisk < threshold && candidate.risk >= threshold
  voiceAgent.lastRisks = Object.fromEntries(forecast.map(zone => [zone.id, zone.risk]))
  if (!force && (!transitioned || cooldownActive)) {
    saveStore()
    return response.json({ triggered: false, reason: cooldownActive ? 'Voice warning cooldown is active' : 'No new risk transition', zone: candidate.name, risk: candidate.risk })
  }
  if (!recipients.length) {
    saveStore()
    return response.status(400).json({ error: 'Add opted-in recipients or set VOICE_AGENT_RECIPIENTS before enabling automated calls' })
  }
  try {
    const call = await dispatchVoiceCall({ recipients, zone: candidate.name, language, source, message: voiceWarning({ zone: candidate.name, risk: candidate.risk, confidence, source, language }) })
    voiceAgent.lastDispatchAt = Date.now()
    voiceAgent.lastEvent = { zone: candidate.name, risk: candidate.risk, source, createdAt: new Date().toISOString() }
    saveStore()
    response.status(201).json({ triggered: true, call, zone: candidate.name, risk: candidate.risk, confidence })
  } catch (error) {
    response.status(502).json({ error: error.message || 'Voice provider unavailable' })
  }
})

app.get('/api/notifications/agent', (request, response) => {
  response.json({ enabled: Boolean(process.env.VOICE_AGENT_RECIPIENTS), lastEvent: voiceAgent.lastEvent, lastDispatchAt: voiceAgent.lastDispatchAt || null })
})

app.post('/api/reports', async (request, response) => {
  const { location, depth = '', photo = '', severity = 'high', detail = '', timestamp = new Date().toISOString() } = request.body || {}
  if (!String(location || '').trim()) return response.status(400).json({ error: 'Location is required' })
  if (!['medium', 'high', 'critical'].includes(severity)) return response.status(400).json({ error: 'Invalid severity' })
  const report = { id: Date.now(), location: String(location).trim(), depth: String(depth).trim(), photo: String(photo).trim(), severity, detail: String(detail).trim(), status: 'New', verified: false, time: new Date().toISOString(), timestamp }
  reports.unshift(report)
  saveStore()
  if (['high', 'critical'].includes(severity) && voiceRecipients().length) {
    const result = await fetch(`http://127.0.0.1:${port}/api/notifications/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'citizen-report', force: true }) })
    report.voiceWarning = result.ok ? 'queued' : 'not-queued'
  }
  response.status(201).json({ report })
})
app.get('/api/reports', (request, response) => response.json({ reports }))

app.patch('/api/reports/:id/assign', (request, response) => {
  const report = reports.find(item => String(item.id) === request.params.id)
  if (!report) return response.status(404).json({ error: 'Report not found' })
  report.status = 'Assigned'
  saveStore()
  response.json({ report })
})

app.patch('/api/reports/:id/verify', (request, response) => {
  const report = reports.find(item => String(item.id) === request.params.id)
  if (!report) return response.status(404).json({ error: 'Report not found' })
  report.verified = true
  saveStore()
  response.json({ report })
})

app.get('/api/settings', (request, response) => response.json(settings))
app.patch('/api/settings', (request, response) => {
  const threshold = Number(request.body?.alertThreshold)
  if (!Number.isFinite(threshold) || threshold < 50 || threshold > 95) return response.status(400).json({ error: 'Alert threshold must be between 50 and 95' })
  settings.alertThreshold = threshold
  saveStore()
  response.json(settings)
})

if (existsSync(clientPath)) {
  app.use(express.static(clientPath))
  app.use((request, response, next) => {
    if (request.method === 'GET' && !request.path.startsWith('/api/')) return response.sendFile(resolve(clientPath, 'index.html'))
    next()
  })
}

app.listen(port, () => console.log(`FloodPulse running at http://localhost:${port}`))
