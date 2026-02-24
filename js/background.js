// background.js — Service worker for Job Resume Tailor
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Job Resume Tailor] Extension installed v3.0");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "openSidePanel") {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(console.error);
  }
  if (msg.action === "jobDataExtracted" || msg.action === "extractionFailed") {
    chrome.runtime.sendMessage(msg).catch(() => {
      chrome.storage.session.set({ pendingJobData: msg });
    });
  }
  // Dynamically inject content script on pages not matched by manifest
  if (msg.action === "injectContentScript") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["js/content.js"],
      }).catch((err) => console.warn("[Job Resume Tailor] Could not inject content script:", err));
      chrome.scripting.insertCSS({
        target: { tabId },
        files: ["css/content.css"],
      }).catch(() => {});
    }
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});
