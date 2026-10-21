// 테스트 러너(tests/index.html)가 전역 test, assert를 제공한다.
const isNodeDetect = typeof require === "function" && typeof window === "undefined";
const runDetectTest = isNodeDetect ? require("node:test") : globalThis.test;
const checkDetect = isNodeDetect ? require("node:assert/strict") : globalThis.assert;
const detect = isNodeDetect ? require("../detect.js") : globalThis.Detect;
const ocr = isNodeDetect ? require("../ocr.js") : globalThis.Ocr;

function makeMap(width, height, rects) {
  const map = new Float32Array(width * height);
  rects.forEach(({ x, y, w, h, p }) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) map[yy * width + xx] = p;
  });
  return map;
}

runDetectTest("detectionSize: 긴 변 기준으로 크기를 바꾸고 32의 배수로 맞춘다", () => {
  const size = detect.detectionSize(129, 71, 960);
  checkDetect.equal(size.width % 32, 0);
  checkDetect.equal(size.height % 32, 0);
  checkDetect.equal(size.width, 960);
  checkDetect.equal(size.height, 544);
});

runDetectTest("dbPostprocess: 떨어진 두 영역을 별도 박스로 찾고 위에서 아래 순서로 정렬한다", () => {
  const map = makeMap(100, 60, [
    { x: 20, y: 40, w: 60, h: 8, p: 0.9 },
    { x: 30, y: 8, w: 20, h: 8, p: 0.9 },
  ]);
  const boxes = detect.dbPostprocess(map, 100, 60);
  checkDetect.equal(boxes.length, 2);
  checkDetect.ok(boxes[0].y < boxes[1].y);
  // 박스는 원래 영역보다 크게 확장된다(unclip)
  checkDetect.ok(boxes[1].x < 20 && boxes[1].x + boxes[1].w > 80);
  checkDetect.ok(boxes[1].y < 40 && boxes[1].y + boxes[1].h > 48);
});

runDetectTest("dbPostprocess: 점수가 낮은 영역과 너무 작은 영역은 버린다", () => {
  const map = makeMap(60, 40, [
    { x: 5, y: 5, w: 30, h: 8, p: 0.4 },
    { x: 40, y: 20, w: 2, h: 2, p: 0.95 },
  ]);
  checkDetect.equal(detect.dbPostprocess(map, 60, 40).length, 0);
});

runDetectTest("dbPostprocess: scale을 반영해 원본 좌표로 되돌린다", () => {
  const map = makeMap(100, 60, [{ x: 20, y: 20, w: 40, h: 10, p: 0.9 }]);
  const [box] = detect.dbPostprocess(map, 100, 60, { scaleX: 2, scaleY: 2 });
  checkDetect.ok(box.x < 10 && box.x + box.w > 30);
});

runDetectTest("ctcDecode: blank 제거와 연속 중복 합치기, 사전 매핑", () => {
  const dict = ["0", "1", "A"]; // 클래스: 0=blank, 1="0", 2="1", 3="A", 4=공백
  const classes = 5;
  const seq = [1, 1, 0, 1, 3, 3, 2];
  const logits = new Float32Array(seq.length * classes);
  seq.forEach((cls, t) => (logits[t * classes + cls] = 1));
  const result = ocr.ctcDecode(logits, seq.length, classes, dict);
  checkDetect.equal(result.text, "00A1");
});

runDetectTest("parseDict: 줄바꿈과 마지막 빈 줄 처리", () => {
  checkDetect.deepEqual(ocr.parseDict("a\r\nb\nc\n"), ["a", "b", "c"]);
});
