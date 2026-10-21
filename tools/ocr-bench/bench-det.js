// 검출 조합: 모델 x 입력 긴 변 x 채널 순서 (x thresh/unclip은 쿼리로 조절)
// 예: ?models=v3,v4&long=480,736,960&orders=rgb,bgr&thresh=0.3&unclip=1.5
const params = new URLSearchParams(location.search);
const list = (key, fallback) => (params.get(key) ? params.get(key).split(",") : fallback);

const MODELS = list("models", ["v4"]);
const LONGS = list("long", ["480", "736", "960", "1280"]).map(Number);
const ORDERS = list("orders", ["rgb", "bgr"]);
const THRESH = Number(params.get("thresh") || 0.3);
const BOX_THRESH = Number(params.get("boxthresh") || 0.5);
const UNCLIP = Number(params.get("unclip") || 1.5);

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
      const [file, mac] = line.split(",").map((s) => s.trim());
      return { file, truth: mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase() };
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

// 박스 하나를 여백을 달리해 잘라낸다: 원래, 위아래를 줄임, 좌우를 넓힘
function boxCrops(img, box) {
  // 세로/가로 여백(px, 한쪽 기준)을 달리한 변형
  const pads = [[0, 0], [3, 0], [5, 0], [3, 5], [5, 10], [8, 10], [5, 20]];
  const variants = pads.map(([py, px]) => ({
    name: `v${py}/h${px}`,
    crop: { x: box.x - px, y: box.y - py, w: box.w + px * 2, h: box.h + py * 2 },
  }));
  return variants.map((v) => ({ name: v.name, canvas: Preprocess.cropCanvas(img, v.crop) }));
}

function drawBoxes(img, boxes) {
  const scale = Math.max(1, Math.round(480 / img.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  boxes.forEach((b) => ctx.strokeRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale));
  return canvas;
}

async function runBench() {
  statusEl.textContent = "모델 로딩 중...";
  ort.env.wasm.wasmPaths = base + "vendor/onnx/";
  ort.env.wasm.numThreads = 1;
  const dict = Ocr.parseDict(await (await fetch(base + "vendor/onnx/dict.txt")).text());
  const rec = await ort.InferenceSession.create(base + "vendor/onnx/rec.onnx", { executionProviders: ["wasm"] });
  const dets = {};
  for (const name of MODELS) {
    dets[name] = await ort.InferenceSession.create(base + `vendor/onnx/det_${name}.onnx`, { executionProviders: ["wasm"] });
  }

  const samples = await loadSamples();
  const all = [];
  for (const sample of samples) {
    const img = await loadImage(new URL(`samples/${sample.file}`, base).href);
    const rows = [];
    for (const model of MODELS) {
      for (const targetLong of LONGS) {
        for (const order of ORDERS) {
          const started = performance.now();
          const boxes = await Detect.detectBoxes(ort, dets[model], img, {
            targetLong, order, thresh: THRESH, boxThresh: BOX_THRESH, unclipRatio: UNCLIP,
          });
          const detMs = Math.round(performance.now() - started);

          // 박스별로 여백 변형마다 인식
          const lines = [];
          for (const box of boxes) {
            const crops = boxCrops(img, box);
            const texts = [];
            for (let i = 0; i < crops.length; i++) {
              const { text } = await Ocr.recognize(ort, rec, dict, crops[i].canvas);
              texts.push(text);
            }
            lines.push({ box, texts });
          }
          // 여백 변형별로 줄을 이어 붙여 후보를 뽑고, 변형 전체를 다수결로 합친다
          const variantCount = lines.length ? lines[0].texts.length : 0;
          const tops = Array.from({ length: variantCount }, (_, v) => {
            const joined = lines.map((l) => l.texts[v]).join("\n");
            const cands = MacUtils.extractMacCandidates(joined);
            return cands[0] ? cands[0].hex : null;
          });
          const chips = MacUtils.buildChips(tops);
          const best = chips.chips[0] ? chips.chips[0].hex : null;
          rows.push({
            model, targetLong, order, detMs,
            boxCount: boxes.length,
            boxes: boxes.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), s: Number(b.score.toFixed(2)) })),
            lines: lines.map((l) => l.texts),
            tops,
            best,
            chips: chips.chips.map((c) => `${c.hex}x${c.votes}`),
            errors: best ? MacUtils.charErrors(best, sample.truth) : Infinity,
            preview: drawBoxes(img, boxes),
          });
          statusEl.textContent = `${sample.file}: ${rows.length}건`;
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
    const heading = document.createElement("h3");
    heading.textContent = `${sample.file} (정답 ${sample.truth}): 1순위 칩 완전 일치 ${exact}/${rows.length}`;
    outEl.appendChild(heading);
    const table = document.createElement("table");
    table.innerHTML = "<tr><th>모델</th><th>긴 변</th><th>채널</th><th>det ms</th><th>박스</th><th>줄 인식(박스/세로-15%/가로+6)</th><th>칩</th><th>오류</th><th>미리보기</th></tr>";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = r.errors === 0 ? "ok" : r.errors <= 2 ? "near" : "bad";
      tr.innerHTML = `<td>${r.model}</td><td>${r.targetLong}</td><td>${r.order}</td><td>${r.detMs}</td><td>${r.boxCount}</td><td>${r.lines.map((t) => t.join(" / ")).join("<br>")}</td><td>${r.chips.join(", ") || "-"}</td><td>${r.errors === Infinity ? "-" : r.errors}</td><td></td>`;
      tr.lastChild.appendChild(r.preview);
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
