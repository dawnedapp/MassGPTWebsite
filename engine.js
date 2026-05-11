window.BULK_MODE = false;

const SELECTORS = {
    chatItem: 'a[data-sidebar-item="true"]',
    optionsButton: 'button[aria-haspopup="menu"][aria-label*="Open conversation options"]',
    confirmDelete: 'button.btn-danger',
    menuItemRole: 'div[role="menuitem"]'
};

const ENGINE_API_BASE_URLS = [
    'https://massgptdeleter.onrender.com',
    'http://127.0.0.1:5000',
    'http://localhost:5000'
];

async function apiFetchBackend(path, options = {}) {
    let lastError = null;

    for (let i = 0; i < ENGINE_API_BASE_URLS.length; i++) {
        const baseUrl = ENGINE_API_BASE_URLS[i];
        try {
            const response = await fetch(`${baseUrl}${path}`, options);
            if (response.status === 404 && i < ENGINE_API_BASE_URLS.length - 1) {
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

const DAILY_DELETE_LIMIT = 10; // Free tier limit

const delay = ms => new Promise(res => setTimeout(res, ms));

// Rate limiting helper - now calls backend
async function checkAndLogDelete(token, isProUser = false) {
    try {
        const response = await apiFetchBackend('/api/user/log-delete', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ count: 1 })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 429) {
                // Daily limit reached
                throw new Error(data.error || 'Daily delete limit reached');
            }
            throw new Error(data.error || 'Failed to log delete');
        }
        
        // Update local UI with stats from server
        chrome.storage.local.set({
            deleteCount: data.delete_stats.today,
            deleteRemaining: data.delete_stats.remaining
        });
        
        return data.delete_stats;
    } catch (error) {
        // Fallback to local counting if backend is down
        console.error('Failed to log delete to backend:', error);
        throw error;
    }
}

async function waitForElement(selector, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el) return el;
        await delay(100);
    }
    return null;
}

async function performAction(id, actionType) {
    console.log(`[Bulk Manager] Starting ${actionType} for ${id}`);
    
    // Find the chat item by its unique href
    const chatLink = document.querySelector(`a[href="${id}"][data-sidebar-item="true"]`);
    if (!chatLink) throw new Error("Chat item not found in sidebar");

    chatLink.scrollIntoView({ block: 'center' });
    await delay(300);

    const optionsBtn = chatLink.querySelector(SELECTORS.optionsButton);
    if (!optionsBtn) throw new Error("Options button not found");

    optionsBtn.click();
    await delay(600);

    const menuItems = Array.from(document.querySelectorAll(SELECTORS.menuItemRole));
    const targetOption = menuItems.find(el => el.textContent.toLowerCase().includes(actionType.toLowerCase()));
    
    if (!targetOption) throw new Error(`${actionType} option not found in menu`);
    targetOption.click();

    if (actionType.toLowerCase() === 'delete') {
        const confirmBtn = await waitForElement(SELECTORS.confirmDelete);
        if (!confirmBtn) throw new Error("Delete confirmation button not found");
        confirmBtn.click();
        await delay(1000);
    } else {
        // Archive is immediate
        await delay(600);
    }
    
    console.log(`[Bulk Manager] Successfully ${actionType}d ${id}`);
}

async function processBatch(ids, actionType, onProgress) {
    let successCount = 0;
    let failCount = 0;
    let limitReached = false;
    const isDelete = actionType.toLowerCase() === 'delete';

    // Get JWT token for authenticated requests
    const jwtToken = await new Promise((resolve) => {
        chrome.storage.local.get(['jwtToken'], (result) => {
            resolve(result.jwtToken || null);
        });
    });

    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
            // Check rate limit for deletes via backend
            if (isDelete && jwtToken) {
                await checkAndLogDelete(jwtToken);
            }
            
            await performAction(id, actionType);
            successCount++;
        } catch (err) {
            console.error(`[Bulk Manager] Failed to ${actionType} ${id}:`, err);
            failCount++;
            
            // Check if this is a rate limit error
            if (err.message.includes('Daily delete limit')) {
                limitReached = true;
                break; // Stop processing if limit is hit
            }
        }
        if (onProgress) onProgress(i + 1, ids.length);
    }

    return { successCount, failCount, limitReached };
}

// Attach to window for content.js to access
window.BulkEngine = {
    processBatch
};
