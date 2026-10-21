// 글자 인식 (PP-OCR rec ONNX 모델): 입력 변환과 CTC 디코딩
(function (root) {
  const REC_HEIGHT = 48;

  // 캔버스 -> 인식 모델 입력 텐서 데이터 [1,3,H,W] (높이 고정, 가로는 비율 유지)
  function toRecInput(canvas, { height = REC_HEIGHT, order = "rgb" } = {}) {
    const srcW = canvas.naturalWidth || canvas.width;
    const srcH = canvas.naturalHeight || canvas.height;
    const width = Math.max(16, Math.min(1600, Math.round((srcW / srcH) * height)));
    const resized = document.createElement("canvas");
    resized.width = width;
    resized.height = height;
    const ctx = resized.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const plane = width * height;
    const data = new Float32Array(3 * plane);
    const channels = order === "bgr" ? [2, 1, 0] : [0, 1, 2];
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        data[c * plane + i] = (rgba[i * 4 + channels[c]] / 255 - 0.5) / 0.5;
      }
    }
    return { data, width, height };
  }

  // CTC 그리디 디코딩: 0번 클래스는 blank, 사전 길이 다음 클래스는 공백
  function ctcDecode(logits, steps, classes, dict) {
    let text = "";
    let prev = -1;
    let confSum = 0;
    let confCount = 0;
    for (let t = 0; t < steps; t++) {
      let best = 0;
      let bestVal = -Infinity;
      for (let c = 0; c < classes; c++) {
        const v = logits[t * classes + c];
        if (v > bestVal) {
          bestVal = v;
          best = c;
        }
      }
      if (best !== 0 && best !== prev) {
        text += best - 1 < dict.length ? dict[best - 1] : " ";
        confSum += bestVal;
        confCount++;
      }
      prev = best;
    }
    return { text, conf: confCount ? confSum / confCount : 0 };
  }

  function parseDict(text) {
    return text.split("\n").map((s) => s.replace(/\r$/, "")).filter((s, i, arr) => !(i === arr.length - 1 && s === ""));
  }

  async function recognize(ort, session, dict, canvas, opts = {}) {
    const input = toRecInput(canvas, opts);
    const tensor = new ort.Tensor("float32", input.data, [1, 3, input.height, input.width]);
    const result = await session.run({ [session.inputNames[0]]: tensor });
    const output = result[session.outputNames[0]];
    const [, steps, classes] = output.dims;
    return ctcDecode(output.data, steps, classes, dict);
  }

  const api = { REC_HEIGHT, toRecInput, ctcDecode, parseDict, recognize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Ocr = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
