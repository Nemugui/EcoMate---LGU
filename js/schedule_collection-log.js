/**
 * schedule_collection-log.js  (updated)
 *
 * Changes vs previous version:
 *  - Removed renderCurrentTask() entirely
 *  - "View Live Location" button on each upcoming pickup item opens a
 *    full-screen Leaflet map modal showing the truck's real GPS position
 *  - Clicking the truck marker on the map opens a rich info panel:
 *      • From schedules: route, date, startTime, endTime, status, truck ID
 *      • From trucks: model, assignedWorkerName, status (truck status)
 *      • Location: reverse-geocoded address (no lat/lng shown)
 *  - Calendar dots + popup still work as before
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    doc, getDoc,
    collection, query, where, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── State ─────────────────────────────────────────────────────────────────────
const _nowPH     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
let currentYear  = _nowPH.getFullYear();
let currentMonth = _nowPH.getMonth();
let allSchedules = [];
let scheduleMap  = {};
let userArea     = '';

// Live map state
let liveMap         = null;
let liveTruckMarker = null;
let liveUnsub       = null;   // Firestore onSnapshot unsubscribe

const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];

// Default center: Daet, Camarines Norte
const DEFAULT_LAT = 14.1126;
const DEFAULT_LNG = 122.9553;

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function toDateStr(year, month, day) {
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function todayStr() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function dotClass(status) {
    if (status === 'ongoing')   return 'dot-bio';
    if (status === 'upcoming')  return 'dot-rec';
    if (status === 'completed') return 'dot-haz';
    return 'dot-rec';
}

function tagClass(status) {
    if (status === 'ongoing')   return 'green';
    if (status === 'completed') return 'red';
    return 'blue';
}

function cap(str) {
    if (!str) return '—';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Reverse geocode (same logic as res-dashboard) ─────────────────────────────
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
        const a    = data.address || {};
        const place  = a.amenity || a.tourism || a.shop || a.building || a.leisure || null;
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
    } catch { return 'Location unavailable'; }
}

// ── Leaflet loader ────────────────────────────────────────────────────────────
function ensureLeaflet(cb) {
    if (typeof L !== 'undefined') { cb(); return; }
    if (!document.getElementById('leaflet-sched-css')) {
        const css = document.createElement('link');
        css.id   = 'leaflet-sched-css';
        css.rel  = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
    }
    if (!document.getElementById('leaflet-sched-js')) {
        const js  = document.createElement('script');
        js.id     = 'leaflet-sched-js';
        js.src    = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        js.onload = cb;
        document.head.appendChild(js);
    } else {
        const t = setInterval(() => { if (typeof L !== 'undefined') { clearInterval(t); cb(); } }, 80);
    }
}

// ── LIVE MAP MODAL ────────────────────────────────────────────────────────────
function openLiveMapModal(schedule) {
    // Inject pulse animation once
    if (!document.getElementById('live-map-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'live-map-pulse-style';
        s.textContent = `
            @keyframes liveMapPulse {
                0%   { transform: scale(1); opacity: 0.7; }
                100% { transform: scale(3); opacity: 0; }
            }
        `;
        document.head.appendChild(s);
    }

    const modal = document.getElementById('live-map-modal');
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Find the truck ID from schedule
    const truckId = (schedule.truck || '').trim().toUpperCase();

    ensureLeaflet(() => {
        // Init map once
        if (!liveMap) {
            liveMap = L.map('live-map-leaflet', {
                zoomControl: true,
                attributionControl: false
            }).setView([DEFAULT_LAT, DEFAULT_LNG], 16);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(liveMap);
        }

        liveMap.invalidateSize();

        // Unsubscribe any previous listener
        if (liveUnsub) { liveUnsub(); liveUnsub = null; }
        if (liveTruckMarker) { liveMap.removeLayer(liveTruckMarker); liveTruckMarker = null; }

        // Hide panel
        hideLivePanel();

        // Subscribe to trucks collection for this truck
        liveUnsub = onSnapshot(
            query(collection(db, 'trucks'), where('truckId', '==', truckId)),
            async (snap) => {
                if (snap.empty) return;
                const truckDoc = snap.docs[0].data();
                const loc      = truckDoc.lastLocation || {};
                const lat      = loc.lat ?? DEFAULT_LAT;
                const lng      = loc.lng ?? DEFAULT_LNG;

                if (liveTruckMarker) {
                    liveTruckMarker.setLatLng([lat, lng]);
                    liveMap.panTo([lat, lng]);
                } else {
                    // Build truck icon
                    const icon = L.divIcon({
                        className: '',
                        html: `
                            <div style="position:relative;width:44px;height:44px;cursor:pointer;">
                                <div style="position:absolute;inset:0;border-radius:50%;
                                            background:rgba(165,214,167,0.5);
                                            animation:liveMapPulse 1.8s ease-out infinite;"></div>
                                <div style="position:absolute;top:50%;left:50%;
                                            transform:translate(-50%,-50%);
                                            width:28px;height:28px;background:#2E7D32;
                                            border:3px solid white;border-radius:50%;
                                            box-shadow:0 2px 10px rgba(0,0,0,0.4);
                                            display:flex;align-items:center;justify-content:center;">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                                        <path d="M1 3h15l3 6h4v7h-2a3 3 0 01-6 0H8a3 3 0 01-6 0H1V3z"/>
                                    </svg>
                                </div>
                            </div>`,
                        iconSize:   [44, 44],
                        iconAnchor: [22, 22]
                    });

                    liveTruckMarker = L.marker([lat, lng], { icon }).addTo(liveMap);
                    liveMap.setView([lat, lng], 16);

                    // Click marker → show info panel
                    liveTruckMarker.on('click', async () => {
                        showLivePanel(schedule, truckDoc, lat, lng);
                    });
                }
            },
            (err) => console.warn('[LiveMap] Truck snapshot error:', err)
        );
    });
}

function closeLiveMapModal() {
    const modal = document.getElementById('live-map-modal');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
    if (liveUnsub) { liveUnsub(); liveUnsub = null; }
    hideLivePanel();
}

// ── Panel (truck info popup from map) ─────────────────────────────────────────
function hideLivePanel() {
    const panel = document.getElementById('live-map-panel');
    if (panel) panel.classList.replace('panel-visible', 'panel-hidden') || panel.classList.add('panel-hidden');
}

async function showLivePanel(schedule, truckDoc, lat, lng) {
    const panel   = document.getElementById('live-map-panel');
    const content = document.getElementById('panel-content');
    if (!panel || !content) return;

    // Show loading state
    content.innerHTML = `<div class="panel-loading">Fetching location…</div>`;
    panel.classList.remove('panel-hidden');
    panel.classList.add('panel-visible');

    // Reverse geocode
    const locationStr = (lat !== DEFAULT_LAT && lng !== DEFAULT_LNG)
        ? await reverseGeocode(lat, lng)
        : 'No GPS Data';

    // Last GPS time
    const loc = truckDoc.lastLocation || {};
    let lastGPS = '—';
    if (loc.updatedAt) {
        try {
            const d = new Date(loc.updatedAt);
            lastGPS = isNaN(d.getTime()) ? loc.updatedAt
                : d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        } catch { lastGPS = '—'; }
    }

    // Status pill color
    const schedStatus  = (schedule.status || 'upcoming').toLowerCase();
    const pillClass    = tagClass(schedStatus);
    const truckStatus  = cap(truckDoc.status || '—');

    // Format date
    let niceDate = '—';
    if (schedule.date) {
        const d = new Date(schedule.date + 'T00:00');
        niceDate = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    content.innerHTML = `
        <div class="panel-header">
            <div class="panel-title-group">
                <span class="panel-eyebrow">Live Truck Info</span>
                <h3 class="panel-title">${schedule.route || '—'}</h3>
            </div>
            <span class="panel-status-pill ${pillClass}">${cap(schedStatus)}</span>
        </div>

        <div class="panel-divider"></div>

        <!-- SCHEDULE INFO -->
        <p class="panel-section-label">📅 Schedule</p>
        <div class="panel-row-grid">
            <div class="panel-info-box">
                <span class="pib-label">Date</span>
                <span class="pib-value">${niceDate}</span>
            </div>
            <div class="panel-info-box">
                <span class="pib-label">Start Time</span>
                <span class="pib-value">${schedule.startTime ? formatTime(schedule.startTime) : '—'}</span>
            </div>
            <div class="panel-info-box">
                <span class="pib-label">End Time</span>
                <span class="pib-value">${schedule.endTime ? formatTime(schedule.endTime) : '—'}</span>
            </div>
            <div class="panel-info-box">
                <span class="pib-label">Truck ID</span>
                <span class="pib-value">${schedule.truck || '—'}</span>
            </div>
        </div>

        <div class="panel-divider"></div>

        <!-- TRUCK INFO -->
        <p class="panel-section-label">🚛 Truck</p>
        <div class="panel-row-grid">
            <div class="panel-info-box">
                <span class="pib-label">Model</span>
                <span class="pib-value">${truckDoc.model || '—'}</span>
            </div>
            <div class="panel-info-box">
                <span class="pib-label">Truck Status</span>
                <span class="pib-value">${truckStatus}</span>
            </div>
            <div class="panel-info-box">
                <span class="pib-label">Worker</span>
                <span class="pib-value">${truckDoc.assignedWorkerName || '—'}</span>
            </div>
            <div class="panel-info-box panel-info-box--wide">
                <span class="pib-label">📍 Current Location</span>
                <span class="pib-value">${locationStr}</span>
            </div>
            <div class="panel-info-box">
                <span class="pib-label">Last GPS Update</span>
                <span class="pib-value">${lastGPS}</span>
            </div>
        </div>
    `;
}

// ── Build scheduleMap ─────────────────────────────────────────────────────────
function buildMap(schedules) {
    const map = {};
    schedules.forEach(s => {
        if (!s.date) return;
        if (!map[s.date]) map[s.date] = [];
        map[s.date].push(s);
    });
    return map;
}

// ── Dynamic calendar renderer ─────────────────────────────────────────────────
function renderCalendar(year, month) {
    const label = document.getElementById('cal-month-label');
    if (label) label.textContent = `${MONTH_NAMES[month]} ${year}`;

    const body = document.getElementById('cal-body');
    if (!body) return;
    body.innerHTML = '';

    const today      = todayStr();
    const firstDow   = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev  = new Date(year, month, 0).getDate();

    for (let i = 0; i < firstDow; i++) {
        const el = document.createElement('div');
        el.className = 'cal-day empty';
        el.textContent = daysInPrev - firstDow + 1 + i;
        body.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = toDateStr(year, month, d);
        const el      = document.createElement('div');
        el.className  = 'cal-day';
        if (dateStr === today) el.classList.add('today');
        el.textContent = d;

        const daySchedules = scheduleMap[dateStr];
        if (daySchedules?.length) {
            const sched = daySchedules[0];
            const dot = document.createElement('div');
            dot.className = `day-indicator ${dotClass(sched.status)}`;
            if (dateStr === today) dot.style.background = 'white';
            el.appendChild(dot);
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => openCalendarModal(sched));
        }
        body.appendChild(el);
    }

    const total    = firstDow + daysInMonth;
    const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 1; i <= trailing; i++) {
        const el = document.createElement('div');
        el.className = 'cal-day empty';
        el.textContent = i;
        body.appendChild(el);
    }
}

// ── Calendar day detail modal (simple popup, not live map) ────────────────────
function openCalendarModal(sched) {
    document.getElementById('cal-day-modal')?.remove();

    const statusColors = {
        ongoing:   { bg: '#E8F5E9', color: '#2E7D32' },
        completed: { bg: '#E3F2FD', color: '#0277BD' },
        done:      { bg: '#E3F2FD', color: '#0277BD' },
        upcoming:  { bg: '#FFF8E1', color: '#F57F17' },
    };
    const sc = statusColors[(sched.status || 'upcoming').toLowerCase()] || statusColors.upcoming;

    let niceDate = '—';
    if (sched.date) {
        const d = new Date(sched.date + 'T00:00');
        niceDate = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    const overlay = document.createElement('div');
    overlay.id = 'cal-day-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:600;display:flex;align-items:center;justify-content:center;padding:1rem;';
    overlay.innerHTML = `
        <div style="background:white;border-radius:24px;padding:2rem;width:100%;max-width:380px;
                    box-shadow:0 24px 60px rgba(0,0,0,0.18);font-family:'Outfit',sans-serif;
                    animation:calPopIn 0.25s cubic-bezier(0.34,1.56,0.64,1);position:relative;">
            <style>@keyframes calPopIn{from{opacity:0;transform:scale(0.92) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}</style>

            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">
                <div>
                    <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Collection Schedule</p>
                    <h3 style="font-size:1.1rem;font-weight:800;color:#1B5E20;margin:0;line-height:1.2;">${niceDate}</h3>
                </div>
                <button id="cal-modal-close" style="background:#F5F5F5;border:none;border-radius:50%;width:32px;height:32px;font-size:1rem;cursor:pointer;color:#546E7A;">&times;</button>
            </div>

            <div style="background:#F9FBF9;border-radius:16px;padding:1rem 1.25rem;margin-bottom:0.85rem;">
                <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">Route / Area</p>
                <p style="font-size:1rem;font-weight:700;color:#1B5E20;margin:0;">📍 ${sched.route || '—'}</p>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.85rem;">
                <div style="background:#F9FBF9;border-radius:16px;padding:1rem;">
                    <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">Start Time</p>
                    <p style="font-size:1rem;font-weight:700;color:#263238;margin:0;">🕗 ${sched.startTime ? formatTime(sched.startTime) : '—'}</p>
                </div>
                <div style="background:#F9FBF9;border-radius:16px;padding:1rem;">
                    <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">End Time</p>
                    <p style="font-size:1rem;font-weight:700;color:#263238;margin:0;">🕚 ${sched.endTime ? formatTime(sched.endTime) : '—'}</p>
                </div>
            </div>

            <div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.85rem;">
                <span style="background:${sc.bg};color:${sc.color};padding:0.3rem 1rem;border-radius:50px;font-size:0.8rem;font-weight:800;">
                    ${cap(sched.status || 'upcoming')}
                </span>
            </div>

            ${sched.truck ? `
            <div style="background:#F9FBF9;border-radius:16px;padding:1rem 1.25rem;margin-bottom:0.85rem;">
                <p style="font-size:0.65rem;font-weight:800;color:#9E9E9E;text-transform:uppercase;margin-bottom:4px;">Truck</p>
                <p style="font-size:1rem;font-weight:700;color:#263238;margin:0;">🚛 ${sched.truck}</p>
            </div>` : ''}

            <div style="display:flex;gap:0.75rem;margin-top:1.5rem;">
                <button id="cal-modal-view-live"
                    style="flex:1;background:#2E7D32;color:white;padding:1rem;border:none;
                           border-radius:50px;font-weight:700;font-size:0.95rem;cursor:pointer;
                           font-family:'Outfit',sans-serif;display:flex;align-items:center;
                           justify-content:center;gap:0.5rem;">
                    🗺️ View Live Location
                </button>
                <button id="cal-modal-close-btn"
                    style="flex:1;background:#F5F5F5;color:#546E7A;padding:1rem;border:none;
                           border-radius:50px;font-weight:700;font-size:0.95rem;cursor:pointer;
                           font-family:'Outfit',sans-serif;">
                    Got it!
                </button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('cal-modal-close').addEventListener('click', close);
    document.getElementById('cal-modal-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    document.getElementById('cal-modal-view-live').addEventListener('click', () => {
        close();
        openLiveMapModal(sched);
    });
}

// ── Upcoming Pickups ──────────────────────────────────────────────────────────
function renderUpcomingPickups(schedules) {
    const list = document.getElementById('pickup-list');
    if (!list) return;

    const today    = todayStr();
    const upcoming = schedules
        .filter(s => s.date >= today && s.status !== 'completed')
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 6);

    if (upcoming.length === 0) {
        list.innerHTML = '<p class="empty-msg">No upcoming pickups in your area.</p>';
        return;
    }

    list.innerHTML = upcoming.map((s, i) => {
        const tc  = tagClass(s.status);
        const d   = new Date(s.date + 'T00:00');
        const dl  = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        const tl  = s.startTime ? formatTime(s.startTime) : '';
        const isToday = s.date === today;
        return `
        <div class="pickup-item ${isToday ? 'pickup-item--today' : ''}">
            <div class="pi-left">
                <div class="pi-info">
                    <span class="pi-name">${s.route || '—'}</span>
                    <span class="pi-date">${isToday ? 'Today' : dl}${tl ? ' • ' + tl : ''}</span>
                </div>
                <span class="p-tag ${tc}">${(s.status || 'UPCOMING').toUpperCase()}</span>
            </div>
            <button class="btn-view-live" data-idx="${i}" title="View Live Location">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 11l19-9-9 19-2-8-8-2z"/>
                </svg>
                View Live
            </button>
        </div>`;
    }).join('');

    list.querySelectorAll('.btn-view-live').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = +btn.dataset.idx;
            openLiveMapModal(upcoming[idx]);
        });
    });
}

// ── Wire calendar nav ─────────────────────────────────────────────────────────
function wireCalendarNav() {
    document.getElementById('cal-prev')?.addEventListener('click', () => {
        if (--currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar(currentYear, currentMonth);
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
        if (++currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar(currentYear, currentMonth);
    });
}

// ── Wire live map modal close ─────────────────────────────────────────────────
function wireLiveMapModal() {
    const modal = document.getElementById('live-map-modal');
    const close = document.getElementById('live-map-close');

    close?.addEventListener('click', closeLiveMapModal);
    modal?.addEventListener('click', e => {
        if (e.target === modal) closeLiveMapModal();
    });

    // Drag handle swipe down to dismiss panel
    document.getElementById('panel-drag-handle')?.addEventListener('click', hideLivePanel);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }

    wireCalendarNav();
    wireLiveMapModal();
    renderCalendar(currentYear, currentMonth); // render empty first

    try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists()) return;
        userArea = userSnap.data().area || '';

        if (!userArea) {
            console.warn('No area on user doc — cannot filter schedules.');
            return;
        }

        const snap = await getDocs(
            query(collection(db, 'schedules'), where('route', '==', userArea))
        );
        allSchedules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        scheduleMap  = buildMap(allSchedules);

        renderCalendar(currentYear, currentMonth);
        renderUpcomingPickups(allSchedules);

    } catch (err) {
        console.error('schedule_collection-log.js error:', err);
        renderCalendar(currentYear, currentMonth);
    }
});