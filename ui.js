const API_BASE_URLS = [
    'https://massgptdeleter.onrender.com',
    'http://127.0.0.1:5000',
    'http://localhost:5000'
];

async function apiFetch(path, options = {}) {
    let lastError = null;

    for (let i = 0; i < API_BASE_URLS.length; i++) {
        const baseUrl = API_BASE_URLS[i];
        try {
            const response = await fetch(`${baseUrl}${path}`, options);

            // If one backend is missing this route, try next candidate.
            if (response.status === 404 && i < API_BASE_URLS.length - 1) {
                continue;
            }

            return response;
        } catch (err) {
            lastError = err;
            if (i === API_BASE_URLS.length - 1) throw err;
        }
    }

    if (lastError) throw lastError;
    throw new Error('API request failed');
}

function findSidebarMount() {
    const selectors = [
        'nav[aria-label="Chat history"]',
        'nav[aria-label*="Chat"]',
        'aside nav',
        'aside'
    ];

    for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (candidate) return candidate;
    }

    return null;
}

function setBulkMode(enabled) {
    window.BULK_MODE = enabled;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ bulkMode: enabled });
    }

    const toolbar = document.getElementById('bulk-manager-toolbar');
    if (toolbar) {
        const controls = toolbar.querySelector('.bulk-toolbar-controls');
        if (controls) controls.style.display = enabled ? 'flex' : 'none';
        
        const toggle = document.getElementById('bulk-toggle');
        if (toggle) toggle.checked = enabled;
        // reflect checked state on the label for the custom switch visuals
        if (toggle) {
            const lbl = toggle.closest('.bulk-switch');
            if (lbl) lbl.classList.toggle('bulk-switch-checked', !!enabled);
        }
    }

    document.querySelectorAll('.bulk-checkbox-container')
        .forEach(el => el.style.display = enabled ? 'flex' : 'none');
        
    if (enabled) {
        refreshCheckboxes();
    }
}

function showVerificationModal(email, userId, loginModal) {
    /**Modal for email verification after registration.*/
    const verificationModal = document.createElement('div');
    verificationModal.className = 'bulk-modal-overlay';
    verificationModal.innerHTML = `
        <div class="bulk-modal-content">
            <h3>Verify Your Email</h3>
            <p>We've sent a 6-digit verification code to <strong>${email}</strong></p>
            <input type="text" id="bulk-verify-code" placeholder="Enter 6-digit code" maxlength="6" style="width:100%;padding:8px;margin:12px 0;border:1px solid #4d4d4f;border-radius:4px;background:#2a2b32;color:#fff;font-size:18px;text-align:center;letter-spacing:4px;">
            <div class="bulk-modal-buttons">
                <button id="bulk-verify-submit" class="bulk-modal-btn">Verify</button>
                <button id="bulk-verify-resend" class="bulk-modal-btn" style="background:#4d4d4f;">Resend Code</button>
                <button id="bulk-verify-cancel" class="bulk-modal-btn" style="background:#333;">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(verificationModal);

    const codeInput = verificationModal.querySelector('#bulk-verify-code');
    const submitBtn = verificationModal.querySelector('#bulk-verify-submit');
    const resendBtn = verificationModal.querySelector('#bulk-verify-resend');
    const cancelBtn = verificationModal.querySelector('#bulk-verify-cancel');

    submitBtn.addEventListener('click', async () => {
        const code = codeInput.value.trim();
        if (!code || code.length !== 6) {
            alert('Please enter a valid 6-digit code');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';

        try {
            const response = await apiFetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: 'Verification failed' }));
                throw new Error(err.error || 'Verification failed');
            }

            const data = await response.json();
            
            // Store token and reload
            try {
                chrome.storage.local.set({
                    jwtToken: data.token,
                    userId: data.user_id,
                    userEmail: data.email,
                    isPro: data.is_pro,
                    isAdmin: data.is_admin
                }, () => {
                    verificationModal.remove();
                    loginModal.remove();
                    location.reload();
                });
            } catch (e) {
                verificationModal.remove();
                loginModal.remove();
                location.reload();
            }
        } catch (err) {
            alert('Verification error: ' + (err.message || err));
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify';
        }
    });

    resendBtn.addEventListener('click', async () => {
        resendBtn.disabled = true;
        resendBtn.textContent = 'Sending...';

        try {
            const response = await apiFetch('/api/auth/resend-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            if (!response.ok) {
                throw new Error('Failed to resend code');
            }

            alert('Verification code resent to your email');
            codeInput.value = '';
            codeInput.focus();
        } catch (err) {
            alert('Error: ' + (err.message || err));
        } finally {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Code';
        }
    });

    cancelBtn.addEventListener('click', () => {
        verificationModal.remove();
        loginModal.style.display = 'flex';
    });

    codeInput.focus();
}

function createToolbar() {
    const existing = document.getElementById('bulk-manager-toolbar');
    const rootMount = document.getElementById('bulk-manager-root');
    const sidebarNav = findSidebarMount();
    const mountTarget = rootMount || sidebarNav || document.body;

    if (existing) {
        if (existing.parentElement !== mountTarget) mountTarget.prepend(existing);
        return;
    }

    // Remove any stale modals/overlays
    const prevLoginModal = document.getElementById('bulk-login-modal'); if (prevLoginModal) prevLoginModal.remove();
    const prevOverlay = document.getElementById('bulk-settings-overlay'); if (prevOverlay) prevOverlay.remove();
    const prevLimit = document.getElementById('bulk-limit-modal'); if (prevLimit) prevLimit.remove();

    // Check login state and show login modal if needed
    try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            console.warn('chrome.storage not available');
            return;
        }
        chrome.storage.local.get(['jwtToken'], (result) => {
            try {
                if (!result || !result.jwtToken) {
                    const loginModal = document.createElement('div');
                    loginModal.id = 'bulk-login-modal';
                    loginModal.className = 'bulk-modal-overlay';
                    loginModal.style.display = 'flex';
                    loginModal.innerHTML = `
                        <div class="bulk-modal-content">
                            <h2 style="margin-top:0; text-align:center;">Bulk Manager</h2>
                            <div class="bulk-login-tabs">
                                <button class="bulk-tab-btn active" data-tab="login">Login</button>
                                <button class="bulk-tab-btn" data-tab="register">Register</button>
                            </div>
                            <div class="bulk-tab-content" id="login-tab" style="display:block;">
                                <input type="email" id="bulk-login-email" class="bulk-input" placeholder="Email">
                                <input type="password" id="bulk-login-password" class="bulk-input" placeholder="Password">
                                <button id="bulk-login-btn" class="bulk-upgrade-btn">Login</button>
                            </div>
                            <div class="bulk-tab-content" id="register-tab" style="display:none;">
                                <input type="email" id="bulk-register-email" class="bulk-input" placeholder="Email">
                                <input type="password" id="bulk-register-password" class="bulk-input" placeholder="Password">
                                <input type="password" id="bulk-register-confirm" class="bulk-input" placeholder="Confirm Password">
                                <label style="display:flex; align-items:flex-start; gap:10px; font-size:12px; line-height:1.5; color:#dcdce1; margin:6px 0 10px; text-align:left;">
                                    <input type="checkbox" id="bulk-register-terms" style="width:auto; margin-top:3px;">
                                    <span>
                                        I agree to the <a href="https://massgptdeleter.onrender.com/terms" target="_blank" rel="noopener noreferrer" style="color:#10a37f; text-decoration:underline;">Terms of Use</a> and acknowledge that subscriptions do not automatically end when I uninstall the extension. I must use the cancellation option on the uninstall feedback page or contact support to cancel.
                                    </span>
                                </label>
                                <button id="bulk-register-btn" class="bulk-upgrade-btn">Register</button>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(loginModal);

                    // Tab switching
                    const tabBtns = loginModal.querySelectorAll('.bulk-tab-btn');
                    tabBtns.forEach(btn => {
                        btn.addEventListener('click', () => {
                            try {
                                tabBtns.forEach(b => b.classList.remove('active'));
                                btn.classList.add('active');
                                loginModal.querySelectorAll('.bulk-tab-content').forEach(c => c.style.display = 'none');
                                const tabId = btn.dataset.tab + '-tab';
                                const tabContent = loginModal.querySelector('#' + tabId);
                                if (tabContent) tabContent.style.display = 'block';
                            } catch (e) { console.warn('tab switching error', e); }
                        });
                    });

                    // Login handler
                    const loginBtn = loginModal.querySelector('#bulk-login-btn');
                    if (loginBtn) loginBtn.addEventListener('click', async () => {
                        try {
                            const email = (loginModal.querySelector('#bulk-login-email')||{}).value;
                            const password = (loginModal.querySelector('#bulk-login-password')||{}).value;
                            if (!email || !password) { alert('Please enter email and password'); return; }
                            loginBtn.disabled = true; loginBtn.textContent = 'Logging in...';
                            const response = await apiFetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email,password}) });
                            if (!response.ok) { const err = await response.json().catch(()=>({error:'login_failed'})); 
                                // Check if email needs verification
                                if (err.requires_verification) {
                                    loginModal.style.display = 'none';
                                    showVerificationModal(err.email, err.user_id, loginModal);
                                    return;
                                }
                                throw new Error(err.error||'Login failed'); 
                            }
                            const data = await response.json(); try { chrome.storage.local.set({ jwtToken: data.token, userId: data.user_id, userEmail: data.email, isPro: data.is_pro, isAdmin: data.is_admin }, ()=>{ loginModal.remove(); location.reload(); }); } catch(e){ loginModal.remove(); }
                        } catch (err) { alert('Login error: '+(err.message||err)); try{ loginBtn.disabled=false; loginBtn.textContent='Login'; }catch(e){} }
                    });

                    // Register handler
                    const registerBtn = loginModal.querySelector('#bulk-register-btn');
                    if (registerBtn) registerBtn.addEventListener('click', async () => {
                        try {
                            const email = (loginModal.querySelector('#bulk-register-email')||{}).value;
                            const password = (loginModal.querySelector('#bulk-register-password')||{}).value;
                            const confirm = (loginModal.querySelector('#bulk-register-confirm')||{}).value;
                            const termsAccepted = !!(loginModal.querySelector('#bulk-register-terms') || {}).checked;
                            if (!email || !password || !confirm) { alert('Please fill in all fields'); return; }
                            if (password !== confirm) { alert('Passwords do not match'); return; }
                            if (!termsAccepted) { alert('You must accept the Terms of Use to register'); return; }
                            registerBtn.disabled = true; registerBtn.textContent = 'Registering...';
                            const response = await apiFetch('/api/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email,password,termsAccepted}) });
                            if (!response.ok) { const err = await response.json().catch(()=>({error:'register_failed'})); throw new Error(err.error||'Registration failed'); }
                            const data = await response.json();
                            
                            // Handle email verification
                            if (data.requires_verification) {
                                loginModal.style.display = 'none';
                                showVerificationModal(email, data.user_id, loginModal);
                                return;
                            }
                            
                            try { chrome.storage.local.set({ jwtToken: data.token, userId: data.user_id, userEmail: data.email, isPro: data.is_pro, isAdmin: data.is_admin }, ()=>{ loginModal.remove(); location.reload(); }); } catch(e){ loginModal.remove(); }
                        } catch (err) { alert('Registration error: '+(err.message||err)); try{ registerBtn.disabled=false; registerBtn.textContent='Register'; }catch(e){} }
                    });
                }
            } catch (innerErr) { console.warn('ui.js login modal callback error', innerErr); }
        });
    } catch (err) { console.warn('chrome.storage unavailable during login modal check', err); }

    // Create toolbar
    const toolbar = document.createElement('div'); toolbar.id = 'bulk-manager-toolbar';
    toolbar.innerHTML = `
        <div class="bulk-toolbar-header">
            <label class="bulk-switch"><input type="checkbox" id="bulk-toggle"><span class="bulk-switch-label">Bulk Mode</span></label>
            <div class="bulk-settings"><button id="bulk-settings-toggle" class="bulk-gear">⚙</button></div>
        </div>
        <div class="bulk-toolbar-controls" style="display:${window.BULK_MODE ? 'flex' : 'none'};">
            <span id="bulk-select-count">0 selected</span>
            <span id="bulk-delete-remaining" style="font-size:11px;color:#a0a0a0;margin-left:12px;padding:2px 8px;background:#2a2b32;border-radius:4px;"></span>
            <div class="bulk-toolbar-buttons"><button id="bulk-select-all" class="bulk-btn">Select All</button><button id="bulk-archive-btn" class="bulk-btn bulk-btn-archive">Archive</button><button id="bulk-delete-btn" class="bulk-btn bulk-btn-delete">Delete</button></div>
        </div>
        <div id="bulk-progress-bar" style="display:none;"><div id="bulk-progress-fill"></div></div>
    `;
    mountTarget.prepend(toolbar);

    // Create limit modal and settings overlay (simplified, stable structure)
    const limitModal = document.createElement('div'); limitModal.id='bulk-limit-modal'; limitModal.className='bulk-modal-overlay'; limitModal.style.display='none'; limitModal.innerHTML=`<div class="bulk-modal-content"><h3>Daily Limit Reached</h3><p>You've reached the maximum of <strong>10 deletes per day</strong> on the free plan.</p><div class="bulk-modal-buttons"><button id="bulk-modal-upgrade" class="bulk-modal-btn">Upgrade to Pro</button><button id="bulk-modal-close" class="bulk-modal-btn">Close</button></div></div>`; document.body.appendChild(limitModal);
    const closeBtn = limitModal.querySelector('#bulk-modal-close'); if (closeBtn) closeBtn.addEventListener('click', ()=>{ limitModal.style.display='none'; });
    const settingsOverlay = document.createElement('div');
    settingsOverlay.id = 'bulk-settings-overlay';
    settingsOverlay.className = 'bulk-settings-overlay';
    settingsOverlay.style.display = 'none';
    settingsOverlay.innerHTML = `
        <div class="bulk-settings-panel modal">
            <div class="bulk-settings-panel-inner">
                <button class="bulk-settings-close" type="button" aria-label="Close">×</button>
                <h3 style="margin-top:0;">Bulk Manager Settings</h3>

                <div class="bulk-settings-section">
                    <label>
                        <input type="checkbox" id="bulk-confirm-delete" data-setting="bulkConfirmDelete">
                        Confirm before Delete
                    </label>
                </div>

                <div class="bulk-settings-section">
                    <label>
                        <input type="checkbox" id="bulk-confirm-archive" data-setting="bulkConfirmArchive">
                        Confirm before Archive
                    </label>
                </div>

                <div class="bulk-settings-section">
                    <h4 style="margin:8px 0 6px 0;">Theme</h4>
                    <select id="bulk-theme-select" style="width:100%; padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-secondary); color:var(--text-primary); border-radius:6px; font-size:13px; cursor:pointer;">
                        <option value="theme-dark">Dark (Default)</option>
                        <option value="theme-default">Light</option>
                        <option value="theme-green">Green</option>
                        <option value="theme-luduvo">Luduvo</option>
                        <option value="theme-cloud">Cloud</option>
                        <option value="theme-cosmic">Cosmic</option>
                    </select>
                </div>

                <div class="bulk-settings-section">
                    <h4 style="margin:8px 0 6px 0;">Support & Contact</h4>
                    <div class="bulk-support-email">mohammedyusufnakhuda@gmail.com</div>
                    <div style="margin-top:8px;">
                        <label style="display:block; font-size:13px; margin-bottom:6px;">Message
                            <textarea id="bulk-contact-message" class="bulk-textarea" rows="3" placeholder="Write a short message..."></textarea>
                        </label>
                        <div class="bulk-action-row">
                            <button id="bulk-copy-email" class="bulk-btn" type="button">Copy Email</button>
                            <button id="bulk-send-email" class="bulk-btn" type="button">Send Email</button>
                        </div>
                    </div>
                </div>

                <div class="bulk-settings-section">
                    <h4 style="margin:8px 0 6px 0;">Pro Features</h4>
                    <div style="font-size:13px; color:#d6d6db; margin-bottom:12px;">Unlimited actions & priority support.</div>
                    <button id="bulk-upgrade-btn" class="bulk-upgrade-btn" type="button">Upgrade to Pro</button>
                </div>

                <div class="bulk-settings-section bulk-admin-section" id="bulk-admin-section" style="display:none;">
                    <h4 style="margin:8px 0 6px 0;">Admin Controls</h4>
                    <div style="font-size:13px; color:#d6d6db; margin-bottom:10px;">Grant unlimited delete override by toggling admin access.</div>
                    <input type="email" id="bulk-admin-email" class="bulk-input" placeholder="User email">
                    <label class="bulk-admin-toggle" style="margin-top:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
                        <input type="checkbox" id="bulk-admin-enabled">
                        Set as admin (unlimited deletes)
                    </label>
                    <div class="bulk-action-row" style="margin-top:10px;">
                        <button id="bulk-admin-lookup" class="bulk-btn" type="button">Lookup</button>
                        <button id="bulk-admin-save" class="bulk-btn" type="button">Apply</button>
                    </div>
                    <div id="bulk-admin-result" class="bulk-admin-result" style="margin-top:10px;"></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(settingsOverlay);

    // Wire settings toggle
    const settingsToggle = toolbar.querySelector('#bulk-settings-toggle');
    const settingsCloseBtn = settingsOverlay.querySelector('.bulk-settings-close');
    const adminSection = settingsOverlay.querySelector('#bulk-admin-section');
    if (settingsToggle) {
        settingsToggle.addEventListener('click', (e) => {
            try {
                e.stopPropagation();
                settingsOverlay.style.display = 'flex';
                settingsOverlay.querySelector('#bulk-contact-message')?.focus?.();

                chrome.storage.local.get(['jwtToken', 'isAdmin'], async (storage) => {
                    try {
                        if (!adminSection) return;

                        if (!storage || !storage.jwtToken) {
                            adminSection.style.display = 'none';
                            return;
                        }

                        try {
                            const profileResponse = await apiFetch('/api/user/profile', {
                                headers: { 'Authorization': `Bearer ${storage.jwtToken}` }
                            });

                            if (!profileResponse.ok) {
                                adminSection.style.display = storage.isAdmin ? 'block' : 'none';
                                return;
                            }

                            const profileData = await profileResponse.json();
                            const isAdmin = !!profileData.is_admin;
                            chrome.storage.local.set({
                                isAdmin,
                                isPro: !!profileData.is_pro
                            });
                            adminSection.style.display = isAdmin ? 'block' : 'none';
                        } catch (err) {
                            adminSection.style.display = storage.isAdmin ? 'block' : 'none';
                        }
                    } catch (innerErr) {
                        console.warn('admin visibility error', innerErr);
                    }
                });
            } catch (err) {
                console.warn('settings toggle error', err);
            }
        });
    }

    if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', (e) => {
            try {
                e.preventDefault();
                e.stopPropagation();
                settingsOverlay.style.display = 'none';
            } catch (err) {}
        });
    }

    settingsOverlay.addEventListener('click', (e) => {
        try {
            if (e.target === settingsOverlay) settingsOverlay.style.display = 'none';
        } catch (err) {}
    });

    document.addEventListener('keydown', (e) => {
        try {
            if (e.key === 'Escape' && settingsOverlay.style.display === 'flex') {
                settingsOverlay.style.display = 'none';
            }
        } catch (err) {}
    });

    // Basic settings behaviors
    try {
        chrome.storage.local.get(['bulkConfirmDelete', 'bulkConfirmArchive', 'bulkTheme'], (res) => {
            try {
                const del = settingsOverlay.querySelector('#bulk-confirm-delete');
                const arc = settingsOverlay.querySelector('#bulk-confirm-archive');
                const themeSelect = settingsOverlay.querySelector('#bulk-theme-select');
                if (del) del.checked = !!res.bulkConfirmDelete;
                if (arc) arc.checked = !!res.bulkConfirmArchive;
                if (themeSelect && res.bulkTheme) {
                    themeSelect.value = res.bulkTheme;
                }
            } catch (e) {}
        });
    } catch (e) {}

    // Load and apply saved theme on page load
    try {
        chrome.storage.local.get(['bulkTheme'], (res) => {
            const savedTheme = res.bulkTheme || 'theme-dark';
            document.documentElement.setAttribute('data-bulk-manager-theme', savedTheme);
            // Remove all theme classes and add the saved one
            document.body.classList.remove('theme-dark', 'theme-default', 'theme-green', 'theme-luduvo', 'theme-cloud', 'theme-cosmic');
            document.body.classList.add(savedTheme);
        });
    } catch (e) {}

    try {
        settingsOverlay.querySelectorAll('input[data-setting]').forEach((inp) => {
            inp.addEventListener('change', () => {
                const key = inp.dataset.setting;
                const val = inp.checked;
                const obj = {};
                obj[key] = val;
                try { chrome.storage.local.set(obj); } catch (e) {}
            });
        });
    } catch (e) {}

    // Theme selector
    try {
        const themeSelect = settingsOverlay.querySelector('#bulk-theme-select');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                const selectedTheme = e.target.value;
                // Save to storage
                chrome.storage.local.set({ bulkTheme: selectedTheme });
                // Apply theme immediately
                document.body.classList.remove('theme-dark', 'theme-default', 'theme-green', 'theme-luduvo', 'theme-cloud', 'theme-cosmic');
                document.body.classList.add(selectedTheme);
                document.documentElement.setAttribute('data-bulk-manager-theme', selectedTheme);
            });
        }
    } catch (e) {}

    // Copy email button
    const copyBtn = settingsOverlay.querySelector('#bulk-copy-email');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            try {
                e.stopPropagation();
                const email = (settingsOverlay.querySelector('.bulk-support-email') || {}).textContent || 'placeholder@gmail.com';
                const toastMessage = (message) => {
                    const existing = document.querySelector('.bulk-toast');
                    if (existing) existing.remove();
                    const toast = document.createElement('div');
                    toast.className = 'bulk-toast';
                    toast.textContent = message;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 1800);
                };

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(email).then(() => {
                        toastMessage('Email copied to clipboard.');
                    }).catch(() => {
                        toastMessage('Unable to copy email.');
                    });
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = email;
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); } catch (err) {}
                    ta.remove();
                    toastMessage('Email copied to clipboard.');
                }
            } catch (err) {
                console.warn('copy email error', err);
            }
        });
    }

    // Send Email button opens Gmail compose with prefilled body
    const sendBtn = settingsOverlay.querySelector('#bulk-send-email');
    if (sendBtn) {
        sendBtn.addEventListener('click', (e) => {
            try {
                e.stopPropagation();
                const fromEmail = 'mohammedyusufnakhuda@gmail.com';
                const to = 'mohammedyusufnakhuda@gmail.com';
                const subject = encodeURIComponent('Bulk Manager Contact');
                const msgVal = (settingsOverlay.querySelector('#bulk-contact-message') || {}).value || '';
                const body = encodeURIComponent('From: ' + fromEmail + '\n\n' + msgVal);
                const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${subject}&body=${body}`;
                window.open(gmailUrl, '_blank');
            } catch (err) {
                console.warn('send email error', err);
            }
        });
    }

    // Upgrade button opens Stripe checkout via backend
    const upgradeBtn = settingsOverlay.querySelector('#bulk-upgrade-btn');
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            upgradeBtn.disabled = true;
            upgradeBtn.textContent = 'Loading...';

            try {
                const response = await apiFetch('/api/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        priceType: 'monthly',
                        userId: 'extension-user',
                        email: 'user@example.com'
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to create checkout session');
                }

                const data = await response.json();
                const sessionId = data.sessionId;

                if (sessionId) {
                    window.open(`https://checkout.stripe.com/pay/${sessionId}`, '_blank');
                } else {
                    throw new Error('No session ID returned');
                }
            } catch (error) {
                const existing = document.querySelector('.bulk-toast');
                if (existing) existing.remove();
                const toast = document.createElement('div');
                toast.className = 'bulk-toast';
                toast.textContent = 'Error: ' + error.message;
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2500);
            } finally {
                upgradeBtn.disabled = false;
                upgradeBtn.textContent = 'Upgrade to Pro';
            }
        });
    }

    // Admin lookup/save wiring
    try {
        const adminLookupBtn = settingsOverlay.querySelector('#bulk-admin-lookup');
        const adminSaveBtn = settingsOverlay.querySelector('#bulk-admin-save');
        const adminEmailInput = settingsOverlay.querySelector('#bulk-admin-email');
        const adminEnabledInput = settingsOverlay.querySelector('#bulk-admin-enabled');
        const adminResult = settingsOverlay.querySelector('#bulk-admin-result');

        if (adminLookupBtn && adminEmailInput && adminEnabledInput && adminResult) {
            adminLookupBtn.addEventListener('click', () => {
                const email = (adminEmailInput.value || '').trim().toLowerCase();
                if (!email) {
                    adminResult.textContent = 'Enter an email first.';
                    return;
                }

                chrome.storage.local.get(['jwtToken'], (r) => {
                    try {
                        if (!r || !r.jwtToken) {
                            adminResult.textContent = 'Missing login token.';
                            return;
                        }

                        apiFetch(`/api/admin/user?email=${encodeURIComponent(email)}`, {
                            headers: { 'Authorization': `Bearer ${r.jwtToken}` }
                        }).then(resp => resp.json().then(data => {
                            if (!resp.ok) throw new Error(data.error || 'Lookup failed');
                            adminEnabledInput.checked = !!data.user.is_admin;
                            adminResult.textContent = `Found ${data.user.email} | Pro: ${data.user.is_pro ? 'yes' : 'no'} | Admin: ${data.user.is_admin ? 'yes' : 'no'}`;
                        }).catch(err => {
                            adminResult.textContent = `Lookup error: ${err.message}`;
                        })).catch(err => {
                            adminResult.textContent = `Lookup error: ${err.message}`;
                        });
                    } catch (e) {
                        adminResult.textContent = 'Lookup error';
                    }
                });
            });
        }

        if (adminSaveBtn && adminEmailInput && adminEnabledInput && adminResult) {
            adminSaveBtn.addEventListener('click', () => {
                const email = (adminEmailInput.value || '').trim().toLowerCase();
                if (!email) {
                    adminResult.textContent = 'Enter an email first.';
                    return;
                }

                chrome.storage.local.get(['jwtToken'], (r) => {
                    try {
                        if (!r || !r.jwtToken) {
                            adminResult.textContent = 'Missing login token.';
                            return;
                        }

                        adminSaveBtn.disabled = true;
                        adminSaveBtn.textContent = 'Saving...';

                        apiFetch('/api/admin/set-admin', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${r.jwtToken}`
                            },
                            body: JSON.stringify({ email, is_admin: !!adminEnabledInput.checked })
                        }).then(response => response.json().then(data => {
                            if (!response.ok) throw new Error(data.error || 'Save failed');
                            adminResult.textContent = `Updated ${data.user.email}: admin=${data.user.is_admin ? 'yes' : 'no'}`;
                        }).catch(err => {
                            adminResult.textContent = `Save error: ${err.message}`;
                        })).catch(err => {
                            adminResult.textContent = `Save error: ${err.message}`;
                        }).finally(() => {
                            adminSaveBtn.disabled = false;
                            adminSaveBtn.textContent = 'Apply';
                        });
                    } catch (e) {
                        adminResult.textContent = 'Save error';
                    }
                });
            });
        }
    } catch (e) {}

    // Sync the custom switch label class with the input state and listen for manual toggles
    const bulkToggleInput = toolbar.querySelector('#bulk-toggle');
    const bulkToggleLabel = toolbar.querySelector('.bulk-switch');
    if (bulkToggleInput && bulkToggleLabel) {
        const sync = () => bulkToggleLabel.classList.toggle('bulk-switch-checked', !!bulkToggleInput.checked);
        bulkToggleInput.addEventListener('change', (e) => {
            sync();
            // if user toggles, update stored state and UI
            try { window.BulkUI.setBulkMode && window.BulkUI.setBulkMode(bulkToggleInput.checked); } catch (e) {}
        });
        sync();
    }
}

function refreshCheckboxes() {
    document.querySelectorAll('a[data-sidebar-item="true"]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || !href.startsWith('/c/')) return;
        injectCheckbox(el);
    });
}

function injectCheckbox(chatEl) {
    try {
        if (!chatEl || !chatEl.parentElement) return;
        if (chatEl.dataset && chatEl.dataset.bulkInjected) {
            try {
                const container = chatEl.querySelector('.bulk-checkbox-container');
                if (container && container.parentElement) container.style.display = window.BULK_MODE ? 'flex' : 'none';
            } catch (e) {}
            return;
        }

        if (!chatEl.isConnected) return;

        try {
            const container = document.createElement('div');
            container.className = 'bulk-checkbox-container';
            container.style.display = window.BULK_MODE ? 'flex' : 'none';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'bulk-checkbox';
            
            const chatHref = chatEl.getAttribute ? chatEl.getAttribute('href') : null;
            if (chatHref) checkbox.dataset.chatId = chatHref;

            checkbox.addEventListener('click', e => {
                try {
                    try { e.stopPropagation(); } catch(e){}
                    try { 
                        if (document.body && document.body.contains && chatEl.parentElement && document.body.contains(chatEl)) {
                            updateSelectCount(); 
                        } 
                    } catch(e){ console.warn('checkbox click handler error', e); }
                } catch (outerErr) { console.warn('checkbox event listener outer error', outerErr); }
            });

            container.appendChild(checkbox);

            // Try to attach the container
            try {
                if (chatEl && chatEl.parentElement && chatEl.isConnected) {
                    if (typeof chatEl.prepend === 'function') {
                        chatEl.prepend(container);
                    } else if (chatEl.firstChild) {
                        chatEl.insertBefore(container, chatEl.firstChild);
                    } else {
                        chatEl.appendChild(container);
                    }
                    try { if (chatEl.dataset) chatEl.dataset.bulkInjected = "1"; } catch(e){}
                }
            } catch (domErr) {
                console.warn('Failed to attach bulk checkbox (element detached or invalid)', domErr);
            }
        } catch (setupErr) {
            console.warn('injectCheckbox setup error', setupErr);
        }
    } catch (err) {
        console.warn('injectCheckbox outer error', err);
    }
}

function updateSelectCount() {
    try {
        const count = document.querySelectorAll('.bulk-checkbox:checked').length;
        const countEl = document.getElementById('bulk-select-count');
        if (countEl) { try { countEl.textContent = `${count} selected`; } catch (e) {} }
        try { updateDeleteCounter(); } catch (e) { console.warn('updateDeleteCounter failed', e); }
    } catch (err) {
        console.warn('updateSelectCount error', err);
    }
}

function updateDeleteCounter() {
    try {
        const counterEl = document.getElementById('bulk-delete-remaining');
        if (!counterEl) return;
        
        // Check if chrome API is still available (context not invalidated)
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            return;
        }

        // Store reference checks to prevent invalidated context errors
        const updateCounter = (text, color) => {
            try { if (counterEl && counterEl.parentElement) { counterEl.textContent = text; if (color) counterEl.style.color = color; } } catch (e) {}
        };

        try {
            chrome.storage.local.get(['jwtToken', 'isPro', 'isAdmin', 'deleteRemaining'], (result) => {
                try {
                    // Check context still valid inside callback
                    if (typeof chrome === 'undefined' || !chrome.storage) return;

                    if (!result || !result.jwtToken) {
                        updateCounter('Not logged in');
                        return;
                    }

                    const isPro = result.isPro || false;
                    const isAdmin = result.isAdmin || false;

                    if (isPro || isAdmin) {
                        const color = isAdmin ? '#f0b232' : '#10a37f';
                        const text = isAdmin ? 'Admin (Unlimited)' : 'Pro (Unlimited)';
                        updateCounter(text, color);
                    } else {
                        // Fetch stats from backend
                        apiFetch('/api/user/profile', {
                            headers: { 'Authorization': `Bearer ${result.jwtToken}` }
                        }).then(response => {
                            if (response.ok) {
                                return response.json().then(data => {
                                    // Only update storage if context still valid
                                    try { 
                                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                                            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                                                chrome.storage.local.set({ isPro: !!data.is_pro, isAdmin: !!data.is_admin });
                                            } 
                                        }
                                    } catch(e){}
                                    const stats = data.delete_stats || {};
                                    if (data.is_pro || data.is_admin || stats.limit === null) {
                                        const color = data.is_admin ? '#f0b232' : '#10a37f';
                                        const text = data.is_admin ? 'Admin (Unlimited)' : 'Pro (Unlimited)';
                                        updateCounter(text, color);
                                    } else {
                                        const text = `Deletes: ${stats.remaining}/${stats.limit}`;
                                        const color = stats.remaining <= 3 ? '#d93025' : '#a0a0a0';
                                        updateCounter(text, color);
                                    }
                                }).catch(() => { updateCounter(`Deletes: ${result.deleteRemaining || 10}/10`); });
                            } else {
                                updateCounter(`Deletes: ${result.deleteRemaining || 10}/10`);
                            }
                        }).catch(err => {
                            console.error('Failed to fetch delete stats:', err);
                            updateCounter(`Deletes: ${result.deleteRemaining || 10}/10`);
                        });
                    }
                } catch (innerErr) { console.warn('ui.js updateDeleteCounter storage callback error', innerErr); updateCounter('Not logged in'); }
            });
        } catch (err) {
            console.warn('chrome.storage call failed in updateDeleteCounter:', err);
        }
    } catch (err) {
        console.warn('updateDeleteCounter outer error', err);
    }
}

function initUI() {
    try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            console.warn('chrome.storage not available in initUI');
            return;
        }
        chrome.storage.local.get(["bulkMode"], (res) => {
            try {
                window.BULK_MODE = !!res.bulkMode;

                const bodyObserver = new MutationObserver(() => {
                    try {
                        const sidebarNav = findSidebarMount();
                        if (sidebarNav) {
                            try { createToolbar(); } catch(e) { console.warn('createToolbar in observer error', e); }
                            try { refreshCheckboxes(); } catch(e) { console.warn('refreshCheckboxes in observer error', e); }
                            try { updateDeleteCounter(); } catch(e) { console.warn('updateDeleteCounter in observer error', e); }

                            if (!window._sidebarObserver) {
                                window._sidebarObserver = new MutationObserver(() => {
                                    try { createToolbar(); } catch(e) { console.warn('createToolbar in sidebar observer error', e); }
                                    try { refreshCheckboxes(); } catch(e) { console.warn('refreshCheckboxes in sidebar observer error', e); }
                                });
                                try { window._sidebarObserver.observe(sidebarNav, { childList: true, subtree: true }); } catch(e){}
                            }
                        } else {
                            try { createToolbar(); } catch(e) { console.warn('createToolbar no sidebar error', e); }
                        }
                    } catch (observerErr) { console.warn('mutation observer callback error', observerErr); }
                });

                bodyObserver.observe(document.body, { childList: true, subtree: true });

                try { createToolbar(); } catch(e) { console.warn('initial createToolbar error', e); }
                try { refreshCheckboxes(); } catch(e) { console.warn('initial refreshCheckboxes error', e); }
                try { updateDeleteCounter(); } catch(e) { console.warn('initial updateDeleteCounter error', e); }
            } catch (storageErr) { console.warn('initUI chrome.storage callback error', storageErr); }
        });
    } catch (err) { console.warn('initUI chrome.storage call error', err); }
}

window.BulkUI = {
    init: initUI,
    setBulkMode: setBulkMode,
    updateProgress: (current, total) => {
        const bar = document.getElementById('bulk-progress-bar');
        const fill = document.getElementById('bulk-progress-fill');
        if (bar && fill) {
            bar.style.display = 'block';
            const percent = (current / total) * 100;
            fill.style.width = `${percent}%`;
            if (current === total) {
                setTimeout(() => { bar.style.display = 'none'; }, 2000);
            }
        }
    },
    showToast: (message, duration = 2500) => {
        const existing = document.querySelector('.bulk-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'bulk-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }
};
