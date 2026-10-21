// 글자 줄 검출 (PP-OCR det ONNX 모델의 입력 준비와 DB 후처리)
(function (root) {
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  // 긴 변이 targetLong에 가깝도록 크기를 바꾸고 가로세로를 32의 배수로 맞춘다
  function detectionSize(width, height, targetLong) {
    const ratio = targetLong / Math.max(width, height);
    const round32 = (v) => Math.max(32, Math.round((v * ratio) / 32) * 32);
    return { width: round32(width), height: round32(height) };
  }

  // 캔버스 -> [1,3,H,W] 입력 데이터. order: "rgb" | "bgr"
  function prepareInput(canvas, { targetLong = 960, order = "rgb" } = {}) {
    const srcW = canvas.naturalWidth || canvas.width;
    const srcH = canvas.naturalHeight || canvas.height;
    const { width, height } = detectionSize(srcW, srcH, targetLong);
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
        data[c * plane + i] = (rgba[i * 4 + channels[c]] / 255 - MEAN[c]) / STD[c];
      }
    }
    return { data, width, height, scaleX: width / srcW, scaleY: height / srcH };
  }

  // 확률 맵(prob, width x height)에서 글자 박스를 찾는다.
  // 반환: 입력 이미지 좌표계의 [{x, y, w, h, score}] (위에서 아래, 왼쪽에서 오른쪽 순)
  function dbPostprocess(prob, width, height, opts = {}) {
    const { thresh = 0.3, boxThresh = 0.6, unclipRatio = 1.5, minSize = 3, scaleX = 1, scaleY = 1 } = opts;
    const visited = new Uint8Array(width * height);
    const stack = [];
    const boxes = [];

    for (let start = 0; start < prob.length; start++) {
      if (visited[start] || prob[start] <= thresh) continue;

      let minX = width, maxX = 0, minY = height, maxY = 0, sum = 0, count = 0;
      stack.push(start);
      visited[start] = 1;
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % width;
        const y = (idx - x) / width;
        sum += prob[idx];
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (!visited[nIdx] && prob[nIdx] > thresh) {
              visited[nIdx] = 1;
              stack.push(nIdx);
            }
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const score = sum / count;
      if (Math.min(w, h) < minSize || score < boxThresh) continue;

      // DB 모델은 글자를 줄여서 예측하므로 면적/둘레 비율만큼 바깥으로 넓힌다
      const distance = (w * h * unclipRatio) / (2 * (w + h));
      const x0 = Math.max(0, minX - distance);
      const y0 = Math.max(0, minY - distance);
      const x1 = Math.min(width, maxX + 1 + distance);
      const y1 = Math.min(height, maxY + 1 + distance);
      boxes.push({ x: x0 / scaleX, y: y0 / scaleY, w: (x1 - x0) / scaleX, h: (y1 - y0) / scaleY, score });
    }

    return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // 검출 세션 실행: 입력 캔버스 좌표계의 박스를 돌려준다
  async function detectBoxes(ort, session, canvas, opts = {}) {
    const input = prepareInput(canvas, opts);
    const tensor = new ort.Tensor("float32", input.data, [1, 3, input.height, input.width]);
    const result = await session.run({ [session.inputNames[0]]: tensor });
    const output = result[session.outputNames[0]];
    // 출력은 [1,1,H,W] 확률 맵
    const [, , outH, outW] = output.dims;
    return dbPostprocess(output.data, outW, outH, {
      ...opts,
      scaleX: (input.scaleX * outW) / input.width,
      scaleY: (input.scaleY * outH) / input.height,
    });
  }

  const api = { detectionSize, prepareInput, dbPostprocess, detectBoxes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Detect = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
