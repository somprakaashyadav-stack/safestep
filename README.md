# SafeStep — AI-Powered Women's Journey Safety & Smart Urban Intelligence

> **Live Local App:** Open [index.html](file:///c:/Users/som04/Downloads/Sahayak/index.html) in your browser.  
> **Pitch & Slide Deck:** Open [presentation.html](file:///c:/Users/som04/Downloads/Sahayak/presentation.html).  
> **Detailed Blueprint & Tech Spec:** Read [PROJECT_BLUEPRINT.md](file:///c:/Users/som04/Downloads/Sahayak/PROJECT_BLUEPRINT.md).

---

## 🚀 Quick Start (Running the Website Step by Step)

### Step 1: Open the Interactive Web Application
You can run the full frontend application immediately without needing any local server or build tools:
1. Navigate to `c:\Users\som04\Downloads\Sahayak\`.
2. Double-click **`index.html`** (or open it in Google Chrome, Microsoft Edge, or Firefox).
3. The interface will load:
   - **Interactive Map:** Centered with OpenStreetMap / CartoDB tiles.
   - **Time-Dependent Risk Slider:** Drag from 2 PM $\rightarrow$ 7 PM $\rightarrow$ 11 PM to watch the risk score recalculate and the route polylines turn from 🟢 Green to 🔴 Red!
   - **Alternative Route Cards:** Click between **SafeStep Recommended** and **Fastest Shortcut** to see the Explainable AI (XAI) rationale.
   - **Safe Shelters:** Toggle the checkboxes for Police Stations 🚓, 24/7 Hospitals 🏥, and Pharmacies 💊.
   - **Emergency SOS:** Click the red **SOS** button in the header to preview the 5-second countdown and dispatch protocol.
   - **AI Street Audit Tab:** Click **"AI Street Audit"** in the top navigation to test street photo uploads and YOLOv8 computer vision detection.
   - **Civic Dashboard Tab:** Click **"Civic Dashboard"** to view real-time Chart.js municipal analytics.

---

### Step 2: Running the Python FastAPI Backend (Optional / Development)

When you want to run the full asynchronous REST API backend:

```bash
# 1. Navigate to backend directory
cd backend

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the FastAPI development server
uvicorn main:app --reload --port 8000
```

Once started, explore the interactive Swagger documentation at:
- `http://localhost:8000/docs`

#### Key API Endpoints:
- `POST /api/v1/routes/calculate` — Computes time-dependent safety-weighted alternative routes.
- `GET /api/v1/safe-shelters` — Returns active 24/7 police kiosks, hospitals, and pharmacies.
- `POST /api/v1/incidents/report` — Accepts anonymous crowdsourced hazard logs.

---

## 📁 Project File Structure

```
Sahayak/
├── index.html               # Main interactive web application
├── style.css                # Dark mode, responsive styling & glassmorphic UI
├── app.js                   # Leaflet map logic, time risk engine, and charts
├── presentation.html        # Interactive 7-slide presentation deck
├── SLIDES.md                # Slide deck script & speaker notes
├── PROJECT_BLUEPRINT.md     # Full architectural blueprint & 3-phase roadmap
├── README.md                # This setup and walk-through guide
└── backend/                 # Python FastAPI Backend Scaffolding
    ├── main.py              # Application entrypoint & CORS setup
    ├── models.py            # Pydantic data schemas
    ├── routes.py            # Route handlers & mock database
    ├── ml_engine.py         # Scikit-learn Time-Dependent Risk Regressor
    └── requirements.txt     # Python dependencies
```
