// ══════════════════════════════════════════
// IMPORTS
// ══════════════════════════════════════════
import { auth, db } from './firebase-config.js';
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    doc,
    getDoc,
    collection,
    addDoc,
    serverTimestamp,
    query,
    where,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const uploadTrigger = document.getElementById('upload-trigger');
const imageInput    = document.getElementById('report-image-input');
const uploadStatus  = document.getElementById('upload-status');
const submitBtn     = document.getElementById('btn-submit-report');

let base64Image             = "";
let currentUserArea         = "";
let _modalListenersAttached = false;

// Live tracker state
let trackerMap       = null;
let trackerMarker    = null;
let truckUnsubscribe = null;

// Expanded map state
let expandedMap     = null;
let expandedMarker  = null;

// Default center: Daet, Camarines Norte
const DEFAULT_LAT = 14.1126;
const DEFAULT_LNG = 122.9553;

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
function showToast(type, title, subtitle = '') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:none;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:12px 18px;font-size:14px;pointer-events:auto;opacity:0;transform:translateY(16px) scale(0.97);transition:opacity 0.25s ease,transform 0.25s ease;min-width:220px;max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,0.08);';
    const isSuccess = type === 'success';
    const iconColor = isSuccess ? '#2ecc71' : '#e74c3c';
    const iconBg    = isSuccess ? '#eafaf1' : '#fdf0f0';
    const iconPath  = isSuccess
        ? `<path d="M3 8l3.5 3.5L13 4.5" stroke="${iconColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M4 4l8 8M12 4l-8 8" stroke="${iconColor}" stroke-width="1.8" stroke-linecap="round"/>`;
    toast.innerHTML = `
        <div style="width:28px;height:28px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">${iconPath}</svg>
        </div>
        <div style="flex:1;">
            <p style="margin:0 0 2px;font-weight:600;font-size:14px;color:#1a1a1a;">${title}</p>
            ${subtitle ? `<p style="margin:0;font-size:12px;color:#888;">${subtitle}</p>` : ''}
        </div>
        <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:18px;padding:2px;line-height:1;">&times;</button>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0) scale(1)';
    }));
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px) scale(0.97)';
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

// ══════════════════════════════════════════
// LEAFLET LOADER
// ══════════════════════════════════════════
function ensureLeaflet(callback) {
    if (typeof L !== 'undefined') { callback(); return; }
    if (!document.getElementById('leaflet-tracker-css')) {
        const css = document.createElement('link');
        css.id   = 'leaflet-tracker-css';
        css.rel  = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
    }
    if (!document.getElementById('leaflet-tracker-js')) {
        const js   = document.createElement('script');
        js.id      = 'leaflet-tracker-js';
        js.src     = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        js.onload  = callback;
        document.head.appendChild(js);
    } else {
        const wait = setInterval(() => {
            if (typeof L !== 'undefined') { clearInterval(wait); callback(); }
        }, 100);
    }
}

// ══════════════════════════════════════════
// REVERSE GEOCODE — lat/lng → place name
// ══════════════════════════════════════════
const _geocodeCache = {};

async function reverseGeocode(lat, lng) {
    const key = `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
    if (_geocodeCache[key]) return _geocodeCache[key];

    try {
        const res  = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`,
            { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        const a = data.address || {};
        const place =
            a.amenity || a.tourism || a.shop || a.building || a.leisure || null;
        const road   = a.road || a.pedestrian || a.path || null;
        const suburb = a.suburb || a.village || a.neighbourhood || a.quarter || null;
        const city   = a.city || a.town || a.municipality || null;

        let label;
        if (place && road)        label = `${place}, ${road}`;
        else if (place)           label = suburb ? `${place}, ${suburb}` : place;
        else if (road && suburb)  label = `${road}, ${suburb}`;
        else if (road && city)    label = `${road}, ${city}`;
        else if (road)            label = road;
        else                      label = (data.display_name || '').split(',').slice(0, 2).join(',').trim();

        _geocodeCache[key] = label || 'Unknown Location';
        return _geocodeCache[key];
    } catch {
        return 'Location unavailable';
    }
}

// ══════════════════════════════════════════
// UPDATE TRACKER INFO CHIPS
//
// Data sources:
//   truckDoc  — from trucks collection (GPS, assignedWorkerName, status)
//   schedule  — from schedules collection (truck ID, route, status)
//   lat / lng — from truckDoc.lastLocation (the live GPS)
// ══════════════════════════════════════════
async function updateTrackerChips(truckDoc, schedule, lat, lng) {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = (val !== null && val !== undefined && val !== '') ? val : '—';
    };

    // Truck ID — from schedule.truck (e.g. "TRK-001")
    set('tinfo-truck-id', schedule?.truck || '—');

    // Status — from schedule.status (source of truth for resident view)
    const rawStatus = (schedule?.status || '').toUpperCase();
    set('tinfo-status', rawStatus || '—');

    // Worker name — trucks.assignedWorkerName (already stored there)
    set('tinfo-worker', truckDoc?.assignedWorkerName || '—');

    // Location — reverse geocode trucks.lastLocation
    if (lat != null && lng != null && lat !== DEFAULT_LAT) {
        set('tinfo-location', 'Locating...');
        const placeName = await reverseGeocode(lat, lng);
        set('tinfo-location', placeName);
    } else {
        set('tinfo-location', 'No GPS Data');
    }

    // Last GPS update — trucks.lastLocation.updatedAt
    const lastLoc = truckDoc?.lastLocation || {};
    if (lastLoc.updatedAt) {
        try {
            const d = new Date(lastLoc.updatedAt);
            set('tinfo-gps', isNaN(d.getTime())
                ? lastLoc.updatedAt
                : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
            );
        } catch { set('tinfo-gps', '—'); }
    } else {
        set('tinfo-gps', '—');
    }
}

// ══════════════════════════════════════════
// EXPANDED MAP MODAL
// ══════════════════════════════════════════
function openExpandedMap(lat, lng) {
    if (!document.getElementById('tracker-map-modal')) {
        const el = document.createElement('div');
        el.id = 'tracker-map-modal';
        el.innerHTML = `
            <div id="tracker-map-modal-inner">
                <div id="tracker-map-expanded"></div>
                <button id="tracker-map-modal-close" title="Close">&times;</button>
                <div id="tracker-map-modal-label">Live Truck Location</div>
            </div>`;
        document.body.appendChild(el);
        document.getElementById('tracker-map-modal-close').addEventListener('click', () => el.classList.remove('active'));
        el.addEventListener('click', e => { if (e.target === el) el.classList.remove('active'); });
    }

    const modal = document.getElementById('tracker-map-modal');
    modal.classList.add('active');

    setTimeout(() => {
        if (!expandedMap) {
            expandedMap = L.map('tracker-map-expanded', {
                zoomControl: true,
                attributionControl: false
            }).setView([lat, lng], 16);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(expandedMap);

            const truckIcon = L.divIcon({
                className: '',
                html: `
                    <div style="position:relative;width:38px;height:38px;">
                        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(165,214,167,0.5);animation:trackerPulse 1.8s ease-out infinite;"></div>
                        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                                    width:24px;height:24px;background:#2E7D32;border:3px solid white;
                                    border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);
                                    display:flex;align-items:center;justify-content:center;">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
                                <path d="M1 3h15l3 6h4v7h-2a3 3 0 01-6 0H8a3 3 0 01-6 0H1V3z"/>
                            </svg>
                        </div>
                    </div>`,
                iconSize: [38, 38],
                iconAnchor: [19, 19]
            });

            expandedMarker = L.marker([lat, lng], { icon: truckIcon }).addTo(expandedMap);
        } else {
            expandedMap.setView([lat, lng], 16);
            expandedMarker.setLatLng([lat, lng]);
            expandedMap.invalidateSize();
        }
    }, 120);
}

// ══════════════════════════════════════════
// INIT TRACKER MAP (small card)
// ══════════════════════════════════════════
function initTrackerMap(lat, lng) {
    const container = document.getElementById('tracker-live-map');
    if (!container) return;

    if (!document.getElementById('tracker-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'tracker-pulse-style';
        s.textContent = `
            @keyframes trackerPulse {
                0%   { transform: scale(1); opacity: 0.7; }
                100% { transform: scale(3); opacity: 0; }
            }
            #tracker-live-map { border-radius: 18px; overflow: hidden; cursor: pointer; }
            #tracker-live-map .leaflet-tile-pane { filter: saturate(0.6) brightness(0.95); }
        `;
        document.head.appendChild(s);
    }

    if (trackerMap && trackerMarker) {
        trackerMarker.setLatLng([lat, lng]);
        trackerMap.panTo([lat, lng]);
        return;
    }

    trackerMap = L.map('tracker-live-map', {
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, touchZoom: false
    }).setView([lat, lng], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackerMap);

    const truckIcon = L.divIcon({
        className: '',
        html: `
            <div style="position:relative;width:38px;height:38px;">
                <div style="position:absolute;inset:0;border-radius:50%;background:rgba(165,214,167,0.5);animation:trackerPulse 1.8s ease-out infinite;"></div>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                            width:24px;height:24px;background:#2E7D32;border:3px solid white;
                            border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);
                            display:flex;align-items:center;justify-content:center;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
                        <path d="M1 3h15l3 6h4v7h-2a3 3 0 01-6 0H8a3 3 0 01-6 0H1V3z"/>
                    </svg>
                </div>
            </div>`,
        iconSize: [38, 38], iconAnchor: [19, 19]
    });

    trackerMarker = L.marker([lat, lng], { icon: truckIcon }).addTo(trackerMap);

    container.addEventListener('click', () => {
        ensureLeaflet(() => {
            const pos = trackerMarker ? trackerMarker.getLatLng() : { lat, lng };
            openExpandedMap(pos.lat, pos.lng);
        });
    });

    window.addEventListener('ecomate:recenterMap', () => {
        if (trackerMap && trackerMarker) trackerMap.panTo(trackerMarker.getLatLng());
    });
}

// ══════════════════════════════════════════
// NO TRUCK STATE
// ══════════════════════════════════════════
function showNoTruckState() {
    const routeEl = document.getElementById('tracker-route-display');
    const badgeEl = document.getElementById('tracker-badge-display');
    if (routeEl) routeEl.innerText = 'Route: No schedule today';
    if (badgeEl) {
        badgeEl.innerText = '—';
        badgeEl.style.background = 'rgba(255,255,255,0.15)';
        badgeEl.style.color = 'rgba(255,255,255,0.6)';
    }
    updateTrackerChips(null, null, null, null);
    ensureLeaflet(() => initTrackerMap(DEFAULT_LAT, DEFAULT_LNG));
}

// ══════════════════════════════════════════
// START TRUCK TRACKING
//
// Correct data flow:
//   1. schedules  → find today's schedule matching user's area
//                   → get schedule.truck (e.g. "TRK-001") and schedule.status
//   2. trucks     → real-time onSnapshot filtered by truckId === schedule.truck
//                   → get GPS (lastLocation.lat/lng) + assignedWorkerName
//   3. users      → NOT used for the tracker at all
// ══════════════════════════════════════════
function startTruckTracking(userArea) {
    if (truckUnsubscribe) { truckUnsubscribe(); truckUnsubscribe = null; }

    const nowPH = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const today = `${nowPH.getFullYear()}-${String(nowPH.getMonth()+1).padStart(2,'0')}-${String(nowPH.getDate()).padStart(2,'0')}`;
    const normalizedArea = (userArea || '').trim().toLowerCase();

    getDocs(query(
        collection(db, "schedules"),
        where("date", "==", today)
    )).then(async (schedSnap) => {
        if (schedSnap.empty) { showNoTruckState(); return; }

        // ── Step 1: Find today's schedule matching the resident's area ──
        let matchedSchedule = null;
        schedSnap.forEach(d => {
            const s          = d.data();
            const schedRoute = (s.route || '').trim().toLowerCase();
            const isMatch    = schedRoute === normalizedArea
                            || schedRoute.includes(normalizedArea)
                            || normalizedArea.includes(schedRoute);
            if (isMatch && !matchedSchedule) matchedSchedule = s;
        });

        if (!matchedSchedule) { showNoTruckState(); return; }

        // ── Step 2: Update badge & route label ──
        const badgeEl = document.getElementById('tracker-badge-display');
        const routeEl = document.getElementById('tracker-route-display');
        if (routeEl) routeEl.innerText = `Route: ${matchedSchedule.route || '—'}`;

        const schedStatus = (matchedSchedule.status || '').toLowerCase();
        if (schedStatus === 'ongoing') {
            if (badgeEl) { badgeEl.innerText = 'LIVE'; badgeEl.style.background = ''; badgeEl.style.color = ''; }
        } else if (schedStatus === 'completed' || schedStatus === 'done') {
            if (badgeEl) { badgeEl.innerText = 'DONE'; badgeEl.style.background = 'rgba(255,255,255,0.2)'; badgeEl.style.color = 'white'; }
        } else {
            if (badgeEl) { badgeEl.innerText = 'UPCOMING'; badgeEl.style.background = 'rgba(255,255,255,0.2)'; badgeEl.style.color = 'white'; }
        }

        // ── Step 3: Real-time listener on TRUCKS collection ──
        // Match: trucks.truckId === schedule.truck  (e.g. "TRK-001")
        const assignedTruckId = (matchedSchedule.truck || '').trim().toUpperCase();

        truckUnsubscribe = onSnapshot(
            query(collection(db, "trucks"), where("truckId", "==", assignedTruckId)),
            (trucksSnap) => {
                if (trucksSnap.empty) {
                    console.warn('[Tracker] No truck document found for truckId:', assignedTruckId);
                    updateTrackerChips(null, matchedSchedule, null, null);
                    ensureLeaflet(() => initTrackerMap(DEFAULT_LAT, DEFAULT_LNG));
                    return;
                }

                // Use the first matching truck document
                const truckDoc = trucksSnap.docs[0].data();
                console.log('[Tracker] Truck doc found:', truckDoc);

                // GPS from trucks.lastLocation
                const lastLoc = truckDoc.lastLocation || {};
                const lat = (lastLoc.lat != null) ? lastLoc.lat : DEFAULT_LAT;
                const lng = (lastLoc.lng != null) ? lastLoc.lng : DEFAULT_LNG;

                // Update info chips (worker name comes from trucks.assignedWorkerName)
                updateTrackerChips(truckDoc, matchedSchedule, lat, lng);

                // Update expanded map if open
                if (expandedMarker && lat !== DEFAULT_LAT) {
                    expandedMarker.setLatLng([lat, lng]);
                    if (expandedMap) expandedMap.panTo([lat, lng]);
                }

                // Update small map
                ensureLeaflet(() => initTrackerMap(lat, lng));
            },
            (err) => {
                console.warn('[Tracker] Truck snapshot error:', err);
                updateTrackerChips(null, matchedSchedule, null, null);
                ensureLeaflet(() => initTrackerMap(DEFAULT_LAT, DEFAULT_LNG));
            }
        );

    }).catch(err => {
        console.warn('[Tracker] Schedule tracking error:', err);
        showNoTruckState();
    });
}

// ══════════════════════════════════════════
// SCHEDULE DAY POPUP (calendar click)
// ══════════════════════════════════════════
function showSchedulePopup(scheduleData, dateStr) {
    document.getElementById('schedule-day-popup')?.remove();
    const statusColors = {
        ongoing:   { bg: '#E8F5E9', color: '#2E7D32', label: 'Ongoing' },
        completed: { bg: '#E3F2FD', color: '#0277BD', label: 'Completed' },
        done:      { bg: '#E3F2FD', color: '#0277BD', label: 'Completed' },
        upcoming:  { bg: '#FFF8E1', color: '#F57F17', label: 'Upcoming' },
        managed:   { bg: '#F3E5F5', color: '#6A1B9A', label: 'Managed' },
    };
    const sc      = statusColors[(scheduleData.status || 'upcoming').toLowerCase()] || statusColors.upcoming;
    const [y, m, d] = dateStr.split('-');
    const niceDate  = new Date(Number(y), Number(m) - 1, Number(d))
        .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const popup = document.createElement('div');
    popup.id = 'schedule-day-popup';
    popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    popup.innerHTML = `
        <div style="background:white;border-radius:24px;padding:2rem;width:100%;max-width:380px;
                    box-shadow:0 20px 60px rgba(0,0,0,0.15);animation:popupIn 0.25s cubic-bezier(0.34,1.56,0.64,1);">
            <style>@keyframes popupIn{from{opacity:0;transform:scale(0.92) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}</style>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">
                <div>
                    <p style="font-size:0.7rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Collection Schedule</p>
                    <h3 style="font-size:1.1rem;font-weight:800;color:#1B5E20;margin:0;">${niceDate}</h3>
                </div>
                <button id="close-schedule-popup" style="background:#F5F5F5;border:none;border-radius:50%;width:32px;height:32px;font-size:1.1rem;cursor:pointer;">&times;</button>
            </div>
            <div style="background:#F9FBF9;border-radius:16px;padding:1rem 1.25rem;margin-bottom:1rem;">
                <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">Route / Area</p>
                <p style="font-size:1rem;font-weight:700;color:#1B5E20;margin:0;">📍 ${scheduleData.route || '—'}</p>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;">
                <div style="background:#F9FBF9;border-radius:16px;padding:1rem;">
                    <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">Start Time</p>
                    <p style="font-size:1rem;font-weight:700;color:#263238;margin:0;">🕗 ${scheduleData.startTime || '—'}</p>
                </div>
                <div style="background:#F9FBF9;border-radius:16px;padding:1rem;">
                    <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">End Time</p>
                    <p style="font-size:1rem;font-weight:700;color:#263238;margin:0;">🕚 ${scheduleData.endTime || '—'}</p>
                </div>
            </div>
            <div style="display:flex;gap:0.75rem;margin-bottom:1rem;">
                <div style="display:inline-flex;align-items:center;background:${sc.bg};border-radius:50px;padding:0.5rem 1rem;">
                    <span style="font-size:0.8rem;font-weight:800;color:${sc.color};">${sc.label}</span>
                </div>
            </div>
            ${scheduleData.truck
                ? `<div style="background:#F9FBF9;border-radius:16px;padding:1rem 1.25rem;margin-bottom:1rem;">
                       <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">Truck</p>
                       <p style="font-size:1rem;font-weight:700;color:#263238;margin:0;">🚛 ${scheduleData.truck}</p>
                   </div>` : ''}
            ${scheduleData.notes
                ? `<div style="background:#FFFDE7;border-radius:16px;padding:1rem 1.25rem;margin-bottom:1rem;">
                       <p style="font-size:0.65rem;font-weight:800;color:#F57F17;text-transform:uppercase;margin-bottom:4px;">Notes</p>
                       <p style="font-size:0.85rem;color:#5D4037;margin:0;">${scheduleData.notes}</p>
                   </div>` : ''}
            <button id="close-schedule-popup-btn"
                style="width:100%;background:#2E7D32;color:white;padding:1rem;border:none;
                       border-radius:50px;font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;">
                Got it!
            </button>
        </div>`;

    document.body.appendChild(popup);
    const close = () => popup.remove();
    document.getElementById('close-schedule-popup').addEventListener('click', close);
    document.getElementById('close-schedule-popup-btn').addEventListener('click', close);
    popup.addEventListener('click', e => { if (e.target === popup) close(); });
}

// ══════════════════════════════════════════
// AUTH & PROFILE
// ══════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const userData  = userSnap.data();
            currentUserArea = userData.area || "";

            const sCountUI   = document.getElementById('scanned-count-ui');
            if (sCountUI)   sCountUI.innerText   = userData.scannedCount         || 0;
            const rCountUI   = document.getElementById('recycled-count-ui');
            if (rCountUI)   rCountUI.innerText   = userData.recycledCount        || 0;
            const resolvedUI = document.getElementById('resolved-count');
            if (resolvedUI) resolvedUI.innerText = userData.resolvedReportsCount || 0;

            const firstName   = userData.fullName ? userData.fullName.split(' ')[0] : "User";
            const initial     = firstName.charAt(0).toUpperCase();
            const nameDisplay = document.getElementById('user-name-display');
            if (nameDisplay) nameDisplay.innerText = firstName;

            document.querySelectorAll('.user-profile').forEach(container => {
                container.style.cssText += 'display:flex;align-items:center;justify-content:center;';
                if (userData.photoBase64) {
                    container.style.backgroundColor = "transparent";
                    container.innerHTML = `<img src="${userData.photoBase64}" alt="${firstName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                } else {
                    container.style.backgroundColor = "#2e7d32";
                    const span = container.querySelector('.user-initial-display');
                    if (span) span.innerText = initial;
                    else container.innerHTML = `<span class="user-initial-display" style="color:white;font-weight:bold;font-size:1rem;">${initial}</span>`;
                }
            });
        }

        startTruckTracking(currentUserArea);
        renderCalendar(calYear, calMonth);
    }
});

// ══════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════
const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
                     "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const _nowPH = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
let calYear  = _nowPH.getFullYear();
let calMonth = _nowPH.getMonth();

async function renderCalendar(year, month) {
    const label = document.getElementById('cal-month-label');
    const body  = document.getElementById('calendar-grid-body');
    if (!label || !body) return;
    label.innerText = `${MONTH_NAMES[month]} ${year}`;
    body.innerHTML  = '<div style="grid-column:1/-1;text-align:center;padding:1rem;color:#9E9E9E;font-size:0.8rem;">Loading...</div>';

    const pad      = n => String(n).padStart(2, '0');
    const firstDay = `${year}-${pad(month + 1)}-01`;
    const lastDay  = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
    const nowPH    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const todayStr = `${nowPH.getFullYear()}-${String(nowPH.getMonth()+1).padStart(2,'0')}-${String(nowPH.getDate()).padStart(2,'0')}`;
    const scheduledDates = {};

    try {
        const snap = await getDocs(query(
            collection(db, "schedules"),
            where("date", ">=", firstDay),
            where("date", "<=", lastDay)
        ));
        snap.forEach(d => {
            const s = d.data();
            if (currentUserArea && !(s.route || '').toLowerCase().includes(currentUserArea.toLowerCase())) return;
            const dotClass = 'bio';
            if (!scheduledDates[s.date] || s.status === 'ongoing') {
                scheduledDates[s.date] = { dotClass, data: s };
            }
        });
    } catch (e) { console.warn('Calendar query error:', e); }

    body.innerHTML = '';
    const firstWeekday  = new Date(year, month, 1).getDay();
    const daysInMonth   = new Date(year, month + 1, 0).getDate();
    const daysInPrevMon = new Date(year, month, 0).getDate();

    for (let i = firstWeekday - 1; i >= 0; i--) {
        const el = document.createElement('div');
        el.className   = 'calendar-day empty';
        el.textContent = daysInPrevMon - i;
        body.appendChild(el);
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
        const isToday = dateStr === todayStr;
        const el      = document.createElement('div');
        el.className  = 'calendar-day' + (isToday ? ' active' : '');
        el.textContent = day;
        if (scheduledDates[dateStr]) {
            const { dotClass, data } = scheduledDates[dateStr];
            const dot = document.createElement('div');
            dot.className = `day-dot ${dotClass}`;
            if (isToday) dot.style.background = 'white';
            el.appendChild(dot);
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => showSchedulePopup(data, dateStr));
        }
        body.appendChild(el);
    }
    const remainder = (firstWeekday + daysInMonth) % 7 === 0 ? 0 : 7 - ((firstWeekday + daysInMonth) % 7);
    for (let day = 1; day <= remainder; day++) {
        const el = document.createElement('div');
        el.className   = 'calendar-day empty';
        el.textContent = day;
        body.appendChild(el);
    }
}

document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
    if (--calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(calYear, calMonth);
});
document.getElementById('cal-next-btn')?.addEventListener('click', () => {
    if (++calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(calYear, calMonth);
});
renderCalendar(calYear, calMonth);

// ══════════════════════════════════════════
// AI SCANNER
// ══════════════════════════════════════════
document.getElementById('close-ai-modal')?.addEventListener('click', () => {
    const webcam = document.getElementById('webcam');
    if (webcam?.srcObject) { webcam.srcObject.getTracks().forEach(t => t.stop()); webcam.srcObject = null; }
});

// ══════════════════════════════════════════
// INLINE REPORT CARD — image upload
// ══════════════════════════════════════════
uploadTrigger.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadStatus.innerText = "Optimizing...";
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = ev => {
        const img = new Image();
        img.src = ev.target.result;
        img.onload = () => {
            const canvas   = document.createElement('canvas');
            canvas.width   = 800;
            canvas.height  = img.height * (800 / img.width);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            base64Image    = canvas.toDataURL('image/jpeg', 0.7);
            uploadStatus.innerText    = "Ready";
            uploadStatus.style.color = "#2ecc71";
        };
    };
});

// ══════════════════════════════════════════
// INLINE REPORT CARD — submit
// ══════════════════════════════════════════
submitBtn.addEventListener('click', async () => {
    const user        = auth.currentUser;
    const locationVal = document.getElementById('report-location').value;
    const wasteType   = document.getElementById('report-waste-type').value;
    const description = document.getElementById('report-description').value;
    if (!base64Image || !locationVal) {
        showToast('error', 'Incomplete report', 'Please upload a photo and provide the location.');
        return;
    }
    submitBtn.disabled  = true;
    submitBtn.innerText = "Sending...";
    try {
        await addDoc(collection(db, "reports"), {
            reporterUid:  user.uid,
            reporterName: document.getElementById('user-name-display').innerText,
            location: locationVal, wasteType, description,
            imageUrl: base64Image, status: "pending", timestamp: serverTimestamp()
        });
        showToast('success', 'Report submitted!', 'Wait for Admin to resolve your report.');
        setTimeout(() => window.location.reload(), 2500);
    } catch (err) {
        console.error(err);
        showToast('error', 'Submission failed', err.message);
    } finally {
        submitBtn.disabled  = false;
        submitBtn.innerText = "Submit Report";
    }
});

// ══════════════════════════════════════════
// REPORT ISSUE MODAL (sidebar button)
// ══════════════════════════════════════════
function initializeReportModal() {
    let modalBase64Image = "";
    if (!document.getElementById('report-modal-css')) {
        const l = document.createElement('link');
        l.id = 'report-modal-css'; l.rel = 'stylesheet'; l.href = '../css/report-modal.css';
        document.head.appendChild(l);
    }
    if (!document.getElementById('leaflet-modal-css')) {
        const l = document.createElement('link');
        l.id = 'leaflet-modal-css'; l.rel = 'stylesheet';
        l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(l);
    }
    if (!document.getElementById('report-issue-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="report-issue-modal" class="modal-overlay">
                <div class="report-modal">
                    <div class="modal-header">
                        <h3>Report an Issue</h3>
                        <button class="btn-close-modal" id="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <label class="form-label">UPLOAD PROOF</label>
                    <input type="file" id="report-photo-input" accept="image/*" capture="environment" style="display:none">
                    <div class="upload-proof-box" id="upload-box">
                        <div class="upload-icon-circle"><i data-lucide="camera"></i></div>
                        <h4 id="upload-status-title">Upload Photo Evidence</h4>
                        <p id="upload-status-desc">Drag and drop or click to browse</p>
                    </div>
                    <label class="form-label">LOCATION</label>
                    <div class="location-row">
                        <input type="text" id="loc-input" class="location-input" placeholder="Street address or landmark...">
                        <button class="btn-current-location" id="use-geo-btn"><i data-lucide="crosshair"></i> Use Current Location</button>
                    </div>
                    <div id="report-map" style="width:100%;height:150px;border-radius:20px;z-index:0;margin-bottom:0.5rem;"></div>
                    <label class="form-label">WASTE TYPE</label>
                    <div class="waste-types-group">
                        <button class="waste-badge active">Recyclable</button>
                        <button class="waste-badge">Biodegradable</button>
                        <button class="waste-badge">Hazardous</button>
                        <button class="waste-badge">General Waste</button>
                        <button class="waste-badge">Others</button>
                    </div>
                    <label class="form-label">DESCRIPTION</label>
                    <textarea id="desc-input" class="desc-textarea" placeholder="Describe the issue..."></textarea>
                    <div class="modal-footer">
                        <button class="btn-cancel" id="cancel-modal-btn">Cancel</button>
                        <button class="btn-submit-report" id="submit-modal-btn">Submit Report</button>
                    </div>
                </div>
            </div>`);
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (!document.getElementById('leaflet-modal-js')) {
            const s = document.createElement('script');
            s.id = 'leaflet-modal-js';
            s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            document.head.appendChild(s);
        }
    }

    let reportMap = null, reportMarker = null;
    function initMap(lat, lng) {
        if (reportMap) { reportMap.setView([lat, lng], 16); reportMarker.setLatLng([lat, lng]); return; }
        setTimeout(() => {
            if (typeof L === 'undefined') { setTimeout(() => initMap(lat, lng), 300); return; }
            reportMap   = L.map('report-map').setView([lat, lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(reportMap);
            reportMarker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: '',
                    html: '<div style="width:16px;height:16px;background:#2E7D32;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
                    iconAnchor: [8, 8]
                })
            }).addTo(reportMap);
        }, 100);
    }
    initMap(DEFAULT_LAT, DEFAULT_LNG);

    if (_modalListenersAttached) return;
    _modalListenersAttached = true;

    const modal          = document.getElementById('report-issue-modal');
    const submitModalBtn = document.getElementById('submit-modal-btn');
    const geoBtn         = document.getElementById('use-geo-btn');
    const uploadBox      = document.getElementById('upload-box');
    const fileInput      = document.getElementById('report-photo-input');
    const badges         = modal.querySelectorAll('.waste-badge');

    const closeModal = () => {
        modal.classList.remove('active');
        document.getElementById('desc-input').value              = "";
        document.getElementById('loc-input').value               = "";
        document.getElementById('upload-status-title').innerText = "Upload Photo Evidence";
        document.getElementById('upload-status-desc').innerText  = "Drag and drop or click to browse";
        uploadBox.style.borderColor = "";
        modalBase64Image = "";
    };

    badges.forEach(b => b.addEventListener('click', () => {
        badges.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
    }));

    geoBtn.addEventListener('click', () => {
        if (!navigator.geolocation) return;
        geoBtn.innerText = "Locating...";
        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude: lat, longitude: lng } = pos.coords;
            document.getElementById('loc-input').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            geoBtn.innerText = "Location Set";
            initMap(lat, lng);
            showToast('success', 'Location Found', 'GPS coordinates captured.');
        }, () => {
            showToast('error', 'Location unavailable', 'Please enable GPS and try again.');
            geoBtn.innerText = "Use Current Location";
        });
    });

    uploadBox.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById('upload-status-title').innerText = "Optimizing...";
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = ev => {
            const img = new Image();
            img.src = ev.target.result;
            img.onload = () => {
                const canvas   = document.createElement('canvas');
                canvas.width   = 800;
                canvas.height  = img.height * (800 / img.width);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                modalBase64Image = canvas.toDataURL('image/jpeg', 0.7);
                document.getElementById('upload-status-title').innerText = "Photo Ready";
                document.getElementById('upload-status-desc').innerText  = file.name;
                uploadBox.style.borderColor = "#2ecc71";
            };
        };
    });

    submitModalBtn.addEventListener('click', async () => {
        const user         = auth.currentUser;
        if (!user) { showToast('error', 'Not logged in', 'Please log in.'); return; }
        const description  = document.getElementById('desc-input').value;
        const locationVal  = document.getElementById('loc-input').value;
        const wasteType    = modal.querySelector('.waste-badge.active').innerText;
        const reporterName = document.getElementById('user-name-display')?.innerText || "Resident";
        if (!modalBase64Image) { showToast('error', 'No photo',       'Please upload a photo first.'); return; }
        if (!locationVal)      { showToast('error', 'No location',    'Please provide the location.'); return; }
        if (!description)      { showToast('error', 'No description', 'Please describe the issue.');   return; }
        submitModalBtn.disabled  = true;
        submitModalBtn.innerText = "Submitting...";
        try {
            await addDoc(collection(db, "reports"), {
                description, imageUrl: modalBase64Image, location: locationVal,
                reporterName, reporterUid: user.uid,
                status: "pending", timestamp: serverTimestamp(), wasteType
            });
            showToast('success', 'Report Submitted', 'Wait for Admin to resolve your report.');
            closeModal();
        } catch (err) {
            console.error(err);
            showToast('error', 'Submission failed', err.message);
        } finally {
            submitModalBtn.disabled  = false;
            submitModalBtn.innerText = "Submit Report";
        }
    });

    document.getElementById('close-modal-btn').onclick  = closeModal;
    document.getElementById('cancel-modal-btn').onclick = closeModal;
}

window.initializeReportModal = initializeReportModal;