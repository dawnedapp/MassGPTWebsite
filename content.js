(function() {
    console.log("[Bulk Manager] Content script loaded");

    const ROOT_ID = 'bulk-manager-root';

    function ensureRoot() {
        let root = document.getElementById(ROOT_ID);
        if (root) return root;

        root = document.createElement('div');
        root.id = ROOT_ID;
        root.style.position = 'fixed';
        root.style.top = '84px';
        root.style.left = '16px';
        root.style.zIndex = '2147483647';
        root.style.width = '320px';
        root.style.maxWidth = 'calc(100vw - 32px)';
        root.style.pointerEvents = 'auto';

        const mount = () => {
            if (!document.body) return false;
            document.body.appendChild(root);
            return true;
        };

        if (!mount()) {
            document.addEventListener('DOMContentLoaded', mount, { once: true });
        }

        return root;
    }

    ensureRoot();

    function renderFallbackMessage(text) {
        const root = ensureRoot();
        root.innerHTML = `
            <div style="background:#202123; color:#ececf1; border:1px solid #4d4d4f; border-radius:12px; padding:12px 14px; box-shadow:0 12px 30px rgba(0,0,0,0.45); font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                <div style="font-weight:700; margin-bottom:6px;">GPT Mass Deleter</div>
                <div style="font-size:13px; line-height:1.45; color:#d6d6db;">${text}</div>
                <button id="bulk-retry-ui" style="margin-top:10px; width:100%; border:none; border-radius:8px; padding:10px 12px; background:#10a37f; color:#fff; font-weight:600; cursor:pointer;">Retry loading panel</button>
            </div>
        `;

        const retryBtn = root.querySelector('#bulk-retry-ui');
        if (retryBtn) {
            retryBtn.onclick = () => {
                if (window.BulkUI && typeof window.BulkUI.init === 'function') {
                    window.BulkUI.init();
                }
            };
        }
    }

    function bootBulkUI() {
        if (window.BulkUI && typeof window.BulkUI.init === 'function') {
            window.BulkUI.init();
            const root = document.getElementById(ROOT_ID);
            if (root && root.childElementCount === 0) root.remove();
            return true;
        }

        renderFallbackMessage('Loading the extension UI. If this message stays here, reload the extension from chrome://extensions and refresh ChatGPT.');
        return false;
    }

    function showModal(message) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "bulk-modal-overlay";
            overlay.innerHTML = `
                <div class="bulk-modal-content">
                    <p style="margin-bottom: 20px; font-size: 16px;">${message}</p>
                    <div class="bulk-modal-buttons">
                        <button id="bulk-modal-yes" class="bulk-modal-btn bulk-modal-btn-yes">Confirm</button>
                        <button id="bulk-modal-no" class="bulk-modal-btn bulk-modal-btn-no">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            overlay.querySelector("#bulk-modal-yes").onclick = () => {
                overlay.remove();
                resolve(true);
            };

            overlay.querySelector("#bulk-modal-no").onclick = () => {
                overlay.remove();
                resolve(false);
            };
        });
    }

    function showToast(msg) {
        const el = document.createElement("div");
        el.className = "bulk-toast";
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.5s ease';
            setTimeout(() => el.remove(), 500);
        }, 3000);
    }

    function getSelectedIds() {
        return Array.from(document.querySelectorAll('.bulk-checkbox:checked'))
            .map(cb => cb.dataset.chatId);
    }

    async function handleBulkAction(actionType) {
        const ids = getSelectedIds();
        if (ids.length === 0) {
            showToast("Please select at least one chat.");
            return;
        }

        const confirmed = await showModal(`${actionType.charAt(0).toUpperCase() + actionType.slice(1)} ${ids.length} chats?`);
        if (!confirmed) return;

        // Disable UI during processing
        document.querySelectorAll('.bulk-btn').forEach(btn => btn.disabled = true);

        const result = await window.BulkEngine.processBatch(ids, actionType, (current, total) => {
            window.BulkUI.updateProgress(current, total);
        });

        // Show limit modal if limit was reached
        if (result.limitReached) {
            const limitModal = document.getElementById('bulk-limit-modal');
            if (limitModal) {
                limitModal.style.display = 'flex';
            }
        } else {
            showToast(`Finished: ${result.successCount} succeeded, ${result.failCount} failed.`);
        }
        
        // Reset UI
        document.querySelectorAll('.bulk-checkbox').forEach(cb => cb.checked = false);
        document.querySelectorAll('.bulk-btn').forEach(btn => btn.disabled = false);
        document.getElementById('bulk-select-count').textContent = "0 selected";
    }

    // Initialize UI and attach listeners
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bootBulkUI());
    } else {
        bootBulkUI();
    }

    let bootAttempts = 0;
    const bootTimer = setInterval(() => {
        bootAttempts += 1;
        if (bootBulkUI() || bootAttempts >= 10) {
            clearInterval(bootTimer);
        }
    }, 500);

    document.addEventListener('change', e => {
        if (e.target.id === 'bulk-toggle') {
            window.BulkUI.setBulkMode(e.target.checked);
        }
    });

    document.addEventListener('click', e => {
        const limitModal = document.getElementById('bulk-limit-modal');
        
        if (e.target.id === 'bulk-select-all') {
            if (limitModal) limitModal.style.display = 'none';
            const allCheckboxes = document.querySelectorAll('.bulk-checkbox');
            const someUnchecked = Array.from(allCheckboxes).some(cb => !cb.checked);
            allCheckboxes.forEach(cb => cb.checked = someUnchecked);
            
            e.target.textContent = someUnchecked ? "Deselect All" : "Select All";
            const countEl = document.getElementById('bulk-select-count');
            countEl.textContent = `${someUnchecked ? allCheckboxes.length : 0} selected`;
        }
        
        if (e.target.id === 'bulk-delete-btn') {
            // Proceed with delete (backend will enforce limit)
            handleBulkAction('delete');
        }
        
        if (e.target.id === 'bulk-archive-btn') {
            if (limitModal) limitModal.style.display = 'none';
            handleBulkAction('archive');
        }
    });

})();
