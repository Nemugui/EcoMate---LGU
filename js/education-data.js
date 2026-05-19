export const educationData = {
    recyclable: {
        title: "Recyclable Guideline",
        icon: "recycle",
        color: "#2ecc71",
        content: `
            <p>Master the art of recycling based on our local community standards.</p>
            <ul>
                <li><strong>Clean:</strong> Rinse all food containers to avoid contamination.</li>
                <li><strong>Dry:</strong> Ensure paper and cardboard are not soaked.</li>
            </ul>
            <a href="../document/Recycable Guideline.docx" download class="modal-download-btn">
                <i data-lucide="download"></i> Download Guideline
            </a>
        `
    },
    biodegradable: {
        title: "Biodegradable Guide",
        icon: "leaf",
        color: "#f1c40f",
        content: `
            <p>Learn how to turn your organic waste into nutrient-rich compost for your garden.</p>
            <a href="../document/Biodegradable Guide.docx" download class="modal-download-btn">
                <i data-lucide="download"></i> Download Bio-Guide
            </a>
        `
    },
    hazardous: {
        title: "Hazardous & Emergency Response",
        icon: "alert-triangle",
        color: "#e74c3c",
        content: `
            <p>Toxic materials require strict handling protocols to protect the community.</p>
            <div class="emergency-notice">Check the Emergency Response Guide for spill procedures.</div>
            <a href="../document/Hazardous Guide.docx" download class="modal-download-btn">
                <i data-lucide="download"></i> Hazardous Guide
            </a>
            <a href="../document/Emergency Response Guide.docx" download class="modal-download-btn secondary">
                <i data-lucide="shield-alert"></i> Emergency Response Guide
            </a>
        `
    },
    general: {
        title: "General Waste Guide",
        icon: "trash-2",
        color: "#95a5a6",
        content: `
            <p>Guidelines for non-recyclable and non-biodegradable residual waste management.</p>
            <a href="../document/General Waste Guide.docx" download class="modal-download-btn">
                <i data-lucide="download"></i> Download General Guide
            </a>
        `
    }
};