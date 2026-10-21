# 심사용 테스트 안내 (초안)

대시보드의 **테스트 안내(Test instructions)** 탭에 넣을 내용이다. 로그인 계정이 필요 없는 확장 프로그램이므로 계정 정보는 비워 둔다.

```
No account or login is needed. Everything runs locally; there are no network requests.

[1] Image recognition (popup)
1. Click the extension icon to open the popup. It loads bundled models (about 1 second); the status line says "준비 완료. 이미지를 붙여넣으세요." when ready.
2. Open the attached sample image (sample-mac-image.png) in any image viewer or browser, copy it (Ctrl+C), return to the popup and press Ctrl+V.
3. The popup shows a preview and chips for 00-50-56-AC-56-21 and 005056AC5621. Click a chip to copy that value to the clipboard (paste it into any text field to check).
4. Optional: use "영역 직접 선택" (select region) to drag a box around the number, "모두 지우기" (clear all) to reset, and the dropdowns to change the separator/letter case.
5. Close and reopen the popup: the pasted image and result are restored (kept in chrome.storage.session until the browser is closed).

[2] Context menu (text selection)
1. Save the HTML below as test.html and open it.
2. Select the text "005056ac5621" in the first paragraph (double-click it) and right-click -> "Format and Replace as MAC Address".
3. The input box in the same paragraph is filled with 00-50-56-ac-56-21 and the value is copied to the clipboard.
4. Select "hello" in the second paragraph and use the same menu item: an "Invalid MAC Address" tooltip appears next to the text.

<p>005056ac5621 <input></p>
<p>hello <input></p>

(The replacement targets the input inside the same paragraph as the selected text.)

Notes for reviewers
- The extension requests no host permissions and has no always-on content script. activeTab + scripting are used only after the user clicks the context-menu item.
- All code, WebAssembly and model files are inside the package; no remote code is loaded. Third-party sources and checksums: vendor/onnx/README.md, vendor/onnx/SHA256SUMS, THIRD_PARTY_NOTICES.md.
- 'wasm-unsafe-eval' in the CSP is required only to run the bundled ONNX Runtime WebAssembly.
```

## 첨부할 파일

- `docs/store/sample-mac-image.png`: 합성 이미지(사내 이미지 아님). 대시보드의 테스트 안내에 링크로 안내하거나 스토어 설명 하단 링크로 제공한다.
