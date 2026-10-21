// 우클릭 메뉴로 고른 MAC 주소를 포맷해 같은 줄(p)의 입력 칸에 넣고 클립보드에 복사한다.
// background.js가 사용자가 메뉴를 눌렀을 때만 이 스크립트를 해당 프레임에 주입한다.

// background.js가 중복 주입(리스너 중복 등록)을 피하려고 이 값을 확인한다
window.__macFormatterLoaded = true;

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
    navigator.clipboard.writeText(text).catch((err) => {
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
    document.execCommand("copy");
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
    const selection = window.getSelection();

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

        // 클립보드에 복사
        copyTextToClipboard(formattedMAC);

        sendResponse({ success: true, data: formattedMAC });
      } else {
        console.warn("Input element not found for MAC insertion");
        sendResponse({ success: false, error: "Input element not found" });
      }
    }
  }
});
