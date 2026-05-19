import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query, 
    where, 
    getDocs,
    getDoc,
    doc,
    updateDoc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAv-c6-7n2Uf9MK3-5u3dt42HklwGcxixg",
    authDomain: "ecomate-4c54f.firebaseapp.com",
    projectId: "ecomate-4c54f",
    storageBucket: "ecomate-4c54f.firebasestorage.app",
    messagingSenderId: "626101359921",
    appId: "1:626101359921:web:c95f7b0fca79ff8ce60c10",
    measurementId: "G-MWX6NWBCPL"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ════════════════════════════════════════════════════════════════════════════
// PAGINATION STATE
// ════════════════════════════════════════════════════════════════════════════
const ITEMS_PER_PAGE = 5;
let allSchedules  = [];
let currentPage   = 1;

// ════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

function getWeekDateRange() {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const dayOfWeek = today.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - daysFromMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    return { startOfWeek, endOfWeek, today };
}

function formatDateRange(startDate, endDate) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const startStr = `${months[startDate.getMonth()]} ${startDate.getDate()}`;
    const endStr   = `${months[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`;
    return `${startStr}–${endStr}`;
}

function formatDateForDisplay(dateStr) {
    const date = new Date(dateStr + 'T00:00');
    const days   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return {
        day:   days[date.getDay()],
        date:  date.getDate(),
        month: months[date.getMonth()]
    };
}

function showToast(message) {
    const toast   = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMessage');
    toastMsg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ════════════════════════════════════════════════════════════════════════════
// FETCH TRUCK DATA
// ════════════════════════════════════════════════════════════════════════════

async function getTruckData(truckId) {
    try {
        const q = query(collection(db, 'trucks'), where('truckId', '==', truckId));
        const snap = await getDocs(q);
        return snap.empty ? null : snap.docs[0].data();
    } catch (err) {
        console.error('Error fetching truck data:', err);
        return null;
    }
}

// ════════════════════════════════════════════════════════════════════════════
// LOAD SCHEDULES - FILTERED BY CURRENT WORKER
// ════════════════════════════════════════════════════════════════════════════

async function loadSchedules(userId) {
    try {
        const { startOfWeek, endOfWeek, today } = getWeekDateRange();

        document.getElementById('dateRangeBadge').textContent =
            formatDateRange(startOfWeek, endOfWeek);

        // ✅ FIXED: Filter by assignedWorkerUid to show only schedules assigned to current worker
        const q = query(
            collection(db, 'schedules'),
            where('assignedWorkerUid', '==', userId),
            where('date', '>=', `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth()+1).padStart(2,'0')}-${String(startOfWeek.getDate()).padStart(2,'0')}`),
            where('date', '<=', `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth()+1).padStart(2,'0')}-${String(endOfWeek.getDate()).padStart(2,'0')}`)
        );

        const snapshot = await getDocs(q);
        allSchedules = [];
        snapshot.forEach(d => allSchedules.push({ id: d.id, ...d.data() }));

        allSchedules.sort((a, b) => {
            const dc = a.date.localeCompare(b.date);
            return dc !== 0 ? dc : a.startTime.localeCompare(b.startTime);
        });

        currentPage = 1;
        await renderPage();

        updateCompletedCount(allSchedules, today);
        drawWeeklyChart(allSchedules, startOfWeek);

    } catch (err) {
        console.error('Error loading schedules:', err);
        showToast('Error loading schedule');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER CURRENT PAGE (5 cards max)
// ════════════════════════════════════════════════════════════════════════════

async function renderPage() {
    const container  = document.getElementById('routeCardsContainer');
    const pagination = document.getElementById('schedulePagination');
    const pageLabel  = document.getElementById('schedPageLabel');
    const prevBtn    = document.getElementById('schedPrevBtn');
    const nextBtn    = document.getElementById('schedNextBtn');

    container.innerHTML = '';

    if (allSchedules.length === 0) {
        container.innerHTML = `
            <p style="text-align:center;padding:2rem;color:#999;">
                No routes scheduled this week
            </p>`;
        if (pagination) pagination.style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(allSchedules.length / ITEMS_PER_PAGE);
    const start      = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems  = allSchedules.slice(start, start + ITEMS_PER_PAGE);

    for (const schedule of pageItems) {
        await appendRouteCard(container, schedule);
    }

    // Pagination controls
    if (pagination) {
        if (totalPages > 1) {
            pagination.style.display = 'flex';
            pageLabel.textContent    = `${currentPage} / ${totalPages}`;
            prevBtn.disabled         = currentPage === 1;
            nextBtn.disabled         = currentPage === totalPages;
        } else {
            pagination.style.display = 'none';
        }
    }

    if (window.lucide) window.lucide.createIcons();
}

async function appendRouteCard(container, schedule) {
    const dateDisplay  = formatDateForDisplay(schedule.date);
    const isCompleted  = schedule.status === 'completed';
    const isOngoing    = schedule.status === 'ongoing';
    const isUpcoming   = schedule.status === 'upcoming';

    const statusClass = isOngoing ? 'ongoing' : isUpcoming ? 'upcoming' : 'completed';
    const statusText  = isCompleted ? 'Completed' : isOngoing ? 'Ongoing' : 'Upcoming';

    const card = document.createElement('div');
    card.className = 'route-card';
    card.innerHTML = `
        <div class="route-date-badge">
            <span class="day">${dateDisplay.day}</span>
            <h4 class="date">${dateDisplay.date}</h4>
            <span class="month">${dateDisplay.month}</span>
        </div>
        <div class="route-details">
            <div class="route-meta">
                <span class="r-status ${statusClass}">${statusText}</span>
                <span class="r-time">${schedule.startTime}</span>
            </div>
            <h4>${schedule.route}</h4>
            <div class="route-tags">
                <span><i data-lucide="truck" style="width:14px;height:14px;"></i> ${schedule.truck}</span>
                ${schedule.notes ? `<span><i data-lucide="clipboard" style="width:14px;height:14px;"></i> ${schedule.notes}</span>` : ''}
            </div>
        </div>
        <button class="btn-complete-task ${isCompleted ? 'completed' : ''}"
                data-schedule-id="${schedule.id}"
                ${isCompleted ? 'disabled' : ''}>
            ${isCompleted ? 'Completed' : 'Complete Task'}
        </button>
    `;

    container.appendChild(card);

    if (!isCompleted) {
        card.querySelector('.btn-complete-task')
            .addEventListener('click', () => completeTask(schedule.id, card.querySelector('.btn-complete-task'), schedule.route));
    }
}

// ════════════════════════════════════════════════════════════════════════════
// PAGINATION BUTTON HANDLERS
// ════════════════════════════════════════════════════════════════════════════

document.getElementById('schedPrevBtn')?.addEventListener('click', async () => {
    if (currentPage > 1) {
        currentPage--;
        await renderPage();
        document.getElementById('routeCardsContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

document.getElementById('schedNextBtn')?.addEventListener('click', async () => {
    const totalPages = Math.ceil(allSchedules.length / ITEMS_PER_PAGE);
    if (currentPage < totalPages) {
        currentPage++;
        await renderPage();
        document.getElementById('routeCardsContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// COMPLETE TASK
// ════════════════════════════════════════════════════════════════════════════

async function completeTask(scheduleId, button, routeName) {
    try {
        button.disabled    = true;
        button.textContent = 'Completing...';

        await updateDoc(doc(db, 'schedules', scheduleId), { status: 'completed' });

        // Update local state so pagination stays accurate
        const idx = allSchedules.findIndex(s => s.id === scheduleId);
        if (idx !== -1) allSchedules[idx].status = 'completed';

        button.textContent = 'Completed';
        button.classList.add('completed');
        showToast(`${routeName} marked as completed!`);

        const { today } = getWeekDateRange();
        updateCompletedCount(allSchedules, today);
        drawWeeklyChart(allSchedules, getWeekDateRange().startOfWeek);

        // Re-render current page so button state is in sync
        await renderPage();

    } catch (err) {
        console.error('Error completing task:', err);
        button.disabled    = false;
        button.textContent = 'Complete Task';
        showToast('Error completing task. Please try again.');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// COMPLETED COUNT
// ════════════════════════════════════════════════════════════════════════════

function updateCompletedCount(schedules, today) {
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const todaySchedules  = schedules.filter(s => s.date === todayStr);
    const completedCount  = todaySchedules.filter(s => s.status === 'completed').length;
    document.getElementById('completedCount').textContent =
        `${completedCount}/${todaySchedules.length}`;
}

// ════════════════════════════════════════════════════════════════════════════
// WEEKLY COMPLETION CHART
// ════════════════════════════════════════════════════════════════════════════

function drawWeeklyChart(schedules, startOfWeek) {
    const canvas = document.getElementById('weeklyCompletionChart');
    if (!canvas) return;

    const daysOfWeek     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const completionData = [0,0,0,0,0,0,0];
    const totalData      = [0,0,0,0,0,0,0];

    schedules.forEach(schedule => {
        const dayIndex = (new Date(schedule.date).getDay() + 6) % 7;
        totalData[dayIndex]++;
        if (schedule.status === 'completed') completionData[dayIndex]++;
    });

    const percentageData = completionData.map((c, i) =>
        totalData[i] > 0 ? (c / totalData[i]) * 100 : 0
    );

    if (window.weeklyChart instanceof Chart) window.weeklyChart.destroy();

    window.weeklyChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: daysOfWeek,
            datasets: [{
                label: 'Completion Rate (%)',
                data: percentageData,
                backgroundColor: '#4CAF50',
                borderColor: '#2E7D32',
                borderWidth: 2,
                borderRadius: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { size: 14, weight: 'bold' }, color: '#333', padding: 15, usePointStyle: true }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 13 },
                    borderColor: '#4CAF50',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label:      ctx => `Rate: ${ctx.parsed.y.toFixed(1)}%`,
                        afterLabel: ctx => `${completionData[ctx.dataIndex]}/${totalData[ctx.dataIndex]} completed`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: v => v + '%', font: { size: 12 } },
                    grid: { color: '#E8E8E8', drawBorder: false }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 12, weight: 'bold' } }
                }
            }
        }
    });
}

// ════════════════════════════════════════════════════════════════════════════
// INITIALIZE
// ════════════════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadSchedules(user.uid);
    } else {
        window.location.href = '../html/login.html';
    }
});