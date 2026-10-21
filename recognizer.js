// 이미지 -> MAC 후보 칩 파이프라인: 글자 줄 검출 -> 줄별 인식(여백 변형 다수결) -> MAC 줄 선택
// 의존: mac-utils.js, preprocess.js, detect.js, ocr.js, onnxruntime-web(ort)
(function (root) {
  const MAX_SIDE = 1600; // 이 값보다 큰 이미지는 줄여서 처리한다
  const MAX_BOXES = 40; // 인식할 줄 수 상한 (위에서부터)
  const PRIMARY_PAD = [3, 5]; // [세로, 가로] 여백(px, 한쪽 기준). 검출 박스를 그대로 자르면 인식이 불안정했다
  const EXTRA_PADS = [[3, 0], [5, 10], [5, 20]]; // MAC처럼 보이는 줄에만 추가로 읽어 다수결에 쓴다
  const MAX_FLAT_CHIPS = 5;

  // 같은 줄에 있는 박스는 왼쪽에서 오른쪽으로, 줄은 위에서 아래로 정렬한다
  function orderBoxes(boxes) {
    const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
    const rows = [];
    sorted.forEach((box) => {
      const cy = box.y + box.h / 2;
      const row = rows.find((r) => Math.abs(r.cy - cy) < Math.min(r.h, box.h) * 0.5);
      if (row) {
        row.boxes.push(box);
        row.h = Math.min(row.h, box.h);
      } else {
        rows.push({ cy, h: box.h, boxes: [box] });
      }
    });
    return rows.flatMap((row) => row.boxes.sort((a, b) => a.x - b.x));
  }

  // 인식 결과가 MAC 주소일 가능성이 있는 줄인지 (추가 인식을 할지 결정)
  function looksLikeMac(text) {
    const normalized = MacUtils.normalizeConfusables(text);
    const hexChars = (normalized.match(/[0-9A-F]/g) || []).length;
    return hexChars >= 8 && hexChars / normalized.length >= 0.75 && normalized.length <= 30;
  }

  // lines: 위에서 아래 순서의 [{texts: [여백 변형별 인식 결과...]}]
  // 반환: {groups, chips}. 한 줄(그룹)마다 여백 변형들의 다수결 칩을 만들고, 점수순으로 정렬한다.
  function analyzeLines(lines, maxChipsPerGroup = 3) {
    const groups = [];
    lines.forEach((line, index) => {
      const previous = index > 0 ? lines[index - 1].texts[0] || "" : "";
      let score = -Infinity;
      const tops = line.texts.map((text) => {
        const own = new Set(MacUtils.extractMacCandidates(text).map((c) => c.hex));
        const withLabel = MacUtils.extractMacCandidates(`${previous}\n${text}`).filter((c) => own.has(c.hex));
        if (withLabel.length === 0) return null;
        score = Math.max(score, withLabel[0].score);
        return withLabel[0].hex;
      });
      const built = MacUtils.buildChips(tops, maxChipsPerGroup);
      if (built.chips.length === 0) return;
      groups.push({
        index,
        score,
        chips: built.chips.map((chip) => ({ ...chip, uncertain: built.uncertain })),
        uncertain: built.uncertain,
        consensus: built.consensus,
      });
    });

    groups.sort((a, b) => b.score - a.score || b.chips[0].votes - a.chips[0].votes || a.index - b.index);

    // 칩 목록: 1순위 그룹의 칩 전부 + 나머지 그룹의 1순위 칩
    const chips = [];
    const seen = new Set();
    const push = (chip) => {
      if (!seen.has(chip.hex) && chips.length < MAX_FLAT_CHIPS) {
        seen.add(chip.hex);
        chips.push(chip);
      }
    };
    if (groups[0]) groups[0].chips.forEach(push);
    groups.slice(1).forEach((group) => push(group.chips[0]));
    return { groups, chips };
  }

  function detectionTarget(canvas) {
    const longSide = Math.max(canvas.width, canvas.height);
    return longSide < 400 ? 736 : 960;
  }

  function padCrop(canvas, box, [padY, padX]) {
    return Preprocess.cropCanvas(canvas, { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 });
  }

  // modelBaseUrl: ort wasm과 모델 파일이 있는 폴더 URL (끝에 / 포함). 예: chrome.runtime.getURL("vendor/onnx/")
  async function createRecognizer({ ort, modelBaseUrl }) {
    ort.env.wasm.wasmPaths = modelBaseUrl;
    ort.env.wasm.numThreads = 1;

    const dictPromise = fetch(modelBaseUrl + "dict.txt").then((r) => r.text()).then(Ocr.parseDict);
    const options = { executionProviders: ["wasm"] };
    const [dict, detector, recognizer] = await Promise.all([
      dictPromise,
      ort.InferenceSession.create(modelBaseUrl + "det_v4.onnx", options),
      ort.InferenceSession.create(modelBaseUrl + "rec.onnx", options),
    ]);

    // source: img/canvas/ImageBitmap. region: 원본 좌표 {x,y,w,h}(사용자가 직접 지정한 영역, 선택)
    async function recognize(source, { region = null, onProgress = () => {} } = {}) {
      const started = performance.now();
      const origin = region ? { x: Math.round(region.x), y: Math.round(region.y) } : { x: 0, y: 0 };
      let canvas = region ? Preprocess.cropCanvas(source, region) : source;
      let shrink = 1;
      const size = Preprocess.sourceSize(canvas);
      if (Math.max(size.width, size.height) > MAX_SIDE) {
        shrink = MAX_SIDE / Math.max(size.width, size.height);
        canvas = Preprocess.scaleCanvas(canvas, shrink);
      }

      onProgress({ stage: "detect" });
      const detectStart = performance.now();
      let boxes = await Detect.detectBoxes(ort, detector, canvas, {
        targetLong: detectionTarget(canvas),
        order: "rgb",
        thresh: 0.3,
        boxThresh: 0.5,
        unclipRatio: 1.5,
      });
      const detectMs = Math.round(performance.now() - detectStart);
      // 검출이 아무것도 못 찾으면(예: 번호 줄만 잘라 넣은 경우) 이미지 전체를 한 줄로 본다
      const wholeImage = boxes.length === 0;
      if (wholeImage) boxes = [{ x: 0, y: 0, w: canvas.width, h: canvas.height, score: 0 }];
      boxes = orderBoxes(boxes).slice(0, MAX_BOXES);

      const lines = [];
      const recognizeStart = performance.now();
      for (let i = 0; i < boxes.length; i++) {
        onProgress({ stage: "recognize", done: i, total: boxes.length });
        const box = boxes[i];
        const primary = await Ocr.recognize(ort, recognizer, dict, padCrop(canvas, box, PRIMARY_PAD));
        const texts = [primary.text];
        if (looksLikeMac(primary.text)) {
          for (const pad of EXTRA_PADS) {
            texts.push((await Ocr.recognize(ort, recognizer, dict, padCrop(canvas, box, pad))).text);
          }
        }
        lines.push({
          box: { x: box.x / shrink + origin.x, y: box.y / shrink + origin.y, w: box.w / shrink, h: box.h / shrink },
          texts,
        });
      }
      // 사용자가 지정한 영역에 줄이 하나뿐이면, 영역 전체를 그대로 읽은 결과도 다수결에 더한다
      if (region && lines.length === 1 && !wholeImage) {
        lines[0].texts.push((await Ocr.recognize(ort, recognizer, dict, canvas)).text);
      }
      const recognizeMs = Math.round(performance.now() - recognizeStart);

      const analyzed = analyzeLines(lines);
      return {
        chips: analyzed.chips,
        groups: analyzed.groups,
        lines: lines.map((line) => ({ box: line.box, text: line.texts[0] })),
        wholeImage,
        timings: { detectMs, recognizeMs, totalMs: Math.round(performance.now() - started) },
      };
    }

    return { recognize };
  }

  const api = { orderBoxes, looksLikeMac, analyzeLines, createRecognizer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MacRecognizer = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
