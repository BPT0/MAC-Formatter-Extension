// 테스트 러너(tests/index.html)가 전역 test, assert를 제공한다.
const isNodeRecognizer = typeof require === "function" && typeof window === "undefined";
const runRecognizerTest = isNodeRecognizer ? require("node:test") : globalThis.test;
const checkRecognizer = isNodeRecognizer ? require("node:assert/strict") : globalThis.assert;
const recognizerLib = isNodeRecognizer ? require("../recognizer.js") : globalThis.MacRecognizer;

runRecognizerTest("orderBoxes: 같은 줄의 박스는 왼쪽부터, 줄은 위에서 아래로 정렬한다", () => {
  const boxes = [
    { x: 80, y: 41, w: 60, h: 12 }, // 아래 줄, 오른쪽 (y가 살짝 더 아래)
    { x: 10, y: 40, w: 60, h: 12 }, // 아래 줄, 왼쪽
    { x: 10, y: 5, w: 40, h: 12 }, // 위 줄
  ];
  const ordered = recognizerLib.orderBoxes(boxes);
  checkRecognizer.deepEqual(ordered.map((b) => [b.x, b.y]), [[10, 5], [10, 40], [80, 41]]);
});

runRecognizerTest("looksLikeMac: 16진수 글자가 충분한 짧은 줄만 true", () => {
  checkRecognizer.ok(recognizerLib.looksLikeMac("005056305621"));
  checkRecognizer.ok(recognizerLib.looksLikeMac("00-50-56-ac-56-21"));
  checkRecognizer.equal(recognizerLib.looksLikeMac("MAC"), false);
  checkRecognizer.equal(recognizerLib.looksLikeMac("Device Settings"), false);
});

runRecognizerTest("analyzeLines: MAC 라벨 + 번호 줄. 여백 변형 다수결로 1순위 칩과 불확실 위치를 만든다", () => {
  const result = recognizerLib.analyzeLines([
    { texts: ["MAC"] },
    { texts: ["005056305621", "005056ac5621", "005056ac5621", "005056c5621"] },
  ]);
  checkRecognizer.equal(result.groups.length, 1);
  checkRecognizer.equal(result.chips[0].hex, "005056AC5621");
  checkRecognizer.equal(result.chips[0].votes, 2);
  checkRecognizer.deepEqual(result.chips[0].uncertain, [6, 7]);
  checkRecognizer.ok(result.chips.some((c) => c.hex === "005056305621"));
});

runRecognizerTest("analyzeLines: MAC 라벨이 붙은 줄이 라벨 없는 줄보다 앞선다", () => {
  const result = recognizerLib.analyzeLines([
    { texts: ["00:11:22:33:44:55"] },
    { texts: ["MAC"] },
    { texts: ["AA:BB:CC:DD:EE:FF"] },
  ]);
  checkRecognizer.deepEqual(result.chips.map((c) => c.hex), ["AABBCCDDEEFF", "001122334455"]);
});

runRecognizerTest("analyzeLines: 시리얼 번호 줄은 MAC 줄보다 뒤로 밀린다", () => {
  const result = recognizerLib.analyzeLines([
    { texts: ["S/N"] },
    { texts: ["ABCDEF012345"] },
    { texts: ["MAC Address: 00-50-56-AC-56-21"] },
  ]);
  checkRecognizer.equal(result.chips[0].hex, "005056AC5621");
});

runRecognizerTest("analyzeLines: 후보가 없으면 빈 결과", () => {
  const result = recognizerLib.analyzeLines([{ texts: ["Device Settings"] }, { texts: ["Firmware 1.2.3"] }]);
  checkRecognizer.deepEqual(result, { groups: [], chips: [] });
});
