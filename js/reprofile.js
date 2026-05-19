/**
 * reprofile.js
 * Handles all Firebase-driven functionality for reprofile.html:
 *  - Auth guard (redirects to login if not signed in)
 *  - Loads user data from Firestore "users" collection
 *  - Loads submitted reports count from "reports" collection
 *  - Populates stats, form fields, avatar initial, header initial
 *  - Loads recent activity (last 5 scans + last 3 reports)
 *  - Edit / Save toggle for form fields
 *  - Sign out
 */

import { auth, db } from './firebase-config.js';
import { signOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    doc,
    getDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getCountFromServer,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Toast (self-contained so this module has no dependency on res-dashboard.js) ──
function showToast(type, title, subtitle = '') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:none;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:12px 18px;font-size:14px;pointer-events:auto;opacity:0;transform:translateY(16px) scale(0.97);transition:opacity 0.25s ease,transform 0.25s ease;min-width:260px;max-width:360px;box-shadow:0 4px 16px rgba(0,0,0,0.08);';
    const isSuccess = type === 'success';
    const iconColor = isSuccess ? '#2ecc71' : '#e74c3c';
    const iconBg    = isSuccess ? '#eafaf1' : '#fdf0f0';
    const iconPath  = isSuccess
        ? `<path d="M3 8l3.5 3.5L13 4.5" stroke="${iconColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M4 4l8 8M12 4l-8 8" stroke="${iconColor}" stroke-width="1.8" stroke-linecap="round"/>`;
    toast.innerHTML = `
        <div style="width:32px;height:32px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">${iconPath}</svg>
        </div>
        <div style="flex:1;">
            <p style="margin:0 0 3px;font-weight:600;font-size:14px;color:#1a1a1a;">${title}</p>
            ${subtitle ? `<p style="margin:0;font-size:12px;color:#555;line-height:1.5;">${subtitle}</p>` : ''}
        </div>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:18px;padding:2px;line-height:1;flex-shrink:0;">&times;</button>
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
    }, 4500);
}

// ── Role display map (Firestore stores "res", "admin", "worker") ──
const ROLE_LABELS = { res: 'Resident', admin: 'LGU Admin', worker: 'Worker' };

// ── Helpers ──
function setEl(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') {
        // Match option by value or text
        const options = Array.from(el.options);
        const match = options.find(o => o.value === value || o.text === value);
        if (match) el.value = match.value;
        else el.value = '';
    } else if (el.tagName === 'INPUT') {
        el.value = value;
    } else {
        el.textContent = value;
    }
}

function setAvatar(initial) {
    // Large profile avatar
    setEl('profile-avatar-initial', initial);

    // Header avatar (top-right .user-profile circle) — initial only (no photo here)
    document.querySelectorAll('.user-profile').forEach(container => {
        container.style.backgroundColor = '#2e7d32';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        const span = container.querySelector('.user-initial-display');
        if (span) span.textContent = initial;
        else container.innerHTML = `<span class="user-initial-display" style="color:white;font-weight:600;font-size:16px;">${initial}</span>`;
    });
}

// ── Update header .user-profile circle with a photo ──
function setHeaderPhoto(photoBase64, firstName) {
    document.querySelectorAll('.user-profile').forEach(container => {
        container.style.backgroundColor = 'transparent';
        container.innerHTML = `<img src="${photoBase64}" alt="${firstName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    });
}

// ── Format a Firestore Timestamp for activity feed ──
function timeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const ms  = timestamp.toDate().getTime();
    const diff = Math.floor((now - ms) / 1000);
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// ── Build an activity list item element ──
function buildActivityItem(iconClass, iconName, title, subtitle, time) {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
        <div class="act-icon ${iconClass}">
            <i data-lucide="${iconName}"></i>
        </div>
        <div class="act-info">
            <h5>${title}</h5>
            <p>${subtitle}</p>
            <span class="act-time">${time}</span>
        </div>
    `;
    return item;
}

// ── Main auth listener ──
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    try {
        // ── 1. Load user document from Firestore ──
        const userRef  = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            showToast('error', 'Profile not found', 'Your account data could not be loaded.');
            return;
        }

        const data = userSnap.data();
        const firstName = data.fullName ? data.fullName.split(' ')[0] : 'User';
        const initial   = firstName.charAt(0).toUpperCase();
        const roleLabel = ROLE_LABELS[data.role] || data.role || 'Resident';

        // ── 2. Populate header + profile card ──
        setAvatar(initial);

        if (data.photoBase64) {
            document.querySelectorAll('.avatar-large-wrap').forEach(wrap => {
                wrap.style.backgroundImage    = `url('${data.photoBase64}')`;
                wrap.style.backgroundSize     = 'cover';
                wrap.style.backgroundPosition = 'center';
                const initial_el = wrap.querySelector('.avatar-large-initial');
                if (initial_el) initial_el.style.display = 'none';
            });
            setHeaderPhoto(data.photoBase64, firstName);
        }

        setEl('user-name-display', firstName);
        setEl('profile-full-name', data.fullName || '—');
        setEl('profile-email',     data.email    || user.email || '—');
        setEl('profile-role',      roleLabel);

        // ── 3. Populate form fields ──
        setEl('form-fullname', data.fullName || '');
        setEl('form-email',    data.email    || user.email || '');
        setEl('form-area',     data.area     || '');   // matches select option text
        setEl('form-role',     roleLabel);

        // ── 4. Populate stats from users doc ──
        setEl('stat-scanned',  data.scannedCount         || 0);
        setEl('stat-recycled', data.recycledCount         || 0);
        setEl('stat-resolved', data.resolvedReportsCount  || 0);

        // ── 5. Submitted reports count ──
        try {
            const reportsRef      = collection(db, 'reports');
            const submittedQuery  = query(reportsRef, where('reporterUid', '==', user.uid));
            const submittedSnap   = await getCountFromServer(submittedQuery);
            setEl('stat-submitted', submittedSnap.data().count);
        } catch (e) {
            console.warn('Could not fetch reports count:', e);
            setEl('stat-submitted', '—');
        }

        // ── 6. Recent activity feed ──
        await loadRecentActivity(user.uid);

        if (window.lucide) window.lucide.createIcons();

    } catch (err) {
        console.error('Profile load error:', err);
        showToast('error', 'Error loading profile', err.message);
    }
});

// ── Load recent scans + reports into the activity list ──
async function loadRecentActivity(uid) {
    const listEl = document.getElementById('activity-list');
    if (!listEl) return;

    const items = [];

    try {
        const scansQ  = query(
            collection(db, 'scans'),
            where('userId', '==', uid),
            orderBy('timestamp', 'desc'),
            limit(5)
        );
        const scansSnap = await getDocs(scansQ);
        scansSnap.forEach(d => {
            const data = d.data();
            items.push({
                type:      'scan',
                iconClass: 'green',
                iconName:  'recycle',
                title:     `${data.itemName || 'Item'} Scanned`,
                subtitle:  `+${data.points || 5} pts`,
                ts:        data.timestamp
            });
        });
    } catch (e) { console.warn('Scans activity error:', e); }

    try {
        const reportsQ  = query(
            collection(db, 'reports'),
            where('reporterUid', '==', uid),
            orderBy('timestamp', 'desc'),
            limit(3)
        );
        const reportsSnap = await getDocs(reportsQ);
        reportsSnap.forEach(d => {
            const data = d.data();
            items.push({
                type:      'report',
                iconClass: data.status === 'resolved' ? 'blue' : 'red',
                iconName:  data.status === 'resolved' ? 'check-circle-2' : 'alert-triangle',
                title:     `${data.wasteType || 'Waste'} Report`,
                subtitle:  data.location || 'No location provided',
                ts:        data.timestamp
            });
        });
    } catch (e) { console.warn('Reports activity error:', e); }

    items.sort((a, b) => {
        const ta = a.ts?.toDate?.()?.getTime() || 0;
        const tb = b.ts?.toDate?.()?.getTime() || 0;
        return tb - ta;
    });

    listEl.innerHTML = '';

    if (items.length === 0) {
        listEl.innerHTML = '<p class="loading-text">No recent activity yet.</p>';
        return;
    }

    items.slice(0, 6).forEach(item => {
        listEl.appendChild(
            buildActivityItem(item.iconClass, item.iconName, item.title, item.subtitle, timeAgo(item.ts))
        );
    });
}

// ── Edit / Save toggle ──
const editBtn = document.getElementById('btn-edit-profile');
const saveBtn = document.getElementById('btn-save-changes');

// Fields that use readonly (inputs)
const readonlyIds = ['form-fullname', 'form-email'];
// Fields that use disabled (selects)
const selectIds   = ['form-area'];

let isEditing = false;

function setEditMode(on) {
    isEditing = on;

    // Toggle inputs (readonly)
    readonlyIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.readOnly      = !on;
        el.style.background  = on ? 'white'   : '';
        el.style.borderColor = on ? '#2E7D32' : '';
        el.style.cursor      = on ? 'text'    : 'default';
    });

    // Toggle selects (disabled)
    selectIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled          = !on;
        el.style.background  = on ? 'white'   : '';
        el.style.borderColor = on ? '#2E7D32' : '';
        el.style.cursor      = on ? 'pointer' : 'default';
        // Show/hide the dropdown arrow via opacity on the background-image
        el.style.opacity     = on ? '1'       : '0.7';
    });

    if (editBtn) editBtn.textContent = on ? 'Cancel' : 'Edit Profile';
}

if (editBtn) {
    editBtn.addEventListener('click', () => setEditMode(!isEditing));
}

if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        if (!isEditing) {
            showToast('error', 'Not in edit mode', 'Click "Edit Profile" first.');
            return;
        }

        const user = auth.currentUser;
        if (!user) return;

        const newName  = document.getElementById('form-fullname')?.value?.trim();
        const newEmail = document.getElementById('form-email')?.value?.trim();
        const areaEl   = document.getElementById('form-area');
        const newArea  = areaEl ? areaEl.options[areaEl.selectedIndex]?.text?.trim() : '';

        if (!newName) {
            showToast('error', 'Name required', 'Full name cannot be empty.');
            return;
        }
        if (!newEmail || !newEmail.includes('@')) {
            showToast('error', 'Invalid email', 'Please enter a valid email address.');
            return;
        }

        try {
            saveBtn.textContent = 'Saving...';
            saveBtn.disabled    = true;

            await updateDoc(doc(db, 'users', user.uid), {
                fullName: newName,
                email:    newEmail,
                area:     newArea || ''
            });

            setEl('profile-full-name', newName);
            setEl('profile-email', newEmail);
            const firstName = newName.split(' ')[0];
            setEl('user-name-display', firstName);
            setAvatar(firstName.charAt(0).toUpperCase());

            setEditMode(false);
            showToast('success', 'Profile updated!', 'Your changes have been saved.');
        } catch (err) {
            console.error('Save error:', err);
            showToast('error', 'Save failed', err.message);
        } finally {
            saveBtn.textContent = 'Save Changes';
            saveBtn.disabled    = false;
        }
    });
}

// ── Sign Out ──
const signOutBtn = document.getElementById('btn-sign-out');
if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            window.location.href = 'login.html';
        } catch (err) {
            showToast('error', 'Sign out failed', err.message);
        }
    });
}

// ══════════════════════════════════════════
// CHANGE PASSWORD MODAL
// ══════════════════════════════════════════
const changePassBtn      = document.getElementById('btn-change-password');
const passwordModal      = document.getElementById('password-modal');
const passwordModalClose = document.getElementById('password-modal-close');
const cpCancel           = document.getElementById('cp-cancel');
const cpSave             = document.getElementById('cp-save');

function openPasswordModal()  { if (passwordModal) passwordModal.classList.add('active'); }
function closePasswordModal() {
    if (passwordModal) passwordModal.classList.remove('active');
    ['cp-current','cp-new','cp-confirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

if (changePassBtn)      changePassBtn.addEventListener('click', openPasswordModal);
if (passwordModalClose) passwordModalClose.addEventListener('click', closePasswordModal);
if (cpCancel)           cpCancel.addEventListener('click', closePasswordModal);

if (passwordModal) {
    passwordModal.addEventListener('click', e => {
        if (e.target === passwordModal) closePasswordModal();
    });
}

document.querySelectorAll('.rp-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', input.type === 'password' ? 'eye' : 'eye-off');
        if (window.lucide) window.lucide.createIcons();
    });
});

if (cpSave) {
    cpSave.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) return;

        const current = document.getElementById('cp-current')?.value;
        const newPass  = document.getElementById('cp-new')?.value;
        const confirm  = document.getElementById('cp-confirm')?.value;

        if (!current) { showToast('error', 'Current password required', ''); return; }
        if (!newPass || newPass.length < 6) {
            showToast('error', 'Password too short', 'New password must be at least 6 characters.');
            return;
        }
        if (newPass !== confirm) {
            showToast('error', 'Passwords do not match', 'New password and confirm password must match.');
            return;
        }

        try {
            cpSave.textContent = 'Updating...';
            cpSave.disabled    = true;

            const credential = EmailAuthProvider.credential(user.email, current);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPass);

            showToast('success', 'Password updated!', 'Your new password is active.');
            closePasswordModal();
        } catch (err) {
            console.error('Password change error:', err.code);
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                showToast('error', 'Wrong current password', 'Please check your current password and try again.');
            } else if (err.code === 'auth/too-many-requests') {
                showToast('error', 'Too many attempts', 'Please wait a moment and try again.');
            } else {
                showToast('error', 'Update failed', err.message);
            }
        } finally {
            cpSave.textContent = 'Update Password';
            cpSave.disabled    = false;
        }
    });
}

// ══════════════════════════════════════════
// PHOTO PICKER MODAL
// ══════════════════════════════════════════
const avatarTrigger   = document.getElementById('avatar-trigger');
const photoModal      = document.getElementById('photo-modal');
const photoModalClose = document.getElementById('photo-modal-close');
const optCamera       = document.getElementById('opt-camera');
const optFile         = document.getElementById('opt-file');
const inputCamera     = document.getElementById('input-camera');
const inputFile       = document.getElementById('input-file');
const previewWrap     = document.getElementById('photo-preview-wrap');
const previewImg      = document.getElementById('photo-preview-img');
const photoRetake     = document.getElementById('photo-retake');
const photoSave       = document.getElementById('photo-save');

let pendingPhotoBase64 = null;

function openPhotoModal()  { if (photoModal) photoModal.classList.add('active'); }
function closePhotoModal() {
    if (photoModal) photoModal.classList.remove('active');
    if (previewWrap) previewWrap.style.display = 'none';
    pendingPhotoBase64 = null;
}

if (avatarTrigger)   avatarTrigger.addEventListener('click', openPhotoModal);
if (photoModalClose) photoModalClose.addEventListener('click', closePhotoModal);
if (photoModal) {
    photoModal.addEventListener('click', e => {
        if (e.target === photoModal) closePhotoModal();
    });
}

function compressImage(file, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = e => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX    = 400;
            const scale  = MAX / Math.max(img.width, img.height);
            canvas.width  = img.width  * (scale < 1 ? scale : 1);
            canvas.height = img.height * (scale < 1 ? scale : 1);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        };
    };
}

function handleFileSelect(file) {
    if (!file) return;
    compressImage(file, base64 => {
        pendingPhotoBase64 = base64;
        if (previewImg)  previewImg.src = base64;
        if (previewWrap) previewWrap.style.display = 'block';
    });
}

if (optCamera)   optCamera.addEventListener('click',  () => inputCamera?.click());
if (optFile)     optFile.addEventListener('click',    () => inputFile?.click());
if (inputCamera) inputCamera.addEventListener('change', e => handleFileSelect(e.target.files[0]));
if (inputFile)   inputFile.addEventListener('change',   e => handleFileSelect(e.target.files[0]));
if (photoRetake) photoRetake.addEventListener('click', () => {
    pendingPhotoBase64 = null;
    if (previewWrap) previewWrap.style.display = 'none';
});

if (photoSave) {
    photoSave.addEventListener('click', async () => {
        if (!pendingPhotoBase64) return;
        const user = auth.currentUser;
        if (!user) return;

        try {
            photoSave.textContent = 'Saving...';
            photoSave.disabled    = true;

            await updateDoc(doc(db, 'users', user.uid), { photoBase64: pendingPhotoBase64 });

            document.querySelectorAll('.avatar-large-wrap').forEach(wrap => {
                wrap.style.backgroundImage    = `url('${pendingPhotoBase64}')`;
                wrap.style.backgroundSize     = 'cover';
                wrap.style.backgroundPosition = 'center';
                const initial = wrap.querySelector('.avatar-large-initial');
                if (initial) initial.style.display = 'none';
                const hint = wrap.querySelector('.avatar-edit-hint');
                if (hint) hint.style.background = 'rgba(0,0,0,0.35)';
            });

            const currentName = document.getElementById('profile-full-name')?.textContent || 'User';
            const firstName   = currentName.split(' ')[0];
            setHeaderPhoto(pendingPhotoBase64, firstName);

            showToast('success', 'Photo updated!', 'Your profile photo has been saved.');
            closePhotoModal();
        } catch (err) {
            console.error('Photo save error:', err);
            showToast('error', 'Save failed', err.message);
        } finally {
            photoSave.textContent = 'Save Photo';
            photoSave.disabled    = false;
        }
    });
}