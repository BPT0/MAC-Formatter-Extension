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

    // 콘텐츠 스크립트를 강제로 주입
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        files: ["content.js"],
      },
      () => {
        if (!chrome.runtime.lastError) {
          // 주입 성공 후 메시지 전송
          chrome.tabs.sendMessage(
            tab.id,
            { action: "validateAndReplace", text: formattedMAC },
            (response) => {}
          );
        }
      }
    );
  }
});
