import { educationData } from './education-data.js';

window.addEventListener('load', () => {
    const modal = document.getElementById('education-modal');
    const modalBody = document.getElementById('modal-body-content');
    const closeBtn = document.getElementById('modal-close');

    // 1. Click detection para sa Segregation Cards (Using Event Delegation)
    document.addEventListener('click', (e) => {
        const viewBtn = e.target.closest('.btn-view-details');
        if (viewBtn) {
            const card = viewBtn.closest('.guide-card');
            let type = '';

            if (card.classList.contains('rec')) type = 'recyclable';
            else if (card.classList.contains('bio')) type = 'biodegradable';
            else if (card.classList.contains('haz')) type = 'hazardous';
            else if (card.classList.contains('gen')) type = 'general';

            const data = educationData[type];
            if (data && modal && modalBody) {
                modalBody.innerHTML = `
                    <div class="modal-header" style="text-align: center;">
                        <i data-lucide="${data.icon}" style="color: ${data.color}; width: 50px; height: 50px; margin: 0 auto;"></i>
                        <h3 style="margin-top: 10px;">${data.title}</h3>
                    </div>
                    <div class="modal-text" style="margin-top: 20px;">
                        ${data.content}
                    </div>
                `;
                if (window.lucide) window.lucide.createIcons();
                modal.classList.add('active');
            }
        }
    });

    // 2. Start Learning Button (Hero)
    const startBtn = document.querySelector('.btn-start-learning');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            window.open('../document/Safe Collection Practices Guide.docx', '_blank');
        });
    }

    // 3. Worker Safety Card
    const safetyCard = document.querySelector('.safety-card');
    if (safetyCard) {
        safetyCard.addEventListener('click', () => {
            window.open('../document/Waste Workers PPE Guide.docx', '_blank');
        });
    }

    // 4. Modal Close Logic
    if (closeBtn) {
        closeBtn.onclick = () => modal.classList.remove('active');
    }

    window.onclick = (event) => {
        if (event.target === modal) modal.classList.remove('active');
    };
});