console.log('[CS] content_mac_formatter_main.js loaded');

// background.js가 중복 주입(리스너 중복 등록)을 피하려고 이 값을 확인한다
window.__macFormatterLoaded = true;

function safeRun() {
    const body = document.body;
    if (!body) {
        console.warn("[CS] body not found, retrying...");
        setTimeout(safeRun, 50);
        return;
    }

    console.log("[CS] body found, continuing...");
    initUI(body);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeRun);
} else {
    safeRun();
}

function initUI(body){
    // anchor 찾기
  const anchor =
    document.querySelector("#target") ||
    document.body ||
    document.documentElement;
    // anchor 검증
  if (!anchor) {
    console.warn("[CS] UI anchor not found — UI injection skipped");
  } else {
    try {
      // UI Element 생성
      const uiContainer = document.createElement("div");
      uiContainer.id = "cs-mac-ui";
      uiContainer.style.position = "relative";
      anchor.appendChild(uiContainer);

      console.log("[CS] UI mounted at anchor:", anchor);
    } catch (e) {
      console.warn("[CS] UI mount failed:", e);
    }
  }
}

// MAC 주소 유효성 검사 함수
function isValidMACAddress(cleanText) {
  const macRegex = /^[0-9A-Fa-f]{12}$/; // 12자리 16진수 확인
  return macRegex.test(cleanText);
}

// MAC 주소 포맷팅 함수
function formatMACAddress(cleanText) {
  return cleanText.replace(/.{2}(?=.)/g, "$&-"); // 2자리마다 '-' 추가
}

// 클립보드에 텍스트 복사
function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    // HTTPS 환경: Clipboard API 사용
    navigator.clipboard.writeText(text)
      .then(() => {
        console.log("Text copied to clipboard!");
      })
      .catch(err => {
        console.error("Failed to copy text: ", err);
      });
  } else {
    // HTTP 환경: execCommand로 대체
    fallbackCopyTextToClipboard(text);
  }
}

// HTTP 환경에서 execCommand 사용
function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed"; // 화면에서 보이지 않도록 설정
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  try {
    const successful = document.execCommand("copy");
    console.log("Fallback: Copying text was " + (successful ? "successful" : "unsuccessful"));
  } catch (err) {
    console.error("Fallback: Unable to copy text", err);
  }
  document.body.removeChild(textArea);
}

// 메시지 수신 및 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "validateAndReplace") {
    const originalText = message.text;
    
    // 모든 비허용 문자 제거 (공백, 콜론, 대시 등)
    const cleanText = originalText.replace(/[^0-9A-Fa-f]/g, "");
    
    // MAC 주소 유효성 검사
    if (!isValidMACAddress(cleanText)) {

      // 텍스트 주변에 팝업 메시지 표시
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // 팝업 메시지 생성
        const popup = document.createElement("div");
        popup.innerText = "Invalid MAC Address";
        popup.style.position = "absolute";
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.top = `${rect.top + window.scrollY - 30}px`;
        popup.style.backgroundColor = "#f44336"; // 빨간 배경
        popup.style.color = "#ffffff"; // 흰색 텍스트
        popup.style.padding = "5px 10px";
        popup.style.borderRadius = "5px";
        popup.style.zIndex = "1000";
        popup.style.boxShadow = "0px 4px 6px rgba(0, 0, 0, 0.1)";

        document.body.appendChild(popup);

        // 팝업 메시지 2초 후 제거
        setTimeout(() => {
          popup.remove();
        }, 2000);
      }

      sendResponse({ success: false, error: "Invalid MAC Address" });
      return;
    }

    // MAC 주소가 유효한 경우: 포맷
    const formattedMAC = formatMACAddress(cleanText);
    // selection 확인
    const selection = window.getSelection();
    console.log(selection);
    
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      // p > input 구조에서 input 요소 찾기
      let input = null;

      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        // 텍스트 노드의 부모가 p이고 그 안에 input이 있으면 선택
        const parentP = range.startContainer.parentNode;
        input = parentP.querySelector('input');
      } else if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
        input = range.startContainer.querySelector('input');
      }

      if (input) {
        // 기존 value와 중복 방지
        if (input.value === formattedMAC) {
          sendResponse({ success: false, error: "Duplicate text detected" });
          return;
        }

        // input 값 변경
        input.value = formattedMAC;

        // 커서를 맨 뒤로 이동
        input.focus();
        input.setSelectionRange(formattedMAC.length, formattedMAC.length);

        // chrome.storage.local에 저장
        chrome.storage.local.set({ latestMAC: formattedMAC }, () => {
          console.log("저장된 MAC:", formattedMAC);
        });

        // 클립보드에 복사
        copyTextToClipboard(formattedMAC);
        console.log("정렬된 Mac Addr:", formattedMAC);

        performAsyncTask()
          .then((result) => {
            sendResponse({ success: true, data: result });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });

      } else {
        console.warn("Input element not found for MAC insertion");
        sendResponse({ success: false, error: "Input element not found" });
      }
    }

    // // MAC 주소가 유효한 경우: 포맷하고 Replace
    // const formattedMAC = formatMACAddress(cleanText);
    // const selection = window.getSelection();

    // if (selection && selection.rangeCount > 0) {

    //   const range = selection.getRangeAt(0);

    //   // 기존 내용을 삭제하고 새 텍스트를 삽입
    //   range.deleteContents();

    //   const textNode = document.createTextNode(formattedMAC);

    //   // 중복 방지: 이미 삽입된 텍스트인지 확인
    //   const parentElement = range.startContainer.parentNode;
    //   if (parentElement.textContent.includes(formattedMAC)) {
    //     sendResponse({ success: false, error: "Duplicate text detected" });
    //     return;
    //   }

    //   range.insertNode(textNode);

    //   // 커서를 포맷된 텍스트 뒤로 이동
    //   range.setStartAfter(textNode);
    //   range.setEndAfter(textNode);
    //   selection.removeAllRanges();
    //   selection.addRange(range);
      
    //   // ✅ 복사 대신 chrome.storage.local 에 저장
    //   chrome.storage.local.set({ latestMAC: formattedMAC }, () => {
    //     console.log("저장된 MAC:", formattedMAC);
    //     // sendResponse({ success: true, data: formattedMAC });
    //   });

    //   // 클립보드에 텍스트 복사
    //   copyTextToClipboard(formattedMAC);
    //   console.log("정렬된 Mac Addr:" + formattedMAC);

    //   performAsyncTask().then((result) => {
    //     // sendResponse({ success: true, data: result });
    //   }).catch((error) => {
    //     // sendResponse({ success: false, error: error.message });
    //   });
    // }

    return true;
  }
});

async function performAsyncTask() {
  // 비동기 작업 예시
  return new Promise((resolve) => setTimeout(() => resolve("Task completed"), 1000));
}
