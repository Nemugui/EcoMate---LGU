/**
 * workerdashboard.js
 *
 * Key change: Today's Schedule now shows ONLY schedules where
 * assignedWorkerUid === auth.currentUser.uid
 * (falls back to all-today schedules for legacy docs with no assignedWorkerUid)
 *
 * v3: Reports now only show reports assigned to the current worker
 *     via assignedWorkerUid === auth.currentUser.uid
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    doc, getDoc,
    collection, query, where, getDocs,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const REPORTS_PER_PAGE = 5;

// ── State ─────────────────────────────────────────────────────────────────────
let allReports        = [];
let currentPage       = 1;
let currentScheduleId = null;
let currentReportId   = null;

// ── Leaflet map state ─────────────────────────────────────────────────────────
let leafletMap     = null;
let locationMarker = null;

// ── Live tracking state ───────────────────────────────────────────────────────
let watchId    = null;
let isTracking = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function formatTime(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function timeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Math.floor((Date.now() - timestamp.toDate().getTime()) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function showToast(msg, type = 'success') {
    const existing = document.getElementById('wd-toast');
    if (existing) existing.remove();

    const t = document.createElement('div');
    t.id = 'wd-toast';
    const bg = type === 'success' ? '#2E7D32' : '#C62828';
    t.style.cssText = `
        position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);
        background:${bg};color:white;padding:0.75rem 1.75rem;border-radius:50px;
        font-size:0.875rem;font-weight:600;font-family:'Inter',sans-serif;
        opacity:0;transition:all 0.3s;z-index:9999;white-space:nowrap;pointer-events:none;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => {
        t.style.opacity = '1';
        t.style.transform = 'translateX(-50%) translateY(0)';
    }));
    setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// ── Leaflet map ───────────────────────────────────────────────────────────────
function initMap(lat, lng) {
    let container = document.querySelector('.map-card-inner');
    if (!container) return;

    if (!container.id) container.id = 'wd-leaflet-map';

    const tag = container.querySelector('.map-tag');

    if (!leafletMap) {
        leafletMap = L.map(container.id, {
            zoomControl: false,
            attributionControl: false
        }).setView([lat, lng], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(leafletMap);

        L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lng], 15);
    }

    const pulseIcon = L.divIcon({
        className: '',
        html: `<div class="map-pulse-dot"></div>`,
        iconSize:   [20, 20],
        iconAnchor: [10, 10]
    });

    if (locationMarker) {
        locationMarker.setLatLng([lat, lng]);
    } else {
        locationMarker = L.marker([lat, lng], { icon: pulseIcon })
            .addTo(leafletMap)
            .bindPopup('📍 Your Location')
            .openPopup();
    }

    if (tag) container.appendChild(tag);
}

// ── Save location to Firestore ────────────────────────────────────────────────
async function saveLocationToFirestore(lat, lng, accuracy) {
    const user = auth.currentUser;
    if (!user) return;

    const locationData = {
        lat,
        lng,
        accuracy,
        updatedAt: new Date().toISOString(),
    };

    try {
        await updateDoc(doc(db, 'users', user.uid), { lastLocation: locationData });

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const truckId  = userSnap.data()?.truckId;

        if (truckId) {
            const truckSnap = await getDocs(
                query(collection(db, 'trucks'), where('truckId', '==', truckId))
            );
            if (!truckSnap.empty) {
                await updateDoc(doc(db, 'trucks', truckSnap.docs[0].id), {
                    lastLocation: locationData
                });
            }
        }

        initMap(lat, lng);

        const label = document.getElementById('map-route-label');
        if (label) label.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

        const locationStatus = document.getElementById('location-status');
        if (locationStatus) {
            locationStatus.innerHTML = `
                <div style="font-size:0.75rem;color:#2E7D32;font-weight:600;margin-top:0.75rem;text-align:center;">
                    📍 Live: <strong>${lat.toFixed(5)}, ${lng.toFixed(5)}</strong><br>
                    <span style="color:#78909C;font-weight:400;">
                        ±${Math.round(accuracy)}m &nbsp;•&nbsp; Updated ${new Date().toLocaleTimeString()}
                    </span>
                </div>`;
        }

    } catch (err) {
        console.error('Location save error:', err);
    }
}

// ── Start continuous GPS tracking ─────────────────────────────────────────────
function startTracking() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported on this device', 'error');
        return;
    }

    const locationBtn = document.getElementById('btn-share-location');
    isTracking = true;
    locationBtn.innerHTML = `<i data-lucide="loader"></i> Starting…`;
    locationBtn.disabled  = true;
    if (window.lucide) window.lucide.createIcons();

    watchId = navigator.geolocation.watchPosition(
        async (pos) => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;

            if (locationBtn.dataset.tracking !== 'true') {
                locationBtn.dataset.tracking  = 'true';
                locationBtn.innerHTML = `<i data-lucide="square"></i> Stop Tracking`;
                locationBtn.disabled  = false;
                locationBtn.style.background  = '#C62828';
                locationBtn.style.boxShadow   = '0 4px 15px rgba(198,40,40,0.35)';
                if (window.lucide) window.lucide.createIcons();
                showToast('Live tracking started ✓');
            }

            await saveLocationToFirestore(lat, lng, accuracy);
        },
        (err) => {
            const msgs = {
                1: 'Location permission denied. Allow access in browser settings.',
                2: 'Location unavailable. Try again.',
                3: 'Location timed out. Try again.',
            };
            showToast(msgs[err.code] || 'Could not get location', 'error');
            stopTracking();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
}

// ── Stop GPS tracking ─────────────────────────────────────────────────────────
function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    isTracking = false;

    const locationBtn = document.getElementById('btn-share-location');
    if (locationBtn) {
        locationBtn.dataset.tracking  = 'false';
        locationBtn.innerHTML = `<i data-lucide="navigation"></i> Share My Location`;
        locationBtn.disabled  = false;
        locationBtn.style.background  = '';
        locationBtn.style.boxShadow   = '';
        if (window.lucide) window.lucide.createIcons();
    }

    const locationStatus = document.getElementById('location-status');
    if (locationStatus) {
        locationStatus.innerHTML = `
            <div style="font-size:0.75rem;color:#78909C;margin-top:0.75rem;text-align:center;">
                Tracking stopped.
            </div>`;
    }

    showToast('Location sharing stopped');
}

window.addEventListener('beforeunload', () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
});

// ── Populate worker profile ───────────────────────────────────────────────────
// ── Populate worker profile ───────────────────────────────────────────────────
function populateProfile(userData) {
    const fullName  = userData.fullName || 'Worker';
    const firstName = fullName.split(' ')[0];
    const initial   = firstName.charAt(0).toUpperCase();

    const avatar = document.querySelector('.avatar-circle');
    if (avatar) {
        if (userData.photoBase64) {
            avatar.innerHTML = `<img src="${userData.photoBase64}"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
                alt="${fullName}">`;
        } else {
            avatar.innerHTML = `<span style="color:white;font-weight:700;font-size:1rem;">${initial}</span>`;
        }
    }

    const headerH2 = document.querySelector('.header-title h2');
    if (headerH2) headerH2.textContent = `Welcome, ${firstName}`;
}

// ── Schedule: render list ─────────────────────────────────────────────────────
function renderSchedule(schedules) {
    const list = document.querySelector('.schedule-list');
    if (!list) return;

    const taskCountEl = document.querySelector('.summary-row .summary-card:nth-child(1) h3');
    const completedEl = document.querySelector('.summary-row .summary-card:nth-child(2) h3');
    if (taskCountEl) taskCountEl.textContent = schedules.length;
    if (completedEl) completedEl.textContent = schedules.filter(s => s.status === 'completed').length;

    if (schedules.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:2rem;color:#78909C;font-size:0.875rem;">
                <i data-lucide="calendar-x" style="width:36px;height:36px;opacity:0.3;display:block;margin:0 auto 0.75rem;"></i>
                No schedules assigned to you for today.
            </div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    list.innerHTML = schedules.map(s => {
        const isOngoing   = s.status === 'ongoing';
        const isCompleted = s.status === 'completed';
        let badgeClass, badgeLabel;
        if (isOngoing)        { badgeClass = 'ongoing';   badgeLabel = 'Ongoing'; }
        else if (isCompleted) { badgeClass = 'completed'; badgeLabel = 'Completed'; }
        else                  { badgeClass = 'pending';   badgeLabel = 'Pending'; }

        return `
            <div class="schedule-item" data-schedule-id="${s.id}"
                 data-route="${encodeURIComponent(s.route || '')}"
                 data-start="${s.startTime || ''}"
                 data-end="${s.endTime || ''}"
                 data-truck="${encodeURIComponent(s.truck || '')}"
                 data-status="${s.status || 'pending'}"
                 data-notes="${encodeURIComponent(s.notes || '')}">
                <div class="sch-time">${formatTime(s.startTime)}</div>
                <div class="sch-info">
                    <h4>${s.route || 'Route not set'}</h4>
                    <p>${s.notes || 'No notes'} • Truck ${s.truck || '—'}</p>
                </div>
                <div class="sch-badge ${badgeClass}">${badgeLabel}</div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.schedule-item').forEach(item => {
        item.addEventListener('click', () => openScheduleModal(item));
    });

    if (window.lucide) window.lucide.createIcons();
}

// ── Schedule: modal open ──────────────────────────────────────────────────────
async function openScheduleModal(item) {
    const id      = item.dataset.scheduleId;
    const route   = decodeURIComponent(item.dataset.route)   || '—';
    const start   = item.dataset.start;
    const end     = item.dataset.end;
    const truckId = decodeURIComponent(item.dataset.truck)   || '';
    const status  = item.dataset.status                      || 'pending';
    const notes   = decodeURIComponent(item.dataset.notes)   || 'No notes';

    currentScheduleId = id;

    document.getElementById('modal-route').textContent = route;
    document.getElementById('modal-time').textContent  =
        start ? `${formatTime(start)}${end ? ' – ' + formatTime(end) : ''}` : '—';
    document.getElementById('modal-notes').textContent = notes;

    // ── Truck name lookup ────────────────────────────────────────────────
    const truckEl = document.getElementById('modal-truck');
    truckEl.textContent = truckId || '—';
    if (truckId) {
        try {
            const truckSnap = await getDocs(
                query(collection(db, 'trucks'), where('truckId', '==', truckId))
            );
            if (!truckSnap.empty) {
                const truckData = truckSnap.docs[0].data();
                const model = truckData.model || '';
                truckEl.textContent = model
                    ? (model === truckId ? truckId : `${model} (${truckId})`)
                    : truckId;
            }
        } catch (_) {
            truckEl.textContent = truckId;
        }
    }

    // ── Status label ─────────────────────────────────────────────────────
    const statusMap = { ongoing:'Ongoing', completed:'Completed', pending:'Pending', upcoming:'Upcoming' };
    document.getElementById('modal-status-text').textContent = statusMap[status] || status;

    // ── Assigned Worker: fetch assignedWorkerName from Firestore ──────────
    const workersEl = document.getElementById('modal-workers');
    workersEl.innerHTML = `<span style="color:#78909C;font-size:0.85rem;">Loading…</span>`;
    try {
        const schedSnap = await getDoc(doc(db, 'schedules', id));
        if (schedSnap.exists()) {
            const data = schedSnap.data();
            const name = data.assignedWorkerName || null;
            renderWorkerChips(name ? [name] : []);
        } else {
            renderWorkerChips([]);
        }
    } catch (_) {
        renderWorkerChips([]);
    }

    // ── Complete button state ────────────────────────────────────────────
    const btnComplete = document.getElementById('btn-complete-task');
    if (status === 'completed') {
        btnComplete.disabled  = true;
        btnComplete.innerHTML = '✓ Already Completed';
    } else {
        btnComplete.disabled  = false;
        btnComplete.innerHTML = '<i data-lucide="check-circle-2"></i> Mark Complete';
    }

    document.getElementById('schedule-modal').classList.add('open');
    if (window.lucide) window.lucide.createIcons();
}

function renderWorkerChips(workers) {
    const workersEl = document.getElementById('modal-workers');
    if (workers && workers.length > 0) {
        workersEl.innerHTML = workers.map(w =>
            `<span class="modal-worker-chip">
                <i data-lucide="user" style="width:12px;height:12px;"></i> ${w}
             </span>`
        ).join('');
    } else {
        workersEl.textContent = 'No workers assigned yet';
    }
    if (window.lucide) window.lucide.createIcons();
}

// ── Schedule: Mark Complete ───────────────────────────────────────────────────
document.getElementById('btn-complete-task')?.addEventListener('click', async () => {
    if (!currentScheduleId) return;
    const btn = document.getElementById('btn-complete-task');
    btn.disabled    = true;
    btn.textContent = 'Saving...';
    try {
        await updateDoc(doc(db, 'schedules', currentScheduleId), { status: 'completed' });
        showToast('Schedule marked as completed ✓');
        btn.innerHTML = '✓ Completed';

        const item = document.querySelector(`.schedule-item[data-schedule-id="${currentScheduleId}"]`);
        if (item) {
            item.dataset.status = 'completed';
            const badge = item.querySelector('.sch-badge');
            badge.className   = 'sch-badge completed';
            badge.textContent = 'Completed';
        }

        const completedItems = document.querySelectorAll('.sch-badge.completed').length;
        const completedEl    = document.querySelector('.summary-row .summary-card:nth-child(2) h3');
        if (completedEl) completedEl.textContent = completedItems;
    } catch (err) {
        console.error('Complete error:', err);
        showToast('Failed to update schedule', 'error');
        btn.disabled  = false;
        btn.innerHTML = '<i data-lucide="check-circle-2"></i> Mark Complete';
        if (window.lucide) window.lucide.createIcons();
    }
});

// ── Reports: paginated render ─────────────────────────────────────────────────
function renderReportsPage() {
    const list     = document.getElementById('reports-list');
    const controls = document.getElementById('pagination-controls');
    const info     = document.getElementById('report-pagination-info');
    if (!list) return;

    const totalPages = Math.ceil(allReports.length / REPORTS_PER_PAGE);
    const start      = (currentPage - 1) * REPORTS_PER_PAGE;
    const pageItems  = allReports.slice(start, start + REPORTS_PER_PAGE);

    const pendingEl = document.querySelector('.summary-row .summary-card:nth-child(3) h3');
    if (pendingEl) pendingEl.textContent = allReports.length;

    if (info) {
        info.textContent = allReports.length > 0
            ? `${start + 1}–${Math.min(start + REPORTS_PER_PAGE, allReports.length)} of ${allReports.length}`
            : '';
    }

    if (allReports.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:2rem;color:#78909C;font-size:0.875rem;">
                <i data-lucide="check-circle-2" style="width:36px;height:36px;opacity:0.3;display:block;margin:0 auto 0.75rem;"></i>
                No reports assigned to you.
            </div>`;
        if (controls) controls.style.display = 'none';
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    list.innerHTML = pageItems.map(r => {
        const imgHtml = r.imageUrl
            ? `<img src="${r.imageUrl}" alt="Report" onerror="this.style.display='none'">`
            : `<div style="width:48px;height:48px;border-radius:50%;background:#FFEBEE;
                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i data-lucide="alert-triangle" style="width:20px;height:20px;color:#D32F2F;"></i>
               </div>`;
        const ago = r.timestamp ? timeAgo(r.timestamp) : '';

        return `
            <div class="report-item"
                 data-report-id="${r.id}"
                 data-waste="${encodeURIComponent(r.wasteType || '')}"
                 data-location="${encodeURIComponent(r.location || '')}"
                 data-status="${encodeURIComponent(r.status || 'pending')}"
                 data-desc="${encodeURIComponent(r.description || r.desc || '')}"
                 data-reporter="${encodeURIComponent(r.reporterName || r.reporterEmail || r.reporterUid || '')}"
                 data-img="${encodeURIComponent(r.imageUrl || '')}"
                 data-ts="${r.timestamp ? r.timestamp.toDate().toLocaleString() : ''}">
                ${imgHtml}
                <div class="rep-info">
                    <h5>${r.wasteType || 'Waste Report'}</h5>
                    <p>${r.location || 'No location'}${ago ? ' • ' + ago : ''}</p>
                </div>
                <button class="btn-mark-done" data-id="${r.id}">
                    <i data-lucide="check-square" style="width:14px;height:14px;"></i>
                    Mark Completed
                </button>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.report-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.btn-mark-done')) return;
            openReportModal(item);
        });
    });

    list.querySelectorAll('.btn-mark-done').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const reportId = btn.dataset.id;
            btn.textContent = 'Saving...';
            btn.disabled    = true;
            try {
                await updateDoc(doc(db, 'reports', reportId), { status: 'resolved' });
                allReports = allReports.filter(r => r.id !== reportId);
                const newTotal = Math.ceil(allReports.length / REPORTS_PER_PAGE);
                if (currentPage > newTotal && newTotal > 0) currentPage = newTotal;
                renderReportsPage();
                showToast('Report marked as resolved ✓');
            } catch (err) {
                console.error('Mark done error:', err);
                btn.textContent = 'Mark Completed';
                btn.disabled    = false;
                showToast('Failed to update report', 'error');
            }
        });
    });

    if (controls) {
        if (totalPages > 1) {
            controls.style.display = 'flex';
            buildPaginationDots(totalPages);
        } else {
            controls.style.display = 'none';
        }
    }

    if (window.lucide) window.lucide.createIcons();
}

// ── Reports: open detail modal ────────────────────────────────────────────────
function openReportModal(item) {
    currentReportId = item.dataset.reportId;

    const wasteType = decodeURIComponent(item.dataset.waste)    || '—';
    const location  = decodeURIComponent(item.dataset.location) || '—';
    const status    = decodeURIComponent(item.dataset.status)   || 'pending';
    const desc      = decodeURIComponent(item.dataset.desc)     || 'No description provided.';
    const reporter  = decodeURIComponent(item.dataset.reporter) || '—';
    const imgUrl    = decodeURIComponent(item.dataset.img)      || '';
    const ts        = item.dataset.ts                           || '—';

    document.getElementById('rmodal-type').textContent     = wasteType;
    document.getElementById('rmodal-status').textContent   = status.charAt(0).toUpperCase() + status.slice(1);
    document.getElementById('rmodal-location').textContent = location;
    document.getElementById('rmodal-time').textContent     = ts;
    document.getElementById('rmodal-desc').textContent     = desc;
    document.getElementById('rmodal-reporter').textContent = reporter;

    const imgEl   = document.getElementById('rmodal-img');
    const noImgEl = document.getElementById('rmodal-no-img');
    if (imgUrl) {
        imgEl.src             = imgUrl;
        imgEl.style.display   = 'block';
        noImgEl.style.display = 'none';
    } else {
        imgEl.style.display   = 'none';
        noImgEl.style.display = 'flex';
    }

    const resolveBtn = document.getElementById('rmodal-btn-resolve');
    if (status === 'resolved') {
        resolveBtn.disabled    = true;
        resolveBtn.textContent = '✓ Already Resolved';
    } else {
        resolveBtn.disabled   = false;
        resolveBtn.innerHTML  = '<i data-lucide="check-circle-2"></i> Mark as Resolved';
    }

    document.getElementById('report-modal').classList.add('open');
    if (window.lucide) window.lucide.createIcons();
}

// ── Reports: resolve from modal ───────────────────────────────────────────────
document.getElementById('rmodal-btn-resolve')?.addEventListener('click', async () => {
    if (!currentReportId) return;
    const btn = document.getElementById('rmodal-btn-resolve');
    btn.disabled    = true;
    btn.textContent = 'Saving...';
    try {
        await updateDoc(doc(db, 'reports', currentReportId), { status: 'resolved' });
        allReports = allReports.filter(r => r.id !== currentReportId);
        const newTotal = Math.ceil(allReports.length / REPORTS_PER_PAGE);
        if (currentPage > newTotal && newTotal > 0) currentPage = newTotal;
        renderReportsPage();
        document.getElementById('report-modal').classList.remove('open');
        showToast('Report marked as resolved ✓');
    } catch (err) {
        console.error('Resolve error:', err);
        showToast('Failed to update report', 'error');
        btn.disabled  = false;
        btn.innerHTML = '<i data-lucide="check-circle-2"></i> Mark as Resolved';
        if (window.lucide) window.lucide.createIcons();
    }
});

// ── Pagination dots ───────────────────────────────────────────────────────────
function buildPaginationDots(totalPages) {
    const dotsEl  = document.getElementById('page-indicators');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    if (!dotsEl) return;

    dotsEl.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
        const dot = document.createElement('button');
        dot.className   = `page-dot${i === currentPage ? ' active' : ''}`;
        dot.textContent = i;
        dot.setAttribute('aria-label', `Page ${i}`);
        dot.addEventListener('click', () => { currentPage = i; renderReportsPage(); });
        dotsEl.appendChild(dot);
    }

    if (prevBtn) {
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick  = () => { if (currentPage > 1) { currentPage--; renderReportsPage(); } };
    }
    if (nextBtn) {
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick  = () => { if (currentPage < totalPages) { currentPage++; renderReportsPage(); } };
    }

    if (window.lucide) window.lucide.createIcons();
}

// ── Main auth listener ────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (userSnap.exists()) populateProfile(userSnap.data());

        const today = todayStr();

        // ── SCHEDULE QUERY ────────────────────────────────────────────────
        const [assignedSnap, legacySnap] = await Promise.all([
            getDocs(
                query(
                    collection(db, 'schedules'),
                    where('date', '==', today),
                    where('assignedWorkerUid', '==', user.uid)
                )
            ),
            getDocs(
                query(
                    collection(db, 'schedules'),
                    where('date', '==', today),
                    where('assignedWorkerUid', '==', null)
                )
            ),
        ]);

        const seenIds  = new Set();
        const schedules = [];

        [...assignedSnap.docs, ...legacySnap.docs].forEach(d => {
            if (!seenIds.has(d.id)) {
                seenIds.add(d.id);
                schedules.push({ id: d.id, ...d.data() });
            }
        });

        schedules.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        renderSchedule(schedules);

        // ── REPORTS: only fetch reports assigned to this worker ───────────
        const reportsSnap = await getDocs(
            query(
                collection(db, 'reports'),
                where('assignedWorkerUid', '==', user.uid)
            )
        );

        allReports = reportsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(r => r.status !== 'resolved')   // hide already-resolved
            .sort((a, b) => {
                const ta = a.timestamp?.toDate?.()?.getTime() || 0;
                const tb = b.timestamp?.toDate?.()?.getTime() || 0;
                return tb - ta;                      // newest first
            });

        renderReportsPage();

    } catch (err) {
        console.error('Worker dashboard error:', err);
        showToast('Error loading dashboard data', 'error');
    }
});

// ── Sign Out ──────────────────────────────────────────────────────────────────
const signOutBtn = document.getElementById('btn-sign-out');
if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            window.location.href = 'login.html';
        } catch {
            showToast('Sign out failed', 'error');
        }
    });
}

// ── Location button: toggle tracking ─────────────────────────────────────────
const locationBtn = document.getElementById('btn-share-location');
if (locationBtn) {
    locationBtn.addEventListener('click', () => {
        if (locationBtn.dataset.tracking === 'true') {
            stopTracking();
        } else {
            startTracking();
        }
    });
}