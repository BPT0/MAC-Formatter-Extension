const OPTIONS_KEY = "macFormatterOptions";
const PREVIEW_MAX_WIDTH = 336;
const PREVIEW_MAX_HEIGHT = 260;
const MIN_REGION_PX = 8;

const els = {
  pasteZone: document.getElementById("pasteZone"),
  previewSection: document.getElementById("previewSection"),
  preview: document.getElementById("preview"),
  selectRegion: document.getElementById("selectRegion"),
  resetRegion: document.getElementById("resetRegion"),
  status: document.getElementById("status"),
  chips: document.getElementById("chips"),
  separator: document.getElementById("separator"),
  letterCase: document.getElementById("letterCase"),
  macInput: document.getElementById("macInput"),
  formatButton: document.getElementById("formatButton"),
  result: document.getElementById("result"),
};

const state = {
  image: null, // 붙여넣은 이미지 (캔버스)
  result: null, // 마지막 인식 결과
  region: null, // 사용자가 지정한 영역 (원본 좌표)
  selecting: false,
  dragStart: null,
  dragRect: null, // 드래그 중인 영역 (미리보기 좌표)
  runId: 0,
};

const modelBaseUrl =
  typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL("vendor/onnx/")
    : new URL("vendor/onnx/", location.href).href;

// 모델은 팝업을 열자마자 불러 두어 붙여넣는 즉시 인식할 수 있게 한다
const recognizerPromise = MacRecognizer.createRecognizer({ ort, modelBaseUrl });

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

// --- 포맷 옵션 ---------------------------------------------------------

function loadOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || "{}");
    if (typeof saved.separator === "string") els.separator.value = saved.separator;
    if (saved.letterCase === "upper" || saved.letterCase === "lower") els.letterCase.value = saved.letterCase;
  } catch (error) {
    // 저장된 값을 못 읽어도 기본값으로 동작한다
  }
}

function saveOptions() {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ separator: els.separator.value, letterCase: els.letterCase.value }));
  } catch (error) {
    // 저장 실패는 무시한다
  }
}

function formatOptions() {
  return { separator: els.separator.value, uppercase: els.letterCase.value === "upper" };
}

// --- 클립보드 ----------------------------------------------------------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

// --- 칩 -----------------------------------------------------------------

// 16진수 12자리 중 불확실한 위치에 밑줄을 그어 칩 안에 표시한다
function chipLabel(chip) {
  const { separator, uppercase } = formatOptions();
  const label = document.createElement("span");
  [...chip.hex].forEach((ch, i) => {
    const part = document.createElement("span");
    part.textContent = uppercase ? ch.toUpperCase() : ch.toLowerCase();
    if (chip.uncertain && chip.uncertain.includes(i)) part.className = "uncertain";
    label.appendChild(part);
    if (i % 2 === 1 && i < 11) label.appendChild(document.createTextNode(separator));
  });
  return label;
}

function renderChips() {
  els.chips.textContent = "";
  const chips = state.result ? state.result.chips : [];
  chips.forEach((chip) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "복사";
    button.append(chipLabel(chip), hint);
    button.setAttribute("aria-label", `${MacUtils.formatMac(chip.hex, formatOptions())} 복사`);
    button.addEventListener("click", async () => {
      const ok = await copyText(MacUtils.formatMac(chip.hex, formatOptions()));
      button.classList.toggle("copied", ok);
      hint.textContent = ok ? "복사됨" : "복사 실패";
      if (ok) setStatus("클립보드에 복사했습니다.");
    });
    item.appendChild(button);
    els.chips.appendChild(item);
  });
}

// --- 미리보기 -----------------------------------------------------------

function previewScale() {
  if (!state.image) return 1;
  return Math.min(PREVIEW_MAX_WIDTH / state.image.width, PREVIEW_MAX_HEIGHT / state.image.height);
}

function drawPreview() {
  if (!state.image) return;
  const scale = previewScale();
  const width = Math.max(1, Math.round(state.image.width * scale));
  const height = Math.max(1, Math.round(state.image.height * scale));
  els.preview.width = width;
  els.preview.height = height;
  const ctx = els.preview.getContext("2d");
  ctx.imageSmoothingEnabled = scale < 2; // 작은 이미지를 크게 보여 줄 때는 픽셀을 그대로 보여 준다
  ctx.drawImage(state.image, 0, 0, width, height);

  const strokeBox = (box, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(box.x * scale, box.y * scale, box.w * scale, box.h * scale);
  };

  if (state.result) {
    state.result.lines.forEach((line) => strokeBox(line.box, "#4a90e2", 1));
    const top = state.result.groups[0];
    if (top) strokeBox(state.result.lines[top.index].box, "#1fa34a", 2);
  }
  if (state.region) strokeBox(state.region, "#f29900", 2);
  if (state.dragRect) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#d93025";
    ctx.lineWidth = 2;
    ctx.strokeRect(state.dragRect.x, state.dragRect.y, state.dragRect.w, state.dragRect.h);
    ctx.setLineDash([]);
  }
}

function pointerPosition(event) {
  const rect = els.preview.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * els.preview.width) / rect.width,
    y: ((event.clientY - rect.top) * els.preview.height) / rect.height,
  };
}

function setSelecting(on) {
  state.selecting = on;
  els.preview.classList.toggle("selecting", on);
  els.selectRegion.textContent = on ? "선택 취소" : "영역 직접 선택";
  if (on) setStatus("인식할 영역을 드래그로 지정하세요.");
}

els.selectRegion.addEventListener("click", () => setSelecting(!state.selecting));

els.resetRegion.addEventListener("click", () => {
  state.region = null;
  els.resetRegion.hidden = true;
  runRecognition();
});

els.preview.addEventListener("mousedown", (event) => {
  if (!state.selecting) return;
  state.dragStart = pointerPosition(event);
  state.dragRect = { x: state.dragStart.x, y: state.dragStart.y, w: 0, h: 0 };
});

els.preview.addEventListener("mousemove", (event) => {
  if (!state.selecting || !state.dragStart) return;
  const now = pointerPosition(event);
  state.dragRect = {
    x: Math.min(state.dragStart.x, now.x),
    y: Math.min(state.dragStart.y, now.y),
    w: Math.abs(now.x - state.dragStart.x),
    h: Math.abs(now.y - state.dragStart.y),
  };
  drawPreview();
});

window.addEventListener("mouseup", () => {
  if (!state.selecting || !state.dragStart) return;
  const rect = state.dragRect;
  state.dragStart = null;
  state.dragRect = null;
  if (!rect || rect.w < MIN_REGION_PX || rect.h < MIN_REGION_PX) {
    drawPreview();
    return;
  }
  const scale = previewScale();
  state.region = { x: rect.x / scale, y: rect.y / scale, w: rect.w / scale, h: rect.h / scale };
  setSelecting(false);
  els.resetRegion.hidden = false;
  runRecognition();
});

// --- 인식 ---------------------------------------------------------------

async function runRecognition() {
  const runId = ++state.runId;
  state.result = null;
  renderChips();
  drawPreview();
  setStatus("인식 중...");

  try {
    const recognizer = await recognizerPromise;
    const result = await recognizer.recognize(state.image, {
      region: state.region,
      onProgress: ({ stage, done, total }) => {
        if (runId === state.runId && stage === "recognize") setStatus(`인식 중... (${done + 1}/${total})`);
      },
    });
    if (runId !== state.runId) return; // 그 사이 새 이미지가 들어왔다

    state.result = result;
    renderChips();
    drawPreview();
    if (result.chips.length === 0) {
      setStatus("MAC 주소를 찾지 못했습니다. [영역 직접 선택]으로 번호 줄을 지정해 보세요.", true);
    } else {
      const seconds = (result.timings.totalMs / 1000).toFixed(1);
      setStatus(`인식 완료 (${seconds}초). 칩을 누르면 복사됩니다. 밑줄 친 글자는 확인이 필요합니다.`);
      const first = els.chips.querySelector(".chip");
      if (first) first.focus();
    }
  } catch (error) {
    if (runId !== state.runId) return;
    console.error("인식 실패", error);
    setStatus(`인식에 실패했습니다: ${error && error.message ? error.message : error}`, true);
  }
}

// --- 이미지 입력 --------------------------------------------------------

// 투명 배경 PNG도 흰 배경 위에 올려 일반 이미지처럼 다룬다
async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function handleImageFile(file) {
  try {
    state.image = await fileToCanvas(file);
  } catch (error) {
    setStatus("이미지를 읽을 수 없습니다. PNG, JPG 같은 이미지를 붙여넣어 주세요.", true);
    return;
  }
  state.region = null;
  els.resetRegion.hidden = true;
  setSelecting(false);
  els.previewSection.hidden = false;
  runRecognition();
}

function imageFromItems(items) {
  for (const item of items || []) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

document.addEventListener("paste", (event) => {
  if (event.target === els.macInput) return; // 직접 입력 칸의 붙여넣기는 그대로 둔다
  const file = imageFromItems(event.clipboardData && event.clipboardData.items);
  if (!file) {
    setStatus("클립보드에 이미지가 없습니다. 이미지를 복사한 뒤 붙여넣어 주세요.", true);
    return;
  }
  event.preventDefault();
  handleImageFile(file);
});

["dragenter", "dragover"].forEach((name) =>
  els.pasteZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.pasteZone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((name) =>
  els.pasteZone.addEventListener(name, () => els.pasteZone.classList.remove("dragover"))
);
els.pasteZone.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = [...(event.dataTransfer ? event.dataTransfer.files : [])].find((f) => f.type.startsWith("image/"));
  if (file) handleImageFile(file);
  else setStatus("이미지 파일만 놓을 수 있습니다.", true);
});

// --- 직접 입력 ----------------------------------------------------------

els.formatButton.addEventListener("click", async () => {
  const hex = els.macInput.value.replace(/[^0-9A-Fa-f]/g, "");
  if (!MacUtils.isValidHex12(hex.toUpperCase())) {
    els.result.textContent = "유효한 MAC 주소가 아닙니다 (16진수 12자리).";
    return;
  }
  const formatted = MacUtils.formatMac(hex, formatOptions());
  const ok = await copyText(formatted);
  els.result.textContent = ok ? `${formatted} (복사됨)` : `${formatted} (복사 실패)`;
});

// --- 시작 ---------------------------------------------------------------

[els.separator, els.letterCase].forEach((select) =>
  select.addEventListener("change", () => {
    saveOptions();
    renderChips();
  })
);

loadOptions();
els.pasteZone.focus();

recognizerPromise.then(
  () => {
    if (!state.image) setStatus("준비 완료. 이미지를 붙여넣으세요.");
  },
  (error) => {
    console.error("모델 로딩 실패", error);
    setStatus(`모델을 불러오지 못했습니다: ${error && error.message ? error.message : error}`, true);
  }
);
