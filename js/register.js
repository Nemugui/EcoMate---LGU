import { auth, db } from './firebase-config.js'; 
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const registerForm = document.getElementById('register-form');
const submitBtn = registerForm.querySelector('button[type="submit"]');

// TOAST FUNCTION
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
    const iconBg = isSuccess ? '#eafaf1' : '#fdf0f0';
    const iconPath = isSuccess
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
    }, 4000);
}

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName        = document.getElementById('reg-fullname').value;
    const email           = document.getElementById('reg-email').value;
    const password        = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm').value;
    const area            = document.getElementById('reg-area').value;

    // Role value is already stored correctly from the radio buttons:
    // "res" for Resident, "worker" for Worker, "admin" for Admin
    const role = document.querySelector('input[name="role"]:checked').value;

    // --- VALIDATION ---
    if (password !== confirmPassword) {
        showToast('error', 'Passwords do not match', 'Please make sure both password fields are the same.');
        return;
    }

    if (password.length < 6) {
        showToast('error', 'Password too short', 'Password must be at least 6 characters.');
        return;
    }

    const originalBtnText = submitBtn.innerText;
    submitBtn.innerText   = 'Authenticating...';
    submitBtn.disabled    = true;

    try {
        // 1. Create user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Save to Firestore with correct role value
        await setDoc(doc(db, 'users', user.uid), {
            fullName,
            email,
            role,   // "res" | "worker" | "admin"
            area,
            scannedCount:         0,
            recycledCount:        0,
            resolvedReportsCount: 0,
            createdAt: new Date()
        });

        submitBtn.innerText = 'Account Created!';
        showToast('success', 'Account created!', 'Redirecting you to login...');
        setTimeout(() => window.location.href = 'login.html', 2000);

    } catch (error) {
        console.error('Firebase Error:', error.code);

        submitBtn.innerText = originalBtnText;
        submitBtn.disabled  = false;

        if (error.code === 'auth/email-already-in-use') {
            showToast('error', 'Email already in use', 'Please use a different email or login instead.');
        } else if (error.code === 'auth/invalid-email') {
            showToast('error', 'Invalid email', 'Please enter a valid email address.');
        } else {
            showToast('error', 'Registration failed', error.message);
        }
    }
});