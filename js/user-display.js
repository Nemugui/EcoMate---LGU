import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getCountFromServer 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. KUNIN ANG USER DATA (Para sa Name, Scanned Count, at Resolved Count)
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            
            // User Name at Initial Logic
            const firstName = userData.fullName ? userData.fullName.split(' ')[0] : "User";
            const initial = firstName.charAt(0).toUpperCase();

            const nameDisplay = document.getElementById('user-name-display');
            if (nameDisplay) nameDisplay.innerText = firstName;

            // Update Profile Icons
            document.querySelectorAll('.user-profile').forEach(container => {
                container.style.display = "flex";
                container.style.alignItems = "center";
                container.style.justifyContent = "center";

                if (userData.photoBase64) {
                    // Photo exists in Firestore — show it, hide the initial span
                    container.style.backgroundColor = "transparent";
                    container.innerHTML = `<img src="${userData.photoBase64}" alt="${firstName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                } else {
                    // No photo — fall back to initial letter
                    container.style.backgroundColor = "#2e7d32";
                    const span = container.querySelector('.user-initial-display');
                    if (span) {
                        span.innerText = initial;
                    } else {
                        container.innerHTML = `<span class="user-initial-display" style="color:white;font-weight:bold;font-size:1rem;">${initial}</span>`;
                    }
                }
            });

            // I-display ang Scanned Count mula sa User document
            const scannedCountEl = document.getElementById('history-scanned-count');
            if (scannedCountEl) {
                scannedCountEl.innerText = userData.scannedCount || 0;
            }

            // BAGONG UPDATE: I-display ang Resolved Reports Count mula sa User document
            const resolvedCountEl = document.getElementById('history-resolved-count');
            if (resolvedCountEl) {
                // Base sa screenshot image_5c3b3e.png, ang field name ay 'resolvedReportsCount'
                resolvedCountEl.innerText = userData.resolvedReportsCount || 0;
            }
        }

        // 2. LIVE QUERY PARA SA SUBMITTED REPORTS (Kailangan pa rin ito dahil wala itong counter sa users collection)
        try {
            const reportsRef = collection(db, "reports");

            // Bilangin lahat ng reports na isinubmit base sa reporterUid (image_5d1c5a.png)
            const submittedQuery = query(reportsRef, where("reporterUid", "==", user.uid));
            const submittedSnapshot = await getCountFromServer(submittedQuery);
            const submittedCount = submittedSnapshot.data().count;

            const submittedCountEl = document.getElementById('history-submitted-count');
            if (submittedCountEl) {
                submittedCountEl.innerText = submittedCount;
            }
        } catch (error) {
            console.error("Error calculating submitted reports count:", error);
        }
    }
});