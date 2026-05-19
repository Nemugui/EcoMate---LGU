import { db, auth } from './firebase-config.js';
import { 
    collection, 
    addDoc, 
    serverTimestamp, 
    doc, 
    updateDoc, 
    increment 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";


// Link to your Teachable Machine model
const URL = "https://teachablemachine.withgoogle.com/models/bq80Qv2eD/"; 

let model, webcam, labelContainer, maxPredictions;

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
    }, 5000);
}

// Waste type → disposal guide map
const wasteGuide = {
    "Plastic":        { bin: "Blue Bin",   tip: "Clean and dry before placing in the Blue Bin." },
    "Paper":          { bin: "Blue Bin",   tip: "Flatten and keep dry. Place in the Blue Bin." },
    "Metal":          { bin: "Blue Bin",   tip: "Rinse and cover sharp edges with cardboard before placing in the Blue Bin." },
    "Glass":          { bin: "Blue Bin",   tip: "Rinse and wrap in cardboard to prevent injuries before placing in the Blue Bin." },
    "Biodegradable":  { bin: "Green Bin",  tip: "Place in the Green Bin and keep it separate from plastics." },
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. Kunin ang mga elements
    const modal = document.getElementById('ai-modal');
    const closeBtn = document.getElementById('close-ai-modal');
    const identifyBtn = document.getElementById('identify-waste-btn'); // FIX: was 'capture-btn'
    const openBtn = document.querySelector('.hero-banner .btn-scan-now');

    // 2. Buksan ang Modal (Dashboard Button)
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.add('active');
            modal.style.display = 'flex';
            initAI(); 
        });
    }

    // 3. Isara ang Modal (X Button)
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.remove('active');
            modal.style.display = 'none';
            if (webcam) webcam.stop();
        });
    }

   
 // 4. Identify Button
    if (identifyBtn) {
        identifyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const labelElement = document.getElementById('label-container');
            const finalLabel = labelElement.innerText;

            // 1. Check kung may na-detect na item at hindi ito "Neutral"
            if (finalLabel.includes("Detected") && !finalLabel.includes("Neutral")) {

                // --- CAPTURE IMAGE START ---
                // Kinukuha ang kasalukuyang frame mula sa webcam canvas
                // 'image/jpeg' sa 0.7 quality para hindi masyadong malaki ang file size sa Firestore
                const capturedImage = webcam.canvas.toDataURL('image/jpeg', 0.7);
                // --- CAPTURE IMAGE END ---

                // Extract waste type
                const strongTag = document.querySelector('#label-container strong');
                const detectedType = strongTag ? strongTag.innerText.trim() : finalLabel.replace('Detected:', '').trim();
                const guide = wasteGuide[detectedType];

                // --- FIREBASE LOGIC START ---
                const user = auth.currentUser;
                if (user) {
                    try {
                        console.log("Saving to EcoMate History with image...");
                        
                        // A. Magdagdag ng record sa 'scans' collection kasama ang captured image
                        await addDoc(collection(db, "scans"), {
                            userId: user.uid,
                            itemName: detectedType,
                            category: detectedType,
                            itemImage: capturedImage, // Dito naka-save ang Base64 string ng picture
                            points: 5,
                            timestamp: serverTimestamp()
                        });

                        // B. I-update ang counters sa 'users' document para sa Dashboard
                        const userRef = doc(db, "users", user.uid);
                        await updateDoc(userRef, {
                            scannedCount: increment(1),
                            recycledCount: increment(1)
                        });

                        console.log("Firestore successfully updated!");
                    } catch (error) {
                        console.error("Error saving to Firebase:", error);
                    }
                } else {
                    console.warn("No authenticated user found. Data not saved.");
                }
                // --- FIREBASE LOGIC END ---

                // 2. SHOW TOAST NOTIFICATION
                if (guide) {
                    showToast(
                        'success',
                        `${detectedType} detected!`,
                        `${guide.tip}`
                    );
                } else {
                    showToast(
                        'success',
                        `${detectedType} detected!`,
                        'Follow local barangay guidelines for this material.'
                    );
                }

                // 3. UPDATE UI STATS (Visual Feedback sa Dashboard)
                const scannedText = document.getElementById('scanned-count');
                const recycledText = document.getElementById('recycled-count');

                if (scannedText && recycledText) {
                    let currentScanned = parseInt(scannedText.innerText) || 0;
                    let currentRecycled = parseInt(recycledText.innerText) || 0;

                    scannedText.innerText = currentScanned + 1;
                    recycledText.innerText = currentRecycled + 1;
                    
                    scannedText.style.color = "#2ecc71"; 
                    recycledText.style.color = "#2ecc71";
                    
                    setTimeout(() => {
                        scannedText.style.color = ""; 
                        recycledText.style.color = "";
                    }, 1000);
                }
                
            } else {
                showToast('error', 'No item detected', 'Please point the camera at an object first.');
            }
        });
    }
});

// --- AI CORE FUNCTIONS ---

async function initAI() {
    const modelURL = URL + "model.json";
    const metadataURL = URL + "metadata.json";

    labelContainer = document.getElementById("label-container");
    labelContainer.innerHTML = "Loading AI Model...";

    model = await tmImage.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    const flip = true; 
    webcam = new tmImage.Webcam(400, 400, flip); 
    await webcam.setup(); 
    await webcam.play();
    
    window.requestAnimationFrame(loop);

    const webcamElement = document.getElementById("webcam");
    webcamElement.srcObject = webcam.webcam.srcObject;
}

async function loop() {
    if (webcam && webcam.canvas) {
        webcam.update(); 
        await predict();
        window.requestAnimationFrame(loop);
    }
}

async function predict() {
    if (!model) return;

    const prediction = await model.predict(webcam.canvas);
    let highestProb = 0;
    let bestResult = "";

    for (let i = 0; i < maxPredictions; i++) {
        if (prediction[i].probability > highestProb) {
            highestProb = prediction[i].probability;
            bestResult = prediction[i].className;
        }
    }

    const instructions = document.getElementById('disposal-instructions');

    if (highestProb > 0.8) {
        if (bestResult === "Neutral") {
            labelContainer.innerHTML = "Ready to scan...";
            instructions.innerText = "Align the item in the center to identify.";
        } else {
            labelContainer.innerHTML = `Detected: <strong>${bestResult}</strong>`;
            
            if (bestResult === "Plastic") {
                instructions.innerText = "Clean and dry before placing in the Blue Bin.";
            } else if (bestResult === "Paper") {
                instructions.innerText = "Flatten and keep dry. Place in the Blue Bin.";
            } else if(bestResult === "Metal"){
               instructions.innerText = "Rinse and cover sharp edges with cardboard before placing in the Blue Bin.";
            }
            else if(bestResult === "Glass"){
                instructions.innerText = "Rinse and wrap in cardboard to prevent injuries before placing in the Blue Bin.";
            }
             else if(bestResult === "Biodegradable"){
                instructions.innerText = "Place in the green bin and keep it separate from plastics.";
            }else {
                instructions.innerText = "Follow local barangay guidelines for this material.";
            }
        }
    }
}