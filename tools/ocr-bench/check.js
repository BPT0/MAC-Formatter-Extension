const base = new URL("../../", location.href).href;
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
      const region = x !== undefined && h !== undefined ? { x: +x, y: +y, w: +w, h: +h } : null;
      return { file, truth: mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase(), region };
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

// 합성 화면 캡처: 여러 줄 텍스트 중 한 줄이 MAC 주소
function syntheticCapture(width, height, fontPx, macLine) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#222";
  ctx.font = `${fontPx}px Arial`;
  const lines = ["Device Settings", "Model: ABC-1234", "Serial Number: SN1234567890", macLine, "IP Address: 192.168.0.10", "Firmware 1.2.3"];
  lines.forEach((text, i) => ctx.fillText(text, 40, 60 + i * fontPx * 2));
  return canvas;
}

async function buildCases() {
  const cases = [];
  for (const sample of await loadSamples()) {
    const img = await loadImage(new URL(`samples/${sample.file}`, base).href);
    cases.push({ name: `${sample.file} (전체 이미지)`, source: img, truth: sample.truth });
    if (sample.region) {
      cases.push({ name: `${sample.file} (영역 직접 지정)`, source: img, region: sample.region, truth: sample.truth });
    }
  }
  const mac = "MAC Address: 00-50-56-AC-56-21";
  cases.push({ name: "합성 800x500 글자 16px", source: syntheticCapture(800, 500, 16, mac), truth: "005056AC5621" });
  cases.push({ name: "합성 1280x720 글자 28px", source: syntheticCapture(1280, 720, 28, mac), truth: "005056AC5621" });
  cases.push({ name: "합성 1920x1080 글자 20px", source: syntheticCapture(1920, 1080, 20, mac), truth: "005056AC5621" });
  cases.push({ name: "합성 2560x1440 글자 24px (축소 경로)", source: syntheticCapture(2560, 1440, 24, mac), truth: "005056AC5621" });
  return cases;
}

async function run() {
  statusEl.textContent = "모델 로딩 중...";
  const loadStart = performance.now();
  const recognizer = await MacRecognizer.createRecognizer({ ort, modelBaseUrl: base + "vendor/onnx/" });
  const loadMs = Math.round(performance.now() - loadStart);

  const rows = [];
  for (const testCase of await buildCases()) {
    statusEl.textContent = testCase.name;
    const result = await recognizer.recognize(testCase.source, { region: testCase.region || null });
    const first = result.chips[0] ? result.chips[0].hex : null;
    rows.push({
      name: testCase.name,
      truth: testCase.truth,
      chips: result.chips.map((c) => `${c.hex}(${c.votes})`),
      uncertain: result.chips[0] ? result.chips[0].uncertain : [],
      top1: first,
      inTop: result.chips.some((c) => c.hex === testCase.truth),
      errors: first ? MacUtils.charErrors(first, testCase.truth) : Infinity,
      lines: result.lines.length,
      wholeImage: result.wholeImage,
      timings: result.timings,
    });
  }

  window.__checkResults = { loadMs, rows };
  const table = document.createElement("table");
  table.innerHTML = `<tr><th>케이스</th><th>정답</th><th>칩(표)</th><th>불확실 위치</th><th>줄 수</th><th>검출 ms</th><th>인식 ms</th><th>전체 ms</th><th>1순위 오류</th><th>칩 안에 정답</th></tr>`;
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = r.errors === 0 ? "ok" : r.inTop ? "near" : "bad";
    tr.innerHTML = `<td>${r.name}</td><td>${r.truth}</td><td>${r.chips.join("<br>") || "-"}</td><td>${r.uncertain.join(",")}</td><td>${r.lines}${r.wholeImage ? " (전체를 한 줄로)" : ""}</td><td>${r.timings.detectMs}</td><td>${r.timings.recognizeMs}</td><td>${r.timings.totalMs}</td><td>${r.errors === Infinity ? "-" : r.errors}</td><td>${r.inTop ? "O" : "X"}</td>`;
    table.appendChild(tr);
  });
  outEl.innerHTML = `<p>모델 로딩 ${loadMs}ms</p>`;
  outEl.appendChild(table);
  statusEl.textContent = "완료";
}

document.getElementById("run").addEventListener("click", () => {
  run().catch((error) => {
    statusEl.textContent = `실패: ${error && error.message ? error.message : error}`;
    window.__checkError = String(error && error.stack ? error.stack : error);
  });
});
