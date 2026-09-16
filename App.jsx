import { useEffect, useMemo, useState } from 'react'
import Icon from './components/Icon.jsx'
import CityMap from './components/CityMap.jsx'
import { AreaChart, Sparkline } from './components/Sparkline.jsx'
import { zones as baseZones, areaDirectory, drainNodes, indiaStates, rainfallHistory, initialAlerts, responseAssets } from './data/cityData.js'
import { calculateZoneRisk, confidenceForHorizon, estimateDepth, getRiskMeta } from './utils/floodModel.js'
import { detectHotspots } from './utils/floodAnalytics.js'

const formatTime = () => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())
const API_BASE = import.meta.env.VITE_API_URL || '/api'
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const replayEvents = [{ label: 'Clear morning', storm: 18, date: 'Today 06:00' }, { label: 'Monsoon burst', storm: 46, date: '12 Sep 14:20' }, { label: 'Extreme event', storm: 68, date: '28 Aug 18:45' }]
const responseTeams = ['Team 01', 'Team 02', 'Team 03', 'Team 04', 'Team 05']
const translations = { en: { citizen: 'Citizen view', admin: 'Admin console', safety: 'PUBLIC SAFETY', nextMove: 'Know your next move', route: 'Find a safe route', alerts: 'Get local alerts', location: 'Use my location', report: 'Report flooding', shelters: 'Nearby safe places', emergency: 'Emergency contacts' }, hi: { citizen: 'नागरिक दृश्य', admin: 'प्रशासन कंसोल', safety: 'सार्वजनिक सुरक्षा', nextMove: 'अपना अगला कदम जानें', route: 'सुरक्षित मार्ग खोजें', alerts: 'स्थानीय अलर्ट पाएं', location: 'मेरा स्थान', report: 'बाढ़ की सूचना दें', shelters: 'पास के सुरक्षित स्थान', emergency: 'आपातकालीन संपर्क' }, te: { citizen: 'పౌర వీక్షణ', admin: 'అడ్మిన్ కన్సోల్', safety: 'ప్రజా భద్రత', nextMove: 'తదుపరి చర్య తెలుసుకోండి', route: 'సురక్షిత మార్గం', alerts: 'స్థానిక హెచ్చరికలు', location: 'నా స్థానం', report: 'వరదను నివేదించండి', shelters: 'సమీప సురక్షిత ప్రదేశాలు', emergency: 'అత్యవసర సంప్రదింపులు' } }
const voiceLocales = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }

function MetricCard({ icon, label, value, suffix, sub, trend, values, tone='' }) {
  return <article className={`metric-card ${tone}`}>
    <div className="metric-head"><span className="metric-icon"><Icon name={icon}/></span><span>{label}</span><span className="metric-trend">{trend}</span></div>
    <div className="metric-value">{value}<small>{suffix}</small></div>
    <div className="metric-foot"><span>{sub}</span><Sparkline values={values}/></div>
  </article>
}

function App() {
  const [storm, setStorm] = useState(38)
  const [horizon, setHorizon] = useState(30)
  const [selectedId, setSelectedId] = useState('Z05')
  const [showDrains, setShowDrains] = useState(true)
  const [showRain, setShowRain] = useState(true)
  const [running, setRunning] = useState(true)
  const [time, setTime] = useState(formatTime())
  const [alerts, setAlerts] = useState(initialAlerts)
  const [areaQuery, setAreaQuery] = useState('')
  const [searchMessage, setSearchMessage] = useState('')
  const [activeView, setActiveView] = useState('citizen')
  const [reportOpen, setReportOpen] = useState(false)
  const [reports, setReports] = useState([])
  const [routeMode, setRouteMode] = useState(false)
  const [notificationsOn, setNotificationsOn] = useState(false)
  const [alertThreshold, setAlertThreshold] = useState(70)
  const [assignedReports, setAssignedReports] = useState({})
  const [showShelters, setShowShelters] = useState(true)
  const [showHospitals, setShowHospitals] = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [locationMessage, setLocationMessage] = useState('')
  const [replayIndex, setReplayIndex] = useState(null)
  const [language, setLanguage] = useState('en')
  const [mapScope, setMapScope] = useState('india')
  const [selectedState, setSelectedState] = useState(indiaStates.find(state => state.code === 'TS'))
  const [mapProvider, setMapProvider] = useState('local')
  const [detailZoom, setDetailZoom] = useState(54)
  const [simulation, setSimulation] = useState({ rainfall: 80, duration: 45, blockage: 30, pumpFailure: false })
  const [simulationResult, setSimulationResult] = useState(null)
  const [activeBlockage, setActiveBlockage] = useState(0)
  const [activePumpFailure, setActivePumpFailure] = useState(false)
  const [hotspots, setHotspots] = useState(() => detectHotspots({ storm: 38, horizon: 30 }))
  const [assignment, setAssignment] = useState({ team: 'Team 04', zone: 'Old City Basin', task: 'Drainage inspection', priority: 'Critical' })
  const [assignmentMessage, setAssignmentMessage] = useState('')
  const [callMessage, setCallMessage] = useState('Flood warning for {zone}. Move to higher ground and avoid moving water. Call 112 for immediate help.')
  const [callRecipients, setCallRecipients] = useState('+919876543210')
  const [callStatus, setCallStatus] = useState('')
  const [callSending, setCallSending] = useState(false)
  const [agentStatus, setAgentStatus] = useState('')
  const [guidanceStep, setGuidanceStep] = useState(0)
  const [availableVoices, setAvailableVoices] = useState([])
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantMessages, setAssistantMessages] = useState([])
  const [assistantOpen, setAssistantOpen] = useState(false)
  const text = translations[language]

  useEffect(() => {
    const timer = setInterval(() => setTime(formatTime()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const refreshVoices = () => setAvailableVoices(window.speechSynthesis.getVoices())
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/reports`).then(response => response.ok ? response.json() : Promise.reject()).then(data => setReports(data.reports || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setStorm(s => Math.max(12, Math.min(76, s + (Math.random() > .48 ? 1 : -1)))), 2800)
    return () => clearInterval(timer)
  }, [running])

  const zones = useMemo(() => baseZones.map(z => {
    const risk = Math.round(clamp(calculateZoneRisk(z, storm, horizon) + activeBlockage * 0.16 + (activePumpFailure ? 7 : 0), 4, 99))
    return { ...z, risk, depth: estimateDepth(risk, storm) }
  }), [storm, horizon, activeBlockage, activePumpFailure])

  const selected = zones.find(z => z.id === selectedId) || zones[0]
  const criticalZones = zones.filter(z => z.risk >= 80).length
  const avgDrainLoad = Math.round(zones.reduce((a,z) => a + Math.min(99, 100-z.drainCapacity + storm*.95), 0) / zones.length)
  const maxRisk = Math.max(...zones.map(z => z.risk))
  const confidence = confidenceForHorizon(horizon)
  const uncertainty = Math.max(3, Math.round((100 - confidence) * 0.55))
  const selectedMeta = getRiskMeta(selected.risk)
  const selectedDrain = drainNodes.find(node => node.zone === selected.name) || drainNodes[0]
  const runoffCoefficient = selected.baseRisk >= 70 ? 'HIGH' : selected.baseRisk >= 45 ? 'MEDIUM' : 'LOW'
  const elevationLevel = selected.elevation < 525 ? 'LOW' : selected.elevation < 540 ? 'MEDIUM' : 'HIGH'
  const rainfallForecast = Math.round(storm * 1.63)
  const catchmentArea = 2.8
  const runoffGenerated = Math.round(rainfallForecast * 42500 / 62)
  const effectiveDrainCapacity = Math.max(4, selected.drainCapacity * (1 - activeBlockage / 100) * (activePumpFailure ? 0.62 : 1))
  const drainCapacityVolume = Math.round(31000 * (effectiveDrainCapacity / 34))
  const drainUtilization = Math.round((runoffGenerated / Math.max(1, drainCapacityVolume)) * 100)
  const waterLevel = Number(clamp(selected.depth + Math.max(0, drainUtilization - 100) / 240, 0, 1.5).toFixed(2))
  const infrastructureImpact = { roads: Math.round(clamp(1 + selected.risk / 18 + Math.max(0, drainUtilization - 100) / 25, 1, 12)), hospitals: selected.risk >= 80 ? 2 : selected.risk >= 60 ? 1 : 0, schools: selected.risk >= 75 ? 4 : selected.risk >= 50 ? 2 : 1, power: selected.risk >= 85 ? 1 : 0 }
  const overflowRisk = drainUtilization >= 120 ? 'CRITICAL' : drainUtilization >= 100 ? 'HIGH' : drainUtilization >= 75 ? 'MODERATE' : 'LOW'
  const liveAlert = selected.risk >= 80 ? { severity: 'critical', title: `Predictive flood warning · ${selected.name}`, detail: `Risk ${selected.risk}% · ${infrastructureImpact.roads} roads exposed · drainage at ${drainUtilization}%` } : { severity: 'medium', title: `Monitoring ${selected.name}`, detail: `Risk ${selected.risk}% · drainage utilization ${drainUtilization}%` }
  const guidanceOrigin = userLocation || { x: selected.x, y: selected.y }
  const safePlaces = responseAssets.filter(asset => asset.type === 'shelter')
  const nearestSafePlace = safePlaces.reduce((nearest, shelter) => {
    const distance = Math.hypot(shelter.x - guidanceOrigin.x, shelter.y - guidanceOrigin.y)
    return !nearest || distance < nearest.distance ? { ...shelter, distance } : nearest
  }, null)
  const guidanceSteps = nearestSafePlace ? [
    language === 'hi' ? `${selected.name} से दूर जाएं और ऊंची जगह पर रहें।` : language === 'te' ? `${selected.name} ప్రాంతం నుండి దూరంగా వెళ్లి ఎత్తైన ప్రదేశంలో ఉండండి.` : `Move away from ${selected.name} and stay on higher ground.`,
    language === 'hi' ? `${nearestSafePlace.name} की ओर दिखाए गए सुरक्षित मार्ग पर चलें। जलमग्न सड़कों और अंडरपास से बचें।` : language === 'te' ? `${nearestSafePlace.name} వైపు చూపించిన సురక్షిత మార్గాన్ని అనుసరించండి. నీటితో నిండిన రహదారులు మరియు అండర్‌పాస్‌లను తప్పించండి.` : `Follow the highlighted safe route toward ${nearestSafePlace.name}. Avoid flooded roads and underpasses.`,
    language === 'hi' ? `बच्चों, बुजुर्गों और दिव्यांग लोगों को साथ रखें। बिजली के उपकरणों और बहते पानी को न छुएं।` : language === 'te' ? `పిల్లలు, వృద్ధులు మరియు దివ్యాంగులను కలిసి ఉంచండి. విద్యుత్ పరికరాలు లేదా ప్రవహించే నీటిని తాకవద్దు.` : `Keep children, older adults and people with disabilities together. Do not touch electrical equipment or moving water.`,
    language === 'hi' ? `आप ${nearestSafePlace.name} के पास पहुंच रहे हैं। आश्रय कर्मचारियों से संपर्क करें और किसी के फंसे होने पर 112 पर कॉल करें।` : language === 'te' ? `మీరు ${nearestSafePlace.name} సమీపానికి చేరుకుంటున్నారు. ఆశ్రయ సిబ్బందిని సంప్రదించండి. ఎవరైనా చిక్కుకుపోతే 112కు కాల్ చేయండి.` : `You are approaching ${nearestSafePlace.name}. Check in with shelter staff and call 112 if anyone is trapped.`
  ] : []
  const answerAssistant = question => {
    const query = question.toLowerCase()
    const localized = (english, hindi, telugu) => language === 'hi' ? hindi : language === 'te' ? telugu : english
    if (query.includes('safe') || query.includes('shelter') || query.includes('आश्रय') || query.includes('సురక్షిత')) return localized(`The recommended safe place is ${nearestSafePlace?.name}. Start the voice guide, follow the highlighted route, avoid moving water, and call 112 if anyone is trapped.`, `अनुशंसित सुरक्षित स्थान ${nearestSafePlace?.name} है। वॉइस गाइड शुरू करें, दिखाए गए मार्ग का पालन करें, बहते पानी से बचें और किसी के फंसे होने पर 112 पर कॉल करें।`, `సిఫార్సు చేసిన సురక్షిత ప్రదేశం ${nearestSafePlace?.name}. వాయిస్ గైడ్ ప్రారంభించి చూపించిన మార్గాన్ని అనుసరించండి. ప్రవహించే నీటికి దూరంగా ఉండండి. ఎవరైనా చిక్కుకుంటే 112కు కాల్ చేయండి.`)
    if (query.includes('why') || query.includes('cause') || query.includes('ఎందుకు') || query.includes('क्यों')) return localized(`${selected.name} is ${selectedMeta.level.toLowerCase()} risk because rainfall is ${storm} mm/h, drainage capacity is ${selected.drainCapacity}%, and the drain is ${selectedDrain.blockage}% blocked.`, `${selected.name} में ${selectedMeta.level.toLowerCase()} जोखिम है क्योंकि बारिश ${storm} mm/h है, जल निकासी क्षमता ${selected.drainCapacity}% है और नाला ${selectedDrain.blockage}% बंद है।`, `${selected.name} లో ${selectedMeta.level.toLowerCase()} ప్రమాదం ఉంది. వర్షపాతం ${storm} mm/h, డ్రైనేజీ సామర్థ్యం ${selected.drainCapacity}%, మరియు డ్రెయిన్ ${selectedDrain.blockage}% బ్లాక్ అయింది.`)
    if (query.includes('risk') || query.includes('probability') || query.includes('जोखिम') || query.includes('ప్రమాదం')) return localized(`Current flood risk in ${selected.name} is ${selected.risk}%. The next ${horizon} minutes have ${confidence}% model confidence.`, `${selected.name} में वर्तमान बाढ़ जोखिम ${selected.risk}% है। अगले ${horizon} मिनट के अनुमान की विश्वसनीयता ${confidence}% है।`, `${selected.name} లో ప్రస్తుత వరద ప్రమాదం ${selected.risk}%. రాబోయే ${horizon} నిమిషాల అంచనా నమ్మకత ${confidence}%.`)
    if (query.includes('rain') || query.includes('बारिश') || query.includes('వర్ష')) return localized(`Rainfall is ${storm} mm/h. Drain utilization is ${drainUtilization}%, so avoid low-lying roads if the level continues rising.`, `बारिश ${storm} mm/h है। जल निकासी उपयोग ${drainUtilization}% है, इसलिए पानी बढ़ने पर निचली सड़कों से बचें।`, `వర్షపాతం ${storm} mm/h. డ్రెయిన్ వినియోగం ${drainUtilization}%, కాబట్టి నీటి మట్టం పెరిగితే లోతట్టు రహదారులను తప్పించండి.`)
    return localized(`I can help with ${selected.name}, flood risk, rainfall, drainage, safe shelters, and emergency actions. Ask “Why will it flood?” or “Where should I go?”`, `मैं ${selected.name}, बाढ़ जोखिम, बारिश, जल निकासी, सुरक्षित आश्रय और आपातकालीन कार्रवाई में मदद कर सकता हूं। पूछें: “बाढ़ क्यों आएगी?” या “मुझे कहां जाना चाहिए?”`, `నేను ${selected.name}, వరద ప్రమాదం, వర్షపాతం, డ్రైనేజీ, సురక్షిత ఆశ్రయాలు మరియు అత్యవసర చర్యల గురించి సహాయం చేయగలను. “ఎందుకు వరద వస్తుంది?” లేదా “నేను ఎక్కడికి వెళ్లాలి?” అని అడగండి.`)
  }

  const speakAssistantText = message => {
    if (!('speechSynthesis' in window)) {
      setAgentStatus('Text answer is ready. Voice playback is not supported in this browser.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.lang = voiceLocales[language]
    const voices = availableVoices.length ? availableVoices : window.speechSynthesis.getVoices()
    const prefix = language === 'hi' ? 'hi' : language === 'te' ? 'te' : 'en'
    const matchingVoice = voices.find(voice => voice.lang.toLowerCase() === voiceLocales[language].toLowerCase()) || voices.find(voice => voice.lang.toLowerCase().startsWith(prefix))
    if (matchingVoice) utterance.voice = matchingVoice
    utterance.rate = 0.92
    utterance.onstart = () => setAgentStatus(`Speaking answer in ${language === 'hi' ? 'Hindi' : language === 'te' ? 'Telugu' : 'English'}.`)
    utterance.onend = () => setAgentStatus('Voice answer finished.')
    utterance.onerror = () => setAgentStatus('The browser could not play the voice. Check your system volume and installed speech voices.')
    window.speechSynthesis.resume()
    window.speechSynthesis.speak(utterance)
  }

  const testAssistantVoice = () => {
    const testMessage = language === 'hi' ? 'यह FloodPulse आवाज़ परीक्षण है।' : language === 'te' ? 'ఇది FloodPulse వాయిస్ పరీక్ష.' : 'This is the FloodPulse voice test.'
    speakAssistantText(testMessage)
  }

  const askAssistant = question => {
    const trimmed = question.trim()
    if (!trimmed) return
    const answer = answerAssistant(trimmed)
    setAssistantMessages(messages => [...messages, { role: 'user', text: trimmed }, { role: 'agent', text: answer }])
    speakAssistantText(answer)
    setAssistantQuestion('')
  }
  const nowcastTimeline = [0, 15, 30, 45, 60].map(minutes => {
    const projectedStorm = clamp(storm + minutes * 0.22, 12, 76)
    const projectedRisk = calculateZoneRisk(selected, projectedStorm, Math.max(horizon, minutes || 10))
    const risk = Math.round(clamp(projectedRisk * 0.7 + selected.baseRisk * 0.22 + minutes * 0.08, 4, 96))
    return { minutes, risk }
  })
  const predictedFloodPoint = nowcastTimeline.find(point => point.risk >= 80)
  const floodAlreadyDetected = selected.risk >= 90 && selected.depth >= 0.35
  const floodLeadTime = predictedFloodPoint?.minutes || 60
  const riskFactors = [
    ['Rainfall pressure', Math.min(100, Math.round(storm * 0.72)), 'rain'],
    ['Drain overload', Math.min(100, Math.round(drainUtilization / 1.35)), 'drain'],
    ['Water level', Math.min(100, Math.round(waterLevel * 72)), 'water'],
    ['Blockage', Math.max(selectedDrain.blockage, activeBlockage), 'blockage'],
    ['Terrain', Math.min(100, Math.max(8, Math.round((555 - selected.elevation) * 2.2))), 'terrain'],
  ]

  useEffect(() => {
    if (!notificationsOn || !callRecipients.trim()) return
    const recipients = callRecipients.split(/[\n,]+/).map(value => value.trim()).filter(Boolean)
    fetch(`${API_BASE}/notifications/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storm, horizon, recipients, language }) })
      .then(async response => {
        const data = await response.json()
        if (data.triggered) setAgentStatus(`Automatic voice warning ${data.call.mode === 'twilio' ? 'queued' : 'simulated'} for ${data.zone}.`)
      })
      .catch(() => {})
  }, [storm, horizon, notificationsOn, callRecipients, language])

  useEffect(() => {
    fetch(`${API_BASE}/mcp/hotspots?storm=${storm}&horizon=${horizon}`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setHotspots(data.hotspots || []))
      .catch(() => setHotspots(detectHotspots({ storm, horizon })))
  }, [storm, horizon])

  const triggerScenario = () => {
    setStorm(68)
    setHorizon(45)
    setAlerts(prev => [{ id: Date.now(), severity: 'critical', title: 'Cloudburst scenario activated', detail: '68 mm/h rainfall forcing · 45 min forecast window', time: time.slice(0,5) }, ...prev].slice(0,5))
  }

  const searchArea = (event) => {
    event.preventDefault()
    const query = areaQuery.trim().toLowerCase()
    if (!query) {
      setSearchMessage('Enter a zone, ID or ward')
      return
    }
    const localityMatch = areaDirectory.find(area => area.name.toLowerCase().includes(query))
    const zoneMatch = zones.find(zone => [zone.name, zone.id, zone.ward].some(value => value.toLowerCase().includes(query)))
    const match = localityMatch ? zones.find(zone => zone.id === localityMatch.zoneId) : zoneMatch
    if (!match) {
      setSearchMessage('No matching area found')
      return
    }
    setSelectedId(match.id)
    setMapScope('hyderabad')
    setDetailZoom(42)
    setRouteMode(false)
    setSearchMessage(`${localityMatch?.name || match.name} selected`)
  }

  const clearAreaSearch = () => {
    setAreaQuery('')
    setSearchMessage('')
  }

  const toggleNotifications = async () => {
    if (!notificationsOn && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
    setNotificationsOn(value => !value)
  }

  const assignReport = id => {
    setAssignedReports(prev => ({ ...prev, [id]: true }))
    fetch(`${API_BASE}/reports/${id}/assign`, { method: 'PATCH' }).catch(() => {})
  }

  const verifyReport = id => {
    setReports(prev => prev.map(item => item.id === id ? { ...item, verified: true } : item))
    fetch(`${API_BASE}/reports/${id}/verify`, { method: 'PATCH' }).catch(() => {})
  }

  const updateAlertThreshold = value => {
    setAlertThreshold(value)
    fetch(`${API_BASE}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertThreshold: value }) }).catch(() => {})
  }

  const locateCitizen = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Location is not supported by this browser')
      return
    }
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords
      setUserLocation({ x: Math.round(clamp((longitude - 78.2) * 200, 8, 92)), y: Math.round(clamp((17.65 - latitude) * 220, 8, 92)) })
      setLocationMessage('Your approximate position is shown on the map')
    }, () => setLocationMessage('Location permission was not granted'))
  }

  const replayEvent = index => {
    setReplayIndex(index)
    setStorm(replayEvents[index].storm)
    setHorizon(30)
  }

  const runSimulation = async event => {
    event.preventDefault()
    const response = await fetch(`${API_BASE}/mcp/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...simulation, zoneId: selected.id }) })
    const data = await response.json()
    if (!response.ok) return setAgentStatus(data.error || 'Simulation failed')
    setSimulationResult({ ...data.result, beforeRisk: selected.risk })
    setStorm(clamp(Math.round(Number(simulation.rainfall) / (Number(simulation.duration) / 60)), 12, 76))
    setHorizon(clamp(Number(simulation.duration), 10, 180))
    setActiveBlockage(Number(simulation.blockage))
    setActivePumpFailure(Boolean(simulation.pumpFailure))
    setMapScope('hyderabad')
    setDetailZoom(42)
    setRouteMode(true)
    setAlerts(previous => [{ id: Date.now(), severity: data.result.risk >= 80 ? 'critical' : 'high', title: `Scenario updated · ${data.result.zone}`, detail: `${data.result.risk}% risk · ${data.result.affectedRoads} roads · flood onset ${data.result.onsetMinutes} min`, time: time.slice(0, 5) }, ...previous].slice(0, 5))
  }

  const assignTeam = event => {
    event.preventDefault()
    setAssignmentMessage(`${assignment.team} assigned to ${assignment.zone}`)
  }

  const sendEmergencyCall = async event => {
    event.preventDefault()
    setCallSending(true)
    setCallStatus('')
    const recipients = callRecipients.split(/[\n,]+/).map(value => value.trim()).filter(Boolean)
    const message = callMessage.replace('{zone}', selected.name)
    try {
      const response = await fetch(`${API_BASE}/notifications/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients, message, language }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Call request failed')
      setCallStatus(data.call.mode === 'twilio' ? `Call broadcast queued for ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.` : `Demo call logged for ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}. Add Twilio credentials to place real calls.`)
    } catch (error) {
      setCallStatus(error.message)
    } finally {
      setCallSending(false)
    }
  }

  const speakSafetyGuidance = (step = guidanceStep) => {
    const fallback = language === 'hi' ? 'निकटतम खुले आश्रय स्थल पर जाएं और तुरंत सहायता के लिए 112 पर कॉल करें।' : language === 'te' ? 'సమీపంలోని తెరిచి ఉన్న ఆశ్రయానికి వెళ్లి అత్యవసర సహాయం కోసం 112కు కాల్ చేయండి.' : 'Move to the nearest open shelter and call 112 for immediate help.'
    const message = language === 'hi' ? `FloodPulse सुरक्षा मार्गदर्शक। ${guidanceSteps[step] || fallback}` : language === 'te' ? `FloodPulse భద్రతా మార్గదర్శి. ${guidanceSteps[step] || fallback}` : `FloodPulse safety guide. ${guidanceSteps[step] || fallback}`
    if (!('speechSynthesis' in window)) {
      setAgentStatus('Voice playback is not supported in this browser. Call 112 for immediate help.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.lang = voiceLocales[language]
    const voices = availableVoices.length ? availableVoices : window.speechSynthesis.getVoices()
    const locale = voiceLocales[language].toLowerCase()
    const matchingVoice = voices.find(voice => voice.lang.toLowerCase() === locale) || voices.find(voice => voice.lang.toLowerCase().startsWith(language === 'hi' ? 'hi' : language === 'te' ? 'te' : 'en'))
    if (matchingVoice) utterance.voice = matchingVoice
    utterance.rate = 0.92
    window.speechSynthesis.speak(utterance)
    setRouteMode(true)
    const voiceStatus = matchingVoice ? `${matchingVoice.name} · ${matchingVoice.lang}` : `${voiceLocales[language]} requested; install a matching browser voice if playback sounds English.`
    setAgentStatus(`Voice guide: step ${step + 1} of ${guidanceSteps.length}. Destination: ${nearestSafePlace?.name || 'nearest open shelter'}. ${voiceStatus}`)
  }

  const startSafePlaceGuide = () => {
    setGuidanceStep(0)
    setRouteMode(true)
    setMapScope('hyderabad')
    speakSafetyGuidance(0)
  }

  const nextGuidanceStep = () => {
    const nextStep = Math.min(guidanceStep + 1, Math.max(0, guidanceSteps.length - 1))
    setGuidanceStep(nextStep)
    speakSafetyGuidance(nextStep)
  }

  useEffect(() => {
    if (!routeMode || !('speechSynthesis' in window)) return
    const replay = window.setTimeout(() => speakSafetyGuidance(guidanceStep), 80)
    return () => window.clearTimeout(replay)
  }, [language, availableVoices.length])

  const runVoiceSafetyCheck = async () => {
    setAgentStatus('Evaluating risk and recipient consent...')
    const recipients = callRecipients.split(/[\n,]+/).map(value => value.trim()).filter(Boolean)
    try {
      const response = await fetch(`${API_BASE}/notifications/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storm, horizon, recipients, language, force: true }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Voice safety check failed')
      setAgentStatus(data.triggered ? `Voice warning ${data.call.mode === 'twilio' ? 'queued' : 'simulated'} for ${data.zone}.` : data.reason)
    } catch (error) {
      setAgentStatus(error.message)
    }
  }

  const submitReport = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const localReport = { id: Date.now(), location: form.get('location'), depth: form.get('depth'), photo: form.get('photo')?.name || '', severity: form.get('severity'), detail: form.get('detail'), status: 'New', verified: false, time: time.slice(0, 5), timestamp: new Date().toISOString() }
    try {
      const response = await fetch(`${API_BASE}/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(localReport) })
      if (response.ok) {
        const data = await response.json()
        setReports(prev => [data.report, ...prev])
      } else throw new Error('Report rejected')
    } catch {
      setReports(prev => [localReport, ...prev])
    }
    setReportOpen(false)
    event.currentTarget.reset()
  }

  const exportReports = () => {
    const rows = [['Location', 'Severity', 'Details', 'Status', 'Time'], ...reports.map(report => [report.location, report.severity, report.detail, report.status, report.time])]
    const csv = rows.map(row => row.map(value => `"${String(value || '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = 'floodpulse-reports.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return <div className="app-shell">
    <header className="top-nav">
      <div className="brand"><div className="brand-mark"><Icon name="waves" size={23}/></div><div><strong>FloodPulse</strong><span>FLOOD DECISION-SUPPORT SYSTEM</span></div></div>
      <nav><button className={activeView === 'citizen' ? 'active' : ''} onClick={()=>setActiveView('citizen')}>{text.citizen}</button><button className={activeView === 'admin' ? 'active' : ''} onClick={()=>setActiveView('admin')}>{text.admin}</button></nav>
      <div className="nav-right"><span className="system-live"><i/>SYSTEM LIVE</span><span className="clock">{time} IST</span><button className={`ai-launcher ${assistantOpen ? 'active' : ''}`} onClick={()=>setAssistantOpen(value=>!value)}><Icon name="activity" size={15}/> AI Agent</button><select className="language-select" aria-label="Language" value={language} onChange={event=>setLanguage(event.target.value)}><option value="en">EN</option><option value="hi">हिं</option><option value="te">తె</option></select><button className="icon-btn"><Icon name="settings"/></button></div>
    </header>

    <main className="dashboard">
      <section className="hero-row">
        <div><p className="eyebrow"><Icon name="location" size={14}/> URBAN FLOOD INTELLIGENCE · SIH PROTOTYPE</p><h1>Rainfall meets drainage.<br/><span>Risk becomes actionable.</span></h1><p className="hero-copy">Coupled rainfall–drainage nowcasting for hyperlocal flood prediction, infrastructure stress detection and faster emergency response.</p></div>
        <div className="forecast-card"><div><span>FORECAST HORIZON</span><strong>+{horizon}<small> min</small></strong></div><div className="horizon-steps" role="group" aria-label="Forecast horizon">{[10,20,30,45].map(step=><button className={horizon === step ? 'active' : ''} key={step} onClick={()=>setHorizon(step)}>+{step} min</button>)}</div><p><Icon name="shield" size={15}/> Confidence <b>{confidence}%</b><span className="forecast-uncertainty">± {uncertainty}% uncertainty</span></p></div>
      </section>

      <section className="nowcast-hero panel"><div className="nowcast-heading"><div><span className="section-kicker">FLOOD NOWCAST · {selected.name.toUpperCase()}</span><h2>What happens in the next 60 minutes?</h2></div><span className={`risk-badge ${selectedMeta.tone}`}>{selectedMeta.level} · {selected.risk}%</span></div><div className="nowcast-timeline">{nowcastTimeline.map(point=><div className={`nowcast-point ${getRiskMeta(point.risk).tone}`} key={point.minutes}><span>{point.minutes === 0 ? 'NOW' : `+${point.minutes}`}</span><i style={{'--point-risk': `${Math.max(8, point.risk)}%`}}/><strong>{point.risk}%</strong></div>)}</div><div className="nowcast-callout"><Icon name="alert" size={16}/><span>{floodAlreadyDetected ? <><b>FLOODING DETECTED — NOW</b> Critical conditions are already present in {selected.name}.</> : <><b>FLOODING PREDICTED IN {floodLeadTime} MIN</b> Risk is rising in {selected.name}; avoid low-lying roads and follow the safe-place guide.</>}</span><button className="action-btn" onClick={startSafePlaceGuide}><Icon name="location"/> Guide to safety</button></div></section>

      {assistantOpen && <div className="assistant-dock"><section className="panel assistant-panel"><div className="panel-head"><div><span className="section-kicker">FLOODPULSE AI AGENT</span><h2>Ask about this flood situation</h2></div><div className="assistant-head-actions"><button className="assistant-test-voice" onClick={testAssistantVoice}><Icon name="phone" size={13}/> Test voice</button><button className="assistant-close" onClick={()=>setAssistantOpen(false)} aria-label="Close AI agent">×</button></div></div><div className="assistant-quick"><button onClick={()=>askAssistant('Why will it flood?')}>Why will it flood?</button><button onClick={()=>askAssistant('Where should I go?')}>Where should I go?</button><button onClick={()=>askAssistant('What is the current risk?')}>Current risk</button></div><div className="assistant-messages">{assistantMessages.length === 0 && <p className="assistant-empty">Ask about risk, rainfall, drainage, safe places, or emergency actions for {selected.name}.</p>}{assistantMessages.slice(-6).map((message, index)=><div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'agent' ? 'AI' : 'YOU'}</span><p>{message.text}</p>{message.role === 'agent' && <button className="assistant-speak" onClick={()=>speakAssistantText(message.text)} aria-label="Play AI answer">▶</button>}</div>)}</div><form className="assistant-form" onSubmit={event=>{event.preventDefault();askAssistant(assistantQuestion)}}><input autoFocus value={assistantQuestion} onChange={event=>setAssistantQuestion(event.target.value)} placeholder="Ask FloodPulse AI..." aria-label="Ask FloodPulse AI"/><button className="action-btn" type="submit"><Icon name="activity"/> Ask</button></form></section></div>}

      {activeView === 'citizen' && <section className="citizen-tools">
        <div className="tool-intro"><span className="section-kicker">{text.safety}</span><h2>{text.nextMove}</h2><p>Check local conditions, find safer alternatives, and share what you see on the ground.</p></div>
        <div className="citizen-actions"><button className={`citizen-action ${routeMode ? 'selected' : ''}`} onClick={startSafePlaceGuide}><Icon name="location"/><span><b>{routeMode ? 'Safe route active' : text.route}</b><small>{routeMode ? `Guiding to ${nearestSafePlace?.name || 'safe place'}` : 'Avoid flooded roads and underpasses'}</small></span></button><button className={`citizen-action ${notificationsOn ? 'selected' : ''}`} onClick={toggleNotifications}><Icon name="bell"/><span><b>{notificationsOn ? 'Alerts enabled' : text.alerts}</b><small>{notificationsOn ? 'Critical updates are on' : 'Receive critical risk updates'}</small></span></button><button className="citizen-action" onClick={startSafePlaceGuide}><Icon name="phone"/><span><b>Voice guide to safety</b><small>Step-by-step help to {nearestSafePlace?.name || 'a shelter'}</small></span></button><button className="citizen-action" onClick={locateCitizen}><Icon name="location"/><span><b>{text.location}</b><small>{locationMessage || 'Center the map near you'}</small></span></button><button className="citizen-action" onClick={()=>setReportOpen(true)}><Icon name="flag"/><span><b>{text.report}</b><small>Send location and conditions</small></span></button></div>
        {routeMode && <div className="safe-guide-card"><div><span className="section-kicker">VOICE SAFETY GUIDE</span><strong>{nearestSafePlace?.name} · {nearestSafePlace?.detail}</strong><p><b>Step {guidanceStep + 1} of {guidanceSteps.length}:</b> {guidanceSteps[guidanceStep]}</p></div><div className="safe-guide-actions"><button className="action-btn" onClick={()=>speakSafetyGuidance()}><Icon name="phone"/> Hear step</button><button className="action-btn secondary" onClick={nextGuidanceStep} disabled={guidanceStep >= guidanceSteps.length - 1}>Next step</button><a className="action-btn emergency-call" href="tel:112"><Icon name="phone"/> 112</a></div></div>}
        {agentStatus && <div className="voice-agent-status"><Icon name="phone" size={15}/><span>{agentStatus}</span></div>}
        {routeMode && <div className="route-notice"><Icon name="shield" size={15}/><span>Route recalculated around {infrastructureImpact.roads} exposed roads. Nearest safe shelter: <b>{nearestSafePlace?.name}, 1.2 km</b>.</span></div>}
      </section>}

      {activeView === 'admin' && <section className="admin-tools">
        <div className="admin-summary"><span className="section-kicker">RESPONSE OPERATIONS</span><h2>Municipal control desk</h2><p>Prioritize field reports, monitor infrastructure, and coordinate the next intervention.</p><div className="admin-kpis"><span><b>{reports.length + 12}</b> open incidents</span><span><b>4</b> crews active</span><span><b>7 min</b> avg response</span></div></div>
        <div className="admin-actions"><a className="action-btn emergency-call" href="tel:112"><Icon name="phone"/> Call 112</a><button className="action-btn" onClick={runVoiceSafetyCheck}><Icon name="phone"/> Run voice safety check</button><button className="action-btn" onClick={exportReports}><Icon name="download"/> Export reports</button><button className="action-btn secondary" onClick={toggleNotifications}><Icon name="bell"/> {notificationsOn ? 'Alerts enabled' : 'Enable alerts'}</button><label className="threshold-control">Alert above <b>{alertThreshold}%</b><input type="range" min="50" max="95" step="5" value={alertThreshold} onChange={event=>updateAlertThreshold(+event.target.value)}/></label></div>
      </section>}

      {activeView === 'admin' && <section className="authority-dashboard"><div className="authority-metrics">{[['CRITICAL ZONES','8'],['ACTIVE INCIDENTS','14'],['DRAIN BLOCKAGES','6'],['ROADS TO CLOSE','11'],['PEOPLE AT RISK','84,250'],['SHELTERS AVAILABLE','23'],['PUMPS REQUIRED','7']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><article className="panel assignment-panel"><div className="panel-head"><div><span className="section-kicker">FIELD COORDINATION</span><h2>Assign emergency team</h2></div><span className="live-chip"><i/> RESPONSE READY</span></div><form className="assignment-form" onSubmit={assignTeam}><label>Emergency team<select value={assignment.team} onChange={event=>setAssignment({...assignment, team:event.target.value})}>{responseTeams.map(team=><option key={team}>{team}</option>)}</select></label><label>Target zone<select value={assignment.zone} onChange={event=>setAssignment({...assignment, zone:event.target.value})}>{baseZones.map(zone=><option key={zone.id}>{zone.name}</option>)}</select></label><label>Task<select value={assignment.task} onChange={event=>setAssignment({...assignment, task:event.target.value})}><option>Drainage inspection</option><option>Road closure</option><option>Evacuation support</option><option>Pump deployment</option></select></label><label>Priority<select value={assignment.priority} onChange={event=>setAssignment({...assignment, priority:event.target.value})}><option>Critical</option><option>High</option><option>Medium</option></select></label><button className="action-btn" type="submit"><Icon name="flag"/> Assign team</button></form>{assignmentMessage && <div className="assignment-confirm"><Icon name="shield" size={15}/><span><b>{assignmentMessage}</b><small>Task: {assignment.task} · Priority: {assignment.priority}</small></span><strong>ACTIVE</strong></div>}</article><article className="panel call-panel"><div className="panel-head"><div><span className="section-kicker">VOICE ALERTS</span><h2>Emergency call broadcast</h2></div><span className="live-chip"><i/> DEMO SAFE</span></div><p className="call-help">Send a spoken flood warning to registered contacts. Numbers must use international format, such as +919876543210.</p><form className="call-form" onSubmit={sendEmergencyCall}><label>Recipients<textarea value={callRecipients} onChange={event=>setCallRecipients(event.target.value)} placeholder="+919876543210, +919812345678" rows="2" required/></label><label>Voice message<textarea value={callMessage} onChange={event=>setCallMessage(event.target.value)} rows="3" maxLength="500" required/></label><button className="action-btn" type="submit" disabled={callSending}><Icon name="phone"/> {callSending ? 'Sending...' : 'Start call broadcast'}</button></form>{callStatus && <div className="call-status"><Icon name="shield" size={15}/><span>{callStatus}</span></div>}</article></section>}

      <section className="metrics-grid">
        <MetricCard icon="cloudRain" label="Rainfall intensity" value={storm} suffix=" mm/h" sub="City weighted mean" trend={storm > 45 ? '↑ rising' : '→ steady'} values={[22,24,28,31,29,35,storm]} tone="cyan"/>
        <MetricCard icon="gauge" label="Drainage load" value={avgDrainLoad} suffix="%" sub="Across monitored network" trend={avgDrainLoad > 70 ? '↑ stressed' : '↗ elevated'} values={[37,42,48,55,61,avgDrainLoad-4,avgDrainLoad]} tone="purple"/>
        <MetricCard icon="alert" label="Maximum flood risk" value={maxRisk} suffix="%" sub={`${criticalZones} critical zone${criticalZones === 1 ? '' : 's'}`} trend="predictive" values={[43,49,56,63,71,maxRisk-3,maxRisk]} tone="orange"/>
        <MetricCard icon="sensor" label="Sensor network" value="96.8" suffix="%" sub="126 / 130 online" trend="healthy" values={[92,93,95,94,96,97,96.8]} tone="green"/>
      </section>

      <section className="main-grid">
        <article className="panel map-panel">
          <div className="panel-head"><div><span className="section-kicker">GEOSPATIAL NOWCAST</span><h2>{mapScope === 'india' ? 'India flood monitoring context' : 'Dynamic flood risk surface'}</h2></div><div className="map-tools"><form className="area-search" onSubmit={searchArea}><Icon name="search" size={15}/><input aria-label="Search area" list="hyderabad-areas" placeholder="Search Hyderabad area" value={areaQuery} onChange={event=>{setAreaQuery(event.target.value);setSearchMessage('')}}/><datalist id="hyderabad-areas">{areaDirectory.map(area=><option key={area.name} value={area.name}/>)}</datalist><button type="submit">Search</button><button type="button" className="clear-search" onClick={clearAreaSearch}>Clear</button></form><div className="layer-controls"><select className="provider-select" aria-label="Map provider" value={mapProvider} onChange={event=>setMapProvider(event.target.value)}><option value="local">FloodPulse local</option><option value="google">Google Maps</option><option value="maptiler">MapTiler</option></select><button className={mapScope === 'india'?'on':''} onClick={()=>setMapScope(mapScope === 'india' ? 'hyderabad' : 'india')}>{mapScope === 'india' ? 'Hyderabad detail' : 'Whole India'}</button>{mapScope === 'hyderabad' && <><button className={showRain?'on':''} onClick={()=>setShowRain(!showRain)}><Icon name="cloudRain" size={15}/> Rain cell</button><button className={showDrains?'on':''} onClick={()=>setShowDrains(!showDrains)}><Icon name="layers" size={15}/> Drains</button><button className={showShelters?'on':''} onClick={()=>setShowShelters(!showShelters)}>Shelters</button><button className={showHospitals?'on':''} onClick={()=>setShowHospitals(!showHospitals)}>Hospitals</button></>}</div>{searchMessage && <span className="search-message">{searchMessage}</span>}</div></div>
          <CityMap zones={zones} selected={selected} onSelect={z=>{setSelectedId(z.id);setMapScope('hyderabad');setDetailZoom(42);setRouteMode(false)}} showDrains={showDrains} showRain={showRain} showShelters={showShelters} showHospitals={showHospitals} userLocation={userLocation} mapScope={mapScope} selectedState={selectedState} onSelectState={setSelectedState} provider={mapProvider} routeMode={routeMode} routeOrigin={guidanceOrigin} routeDestination={nearestSafePlace} reports={reports} detailZoom={detailZoom} onZoomIn={()=>setDetailZoom(value=>Math.max(30, value - 6))} onZoomOut={()=>setDetailZoom(value=>Math.min(70, value + 6))} onShowCity={()=>{setMapScope('hyderabad');setDetailZoom(70)}}/>
          {mapScope === 'india' && <div className="state-analysis"><div><span className="section-kicker">SELECTED STATE</span><h3>{selectedState.name} <small>{selectedState.code}</small></h3></div><div><span>Flood risk<strong>{selectedState.risk}%</strong></span><span>Rainfall<strong>{selectedState.rainfall} mm/h</strong></span><span>Population<strong>{selectedState.populationM}M</strong></span><span>Readiness<strong>{selectedState.readiness}%</strong></span></div></div>}
        </article>

        <aside className="panel zone-panel">
          <div className="panel-head"><div><span className="section-kicker">SELECTED ZONE</span><h2>{selected.name}</h2></div><span className={`risk-badge ${selectedMeta.tone}`}>{selectedMeta.level}</span></div>
          <div className="risk-ring" style={{'--risk': `${selected.risk * 3.6}deg`}}><div><strong>{selected.risk}</strong><span>% risk</span></div></div>
          <div className="zone-stats"><div><span>Predicted depth</span><strong>{selected.depth} m</strong></div><div><span>Drain capacity</span><strong>{selected.drainCapacity}%</strong></div><div><span>Elevation</span><strong>{selected.elevation} m</strong></div><div><span>Population</span><strong>{selected.population.toLocaleString('en-IN')}</strong></div></div>
          <div className="cause-box"><span>PRIMARY RISK DRIVER</span><strong>{selected.drainCapacity < 45 ? 'Drainage capacity deficit' : storm > 48 ? 'High-intensity rainfall' : 'Runoff accumulation'}</strong><p>Coupling engine fuses rainfall forcing, drain headroom and terrain susceptibility.</p></div>
          <div className="risk-explanation"><div className="explanation-title"><span>WHY {selected.name.toUpperCase()} IS {selectedMeta.level.toUpperCase()}</span><Icon name="activity" size={15}/></div><div className="explanation-score"><strong>{selected.risk}%</strong><span>flood probability</span></div><div className="explanation-metrics">{riskFactors.map(([label, value, tone])=><div key={label}><span>{label}</span><i><b className={tone} style={{width:`${value}%`}}/></i><strong>{value}%</strong></div>)}</div><div className="explanation-facts"><span>Elevation<strong>{elevationLevel}</strong></span><span>Runoff coefficient<strong>{runoffCoefficient}</strong></span><span>Forecast confidence<strong>{confidence}%</strong></span></div><div className="main-cause"><small>MAIN CAUSE</small><b>{drainUtilization >= 100 ? 'Rainfall exceeds drainage capacity.' : 'Rainfall pressure is reducing drainage headroom.'}</b></div></div>
          <button className="action-btn" onClick={triggerScenario}><Icon name="play"/> Run cloudburst scenario</button>
        </aside>
      </section>

      <section className="panel model-pipeline"><div className="panel-head"><div><span className="section-kicker">COUPLED RISK ENGINE</span><h2>Rainfall to flood risk</h2></div><span className="live-chip"><i/> LIVE MODEL FLOW</span></div><div className="pipeline-track">{[[`Rainfall forecast`, `${Math.round(storm * 0.82)} mm/h`], ['Rainfall intensity', `${storm} mm/h`], ['Catchment / runoff', `${Math.round(storm * 1.42)}%`], ['Drainage capacity', `${selected.drainCapacity}%`], ['Drainage overload', `${Math.min(99, Math.round(100 - selected.drainCapacity + storm * .7))}%`], ['Water accumulation', `${selected.depth > 0 ? Math.round(selected.depth * 100) : 0} cm`], ['Flood depth', `${selected.depth} m`], ['Flood probability', `${selected.risk}%`], ['Risk level', selectedMeta.level]].map(([label,value], index)=><div className={`pipeline-step ${index === 8 ? selectedMeta.tone : ''}`} key={label}><span className="pipeline-index">{String(index + 1).padStart(2, '0')}</span><small>{label}</small><strong>{value}</strong>{index < 8 && <b className="pipeline-arrow">→</b>}</div>)}</div></section>

      <section className="panel coupling-panel"><div className="panel-head"><div><span className="section-kicker">RAINFALL-DRAINAGE COUPLING</span><h2>When rainfall exceeds drainage</h2></div><span className={`risk-badge ${overflowRisk.toLowerCase()}`}>{overflowRisk}</span></div><div className="coupling-flow"><div className="coupling-step forecast"><span>Rainfall forecast</span><strong>{rainfallForecast.toLocaleString('en-IN')}<small> mm/hr</small></strong></div><b className="coupling-arrow">↓</b><div className="coupling-step"><span>Catchment area</span><strong>{catchmentArea}<small> km²</small></strong></div><b className="coupling-arrow">↓</b><div className="coupling-step runoff"><span>Runoff generated</span><strong>{runoffGenerated.toLocaleString('en-IN')}<small> m³/hr</small></strong></div><b className="coupling-arrow">↓</b><div className="coupling-step capacity"><span>Drain capacity</span><strong>{drainCapacityVolume.toLocaleString('en-IN')}<small> m³/hr</small></strong></div><b className="coupling-arrow">↓</b><div className="coupling-step utilization"><span>Drain utilization</span><strong>{drainUtilization}<small>%</small></strong></div><b className="coupling-arrow">↓</b><div className={`coupling-step overflow ${overflowRisk.toLowerCase()}`}><span>Overflow risk</span><strong>{overflowRisk}</strong></div></div><div className="coupling-meter"><span>Drainage headroom</span><i><b style={{width:`${Math.min(100, Math.round((drainCapacityVolume / Math.max(runoffGenerated, drainCapacityVolume)) * 100))}%`}}/></i><strong>{Math.max(0, drainCapacityVolume - runoffGenerated).toLocaleString('en-IN')} m³/hr</strong></div></section>

      <section className="impact-strip"><article className={`impact-alert ${liveAlert.severity}`}><span className="section-kicker">PREDICTIVE RESPONSE</span><strong>{liveAlert.title}</strong><small>{liveAlert.detail}</small></article><div className="impact-metric"><span>Water level</span><strong>{waterLevel} m</strong><small>{waterLevel > selected.depth ? 'rising' : 'stable'}</small></div><div className="impact-metric"><span>Roads exposed</span><strong>{infrastructureImpact.roads}</strong><small>avoid / close</small></div><div className="impact-metric"><span>Facilities at risk</span><strong>{infrastructureImpact.hospitals + infrastructureImpact.schools + infrastructureImpact.power}</strong><small>{infrastructureImpact.hospitals} hospitals · {infrastructureImpact.schools} schools</small></div><button className="action-btn" onClick={startSafePlaceGuide}><Icon name="location"/> Recalculate route</button></section>

      {mapScope === 'india' && <section className="panel state-directory"><div className="panel-head"><div><span className="section-kicker">NATIONAL COVERAGE</span><h2>All Indian states</h2></div><span className="data-source">{indiaStates.length} states monitored</span></div><div className="state-grid">{indiaStates.map(state=><button className={selectedState.code === state.code ? 'active' : ''} key={state.code} onClick={()=>setSelectedState(state)}><b>{state.code}</b><span>{state.name}</span><small>{state.risk}% risk</small></button>)}</div></section>}

      <section className="advanced-strip"><article className="replay-panel"><div className="panel-head"><div><span className="section-kicker">EVENT REPLAY</span><h2>Compare flood conditions</h2></div><span className="data-source">{replayIndex === null ? 'Live now' : replayEvents[replayIndex].date}</span></div><div className="replay-buttons">{replayEvents.map((event,index)=><button className={replayIndex === index ? 'active' : ''} key={event.label} onClick={()=>replayEvent(index)}><span>{event.label}</span><b>{event.storm} mm/h</b></button>)}<button className={replayIndex === null ? 'active' : ''} onClick={()=>{setReplayIndex(null);setStorm(38)}}><span>Live forecast</span><b>Now</b></button></div></article><article className="insight-panel"><div className="panel-head"><div><span className="section-kicker">MODEL EXPLAINER</span><h2>Risk intelligence</h2></div><Icon name="activity" size={18}/></div><p><b>{selected.name}</b> is currently {selectedMeta.level.toLowerCase()} because {selected.drainCapacity < 45 ? 'limited drainage headroom' : 'rainfall pressure'} is combining with {selected.elevation < 530 ? 'low elevation' : 'runoff accumulation'}.</p><div className="insight-factors"><span>Rain <b>{storm} mm/h</b></span><span>Drain headroom <b>{selected.drainCapacity}%</b></span><span>Confidence <b>{confidence}%</b></span></div></article></section>
      <section className="simulation-section"><article className="panel simulation-panel"><div className="panel-head"><div><span className="section-kicker">MCP WHAT-IF SIMULATOR</span><h2>Test a flood scenario</h2></div><span className="data-source">Selected: {selected.name}</span></div><p className="simulation-help">Change rainfall, duration, blockage, or pump availability to see how quickly conditions deteriorate.</p><form className="simulation-form" onSubmit={runSimulation}><label>Rainfall<input type="number" min="10" max="400" value={simulation.rainfall} onChange={event=>setSimulation({...simulation, rainfall:event.target.value})}/><small>mm total</small></label><label>Duration<input type="number" min="15" max="240" value={simulation.duration} onChange={event=>setSimulation({...simulation, duration:event.target.value})}/><small>minutes</small></label><label>Drain blockage<input type="number" min="0" max="100" value={simulation.blockage} onChange={event=>setSimulation({...simulation, blockage:event.target.value})}/><small>%</small></label><label className="toggle-field">Pump failure<input type="checkbox" checked={simulation.pumpFailure} onChange={event=>setSimulation({...simulation, pumpFailure:event.target.checked})}/><small>{simulation.pumpFailure ? 'ON' : 'OFF'}</small></label><button className="action-btn" type="submit"><Icon name="play"/> Run simulation</button></form></article>{simulationResult && <article className="panel simulation-result"><div className="result-columns"><div><small>LIVE NOW</small><strong>{simulationResult.beforeRisk}%</strong><span>Risk</span></div><div className="result-arrow">→</div><div className="after-result"><small>SCENARIO · {simulationResult.severity.toUpperCase()}</small><strong>{simulationResult.risk}%</strong><span>Risk</span></div></div><div className="result-stats"><span>Maximum depth<strong>{simulationResult.depth} m</strong></span><span>Flood onset<strong>{simulationResult.onsetMinutes} min</strong></span><span>Affected area<strong>{simulationResult.affectedArea} km²</strong></span><span>Affected roads<strong>{simulationResult.affectedRoads}</strong></span><span>Drainage zones<strong>{simulationResult.drainageZones}</strong></span></div></article>}</section>

      <section className="panel hotspot-panel"><div className="panel-head"><div><span className="section-kicker">MCP HOTSPOT DISCOVERY</span><h2>Repeated flood-prone locations</h2></div><span className="data-source">Rainfall · history · drainage · terrain</span></div><div className="hotspot-grid">{hotspots.slice(0, 5).map(hotspot=><button className="hotspot-row" key={hotspot.id} onClick={()=>{setSelectedId(hotspot.id);setMapScope('hyderabad')}}><span className={`hotspot-dot ${hotspot.level.toLowerCase()}`}/><span><b>{hotspot.name}</b><small>{hotspot.ward} · drainage stress {hotspot.drainageStress}%</small></span><strong>{hotspot.score}<small>/100</small></strong><em>{hotspot.level}</em></button>)}</div></section>

      <section className="panel architecture-panel"><div className="panel-head"><div><span className="section-kicker">SYSTEM ARCHITECTURE</span><h2>From city data to emergency action</h2></div><span className="live-chip"><i/> DECISION PIPELINE</span></div><div className="architecture-flow"><div className="architecture-group sources"><span className="architecture-label">DATA SOURCES</span><div><b>Rainfall</b><small>Radar + gauges</small></div><div><b>Drain IoT</b><small>Levels + flow</small></div><div><b>GIS / DEM</b><small>Elevation + terrain</small></div></div><i className="architecture-arrow">↓</i><div className="architecture-group processing"><span className="architecture-label">DATA PROCESSING</span><div><b>Hydrological model</b><small>Rain → runoff → flow</small></div><div><b>Drainage model</b><small>Capacity + blockage + flow</small></div><div><b>AI model</b><small>Flood probability</small></div></div><i className="architecture-arrow">↓</i><div className="architecture-group outputs"><span className="architecture-label">DECISION OUTPUTS</span><div><b>Flood map</b><small>Risk zones</small></div><div><b>Forecast</b><small>+10 · +20 · +30 · +45 min</small></div><div><b>Decision engine</b><small>Alerts · Routes · Emergency response</small></div></div></div></section>

      <section className="lower-grid">
        <article className="panel chart-panel">
          <div className="panel-head"><div><span className="section-kicker">COUPLED HYDROGRAPH</span><h2>Rainfall → runoff → drainage stress</h2></div><div className="mini-status"><i/> NOWCAST ACTIVE</div></div>
          <AreaChart data={rainfallHistory} storm={storm}/>
        </article>
        <article className="panel alert-panel">
          <div className="panel-head"><div><span className="section-kicker">DECISION SUPPORT</span><h2>Operational alerts</h2></div><span className="count-chip">{alerts.length}</span></div>
          <div className="alerts-list">{alerts.slice(0,4).map(a=><div className={`alert-row ${a.severity}`} key={a.id}><span className="alert-icon"><Icon name="alert" size={16}/></span><div><strong>{a.title}</strong><p>{a.detail}</p></div><time>{a.time}</time></div>)}</div>
        </article>
      </section>

      {activeView === 'citizen' && <section className="citizen-grid"><article className="panel shelter-panel"><div className="panel-head"><div><span className="section-kicker">EMERGENCY SUPPORT</span><h2>{text.shelters}</h2></div><span className="count-chip">3 open</span></div><div className="shelter-list">{safePlaces.map(shelter=><div className={nearestSafePlace?.id === shelter.id ? 'recommended-shelter' : ''} key={shelter.id}><Icon name="shield"/><span><b>{shelter.name}</b><small>{shelter.detail} · {nearestSafePlace?.id === shelter.id ? 'Recommended for you' : 'Open and staffed'}</small></span><strong>{nearestSafePlace?.id === shelter.id ? 'GO HERE' : 'OPEN'}</strong></div>)}</div></article><article className="panel citizen-alerts"><div className="panel-head"><div><span className="section-kicker">YOUR AREA</span><h2>What to do now</h2></div><span className="live-chip"><i/> 112 READY</span></div><div className="safety-steps"><p><b>1</b><span>Keep away from moving water and electrical equipment.</span></p><p><b>2</b><span>Follow the voice guide to <strong>{nearestSafePlace?.name}</strong>.</span></p><p><b>3</b><span>Call <strong>112</strong> for immediate emergency assistance.</span></p></div><div className="contact-strip"><Icon name="phone"/><span><b>{text.emergency}</b><small>Tap a number to call emergency services</small></span><div className="contact-actions"><a href="tel:112">112</a><a href="tel:108">108</a><a href="tel:04021111111">GHMC</a></div></div></article></section>}

      {activeView === 'admin' && <section className="admin-grid"><article className="panel incident-panel"><div className="panel-head"><div><span className="section-kicker">FIELD REPORTS</span><h2>Incident queue</h2></div><span className="count-chip">{reports.length + 2}</span></div><div className="incident-list">{reports.length ? reports.map(report=><div className="incident-row" key={report.id}><span className={`severity-dot ${report.severity}`}/><span><b>{report.location} <em className={`verification-tag ${report.verified ? 'verified' : ''}`}>{report.verified ? 'Verified' : 'Unverified'}</em></b><small>{report.depth ? `${report.depth} m depth · ` : ''}{report.detail || 'Citizen-submitted flood report'} · {report.time}</small></span><button onClick={()=>setReports(prev=>prev.map(item=>item.id === report.id ? {...item, verified: true} : item))}>{report.verified ? 'Verified' : 'Verify'}</button><button onClick={()=>assignReport(report.id)}>{assignedReports[report.id] ? 'Assigned' : 'Assign'}</button></div>) : <div className="empty-state"><Icon name="flag"/><span><b>No citizen reports yet</b><small>Reports submitted from the public will appear here.</small></span></div>}<div className="incident-row"><span className="severity-dot critical"/><span><b>Old City Basin</b><small>Drainage surcharge predicted · 12:52</small></span><button onClick={()=>assignReport('old-city')}>{assignedReports['old-city'] ? 'Assigned' : 'Assign'}</button></div><div className="incident-row"><span className="severity-dot high"/><span><b>River Bend underpass</b><small>Road inundation threshold likely · 12:49</small></span><button onClick={()=>assignReport('river-bend')}>{assignedReports['river-bend'] ? 'Assigned' : 'Assign'}</button></div></div></article><article className="panel maintenance-panel"><div className="panel-head"><div><span className="section-kicker">NETWORK HEALTH</span><h2>Sensor readiness</h2></div><span className="count-chip">96.8%</span></div><div className="sensor-health"><div><span><b>126</b> online</span><i><em style={{width:'96.8%'}}/></i></div><div><span><b>2</b> stale</span><i><em className="stale" style={{width:'1.5%'}}/></i></div><div><span><b>2</b> offline</span><i><em className="offline" style={{width:'1.5%'}}/></i></div></div><div className="maintenance-list"><p><span className="status-pill critical"><i/>Urgent</span><b>D-204 · Old City Basin</b><small>Inspect pump and clear inlet</small></p><p><span className="status-pill stressed"><i/>Today</span><b>D-338 · River Bend</b><small>Desilt downstream chamber</small></p><p><span className="status-pill normal"><i/>Scheduled</span><b>D-117 · Central Market</b><small>Sensor calibration check</small></p></div></article></section>}

      {reportOpen && <div className="modal-backdrop" onClick={event=>event.target === event.currentTarget && setReportOpen(false)}><form className="report-modal" onSubmit={submitReport}><div className="panel-head"><div><span className="section-kicker">CITIZEN REPORT</span><h2>Report flooding</h2></div><button type="button" className="modal-close" onClick={()=>setReportOpen(false)}>×</button></div><label>Location<input name="location" required placeholder="Road, landmark or area"/></label><label>Flood depth (metres)<input name="depth" type="number" min="0" max="5" step="0.01" placeholder="Example: 0.30"/></label><label>Severity<select name="severity" defaultValue="high"><option value="medium">Moderate</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Photo<input name="photo" type="file" accept="image/*"/></label><label>What is happening?<textarea name="detail" placeholder="Blocked road, stranded people, water movement..."/></label><button className="action-btn" type="submit"><Icon name="flag"/> Submit report</button></form></div>}

      <section className="panel network-panel">
        <div className="panel-head"><div><span className="section-kicker">DRAINAGE TELEMETRY</span><h2>Critical infrastructure watchlist</h2></div><span className="data-source">IoT + GIS + Radar fusion</span></div>
        <div className="table-wrap"><table><thead><tr><th>Node</th><th>Zone</th><th>Design capacity</th><th>Current loading</th><th>Blockage</th><th>Status</th></tr></thead><tbody>{drainNodes.map(n=>{const load=Math.min(99, n.level+Math.round((storm-38)*.38)+Math.round((n.blockage-42)*.08)); const status=load>82?'critical':load>62?'stressed':'normal';return <tr key={n.id}><td><b>{n.id}</b></td><td>{n.zone}</td><td>{n.capacity} mm/h</td><td><div className="load-cell"><span className="load-bar"><i style={{width:`${load}%`}}/></span><b>{load}%</b></div></td><td><span className={`blockage-value ${n.blockage > 35 ? 'severe' : ''}`}>{n.blockage}%</span></td><td><span className={`status-pill ${status}`}><i/>{status}</span></td></tr>})}</tbody></table></div>
      </section>
    </main>

    <footer><span>FloodPulse · Smart India Hackathon Prototype</span><span>Observed + forecast data clearly separated · Synthetic demo telemetry</span><span>Model: rainfall × drainage × terrain</span></footer>
  </div>
}

export default App
