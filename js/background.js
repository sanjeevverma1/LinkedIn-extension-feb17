// background.js — Service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log("[LinkedIn Resume Tailor] Extension installed v2.1");
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
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});
