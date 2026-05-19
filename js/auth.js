import { auth, db } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    FacebookAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Custom error banner (replaces all alert() calls) ──────────────────────────
function showError(msg) {
    const banner  = document.getElementById('auth-error');
    const msgSpan = document.getElementById('auth-error-msg');
    if (!banner || !msgSpan) return;
    msgSpan.textContent = msg;
    banner.classList.add('show');
    // Auto-hide after 6 seconds
    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => banner.classList.remove('show'), 6000);
}

function hideError() {
    const banner = document.getElementById('auth-error');
    if (banner) banner.classList.remove('show');
}

// ── Shared: redirect by role ──────────────────────────────────────────────────
function redirectToDashboard(role) {
    window.location.href = `./${role.toLowerCase()}dashboard.html`;
}

// ── Shared: check Firestore then route (used by social logins) ────────────────
async function checkAndRoute(user) {
    const userDoc = await getDoc(doc(db, 'users', user.uid));

    if (userDoc.exists()) {
        // Returning user — go straight to their dashboard
        redirectToDashboard(userDoc.data().role);
    } else {
        // New social user — needs to complete profile first
        sessionStorage.setItem('pendingGoogleUID',   user.uid);
        sessionStorage.setItem('pendingGoogleEmail', user.email);
        sessionStorage.setItem('pendingGoogleName',  user.displayName || '');
        window.location.href = 'complete-profile.html';
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // ── Email / Password Login ────────────────────────────────────────────────
    const loginForm = document.getElementById('login-form');
    const loginBtn = loginForm ? loginForm.querySelector('.btn-auth') : null;

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideError();

            // UI Feedback: Disable button and show status
            const originalBtnText = loginBtn.innerHTML;
            loginBtn.disabled = true;
            loginBtn.innerText = "Authenticating...";

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                // 1. Attempt Firebase Login
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 2. Fetch the role from Firestore 'users' collection
                // The Document ID must match the user's UID
                const userDoc = await getDoc(doc(db, "users", user.uid));

                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const role = userData.role.toLowerCase(); // ensures 'Admin' becomes 'admin'

                    console.log(`User role identified: ${role}`);

                    // 3. Navigate to the specific dashboard based on your file list
                    // Maps to: admindashboard.html, resdashboard.html, or workerdashboard.html
                    window.location.href = `./${role}dashboard.html`;

                } else {
                    showError("User record not found in database. Please contact support.");
                    loginBtn.disabled = false;
                    loginBtn.innerHTML = originalBtnText;
                }

            } catch (error) {
                console.error("Auth Error:", error.code);
                loginBtn.disabled = false;
                loginBtn.innerHTML = originalBtnText;

                // Error Handling
                if (error.code === 'auth/invalid-credential') {
                    showError("Incorrect email or password. Please try again.");
                } else if (error.code === 'auth/too-many-requests') {
                    showError("Account temporarily locked due to many failed attempts. Try again later.");
                } else {
                    showError("Login failed: " + error.message);
                }
            }
        });
    }

    // ── Google Login ──────────────────────────────────────────────────────────
    const googleBtn = document.getElementById('google-login-btn');

    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            hideError();
            const provider = new GoogleAuthProvider();

            try {
                const { user } = await signInWithPopup(auth, provider);
                await checkAndRoute(user);
            } catch (error) {
                console.error('Google Auth Error:', error.code);
                if (error.code === 'auth/popup-closed-by-user') return;
                showError('Google sign-in failed. Please try again.');
            }
        });
    }

    // ── Facebook Login ────────────────────────────────────────────────────────
    const facebookBtn = document.getElementById('facebook-login-btn');

    if (facebookBtn) {
        facebookBtn.addEventListener('click', async () => {
            hideError();
            const provider = new FacebookAuthProvider();

            try {
                const { user } = await signInWithPopup(auth, provider);
                await checkAndRoute(user);
            } catch (error) {
                console.error('Facebook Auth Error:', error.code);
                if (error.code === 'auth/popup-closed-by-user') return;

                if (error.code === 'auth/account-exists-with-different-credential') {
                    showError('An account already exists with this email using a different sign-in method.');
                } else {
                    showError('Facebook sign-in failed. Please try again.');
                }
            }
        });
    }

});