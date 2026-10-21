// 확장 프로그램 설치 시 컨텍스트 메뉴 생성
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: "formatAndReplaceMAC",
      title: "Format and Replace as MAC Address",
      contexts: ["selection"],
    },
    () => {}
  );
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "formatAndReplaceMAC" && info.selectionText) {
    const formattedMAC = info.selectionText.replace(/.{2}(?=.)/g, "$&-");

    const target = { tabId: tab.id };
    const sendToPage = () =>
      chrome.tabs.sendMessage(tab.id, { action: "validateAndReplace", text: formattedMAC }, () => {
        void chrome.runtime.lastError; // 응답이 없어도 오류로 남기지 않는다
      });

    // 이미 주입된 탭에 다시 주입하면 메시지 리스너가 중복 등록되므로 주입 여부를 먼저 확인한다
    chrome.scripting.executeScript({ target, func: () => Boolean(window.__macFormatterLoaded) }, (results) => {
      if (chrome.runtime.lastError) return;
      if (results && results[0] && results[0].result) {
        sendToPage();
        return;
      }

      // 아직 주입되지 않은 탭(확장 설치 전에 열린 탭 등)에만 콘텐츠 스크립트를 주입한다
      chrome.scripting.executeScript({ target, files: ["content.js"] }, () => {
        if (!chrome.runtime.lastError) sendToPage();
      });
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "copyFromStorage") {
    chrome.storage.local.get(["latestMAC"], (result) => {
      const text = result.latestMAC;
      if (!text) {
        sendResponse({ success: false, error: "No MAC stored" });
        return;
      }

      // HTTPS 환경인 background에서는 clipboard API 사용 가능
      navigator.clipboard.writeText(text).then(() => {
        console.log("Clipboard 복사 성공:", text);
        sendResponse({ success: true });
      }).catch((err) => {
        console.error("Clipboard 복사 실패:", err);
        sendResponse({ success: false, error: err.message });
      });
    });
    return true; // 비동기 응답
  }
});

