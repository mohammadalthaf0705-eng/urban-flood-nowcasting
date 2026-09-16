# FloodPulse — Urban Flood Nowcasting System

Advanced SIH web prototype for a **Flood decision-support system** focused on Urban Flood Nowcasting (Drainage and Rainfall Coupling).

The application demonstrates how rainfall forcing, drainage capacity, terrain susceptibility and live telemetry can be fused into hyperlocal flood-risk forecasts and operational alerts.

## What is included

- Flood decision-support system
- Dynamic ward/zone flood-risk map
- Coupled rainfall → runoff → drainage stress chart
- +10, +20, +30 and +45 minute nowcast horizon control
- Forecast confidence that changes with lead time
- Rain-cell and drainage-network map layers
- Zone-level predicted inundation depth
- Drainage telemetry and stress watchlist
- Operational alert panel
- Cloudburst / extreme-rain scenario simulation
- Synthetic real-time rainfall stream for offline demos
- Responsive desktop/tablet/mobile layout
- No API key required for the prototype

## Tech stack

- React 19.3
- Vite 8.3
- Native SVG visualizations and digital-twin map
- Modern responsive CSS with glass / command-center UI

The prototype intentionally uses a local SVG geospatial layer instead of a third-party map SDK so it remains reliable during hackathon demonstrations with poor internet access.

## Run in VS Code

### 1. Prerequisites

Install **Node.js 20.19+** (Node 22 LTS or newer is recommended).

### 2. Open project

Extract the ZIP and open the `urban-flood-nowcasting-sih` folder in VS Code.

### 3. Install dependencies

```bash
npm install
```

### 4. Start development server

```bash
npm run dev
```

Vite will print a local URL, normally `http://localhost:5173`.

### 5. Start the backend API

In a second terminal, run:

```bash
set PORT=3001 && npm run server
```

The API runs at `http://localhost:3001/api` during development, matching the Vite proxy. The frontend connects to it automatically and falls back to local demo state if it is unavailable. Set `VITE_API_URL` when the API is hosted elsewhere. In PowerShell, use `$env:PORT=3001; npm run server`.

### Single-localhost mode

To serve the built frontend and API together from one address, run:

```bash
npm start
```

Open `http://localhost:5173`. The React app and all `/api/*` requests use this same local host.

Reports, assignments, and alert thresholds persist locally in `data/store.json`. This is suitable for a demo or single-server deployment; use PostgreSQL/PostGIS and authentication before deploying for public use.

The UI includes English, Hindi, and Telugu citizen labels. Live radar, routing, SMS/WhatsApp, and AI image analysis can be connected through the backend without exposing provider credentials in the browser.

### AI + MCP analytics boundary

The prototype exposes MCP-shaped HTTP tools for an AI agent or a future standards-compliant MCP adapter. The shared analytics engine combines rainfall intensity, event duration, drainage capacity, blockage, elevation, water level and flood history. The What-If Simulator returns risk, severity, depth, affected area, flood onset, drainage zones over capacity and population at risk. Hotspot Discovery returns a score from 0–100 plus contributing factors and can select the corresponding zone on the dashboard.

### Map providers

Use the map provider selector in the dashboard. `FloodPulse local` requires no key. To enable the external providers, copy `.env.example` to `.env`, add a browser-restricted Google Maps Embed API key and/or MapTiler key, then restart the app:

```env
VITE_GOOGLE_MAPS_KEY=your_google_key
VITE_MAPTILER_KEY=your_maptiler_key
```

Never commit `.env` or expose unrestricted keys. Google Maps requires the Maps Embed API; MapTiler requires a web map key.

Available endpoints include:

- `GET /api/health` — service health check
- `GET /api/areas?q=Madhapur` — Hyderabad locality lookup
- `GET /api/nowcast?storm=38&horizon=30` — calculated zone forecast
- `GET /api/mcp/tools` — analytics tool manifest for the MCP integration boundary
- `POST /api/mcp/simulate` — what-if simulation for rainfall, duration, blockage and zone
- `GET /api/mcp/hotspots?storm=38&horizon=30` — ranked recurring flood hotspots
- `GET /api/alerts` — operational alerts
- `GET /api/reports` and `POST /api/reports` — citizen reports
- `PATCH /api/reports/:id/assign` — assign a field report
- `PATCH /api/reports/:id/verify` — verify a citizen report
- `GET/PATCH /api/settings` — alert threshold settings
- `POST /api/notifications/call` — queue an emergency voice alert for E.164 recipients
- `POST /api/notifications/evaluate` — evaluate forecast risk and queue one deduplicated voice safety warning
- `GET /api/notifications/calls` — inspect recent call broadcast requests
- `GET /api/notifications/agent` — inspect voice-agent readiness and last dispatch

### Emergency voice alerts

The Admin console includes an Emergency call broadcast form. Without provider credentials, requests are logged as demo calls and no phone call is placed. To place real calls with Twilio, configure these server-only environment variables before starting the API:

```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1your_twilio_number
```

The voice safety agent evaluates the configured alert threshold and only dispatches on a new risk transition, with a 15-minute cooldown. Configure an opted-in recipient list for automated warnings with `VOICE_AGENT_RECIPIENTS=+919876543210,+919812345678`. High and critical citizen reports also request a warning when this list is configured. Recipients must use E.164 format. Keep credentials and recipient data on the server and obtain consent before sending emergency calls. For a production deployment, add authentication, per-citizen location subscriptions, rate limits, delivery callbacks, provider failover, human approval for evacuation orders, and an approved emergency message workflow.

Citizens can use **Hear safety guidance** for local browser voice playback without a phone provider. This is an accessibility aid, not a replacement for emergency services or official evacuation instructions.

### 6. Production build

```bash
npm run build
npm run preview
```

## Demo flow for SIH judges

1. Start at **Overview** and explain the four fused signals: rainfall, drainage load, flood risk and sensor health.
2. Move the **forecast horizon** between +10, +20, +30 and +45 minutes and point out the changing confidence and risk surface.
3. Toggle **Rain cell** and **Drains** on the map.
4. Select **Old City Basin** or **River Bend** to explain zone-level risk and predicted water depth.
5. Click **Run cloudburst scenario** to trigger a severe event and show cascading changes across the dashboard.
6. Use the hydrograph to explain rainfall–drainage coupling.
7. Finish with the **Operational alerts** and **Drainage telemetry** sections to demonstrate decision support for municipal responders.

## How the prototype model works

The browser demo uses a transparent heuristic model:

`Flood Risk = base susceptibility + rainfall pressure + drainage deficit + low-elevation penalty + forecast-horizon term`

This is deliberately simple enough to explain to judges while keeping the UI ready for a real model.

For a production SIH implementation, replace the heuristic with a server-side model using:

- IMD / weather radar rainfall grids
- Automatic rain gauge feeds
- IoT drain water-level and flow sensors
- DEM / terrain and slope
- Drainage GIS topology, pipe dimensions and design capacity
- Soil / impervious surface data
- Historical flood observations and complaint data
- Road underpass / critical-infrastructure layers

## Recommended production architecture

```text
Rain Radar / Gauges ─┐
IoT Drain Sensors ───┼──> Ingestion API / MQTT ──> Time-series DB
GIS / DEM Layers ────┘                 │
                                       v
                         Rainfall-runoff + drainage model
                                       │
                                       v
                           Nowcast Risk API / WebSocket
                                       │
                    ┌──────────────────┴─────────────────┐
                    v                                    v
             FloodPulse Web App                  Alert / Response API
```

Suggested backend upgrades:

- FastAPI or Node.js API gateway
- PostgreSQL + PostGIS for spatial data
- TimescaleDB for sensor time series
- MQTT for IoT telemetry
- Redis for fast latest-state access
- WebSocket / Server-Sent Events for live updates
- Python model service (XGBoost/LSTM/GNN + hydraulic features)
- Docker for deployment

## Suggested ML / hydrology roadmap

### Phase 1 — Data-driven baseline
Train a gradient-boosted model on rainfall intensity, antecedent rainfall, elevation, imperviousness, drain capacity and historical waterlogging labels.

### Phase 2 — Spatiotemporal nowcasting
Use ConvLSTM / transformer-based radar extrapolation for 0–60 minute rainfall prediction.

### Phase 3 — Drainage coupling
Represent the drainage system as a graph. Each node carries water level / capacity / flow information; edges represent pipes/channels. A graph model or simplified hydraulic solver propagates surcharge risk downstream.

### Phase 4 — Hybrid model
Fuse physics-derived hydraulic features with ML predictions. This is usually more defensible for civic infrastructure than presenting a black-box model alone.

## Real API adapters

`.env.example` contains placeholders for future integrations:

```env
VITE_WEATHER_API_URL=
VITE_IOT_API_URL=
VITE_GIS_API_URL=
```

For production, avoid exposing secret credentials in frontend environment variables. Put authenticated calls behind your backend.

## Important note

All current telemetry, zones and alerts are **synthetic demonstration data**. The UI clearly presents a prototype digital twin and should not be used for real emergency decisions until validated with city data and calibrated models.
