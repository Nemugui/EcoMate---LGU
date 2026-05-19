import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAv-c6-7n2Uf9MK3-5u3dt42HklwGcxixg",
    authDomain: "ecomate-4c54f.firebaseapp.com", // ← change to your Netlify URL
    projectId: "ecomate-4c54f",
    storageBucket: "ecomate-4c54f.firebasestorage.app",
    messagingSenderId: "626101359921",
    appId: "1:626101359921:web:c95f7b0fca79ff8ce60c10",
    measurementId: "G-MWX6NWBCPL"
};

const app = initializeApp(firebaseConfig);

// 2. I-export ang storage instance
export const auth = getAuth(app);
export const db = getFirestore(app);
