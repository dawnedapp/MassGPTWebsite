const FEEDBACK_URL = 'https://massgptdeleter.onrender.com/feedback?source=extension_uninstall';

function setFeedbackUninstallUrl() {
    try {
        if (chrome?.runtime?.setUninstallURL) {
            chrome.runtime.setUninstallURL(FEEDBACK_URL, () => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.warn('Failed to set uninstall URL:', err.message);
                }
            });
        }
    } catch (error) {
        console.warn('Unable to register uninstall URL:', error);
    }
}

setFeedbackUninstallUrl();

if (chrome?.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
        setFeedbackUninstallUrl();
    });
}
