import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const getStartedBtn = document.getElementById('get-started-btn');
    const skipBtn = document.getElementById('skip-btn');
    const nextBtn = document.getElementById('next-btn');
    const backBtn = document.getElementById('back-btn');
    const helpBtn = document.getElementById('help-btn');
    const getStartedFinalBtn = document.getElementById('get-started-final-btn');
    const loginForm = document.getElementById('login-form');

    // Get current page filename
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    const navigateTo = (url) => {
        console.log(`Navigating to: ${url}`);
        
        // Add fade-out transition
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.4s ease';
        
        setTimeout(() => {
            window.location.href = url;
        }, 400);
    };

    // Shared Event Listeners
    if (skipBtn) {
        skipBtn.addEventListener('click', () => {
            alert('Welcome to the Main Ecosystem!');
            navigateTo('resdashboard.html');
        });
    }

    // Page Specific Logic
    if (currentPage === 'index.html' || currentPage === '') {
        if (getStartedBtn) {
            getStartedBtn.addEventListener('click', () => navigateTo('onboarding2.html'));
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => navigateTo('onboarding2.html'));
        }
    } else if (currentPage === 'onboarding2.html') {
        if (backBtn) {
            backBtn.addEventListener('click', () => navigateTo('index.html'));
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => navigateTo('onboarding3.html'));
        }
    } else if (currentPage === 'onboarding3.html') {
        if (backBtn) {
            backBtn.addEventListener('click', () => navigateTo('onboarding2.html'));
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => navigateTo('roles.html'));
        }
    } else if (currentPage === 'roles.html') {
        if (backBtn) {
            backBtn.addEventListener('click', () => navigateTo('onboarding3.html'));
        }
        if (getStartedFinalBtn) {
            getStartedFinalBtn.addEventListener('click', () => {
                const activeRole = document.querySelector('.role-card.active .role-title')?.textContent || 'Resident';
                console.log(`User selected role: ${activeRole}`);
                navigateTo('login.html');
            });
        }
    }

    // Dashboard Interaction Simulation
    const navItems = document.querySelectorAll('.nav-item, .worker-nav a, .admin-nav a');
    if (navItems.length > 0) {
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const linkText = item.textContent.trim();
                const href = item.getAttribute('href');
                
                if (href && href !== '#' && !href.startsWith('http')) {
                    e.preventDefault();
                    navigateTo(href);
                } else if (linkText === 'Dashboard') {
                    e.preventDefault();
                    navigateTo('resdashboard.html');
                } else if (linkText === 'Schedule & Collection Log') {
                    e.preventDefault();
                    navigateTo('schedule_collection-log.html');
                } else if (linkText === 'History') {
                    e.preventDefault();
                    navigateTo('history.html');
                } else if (linkText === 'Education') {
                    e.preventDefault();
                    navigateTo('education.html');
                } else {
                    // Placeholder for other pages
                    e.preventDefault();
                    navItems.forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    console.log(`Switched to: ${linkText}`);
                }
            });
        });
    }

    // Interactive Hover Effects
    const interactiveElements = [getStartedBtn, skipBtn, nextBtn, backBtn, helpBtn, getStartedFinalBtn];
    interactiveElements.forEach(el => {
        if (el) {
            el.addEventListener('mouseenter', () => {
                const isPrimary = el.classList.contains('btn-get-started') || el.classList.contains('btn-get-started-nav');
                el.style.transform = isPrimary ? 'scale(1.03) translateY(-2px)' : 'scale(1.08)';
            });
            el.addEventListener('mouseleave', () => {
                el.style.transform = 'scale(1)';
            });
        }
    });

    // Top Header Navigation (Settings & Profile)
    const settingsTriggers = document.querySelectorAll('.icon-box .lucide-settings, .header-icon .lucide-settings, .icon-box i[data-lucide="settings"], .header-icon i[data-lucide="settings"]');
    settingsTriggers.forEach(trigger => {
        const parent = trigger.closest('.icon-box, .header-icon');
        if (parent && !parent.classList.contains('active')) {
            parent.addEventListener('click', () => {
                let target = 'resettings.html';
                if (currentPage.includes('worker')) target = 'workersettings.html';
                else if (currentPage.includes('admin')) target = 'adminsettings.html';
                navigateTo(target);
            });
            parent.style.cursor = 'pointer';
        }
    });

    const profileTriggers = document.querySelectorAll('.avatar-circle, .user-profile');
    profileTriggers.forEach(trigger => {
        if (!trigger.classList.contains('active')) {
            trigger.addEventListener('click', () => {
                let target = 'reprofile.html';
                if (currentPage.includes('worker')) target = 'workerprofile.html';
                else if (currentPage.includes('admin')) target = 'adminprofile.html';
                navigateTo(target);
            });
            trigger.style.cursor = 'pointer';
        }
    });

    // Sign Out
    const signOutBtn = document.getElementById('btn-sign-out');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Signing out...');
            navigateTo('roles.html');
        });
    }

    // FIX: Wait for window.initializeReportModal (module loads async)
    function waitForModal(callback, retries = 20) {
        if (typeof window.initializeReportModal === 'function') {
            callback();
        } else if (retries > 0) {
            setTimeout(() => waitForModal(callback, retries - 1), 100);
        } else {
            console.warn('initializeReportModal not available.');
        }
    }

    // Trigger modal opening
    const reportBtns = document.querySelectorAll('.btn-report-issue');
    reportBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            waitForModal(() => {
                window.initializeReportModal();
                const modal = document.getElementById('report-issue-modal');
                if (modal) {
                    // Ensure minor delay for transition animation if newly injected
                    setTimeout(() => modal.classList.add('active'), 10);
                }
            });
        });
    });

    // Handle fading in for every page load
    document.body.style.opacity = '1';
    document.body.style.transition = 'opacity 0.4s ease';
});