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

// 주입할 수 없는 영역(권한이 없는 프레임 등)에서는 아이콘 배지로 알린다
function showUnavailable(tabId) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setTitle({ tabId, title: "MAC Formatter: 이 영역에서는 변환할 수 없습니다" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({ tabId, title: "MAC Formatter" });
  }, 4000);
}

// 사용자가 메뉴를 누른 프레임에만 content.js를 주입한다 (activeTab 권한, 모든 사이트 자동 주입 없음)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "formatAndReplaceMAC" && info.selectionText) {
    const formattedMAC = info.selectionText.replace(/.{2}(?=.)/g, "$&-");

    const frameId = info.frameId || 0;
    const target = { tabId: tab.id, frameIds: [frameId] };
    const sendToPage = () =>
      chrome.tabs.sendMessage(tab.id, { action: "validateAndReplace", text: formattedMAC }, { frameId }, () => {
        void chrome.runtime.lastError; // 응답이 없어도 오류로 남기지 않는다
      });

    // 이미 주입된 프레임에 다시 주입하면 메시지 리스너가 중복 등록되므로 주입 여부를 먼저 확인한다
    chrome.scripting.executeScript({ target, func: () => Boolean(window.__macFormatterLoaded) }, (results) => {
      if (chrome.runtime.lastError) {
        showUnavailable(tab.id);
        return;
      }
      if (results && results[0] && results[0].result) {
        sendToPage();
        return;
      }

      chrome.scripting.executeScript({ target, files: ["content.js"] }, () => {
        if (chrome.runtime.lastError) {
          showUnavailable(tab.id);
          return;
        }
        sendToPage();
      });
    });
  }
});
