// ONNX 인식 모델 측정: 영역(crop) x 입력 높이 x 전처리 x 채널 순서
const params = new URLSearchParams(location.search);
const list = (key, fallback) => (params.get(key) ? params.get(key).split(",") : fallback);

const HEIGHTS = list("heights", ["32", "48"]).map(Number);
const METHODS = list("methods", ["color", "gray"]);
const PRE_BLURS = list("preblur", ["0", "1"]).map(Number);
const ORDERS = list("orders", ["rgb", "bgr"]);

const base = new URL("../../", location.href).href;
const here = new URL("./", location.href).href;
const statusEl = document.getElementById("status");
const outEl = document.getElementById("out");

async function loadSamples() {
  const csv = await (await fetch(new URL("samples/truth.csv", base))).text();
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [file, mac, x, y, w, h] = line.split(",").map((s) => s.trim());
      const crop = x !== undefined && h !== undefined ? { x: +x, y: +y, w: +w, h: +h } : null;
      return { file, truth: mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase(), crop };
    });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 기본 영역 외에 위아래/좌우 여백이 다른 영역을 함께 시험한다
function cropVariants(crop, img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const clamp = (c) => {
    const x = Math.max(0, c.x);
    const y = Math.max(0, c.y);
    return { x, y, w: Math.min(W - x, c.w), h: Math.min(H - y, c.h) };
  };
  return [
    { name: "기본", crop: clamp(crop) },
    { name: "좁게(위아래 -3)", crop: clamp({ x: crop.x, y: crop.y + 3, w: crop.w, h: crop.h - 6 }) },
    { name: "넓게(위아래 +4)", crop: clamp({ x: crop.x, y: crop.y - 4, w: crop.w, h: crop.h + 8 }) },
    { name: "좌우 여백 -6", crop: clamp({ x: crop.x + 6, y: crop.y, w: crop.w - 12, h: crop.h }) },
  ];
}

// 캔버스를 인식 모델 입력 텐서 [1,3,H,W]로 변환 (높이 고정, 가로는 비율 유지)
function toTensor(canvas, height, order) {
  const width = Math.max(16, Math.min(1600, Math.round((canvas.width / canvas.height) * height)));
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
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

// CTC 그리디 디코딩: 0번 클래스는 blank, 마지막 클래스는 공백
function decode(output, dict) {
  const [, steps, classes] = output.dims;
  const logits = output.data;
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
      const ch = best - 1 < dict.length ? dict[best - 1] : " ";
      text += ch;
      confSum += bestVal;
      confCount++;
    }
    prev = best;
  }
  return { text, conf: confCount ? confSum / confCount : 0, classes, steps };
}

async function runBench() {
  statusEl.textContent = "모델 로딩 중...";
  ort.env.wasm.wasmPaths = base + "vendor/onnx/";
  ort.env.wasm.numThreads = 1;
  const dictText = await (await fetch(base + "vendor/onnx/dict.txt")).text();
  const dict = dictText.split("\n").map((s) => s.replace(/\r$/, "")).filter((s, i, arr) => !(i === arr.length - 1 && s === ""));
  const session = await ort.InferenceSession.create(base + "vendor/onnx/rec.onnx", { executionProviders: ["wasm"] });
  const inputName = session.inputNames[0];
  window.__onnxInfo = { inputNames: session.inputNames, outputNames: session.outputNames, dictLength: dict.length };

  const samples = await loadSamples();
  const all = [];
  for (const sample of samples) {
    const img = await loadImage(new URL(`samples/${sample.file}`, base).href);
    const rows = [];
    const crops = sample.crop ? cropVariants(sample.crop, img) : [{ name: "전체", crop: null }];
    for (const { name: cropName, crop } of crops) {
      for (const method of METHODS) {
        for (const preBlur of PRE_BLURS) {
          // scale=1: 크기 조정은 toTensor에서 하므로 여기서는 영역/그레이/블러만 적용
          const canvas = Preprocess.apply(img, { scale: 1, method, preBlur, crop });
          for (const height of HEIGHTS) {
            for (const order of ORDERS) {
              const tensor = toTensor(canvas, height, order);
              const started = performance.now();
              const result = await session.run({ [inputName]: tensor });
              const ms = Math.round(performance.now() - started);
              const decoded = decode(result[session.outputNames[0]], dict);
              const candidates = MacUtils.extractMacCandidates(decoded.text);
              const top = candidates[0] ? candidates[0].hex : null;
              const compact = MacUtils.normalizeConfusables(decoded.text);
              rows.push({
                cropName, method, preBlur, height, order, ms,
                text: decoded.text,
                conf: Number(decoded.conf.toFixed(2)),
                classes: decoded.classes,
                top,
                errors: top ? MacUtils.charErrors(top, sample.truth) : Infinity,
                compact,
              });
              statusEl.textContent = `${sample.file}: ${rows.length}건`;
            }
          }
        }
      }
    }
    all.push({ sample, rows });
  }
  render(all);
  window.__benchResults = all;
  statusEl.textContent = "완료";
}

function render(all) {
  outEl.innerHTML = "";
  for (const { sample, rows } of all) {
    const exact = rows.filter((r) => r.errors === 0).length;
    const near = rows.filter((r) => r.errors > 0 && r.errors <= 2).length;
    const heading = document.createElement("h3");
    heading.textContent = `${sample.file} (정답 ${sample.truth}): 완전 일치 ${exact}/${rows.length}, 오류 1~2자 ${near}`;
    outEl.appendChild(heading);
    const table = document.createElement("table");
    table.innerHTML = "<tr><th>영역</th><th>방식</th><th>블러</th><th>높이</th><th>채널</th><th>ms</th><th>인식 텍스트</th><th>1순위 후보</th><th>오류</th></tr>";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = r.errors === 0 ? "ok" : r.errors <= 2 ? "near" : "bad";
      tr.innerHTML = `<td>${r.cropName}</td><td>${r.method}</td><td>${r.preBlur}</td><td>${r.height}</td><td>${r.order}</td><td>${r.ms}</td><td>${r.text}</td><td>${r.top || "-"}</td><td>${r.errors === Infinity ? "-" : r.errors}</td>`;
      table.appendChild(tr);
    });
    outEl.appendChild(table);
  }
}

document.getElementById("run").addEventListener("click", () => {
  runBench().catch((error) => {
    statusEl.textContent = `실패: ${error && error.message ? error.message : error}`;
    window.__benchError = String(error && error.stack ? error.stack : error);
  });
});
