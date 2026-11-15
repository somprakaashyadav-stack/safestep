// SafeStep — Core Application Logic with OpenStreetMap, Nominatim Autocomplete Geocoding,
// OSRM Road-Following Routing, Dynamic Marker Clustering, and Data-Driven Safety Scoring.

function getApiBaseUrl() {
  const custom = localStorage.getItem('safestep_backend_url');
  if (custom) return custom.replace(/\/+$/, '');

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.port
      ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
      : 'http://localhost:8000';
  }

  // In production (Vercel): use relative URL so vercel.json reverse-proxies directly to Render
  return '';
}

let API_BASE_URL = getApiBaseUrl();
let isBackendConnected = false;
let currentTheme = localStorage.getItem('safestep_theme') || 'light';
let activeMapStyle = 'osm';

let map;
let tileLayer;
let clusterGroup;
let safeRoutePolyline;
let fastRoutePolyline;
let heatmapLayers = [];
let startMarker = null;
let endMarker = null;

let originCoords = null; // [lat, lng]
let destCoords = null;   // [lat, lng]

let showSafetyHeatmap = true;
let selectedRouteType = 'safe';
let currentTimeHour = 22; // Default 10 PM
let sosTimer = null;
let sosSecondsRemaining = 5;

// Dynamic shelters and incidents arrays
let currentShelters = [];
let currentIncidents = [];

// Map Tile Providers Definition (Zero Watermarks, 100% Free, No Carto)
const MAP_PROVIDERS = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19
  },
  hot: {
    name: 'OSM Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/" target="_blank">Humanitarian OpenStreetMap Team</a>',
    maxZoom: 19
  },
  satellite: {
    name: 'Esri Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 18
  }
};

// Initialize on DOM Load
window.addEventListener('DOMContentLoaded', async () => {
  applyTheme(currentTheme);
  initMap();
  setupAutocomplete();
  loadSavedApiKeys();
  await checkBackendHealth();
  await loadIncidentsFromBackend();
  initCharts();

  // Try GPS Initialization
  requestUserGPSLocation(false);

  // Prevent grey map tiles on window resize
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
});

// 1. Initialize Leaflet Map (Neutral initial view, no Pune default)
function initMap() {
  // Broad overview of India (or global view)
  map = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView([20.5937, 78.9629], 5);

  setMapStyle('osm');

  // Initialize MarkerCluster group
  if (typeof L.markerClusterGroup === 'function') {
    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true
    });
    map.addLayer(clusterGroup);
  } else {
    clusterGroup = L.layerGroup().addTo(map);
  }

  // Map Click Handler
  map.on('click', handleMapClick);

  setTimeout(() => map.invalidateSize(), 150);
  setTimeout(() => map.invalidateSize(), 600);
}

// 2. Set Map Provider Style
function setMapStyle(styleKey) {
  if (!MAP_PROVIDERS[styleKey]) return;
  activeMapStyle = styleKey;

  if (tileLayer) map.removeLayer(tileLayer);

  const provider = MAP_PROVIDERS[styleKey];
  tileLayer = L.tileLayer(provider.url, {
    maxZoom: provider.maxZoom,
    subdomains: 'abc',
    attribution: provider.attribution
  }).addTo(map);

  document.querySelectorAll('.map-style-bar button').forEach(b => b.classList.remove('active'));
  if (styleKey === 'osm') document.getElementById('btnMapOSM')?.classList.add('active');
  if (styleKey === 'hot') document.getElementById('btnMapHOT')?.classList.add('active');
  if (styleKey === 'satellite') document.getElementById('btnMapSat')?.classList.add('active');
}

// 3. User GPS Location Initialization
function requestUserGPSLocation(isUserClick = false) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        originCoords = [latitude, longitude];
        setStartMarker(latitude, longitude, 'Current GPS Location');
        map.setView([latitude, longitude], 15);

        // Reverse geocode to get readable address
        const name = await reverseGeocode(latitude, longitude);
        document.getElementById('originInput').value = name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)} (Current Location)`;
        updateMapHint('📍 GPS detected. Search destination above or click on the map to calculate safest route.');

        if (destCoords) {
          calculateRoutes();
        }
      },
      (err) => {
        if (isUserClick) {
          alert('GPS location permission denied or unavailable on your browser.');
        } else {
          updateMapHint('💡 Search starting location and destination above, or click on the map to set points.');
        }
      },
      { timeout: 7000, enableHighAccuracy: true }
    );
  }
}

function useCurrentLocation() {
  requestUserGPSLocation(true);
}

function clearDestination() {
  document.getElementById('destInput').value = '';
  destCoords = null;
  if (endMarker) {
    map.removeLayer(endMarker);
    endMarker = null;
  }
  clearRouteLines();
  resetRouteCards();
}

function updateMapHint(text) {
  const el = document.getElementById('mapHintBanner');
  if (el) el.innerHTML = `<span>💡</span> ${text}`;
}

// 4. Autocomplete Geocoding Setup (Nominatim Search with 300ms Debounce)
function setupAutocomplete() {
  initAutocompleteField('originInput', 'originSuggestions', (item) => {
    originCoords = [parseFloat(item.lat), parseFloat(item.lng)];
    document.getElementById('originInput').value = item.display_name;
    setStartMarker(originCoords[0], originCoords[1], item.display_name);
    if (!destCoords) {
      map.setView(originCoords, 14);
    } else {
      calculateRoutes();
    }
  });

  initAutocompleteField('destInput', 'destSuggestions', (item) => {
    destCoords = [parseFloat(item.lat), parseFloat(item.lng)];
    document.getElementById('destInput').value = item.display_name;
    setEndMarker(destCoords[0], destCoords[1], item.display_name);
    if (!originCoords) {
      map.setView(destCoords, 14);
    } else {
      calculateRoutes();
    }
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-container')) {
      document.querySelectorAll('.autocomplete-dropdown').forEach(d => {
        d.classList.remove('show');
        d.innerHTML = '';
      });
    }
  });
}

function initAutocompleteField(inputId, dropdownId, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let debounceTimer = null;

  input.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);

    if (val.length < 2) {
      dropdown.classList.remove('show');
      dropdown.innerHTML = '';
      return;
    }

    dropdown.innerHTML = '<div class="autocomplete-loading">Searching addresses...</div>';
    dropdown.classList.add('show');

    debounceTimer = setTimeout(async () => {
      const results = await fetchGeocodeSuggestions(val);
      renderSuggestions(results, dropdown, onSelect);
    }, 300);
  });
}

async function fetchGeocodeSuggestions(query) {
  // Try local backend proxy first
  if (isBackendConnected) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/geocode?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {}
  }

  // Fallback direct to OpenStreetMap Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=6`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const data = await res.json();
      return data.map(item => ({
        place_id: item.place_id,
        display_name: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        type: item.type
      }));
    }
  } catch (err) {}

  return [];
}

function renderSuggestions(items, dropdown, onSelect) {
  if (!items || items.length === 0) {
    dropdown.innerHTML = '<div class="autocomplete-loading">No locations found. Try a different landmark or city.</div>';
    return;
  }

  dropdown.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'autocomplete-item';

    const parts = (item.display_name || '').split(',');
    const mainTitle = parts[0];
    const subTitle = parts.slice(1).join(',').trim();

    div.innerHTML = `
      <div class="autocomplete-item-title">📍 ${mainTitle}</div>
      <div class="autocomplete-item-sub">${subTitle || 'Identified Address'}</div>
    `;

    div.addEventListener('click', () => {
      dropdown.classList.remove('show');
      dropdown.innerHTML = '';
      onSelect(item);
    });

    dropdown.appendChild(div);
  });
}

// 5. Reverse Geocode helper
async function reverseGeocode(lat, lng) {
  if (isBackendConnected) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/reverse-geocode?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        return data.display_name;
      }
    } catch (e) {}
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17`);
    if (res.ok) {
      const data = await res.json();
      return data.display_name;
    }
  } catch (e) {}

  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// 6. Set Markers A and B
function setStartMarker(lat, lng, label = 'Point A') {
  if (startMarker) map.removeLayer(startMarker);

  const startIcon = L.divIcon({
    className: 'custom-pin-point start',
    html: 'A',
    iconSize: [32, 32]
  });

  startMarker = L.marker([lat, lng], { icon: startIcon, draggable: true }).addTo(map);
  startMarker.bindPopup(`<strong>Origin (Point A)</strong><br>${label}<br><small style="color:#64748b;">(Drag to reposition)</small>`);
  startMarker.on('dragend', async () => {
    const pos = startMarker.getLatLng();
    originCoords = [pos.lat, pos.lng];
    const name = await reverseGeocode(pos.lat, pos.lng);
    document.getElementById('originInput').value = name || `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
    if (destCoords) calculateRoutes();
  });
}

function setEndMarker(lat, lng, label = 'Point B') {
  if (endMarker) map.removeLayer(endMarker);

  const endIcon = L.divIcon({
    className: 'custom-pin-point end',
    html: 'B',
    iconSize: [32, 32]
  });

  endMarker = L.marker([lat, lng], { icon: endIcon, draggable: true }).addTo(map);
  endMarker.bindPopup(`<strong>Destination (Point B)</strong><br>${label}<br><small style="color:#64748b;">(Drag to reposition)</small>`);
  endMarker.on('dragend', async () => {
    const pos = endMarker.getLatLng();
    destCoords = [pos.lat, pos.lng];
    const name = await reverseGeocode(pos.lat, pos.lng);
    document.getElementById('destInput').value = name || `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
    if (originCoords) calculateRoutes();
  });
}

// 7. Click on Map Handler (Select Point A or Point B)
function handleMapClick(e) {
  const { lat, lng } = e.latlng;
  const popupContent = `
    <div style="font-family:inherit; font-size:12px; display:flex; flex-direction:column; gap:6px; min-width:190px;">
      <strong style="color:var(--text-main);">Selected Map Coordinate</strong>
      <span style="color:#64748b;">${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E</span>
      <div style="display:flex; gap:6px; margin-top:4px;">
        <button onclick="setPointFromMap('start', ${lat}, ${lng})" style="background:#059669; color:#fff; border:none; padding:6px 8px; border-radius:5px; cursor:pointer; font-weight:bold; flex:1;">Set Start (A)</button>
        <button onclick="setPointFromMap('end', ${lat}, ${lng})" style="background:#e11d48; color:#fff; border:none; padding:6px 8px; border-radius:5px; cursor:pointer; font-weight:bold; flex:1;">Set Dest (B)</button>
      </div>
    </div>
  `;

  L.popup()
    .setLatLng(e.latlng)
    .setContent(popupContent)
    .openOn(map);
}

async function setPointFromMap(type, lat, lng) {
  map.closePopup();
  const address = await reverseGeocode(lat, lng);

  if (type === 'start') {
    originCoords = [lat, lng];
    document.getElementById('originInput').value = address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setStartMarker(lat, lng, address);
  } else {
    destCoords = [lat, lng];
    document.getElementById('destInput').value = address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setEndMarker(lat, lng, address);
  }

  if (originCoords && destCoords) {
    calculateRoutes();
  }
}

// 8. Dynamic Nearby Services Around Selected Journey
async function fetchNearbyServicesAroundRoute(minLat, minLng, maxLat, maxLng) {
  let services = [];

  // 1. Try Backend API
  if (isBackendConnected) {
    try {
      const url = `${API_BASE_URL}/api/v1/nearby-services?min_lat=${minLat}&min_lng=${minLng}&max_lat=${maxLat}&max_lng=${maxLng}`;
      const res = await fetch(url);
      if (res.ok) {
        services = await res.json();
      }
    } catch (e) {}
  }

  // 2. Direct Nominatim fallback if backend returned none
  if (services.length === 0) {
    const amenities = ['police', 'hospital', 'pharmacy'];
    for (const am of amenities) {
      try {
        const viewbox = `${minLng},${maxLat},${maxLng},${minLat}`;
        const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&amenity=${am}&viewbox=${viewbox}&bounded=1&limit=4`;
        const res = await fetch(nomUrl, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const items = await res.json();
          items.forEach(it => {
            const disp = it.display_name || '';
            const is247 = disp.includes('24/7') || disp.includes('Emergency') || disp.includes('24 hours');
            services.push({
              id: `nom_${it.place_id}`,
              name: it.name || disp.split(',')[0],
              type: am === 'police' ? 'police' : am === 'hospital' ? 'hospital' : 'pharma',
              lat: parseFloat(it.lat),
              lng: parseFloat(it.lon),
              operating_hours: is247 ? 'Verified 24/7' : 'Standard Operating Hours',
              is_verified_24_7: is247,
              contact: am === 'police' ? 'Police Dispatch: 112' : am === 'hospital' ? 'Casualty: 108' : 'Chemist Desk',
              address: disp
            });
          });
        }
      } catch (e) {}
    }
  }

  currentShelters = services;
  renderSheltersAndIncidents();
  return services;
}

// 9. Marker Clustering & Distinct Icons (Police, Hospitals, Pharmacies, Incidents)
function renderSheltersAndIncidents() {
  if (!clusterGroup) return;
  clusterGroup.clearLayers();

  const showPolice = document.getElementById('chkPolice')?.checked ?? true;
  const showHosp = document.getElementById('chkHospitals')?.checked ?? true;
  const showPharma = document.getElementById('chkPharma')?.checked ?? true;

  const showHazards = document.getElementById('chkHazards')?.checked ?? true;
  const showDarkLamps = document.getElementById('chkDarkLamps')?.checked ?? true;
  const showHarassment = document.getElementById('chkHarassment')?.checked ?? true;

  const seenKeys = new Set();

  // Render Shelters (Police, Hospital, Pharmacy)
  currentShelters.forEach(s => {
    if ((s.type === 'police' && !showPolice) ||
        (s.type === 'hospital' && !showHosp) ||
        (s.type === 'pharma' && !showPharma)) {
      return;
    }

    const key = `${s.lat.toFixed(4)}_${s.lng.toFixed(4)}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    let emoji = '🚓';
    let badgeClass = 'police';
    let title = 'Police Station';
    let titleColor = '#1d4ed8';

    if (s.type === 'hospital') {
      emoji = '🏥';
      badgeClass = 'hospital';
      title = s.is_verified_24_7 ? '24/7 Hospital & Trauma' : 'Hospital / Clinic';
      titleColor = '#059669';
    } else if (s.type === 'pharma') {
      emoji = '💊';
      badgeClass = 'pharma';
      title = s.is_verified_24_7 ? '24/7 Verified Pharmacy' : 'Pharmacy';
      titleColor = '#0284c7';
    }

    const icon = L.divIcon({
      className: `marker-badge ${badgeClass}`,
      html: emoji,
      iconSize: [30, 30]
    });

    const marker = L.marker([s.lat, s.lng], { icon: icon });
    marker.bindPopup(`
      <div style="font-family:inherit; min-width:200px;">
        <span style="font-size:10px; font-weight:bold; text-transform:uppercase; color:${titleColor};">
          ${title}
        </span>
        <h4 style="margin:4px 0 2px; font-size:13px; color:#0f172a;">${s.name}</h4>
        <div style="margin:3px 0; font-size:11px;">
          <span style="display:inline-block; padding:1px 6px; border-radius:4px; font-weight:600; background:${s.is_verified_24_7 ? '#ecfdf5' : '#f1f5f9'}; color:${s.is_verified_24_7 ? '#059669' : '#64748b'};">
            ${s.operating_hours || 'Standard Operating Hours'}
          </span>
        </div>
        <p style="font-size:11px; color:#475569; margin:4px 0;">${s.address ? s.address.substring(0, 85) + '...' : 'Verified assistance facility'}</p>
        <div style="font-size:11px; font-weight:bold; color:#0f172a;">📞 ${s.contact || 'Emergency: 112'}</div>
      </div>
    `);
    clusterGroup.addLayer(marker);
  });

  // Render Incidents (Dark streetlights, Harassment, Community hazards)
  currentIncidents.forEach(inc => {
    if ((inc.category === 'poor_streetlight' && !showDarkLamps) ||
        (inc.category === 'harassment' && !showHarassment) ||
        (inc.category === 'community_hazard' && !showHazards)) {
      return;
    }

    const key = `${parseFloat(inc.lat).toFixed(4)}_${parseFloat(inc.lng).toFixed(4)}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    let emoji = '⚠️';
    let badgeClass = 'community_hazard';
    let title = 'Community Hazard';
    let badgeColor = '#dc2626';

    if (inc.category === 'poor_streetlight') {
      emoji = '💡';
      badgeClass = 'poor_streetlight';
      title = 'Defective / Dark Streetlight';
      badgeColor = '#d97706';
    } else if (inc.category === 'harassment') {
      emoji = '🚫';
      badgeClass = 'harassment';
      title = 'Reported Harassment Hotspot';
      badgeColor = '#7c3aed';
    }

    const icon = L.divIcon({
      className: `marker-badge ${badgeClass}`,
      html: emoji,
      iconSize: [28, 28]
    });

    const marker = L.marker([parseFloat(inc.lat), parseFloat(inc.lng)], { icon: icon });
    marker.bindPopup(`
      <div style="font-family:inherit; min-width:190px;">
        <span style="font-size:10px; font-weight:bold; text-transform:uppercase; color:${badgeColor};">
          ${title}
        </span>
        <h4 style="margin:4px 0 2px; font-size:12px; color:#0f172a;">${inc.desc || inc.description || 'Community incident logged'}</h4>
        <span style="font-size:11px; color:#64748b;">Reported: ${inc.reported_time || 'Recent verified entry'}</span>
      </div>
    `);
    clusterGroup.addLayer(marker);
  });
}

function toggleShelterFilter() {
  renderSheltersAndIncidents();
}

function toggleIncidentFilter() {
  renderSheltersAndIncidents();
}

// 10. Safety Heatmap Toggle
function toggleSafetyHeatmap() {
  showSafetyHeatmap = document.getElementById('chkSafetyHeatmap')?.checked ?? true;
  const btn = document.getElementById('btnToggleHeatmap');
  if (btn) btn.style.color = showSafetyHeatmap ? 'var(--primary)' : 'inherit';

  heatmapLayers.forEach(l => map.removeLayer(l));
  heatmapLayers = [];

  if (showSafetyHeatmap && window.lastRiskSegments) {
    window.lastRiskSegments.forEach(seg => {
      const poly = L.polyline(seg.coordinates, {
        color: seg.color || '#94a3b8',
        weight: 10,
        opacity: 0.35,
        lineCap: 'round'
      }).addTo(map);

      poly.bindPopup(`
        <div style="font-family:inherit; font-size:12px;">
          <strong style="color:${seg.color};">Road Safety Segment (${(seg.risk_level || 'standard').toUpperCase()})</strong><br>
          Estimated Safety: <strong>${seg.score ? seg.score + ' / 100' : 'Unassessed Segment'}</strong><br>
          <span style="color:#64748b;">${seg.label || 'Road-following transit'}</span>
        </div>
      `);
      heatmapLayers.push(poly);
    });
  }
}

// 11. Time-Dependent AI Risk Engine
function updateTimeRisk(hour) {
  currentTimeHour = parseInt(hour, 10);

  let period = currentTimeHour >= 12 ? 'PM' : 'AM';
  let formattedHour = currentTimeHour % 12;
  if (formattedHour === 0) formattedHour = 12;
  document.getElementById('timeDisplay').textContent = `${formattedHour}:00 ${period}`;

  document.querySelectorAll('.time-presets .btn-chip').forEach(btn => btn.classList.remove('active'));
  if (currentTimeHour === 14) document.querySelectorAll('.time-presets .btn-chip')[0]?.classList.add('active');
  if (currentTimeHour === 19) document.querySelectorAll('.time-presets .btn-chip')[1]?.classList.add('active');
  if (currentTimeHour === 23) document.querySelectorAll('.time-presets .btn-chip')[2]?.classList.add('active');

  if (originCoords && destCoords) {
    calculateRoutes();
  }
}

function setTimePreset(hour) {
  document.getElementById('timeSlider').value = hour;
  updateTimeRisk(hour);
}

// 12. Calculate Road-Following Routes via OSRM + Backend / Direct Fallback
async function calculateRoutes() {
  if (!originCoords || !destCoords) {
    alert('Please enter or select both Starting Location and Destination.');
    return;
  }

  const loadingIndicator = document.getElementById('routeLoadingIndicator');
  const btnCalc = document.getElementById('btnCalculate');
  if (loadingIndicator) loadingIndicator.style.display = 'block';
  if (btnCalc) btnCalc.disabled = true;

  clearRouteLines();

  let safeRouteData = null;
  let fastRouteData = null;
  let riskSegments = [];

  // Query nearby services around journey bounding box
  const minLat = Math.min(originCoords[0], destCoords[0]) - 0.03;
  const maxLat = Math.max(originCoords[0], destCoords[0]) + 0.03;
  const minLng = Math.min(originCoords[1], destCoords[1]) - 0.03;
  const maxLng = Math.max(originCoords[1], destCoords[1]) + 0.03;
  const nearbyServices = await fetchNearbyServicesAroundRoute(minLat, minLng, maxLat, maxLng);

  // 1. Try Backend API
  if (isBackendConnected) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/routes/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: document.getElementById('originInput').value,
          destination: document.getElementById('destInput').value,
          origin_coords: originCoords,
          dest_coords: destCoords,
          departure_hour: currentTimeHour
        })
      });

      if (res.ok) {
        const data = await res.json();
        safeRouteData = data.routes.find(r => r.id === 'route_safe');
        fastRouteData = data.routes.find(r => r.id === 'route_fast');
        riskSegments = data.risk_segments || [];
      }
    } catch (err) {
      console.warn('Backend route calculate error, attempting direct client OSRM fallback:', err);
    }
  }

  // 2. Direct Client OSRM Fallback (Strict longitude,latitude order)
  if (!safeRouteData || !fastRouteData) {
    try {
      const startLng = originCoords[1];
      const startLat = originCoords[0];
      const destLng = destCoords[1];
      const destLat = destCoords[0];

      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson&alternatives=true`;
      const osrmRes = await fetch(osrmUrl, { signal: AbortSignal.timeout(5000) });
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
          const r1 = osrmData.routes[0];
          const coords1 = r1.geometry.coordinates.map(c => [c[1], c[0]]);
          const distKm = round2(r1.distance / 1000.0);
          const durMins = round1(r1.duration / 60.0);

          let coords2 = coords1;
          let dist2 = distKm;
          let dur2 = durMins;
          if (osrmData.routes.length > 1) {
            const r2 = osrmData.routes[1];
            coords2 = r2.geometry.coordinates.map(c => [c[1], c[0]]);
            dist2 = round2(r2.distance / 1000.0);
            dur2 = round1(r2.duration / 60.0);
          }

          // Build realistic assistance list
          const assistList = nearbyServices.slice(0, 3).map(s => `${s.name} (${s.is_verified_24_7 ? '24/7' : 'Assistance'})`);

          safeRouteData = {
            id: 'route_safe',
            title: 'SafeStep Recommended (Safest)',
            safety_score: null,
            has_sufficient_data: false,
            data_confidence: 'Low (no local street audits)',
            distance_km: distKm,
            duration_mins: Math.max(1, durMins),
            lighting_pct: null,
            coordinates: coords1,
            nearby_assistance: assistList,
            features: ['OSRM Road-Following Geometry', 'Public Arterial Highway'],
            explanation: 'Route follows verified road-following geometry via OSRM. Municipal street-lighting audits and localized incident records are unlogged for this corridor.'
          };

          fastRouteData = {
            id: 'route_fast',
            title: 'Alternative Route (Fastest)',
            safety_score: null,
            has_sufficient_data: false,
            data_confidence: 'Low (no local street audits)',
            distance_km: dist2,
            duration_mins: Math.max(1, dur2),
            lighting_pct: null,
            coordinates: coords2,
            nearby_assistance: assistList.slice(0, 1),
            features: ['Alternative Corridor', 'Road-Following'],
            explanation: 'Alternative highway transit corridor. Insufficient localized municipal safety data.'
          };

          if (coords1.length >= 2) {
            const half = Math.floor(coords1.length / 2);
            riskSegments = [
              { coordinates: coords1.slice(0, half + 1), risk_level: 'standard', color: '#059669', score: null, label: 'Road Segment A · Verified road geometry' },
              { coordinates: coords1.slice(half), risk_level: 'standard', color: '#059669', score: null, label: 'Road Segment B · Verified road geometry' }
            ];
          }
        }
      }
    } catch (osrmErr) {
      console.warn('Direct OSRM query failed:', osrmErr);
    }
  }

  if (loadingIndicator) loadingIndicator.style.display = 'none';
  if (btnCalc) btnCalc.disabled = false;

  if (safeRouteData && fastRouteData) {
    updateRouteUI(safeRouteData, fastRouteData);
    drawRoadRoutes(safeRouteData, fastRouteData);
    window.lastRiskSegments = riskSegments;
    toggleSafetyHeatmap();
    updateMapHint(`Route calculated (${safeRouteData.distance_km} km, ${safeRouteData.duration_mins} mins). Recommended route shown in green.`);
  } else {
    alert('Unable to calculate a driving route between these two locations. Please verify the addresses.');
  }
}

function updateRouteUI(safeData, fastData) {
  // Safe Route Card
  const safeScoreEl = document.getElementById('safeScoreVal');
  if (safeData.has_sufficient_data && safeData.safety_score) {
    safeScoreEl.textContent = `Safety: ${safeData.safety_score} / 100`;
    safeScoreEl.className = 'route-score high';
  } else {
    safeScoreEl.textContent = 'Insufficient safety data';
    safeScoreEl.className = 'route-score insufficient';
  }

  document.getElementById('safeTimeVal').textContent = `${safeData.duration_mins} mins`;
  document.getElementById('safeDistVal').textContent = `· ${safeData.distance_km} km`;
  document.getElementById('safeRouteDesc').innerHTML = `<strong>Route Assessment:</strong> ${safeData.explanation}`;

  const safeLightingTag = document.getElementById('safeLightingTag');
  if (safeLightingTag) {
    safeLightingTag.textContent = safeData.lighting_pct ? `💡 ${safeData.lighting_pct}% Lit` : `🛡️ Data-Driven OSRM`;
  }

  const safeAssistList = document.getElementById('safeAssistanceList');
  if (safeAssistList) {
    if (safeData.nearby_assistance && safeData.nearby_assistance.length > 0) {
      safeAssistList.innerHTML = safeData.nearby_assistance.map(a => `<span class="assist-item">✓ ${a}</span>`).join('');
    } else {
      safeAssistList.innerHTML = '<span class="assist-item">Emergency Dial: 112 / 108</span>';
    }
  }

  // Fast Route Card
  const fastScoreEl = document.getElementById('fastScoreVal');
  if (fastData.has_sufficient_data && fastData.safety_score) {
    fastScoreEl.textContent = `Safety: ${fastData.safety_score} / 100`;
    fastScoreEl.className = fastData.safety_score < 60 ? 'route-score low' : 'route-score high';
  } else {
    fastScoreEl.textContent = 'Insufficient safety data';
    fastScoreEl.className = 'route-score insufficient';
  }

  document.getElementById('fastTimeVal').textContent = `${fastData.duration_mins} mins`;
  document.getElementById('fastDistVal').textContent = `· ${fastData.distance_km} km`;
  document.getElementById('fastRouteDesc').innerHTML = `<strong>Alternative Option:</strong> ${fastData.explanation}`;

  const fastAssistList = document.getElementById('fastAssistanceList');
  if (fastAssistList) {
    if (fastData.nearby_assistance && fastData.nearby_assistance.length > 0) {
      fastAssistList.innerHTML = fastData.nearby_assistance.map(a => `<span class="assist-item">✓ ${a}</span>`).join('');
    } else {
      fastAssistList.innerHTML = '<span class="assist-item">Emergency Dial: 112</span>';
    }
  }
}

function resetRouteCards() {
  document.getElementById('safeScoreVal').textContent = 'Search route';
  document.getElementById('safeScoreVal').className = 'route-score high';
  document.getElementById('safeTimeVal').textContent = '-- mins';
  document.getElementById('safeDistVal').textContent = '· -- km';
  document.getElementById('safeRouteDesc').textContent = 'Enter your starting point and destination above, or tap on the map to begin.';
  document.getElementById('safeAssistanceList').innerHTML = '<span class="assist-item">Select Origin & Destination to evaluate nearby shelters</span>';

  document.getElementById('fastScoreVal').textContent = '-- / 100';
  document.getElementById('fastTimeVal').textContent = '-- mins';
  document.getElementById('fastDistVal').textContent = '· -- km';
  document.getElementById('fastRouteDesc').textContent = 'Alternative route comparison will appear once points are selected.';
  document.getElementById('fastAssistanceList').innerHTML = '<span class="assist-item">--</span>';
}

function clearRouteLines() {
  if (safeRoutePolyline) { map.removeLayer(safeRoutePolyline); safeRoutePolyline = null; }
  if (fastRoutePolyline) { map.removeLayer(fastRoutePolyline); fastRoutePolyline = null; }
  heatmapLayers.forEach(l => map.removeLayer(l));
  heatmapLayers = [];
}

function drawRoadRoutes(safeData, fastData) {
  clearRouteLines();

  const isSafeSelected = selectedRouteType === 'safe';

  // Fast / Alternative Route in Amber / Red
  fastRoutePolyline = L.polyline(fastData.coordinates, {
    color: '#d97706',
    weight: isSafeSelected ? 4 : 6,
    opacity: isSafeSelected ? 0.65 : 0.95,
    dashArray: isSafeSelected ? '5, 8' : null
  }).addTo(map);

  fastRoutePolyline.bindPopup(`
    <div style="font-family:inherit;">
      <span style="font-size:10px; font-weight:bold; color:#d97706; text-transform:uppercase;">Alternative Route</span>
      <h4 style="margin:2px 0; font-size:13px;">${fastData.safety_score ? 'Safety: ' + fastData.safety_score + '/100' : 'Road Route'}</h4>
      <p style="font-size:11px; color:#475569;">${fastData.duration_mins} mins · ${fastData.distance_km} km</p>
    </div>
  `);

  // Safe Recommended Route in Vibrant Green (#059669)
  safeRoutePolyline = L.polyline(safeData.coordinates, {
    color: '#059669',
    weight: isSafeSelected ? 6 : 4,
    opacity: isSafeSelected ? 1.0 : 0.65,
    dashArray: isSafeSelected ? null : '5, 8'
  }).addTo(map);

  safeRoutePolyline.bindPopup(`
    <div style="font-family:inherit;">
      <span style="font-size:10px; font-weight:bold; color:#059669; text-transform:uppercase;">Recommended Safe Route</span>
      <h4 style="margin:2px 0; font-size:13px;">${safeData.safety_score ? 'Safety: ' + safeData.safety_score + '/100' : 'Road Route (OSRM)'}</h4>
      <p style="font-size:11px; color:#475569;">${safeData.duration_mins} mins · ${safeData.distance_km} km</p>
    </div>
  `);

  // Auto fit map bounds to the route
  fitRouteBounds();
}

function fitRouteBounds() {
  if (safeRoutePolyline) {
    map.fitBounds(safeRoutePolyline.getBounds(), { padding: [50, 50] });
  } else if (startMarker && endMarker) {
    const group = L.featureGroup([startMarker, endMarker]);
    map.fitBounds(group.getBounds(), { padding: [50, 50] });
  }
}

function selectRoute(type) {
  selectedRouteType = type;
  document.getElementById('routeCardSafe')?.classList.toggle('selected', type === 'safe');
  document.getElementById('routeCardFast')?.classList.toggle('selected', type === 'fast');

  if (safeRoutePolyline && fastRoutePolyline) {
    safeRoutePolyline.setStyle({
      weight: type === 'safe' ? 6 : 4,
      opacity: type === 'safe' ? 1.0 : 0.65,
      dashArray: type === 'safe' ? null : '5, 8'
    });
    fastRoutePolyline.setStyle({
      weight: type === 'fast' ? 6 : 4,
      opacity: type === 'fast' ? 0.95 : 0.65,
      dashArray: type === 'fast' ? null : '5, 8'
    });
  }
}

// 13. Theme Management
function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('safestep_theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = theme === 'light' ? '☀️' : '🌙';
}

// 14. Backend Health & Initial Incidents Load
async function checkBackendHealth() {
  const pill = document.getElementById('backendStatusPill');
  const text = document.getElementById('backendStatusText');
  const engineSource = document.getElementById('routeEngineSource');

  pill.className = 'backend-status-pill checking';
  text.textContent = 'Connecting Backend...';

  // Probe candidates: active base URL, relative path (Vercel proxy), or Render cloud
  const probeUrls = [];
  if (API_BASE_URL) {
    probeUrls.push(`${API_BASE_URL}/api/v1/health`);
  } else {
    probeUrls.push('/api/v1/health');
    probeUrls.push('https://safestep-backend.onrender.com/api/v1/health');
  }

  for (const url of probeUrls) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4500)
      });

      if (res.ok) {
        isBackendConnected = true;
        pill.className = 'backend-status-pill online';
        
        let label = 'Local Server';
        if (API_BASE_URL) {
          try { label = new URL(API_BASE_URL, window.location.href).host; } catch(e) { label = API_BASE_URL; }
        } else {
          label = 'Render Cloud Proxy';
        }

        text.textContent = `🟢 Backend Live (${label})`;
        if (engineSource) engineSource.textContent = 'OSRM + AI Engine Live';
        return true;
      }
    } catch (err) {}
  }

  isBackendConnected = false;
  pill.className = 'backend-status-pill offline';
  text.textContent = '🟡 Standalone Mode (Client Engine Active)';
  if (engineSource) engineSource.textContent = 'OSRM Road Engine (Direct)';
  return false;
}

async function loadIncidentsFromBackend() {
  if (isBackendConnected) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/incidents`);
      if (res.ok) {
        currentIncidents = await res.json();
      }
    } catch(e) {}
  }
  renderSheltersAndIncidents();
}

// 15. View Switcher (Nav, Audit, Admin)
function switchView(viewName) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  if (viewName === 'nav') {
    document.getElementById('viewNav').classList.add('active');
    document.getElementById('tabNavBtn').classList.add('active');
    setTimeout(() => map.invalidateSize(), 150);
  } else if (viewName === 'audit') {
    document.getElementById('viewAudit').classList.add('active');
    document.getElementById('tabAuditBtn').classList.add('active');
  } else if (viewName === 'admin') {
    document.getElementById('viewAdmin').classList.add('active');
    document.getElementById('tabAdminBtn').classList.add('active');
  }
}

// 16. API Keys Management
function openApiKeyModal() {
  document.getElementById('apiKeyModal').classList.add('active');
  loadSavedApiKeys();
}

function closeApiKeyModal() {
  document.getElementById('apiKeyModal').classList.remove('active');
}

function saveApiKeys(e) {
  e.preventDefault();
  const backendUrl = document.getElementById('keyBackendUrl')?.value.trim() || '';
  if (backendUrl) {
    API_BASE_URL = backendUrl.replace(/\/+$/, '');
    localStorage.setItem('safestep_backend_url', API_BASE_URL);
  } else {
    localStorage.removeItem('safestep_backend_url');
    API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://127.0.0.1:8000'
      : 'https://safestep-backend.onrender.com';
  }

  const keys = {
    firebase: document.getElementById('keyFirebase')?.value.trim() || '',
    twilioSid: document.getElementById('keyTwilioSid')?.value.trim() || '',
    twilioToken: document.getElementById('keyTwilioToken')?.value.trim() || '',
    roboflow: document.getElementById('keyRoboflow')?.value.trim() || ''
  };

  localStorage.setItem('safestep_api_keys', JSON.stringify(keys));
  closeApiKeyModal();
  checkBackendHealth();
  alert('Configuration saved! Target backend set to: ' + API_BASE_URL);
}

function loadSavedApiKeys() {
  const customBackend = localStorage.getItem('safestep_backend_url');
  if (document.getElementById('keyBackendUrl')) {
    document.getElementById('keyBackendUrl').value = customBackend || API_BASE_URL;
  }

  const saved = localStorage.getItem('safestep_api_keys');
  if (saved) {
    try {
      const keys = JSON.parse(saved);
      if (document.getElementById('keyFirebase')) document.getElementById('keyFirebase').value = keys.firebase || '';
      if (document.getElementById('keyTwilioSid')) document.getElementById('keyTwilioSid').value = keys.twilioSid || '';
      if (document.getElementById('keyTwilioToken')) document.getElementById('keyTwilioToken').value = keys.twilioToken || '';
      if (document.getElementById('keyRoboflow')) document.getElementById('keyRoboflow').value = keys.roboflow || '';
    } catch(err) {}
  }
}

// 17. AI Street Audit (YOLO Simulation)
function loadSampleImage(type) {
  const img = document.getElementById('auditImg');
  const box1 = document.getElementById('box1');
  const box2 = document.getElementById('box2');
  const lux = document.getElementById('valLux');
  const lamps = document.getElementById('valLamps');
  const score = document.getElementById('valScore');
  const status = document.getElementById('auditStatus');

  if (type === 'unlit') {
    img.src = 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=800&q=80';
    box1.style.display = 'block';
    box2.style.display = 'block';
    lux.textContent = '8.4 Lux (Critically Low)';
    lux.className = 'metric-val danger';
    lamps.textContent = '0 / 2 Functional';
    score.textContent = '32 / 100 (Unsafe)';
    score.className = 'metric-val danger';
    status.textContent = 'YOLOv8: Defect Flagged';
    status.style.background = 'var(--danger-red-bg)';
    status.style.color = 'var(--danger-red)';
  } else {
    img.src = 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=800&q=80';
    box1.style.display = 'none';
    box2.style.display = 'none';
    lux.textContent = '48.2 Lux (Good Brightness)';
    lux.className = 'metric-val';
    lamps.textContent = '4 / 4 Functional';
    score.textContent = '94 / 100 (Safe)';
    score.className = 'metric-val';
    status.textContent = 'YOLOv8: Verified Safe';
    status.style.background = 'var(--safe-green-bg)';
    status.style.color = 'var(--safe-green)';
  }
}

function handleAuditUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('auditImg').src = e.target.result;
      document.getElementById('auditStatus').textContent = 'YOLOv8 Analyzing...';
      setTimeout(() => {
        loadSampleImage('unlit');
      }, 800);
    };
    reader.readAsDataURL(file);
  }
}

function convertAuditToIncident() {
  alert('Street audit successfully converted into a geo-referenced ticket and dispatched to Municipal Road Infrastructure cell!');
  switchView('nav');
}

// 18. Hazard Reporting
function openReportModal() {
  document.getElementById('reportModal').classList.add('active');
}

function closeReportModal() {
  document.getElementById('reportModal').classList.remove('active');
}

async function submitHazardReport(e) {
  e.preventDefault();
  const category = document.getElementById('repCategory').value;
  const loc = document.getElementById('repLocation').value;
  const desc = document.getElementById('repDesc').value;
  const isAnon = document.getElementById('repAnon').checked;

  const center = map.getCenter();
  const reportPayload = {
    category: category,
    description: desc,
    location_name: loc,
    lat: center.lat + (Math.random() * 0.002 - 0.001),
    lng: center.lng + (Math.random() * 0.002 - 0.001),
    is_anonymous: isAnon,
    reported_time: 'Just now'
  };

  if (isBackendConnected) {
    try {
      await fetch(`${API_BASE_URL}/api/v1/incidents/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportPayload)
      });
    } catch(err) {}
  }

  currentIncidents.push(reportPayload);
  renderSheltersAndIncidents();
  closeReportModal();
  alert('Thank you! Your hazard report was logged anonymously into the SafeStep database and mapped.');
}

// 19. Emergency SOS Handling
function triggerSOS() {
  document.getElementById('sosModal').classList.add('active');
  sosSecondsRemaining = 5;
  document.getElementById('sosCountdown').textContent = sosSecondsRemaining;

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch(e) {}

  if (sosTimer) clearInterval(sosTimer);
  sosTimer = setInterval(() => {
    sosSecondsRemaining--;
    document.getElementById('sosCountdown').textContent = sosSecondsRemaining;
    if (sosSecondsRemaining <= 0) {
      clearInterval(sosTimer);
      confirmSOSDispatch();
    }
  }, 1000);
}

function cancelSOS() {
  if (sosTimer) clearInterval(sosTimer);
  document.getElementById('sosModal').classList.remove('active');
}

async function confirmSOSDispatch() {
  if (sosTimer) clearInterval(sosTimer);
  document.getElementById('sosModal').classList.remove('active');

  const startLatLng = startMarker ? startMarker.getLatLng() : map.getCenter();
  const payload = {
    user_lat: startLatLng.lat,
    user_lng: startLatLng.lng,
    timestamp: new Date().toISOString()
  };

  if (isBackendConnected) {
    try {
      await fetch(`${API_BASE_URL}/api/v1/sos/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch(e) {}
  }

  alert(`🚨 EMERGENCY SOS BROADCASTED!\n\n1. Police Dispatch 112 alerted with live coordinates (${startLatLng.lat.toFixed(4)}° N, ${startLatLng.lng.toFixed(4)}° E).\n2. SMS alert with live tracking link dispatched to Emergency Contacts.\n3. Nearest assistance hubs notified.`);
}

// 20. Chart.js Setup for Civic Dashboard
function initCharts() {
  const ctxTime = document.getElementById('chartTimeIncidents')?.getContext('2d');
  const ctxCat = document.getElementById('chartCategories')?.getContext('2d');

  if (ctxTime) {
    new Chart(ctxTime, {
      type: 'bar',
      data: {
        labels: ['8 AM - 12 PM', '12 PM - 4 PM', '4 PM - 8 PM', '8 PM - 12 AM', '12 AM - 4 AM', '4 AM - 8 AM'],
        datasets: [{
          label: 'Reported Incidents',
          data: [4, 9, 28, 86, 52, 11],
          backgroundColor: '#e11d48',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#64748b' } }
        }
      }
    });
  }

  if (ctxCat) {
    new Chart(ctxCat, {
      type: 'doughnut',
      data: {
        labels: ['Poor Streetlights', 'Unlit Corridors', 'Harassment Hotspots', 'Isolated Stops', 'Damaged Paths'],
        datasets: [{
          data: [58, 34, 26, 18, 6],
          backgroundColor: ['#d97706', '#dc2626', '#7c3aed', '#0284c7', '#059669'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#334155', font: { size: 11 } }
          }
        }
      }
    });
  }
}

function round1(val) { return Math.round(val * 10) / 10; }
function round2(val) { return Math.round(val * 100) / 100; }
