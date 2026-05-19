import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    orderBy, 
    getDocs, 
    Timestamp,
    deleteDoc,
    doc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Global states
let currentTab = 'scanned'; 
let dateRange = 30; 
let selectedCategory = 'All'; 

onAuthStateChanged(auth, async (user) => {
    if (user) {
        injectModalStyles();
        injectDetailModal();
        setupTabListeners();
        setupFilterListeners(); 
        loadHistoryData(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// ══════════════════════════════════════════
// STYLES (injected once)
// ══════════════════════════════════════════
function injectModalStyles() {
    if (document.getElementById('hist-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'hist-modal-styles';
    style.textContent = `
        @keyframes histModalPop {
            from { opacity:0; transform:scale(0.92) translateY(16px); }
            to   { opacity:1; transform:scale(1)  translateY(0); }
        }
        #hist-detail-overlay {
            display:none; position:fixed; inset:0;
            background:rgba(0,0,0,0.45); z-index:600;
            align-items:center; justify-content:center; padding:1rem;
        }
        #hist-detail-card {
            background:#fff; border-radius:28px; width:100%; max-width:440px;
            box-shadow:0 24px 60px rgba(0,0,0,0.18); overflow:hidden;
            animation:histModalPop 0.28s cubic-bezier(0.34,1.56,0.64,1);
            font-family:'Outfit',sans-serif;
        }
        #hist-detail-img { width:100%; height:220px; object-fit:cover; display:block; }
        .hm-no-img {
            width:100%; height:160px;
            background:linear-gradient(135deg,#E8F5E9,#C8E6C9);
            display:flex; align-items:center; justify-content:center; font-size:3rem;
        }
        .hm-body { padding:1.75rem; }
        .hm-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.25rem; }
        .hm-title { font-size:1.3rem; font-weight:700; color:#1B5E20; margin:0; flex:1; padding-right:1rem; }
        .hm-x {
            background:#F5F5F5; border:none; border-radius:50%;
            width:32px; height:32px; cursor:pointer; font-size:1rem; color:#546E7A;
            display:flex; align-items:center; justify-content:center; flex-shrink:0;
        }
        .hm-row { display:flex; align-items:flex-start; gap:0.75rem; padding:0.75rem 0; border-bottom:1px solid #F5F5F5; }
        .hm-row:last-of-type { border-bottom:none; }
        .hm-label { font-size:0.6rem; font-weight:800; letter-spacing:0.8px; text-transform:uppercase; color:#9E9E9E; min-width:90px; padding-top:2px; }
        .hm-value { font-size:0.9rem; font-weight:600; color:#263238; flex:1; }
        .hm-badge { display:inline-block; padding:3px 12px; border-radius:20px; font-size:0.6rem; font-weight:800; text-transform:uppercase; }
        .hm-badge.plastic  { background:#E8F5E9; color:#2E7D32; }
        .hm-badge.organic  { background:#FFF3E0; color:#E65100; }
        .hm-badge.paper    { background:#F1F8E9; color:#558B2F; }
        .hm-badge.hazard   { background:#FFEBEE; color:#C62828; }
        .hm-badge.rpt-pending  { background:#FFF3E0; color:#E65100; }
        .hm-badge.rpt-resolved { background:#E8F5E9; color:#2E7D32; }
        .hm-badge.rpt-ongoing  { background:#E3F2FD; color:#1E88E5; }
        .hm-close-btn {
            width:100%; margin-top:1.5rem; background:#2E7D32; color:white;
            border:none; padding:1rem; border-radius:50px; font-weight:700;
            font-size:1rem; cursor:pointer; font-family:'Outfit',sans-serif; transition:background 0.2s;
        }
        .hm-close-btn:hover { background:#1B5E20; }

        /* 3-dot dropdown */
        .dot-menu-wrapper { position:relative; }
        .dot-dropdown {
            display:none; position:absolute; right:0; top:calc(100% + 6px);
            background:white; border-radius:14px; box-shadow:0 8px 24px rgba(0,0,0,0.12);
            min-width:160px; z-index:400; overflow:hidden;
        }
        .dot-dropdown.open { display:block; }
        .dot-dropdown button {
            width:100%; background:none; border:none; padding:0.85rem 1.25rem;
            text-align:left; font-size:0.88rem; font-weight:600; color:#263238;
            cursor:pointer; font-family:'Outfit',sans-serif;
            display:flex; align-items:center; gap:0.75rem; transition:background 0.15s;
        }
        .dot-dropdown button:hover { background:#F1F8E9; color:#1B5E20; }
        .dot-dropdown button.danger { color:#C62828; }
        .dot-dropdown button.danger:hover { background:#FFEBEE; }
        .dot-dropdown hr { border:none; border-top:1px solid #F5F5F5; margin:0; }

        /* Delete confirm */
        #hist-confirm-overlay {
            display:none; position:fixed; inset:0;
            background:rgba(0,0,0,0.45); z-index:700;
            align-items:center; justify-content:center; padding:1rem;
        }
        #hist-confirm-card {
            background:white; border-radius:24px; padding:2rem; max-width:360px; width:100%;
            font-family:'Outfit',sans-serif; box-shadow:0 24px 60px rgba(0,0,0,0.18);
            text-align:center; animation:histModalPop 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        .hc-icon { width:56px; height:56px; border-radius:50%; background:#FFEBEE; margin:0 auto 1rem; display:flex; align-items:center; justify-content:center; font-size:1.5rem; }
        #hist-confirm-card h3 { font-size:1.15rem; font-weight:700; color:#263238; margin-bottom:0.5rem; }
        #hist-confirm-card p  { font-size:0.875rem; color:#546E7A; margin-bottom:1.5rem; }
        .hc-btns { display:flex; gap:0.75rem; }
        .hc-cancel { flex:1; background:#F5F5F5; color:#546E7A; border:none; padding:0.9rem; border-radius:50px; font-weight:700; font-size:0.9rem; cursor:pointer; font-family:'Outfit',sans-serif; }
        .hc-delete { flex:1; background:#C62828; color:white; border:none; padding:0.9rem; border-radius:50px; font-weight:700; font-size:0.9rem; cursor:pointer; font-family:'Outfit',sans-serif; transition:background 0.2s; }
        .hc-delete:hover { background:#B71C1C; }
    `;
    document.head.appendChild(style);
}

// ══════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════
function injectDetailModal() {
    if (document.getElementById('hist-detail-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'hist-detail-overlay';
    overlay.innerHTML = `
        <div id="hist-detail-card">
            <div id="hist-detail-img-wrap"></div>
            <div class="hm-body">
                <div class="hm-top">
                    <h3 class="hm-title" id="hm-title">—</h3>
                    <button class="hm-x" id="hm-x">✕</button>
                </div>
                <div id="hm-rows"></div>
                <button class="hm-close-btn" id="hm-close-btn">Close</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const confirmOverlay = document.createElement('div');
    confirmOverlay.id = 'hist-confirm-overlay';
    confirmOverlay.innerHTML = `
        <div id="hist-confirm-card">
            <div class="hc-icon">🗑️</div>
            <h3>Delete this record?</h3>
            <p>This will permanently remove it from your history. This cannot be undone.</p>
            <div class="hc-btns">
                <button class="hc-cancel" id="hc-cancel">Cancel</button>
                <button class="hc-delete" id="hc-confirm-delete">Delete</button>
            </div>
        </div>`;
    document.body.appendChild(confirmOverlay);

    document.getElementById('hm-x').addEventListener('click', closeDetailModal);
    document.getElementById('hm-close-btn').addEventListener('click', closeDetailModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDetailModal(); });
    document.getElementById('hc-cancel').addEventListener('click', closeConfirmModal);
    confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) closeConfirmModal(); });
}

function openDetailModal(data, type) {
    const imgWrap = document.getElementById('hist-detail-img-wrap');
    const titleEl = document.getElementById('hm-title');
    const rowsEl  = document.getElementById('hm-rows');
    const imgSrc  = type === 'scanned' ? data.itemImage : data.imageUrl;

    imgWrap.innerHTML = imgSrc
        ? `<img id="hist-detail-img" src="${imgSrc}" alt="photo" onerror="this.parentElement.innerHTML='<div class=hm-no-img>${type === 'scanned' ? '♻️' : '📋'}</div>'">`
        : `<div class="hm-no-img">${type === 'scanned' ? '♻️' : '📋'}</div>`;

    if (type === 'scanned') {
        titleEl.textContent = data.itemName || 'Scanned Item';
        const bc = getBadgeClass(data.category);
        const tl = data.timestamp
            ? data.timestamp.toDate().toLocaleString('en-PH', { dateStyle:'long', timeStyle:'short' })
            : 'Just now';
        rowsEl.innerHTML = buildRows([
            { label:'Category', value:`<span class="hm-badge ${bc}">${data.category || '—'}</span>` },
            { label:'Points',   value:`+${data.points || 5} pts earned` },
            { label:'Scanned',  value: tl },
            { label:'Tip',      value: data.disposalTip || data.tip || 'Dispose properly at your nearest recycling center.' },
        ]);
    } else {
        titleEl.textContent = `${data.wasteType || 'Waste'} Report`;
        const st = (data.status || 'pending').toLowerCase();
        rowsEl.innerHTML = buildRows([
            { label:'Status',      value:`<span class="hm-badge rpt-${st}">${st.toUpperCase()}</span>` },
            { label:'Type',        value: data.wasteType   || '—' },
            { label:'Location',    value: data.location    || '—' },
            { label:'Description', value: data.description || 'No description.' },
            { label:'Submitted',   value: formatFirebaseDate(data.timestamp) },
        ]);
    }

    document.getElementById('hist-detail-overlay').style.display = 'flex';
}

function buildRows(rows) {
    return rows.map(r =>
        `<div class="hm-row"><span class="hm-label">${r.label}</span><span class="hm-value">${r.value}</span></div>`
    ).join('');
}

function closeDetailModal() {
    document.getElementById('hist-detail-overlay').style.display = 'none';
}

// Delete confirm state
let pendingDeleteId   = null;
let pendingDeleteCard = null;
let pendingDeleteCol  = null;

function openConfirmModal(docId, cardEl, collectionName) {
    pendingDeleteId   = docId;
    pendingDeleteCard = cardEl;
    pendingDeleteCol  = collectionName;

    // Re-clone button to avoid stacking listeners
    const btn    = document.getElementById('hc-confirm-delete');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', executeDelete);

    document.getElementById('hist-confirm-overlay').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('hist-confirm-overlay').style.display = 'none';
    pendingDeleteId = pendingDeleteCard = pendingDeleteCol = null;
}

async function executeDelete() {
    if (!pendingDeleteId || !pendingDeleteCol) return;
    try {
        await deleteDoc(doc(db, pendingDeleteCol, pendingDeleteId));
        if (pendingDeleteCard) {
            pendingDeleteCard.style.transition = 'opacity 0.3s, transform 0.3s';
            pendingDeleteCard.style.opacity    = '0';
            pendingDeleteCard.style.transform  = 'translateX(30px)';
            setTimeout(() => pendingDeleteCard.remove(), 300);
        }
        closeConfirmModal();
    } catch (err) {
        console.error('Delete failed:', err);
        closeConfirmModal();
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.dot-dropdown.open').forEach(d => d.classList.remove('open'));
});

// 1. TABS LOGIC
function setupTabListeners() {
    const scanTab   = document.getElementById('tab-scanned-items');
    const reportTab = document.getElementById('tab-reports');

    scanTab?.addEventListener('click', () => {
        if (currentTab === 'scanned') return;
        currentTab = 'scanned'; selectedCategory = 'All';
        updateTabUI(scanTab, reportTab);
        loadHistoryData(auth.currentUser.uid);
    });

    reportTab?.addEventListener('click', () => {
        if (currentTab === 'reports') return;
        currentTab = 'reports'; selectedCategory = 'All';
        updateTabUI(reportTab, scanTab);
        loadHistoryData(auth.currentUser.uid);
    });
}

function updateTabUI(active, inactive) {
    active.classList.replace('inactive','active');   active.classList.add('active');
    inactive.classList.replace('active','inactive'); inactive.classList.add('inactive');
    const span = document.getElementById('filter-category-btn')?.querySelector('span');
    if (span) span.textContent = 'Category';
}

// 2. FILTERS LOGIC
function setupFilterListeners() {
    const catBtn  = document.getElementById('filter-category-btn');
    const catMenu = document.getElementById('category-menu');
    const dateBtn = document.getElementById('filter-date-btn');
    const dateMenu = document.getElementById('date-menu');

    catBtn?.addEventListener('click', e => { e.stopPropagation(); catMenu.classList.toggle('show'); dateMenu.classList.remove('show'); });
    dateBtn?.addEventListener('click', e => { e.stopPropagation(); dateMenu.classList.toggle('show'); catMenu.classList.remove('show'); });

    catMenu?.querySelectorAll('li').forEach(item => {
        item.addEventListener('click', () => {
            selectedCategory = item.getAttribute('data-value');
            if (catBtn.querySelector('span')) catBtn.querySelector('span').textContent = selectedCategory;
            catMenu.classList.remove('show');
            loadHistoryData(auth.currentUser.uid);
        });
    });

    dateMenu?.querySelectorAll('li').forEach(item => {
        item.addEventListener('click', () => {
            dateRange = parseInt(item.getAttribute('data-days'));
            if (dateBtn.querySelector('span')) dateBtn.querySelector('span').textContent = `Last ${dateRange} Days`;
            dateMenu.classList.remove('show');
            loadHistoryData(auth.currentUser.uid);
        });
    });

    window.addEventListener('click', () => { catMenu?.classList.remove('show'); dateMenu?.classList.remove('show'); });
}

// 3. DATA LOADING
async function loadHistoryData(uid) {
    const container = document.getElementById('history-items-container');
    if (!container) return;
    container.innerHTML = `<div class="loading-state"><p>Loading your history...</p></div>`;

    try {
        const collectionName = currentTab === 'scanned' ? 'scans' : 'reports';
        const userField      = currentTab === 'scanned' ? 'userId' : 'reporterUid';
        let constraints      = [where(userField, '==', uid)];

        if (dateRange !== 999) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - dateRange);
            constraints.push(where('timestamp', '>=', Timestamp.fromDate(cutoff)));
        }
        if (selectedCategory !== 'All') {
            constraints.push(where(currentTab === 'scanned' ? 'category' : 'wasteType', '==', selectedCategory));
        }
        constraints.push(orderBy('timestamp', 'desc'));

        const snap = await getDocs(query(collection(db, collectionName), ...constraints));
        container.innerHTML = '';

        if (snap.empty) {
            const rangeText = dateRange === 999 ? 'all time' : `the last ${dateRange} days`;
            container.innerHTML = `<div class="empty-state"><p>No ${selectedCategory !== 'All' ? selectedCategory : ''} items found for ${rangeText}.</p></div>`;
            updateMetrics(0, currentTab);
            return;
        }

        updateMetrics(snap.size, currentTab);
        snap.forEach(document => {
            const data = document.data();
            const card = currentTab === 'scanned'
                ? createScanCard(data, document.id, collectionName)
                : createReportCard(data, document.id, collectionName);
            container.appendChild(card);
        });

        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        console.error('Error loading history:', error);
        container.innerHTML = '<p class="error-msg">Failed to load data. Please check your Firestore indexes.</p>';
    }
}

// 4. CARD GENERATORS
function getBadgeClass(category) {
    const c = (category || '').toLowerCase();
    if (c.includes('plastic'))                      return 'plastic';
    if (c.includes('paper'))                        return 'paper';
    if (c.includes('bio') || c.includes('organic')) return 'organic';
    if (c.includes('haz'))                          return 'hazard';
    return 'plastic';
}

function createScanCard(data, docId, collName) {
    const card      = document.createElement('div');
    card.className  = 'history-card';
    const imageSrc  = data.itemImage || '../assets/img/default-waste.png';
    const badgeClass = getBadgeClass(data.category);
    const timeLabel = data.timestamp
        ? data.timestamp.toDate().toLocaleString('en-PH', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : 'Just now';

    card.innerHTML = `
        <div class="item-thumb">
            <img src="${imageSrc}" alt="${data.itemName || 'Scanned item'}"
                 style="width:100%;height:100%;object-fit:cover;border-radius:20px;"
                 onerror="this.style.display='none'">
        </div>
        <div class="item-main">
            <div class="item-meta">
                <span class="item-badge ${badgeClass}">${data.category || 'Item'}</span>
                <span class="item-time">${timeLabel}</span>
            </div>
            <div class="item-title">${data.itemName || 'Scanned Item'}</div>
            <div class="item-tip">
                <i data-lucide="recycle" style="width:16px;height:16px;"></i>
                +${data.points || 5} pts earned · Recyclable
            </div>
        </div>
        <div class="item-actions dot-menu-wrapper">
            <i data-lucide="more-vertical" style="width:20px;height:20px;cursor:pointer;"></i>
            <div class="dot-dropdown">
                <button class="dot-view-btn">
                    <i data-lucide="eye" style="width:16px;height:16px;"></i> View Details
                </button>
                <hr>
                <button class="dot-delete-btn danger">
                    <i data-lucide="trash-2" style="width:16px;height:16px;"></i> Delete
                </button>
            </div>
        </div>`;

    wireCardMenu(card, data, docId, collName, 'scanned');
    return card;
}

function createReportCard(data, docId, collName) {
    const card     = document.createElement('div');
    card.className = 'history-card';
    const imageSrc = data.imageUrl || '../assets/placeholder.png';
    const status   = (data.status || 'pending').toLowerCase();
    const timeLabel = formatFirebaseDate(data.timestamp);

    card.innerHTML = `
        <div class="item-thumb">
            <img src="${imageSrc}" alt="Report photo"
                 style="width:100%;height:100%;object-fit:cover;border-radius:20px;"
                 onerror="this.style.display='none'">
        </div>
        <div class="item-main">
            <div class="item-meta">
                <span class="item-badge rpt-${status}">${status.toUpperCase()}</span>
                <span class="item-time">${timeLabel}</span>
            </div>
            <div class="item-title">${data.wasteType || 'Waste'} Report</div>
            <div class="item-tip">
                <i data-lucide="map-pin" style="width:16px;height:16px;"></i>
                ${data.location || data.description || 'No location provided.'}
            </div>
        </div>
        <div class="item-actions dot-menu-wrapper">
            <i data-lucide="more-vertical" style="width:20px;height:20px;cursor:pointer;"></i>
            <div class="dot-dropdown">
                <button class="dot-view-btn">
                    <i data-lucide="eye" style="width:16px;height:16px;"></i> View Details
                </button>
                <hr>
                <button class="dot-delete-btn danger">
                    <i data-lucide="trash-2" style="width:16px;height:16px;"></i> Delete
                </button>
            </div>
        </div>`;

    wireCardMenu(card, data, docId, collName, 'reports');
    return card;
}

function wireCardMenu(card, data, docId, collName, type) {
    const wrapper   = card.querySelector('.dot-menu-wrapper');
    const icon      = wrapper.querySelector('[data-lucide="more-vertical"]');
    const dropdown  = wrapper.querySelector('.dot-dropdown');
    const viewBtn   = wrapper.querySelector('.dot-view-btn');
    const deleteBtn = wrapper.querySelector('.dot-delete-btn');

    icon.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.dot-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
        dropdown.classList.toggle('open');
    });

    dropdown.addEventListener('click', e => e.stopPropagation());

    viewBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        openDetailModal(data, type);
    });

    deleteBtn.addEventListener('click', () => {
        dropdown.classList.remove('open');
        openConfirmModal(docId, card, collName);
    });
}

// 5. HELPERS
function formatFirebaseDate(timestamp) {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return date.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' })
         + ' • ' + date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function updateMetrics(count, type) {
    if (type === 'scanned') document.getElementById('history-scanned-count').textContent  = count;
    if (type === 'reports') document.getElementById('history-submitted-count').textContent = count;
}