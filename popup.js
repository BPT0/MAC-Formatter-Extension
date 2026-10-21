const OPTIONS_KEY = "macFormatterOptions";
const SAVED_STATE_KEY = "macFormatterSavedState";
const PREVIEW_MAX_WIDTH = 336;
const PREVIEW_MAX_HEIGHT = 260;
const MIN_REGION_PX = 8;
const MAX_PNG_CHARS = 4000000; // 이보다 큰 이미지는 줄여서 JPEG로 저장한다 (storage.session 한도 10MB 대비)
const STORE_MAX_SIDE = 2000;
const SAVE_DELAY_MS = 300;

const els = {
  pasteZone: document.getElementById("pasteZone"),
  previewSection: document.getElementById("previewSection"),
  preview: document.getElementById("preview"),
  selectRegion: document.getElementById("selectRegion"),
  resetRegion: document.getElementById("resetRegion"),
  status: document.getElementById("status"),
  clearAll: document.getElementById("clearAll"),
  chips: document.getElementById("chips"),
  separator: document.getElementById("separator"),
  letterCase: document.getElementById("letterCase"),
  macInput: document.getElementById("macInput"),
  formatButton: document.getElementById("formatButton"),
  clearManual: document.getElementById("clearManual"),
  result: document.getElementById("result"),
  manualChips: document.getElementById("manualChips"),
};

const state = {
  image: null, // 붙여넣은 이미지 (캔버스)
  encoded: null, // 저장용으로 인코딩한 이미지 {dataUrl, ratio}
  result: null, // 마지막 인식 결과
  region: null, // 사용자가 지정한 영역 (원본 좌표)
  manualHex: null, // 직접 입력에서 만든 12자리 16진수
  selecting: false,
  dragStart: null,
  dragRect: null, // 드래그 중인 영역 (미리보기 좌표)
  runId: 0,
  saveTimer: null,
  saveWarned: false,
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

// --- 팝업을 닫아도 유지되는 상태 ----------------------------------------
// 확장 프로그램에서는 chrome.storage.session(브라우저 메모리, 브라우저를 닫으면 삭제)을 쓰고,
// 일반 페이지(개발용 테스트)에서는 sessionStorage로 대신한다.

const savedStore = {
  async get() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      const data = await chrome.storage.session.get(SAVED_STATE_KEY);
      return data[SAVED_STATE_KEY] || null;
    }
    const raw = sessionStorage.getItem(SAVED_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  async set(value) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      await chrome.storage.session.set({ [SAVED_STATE_KEY]: value });
    } else {
      sessionStorage.setItem(SAVED_STATE_KEY, JSON.stringify(value));
    }
  },
  async remove() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      await chrome.storage.session.remove(SAVED_STATE_KEY);
    } else {
      sessionStorage.removeItem(SAVED_STATE_KEY);
    }
  },
};

// 큰 이미지는 줄여서 JPEG로 저장한다. ratio는 (저장 이미지 가로 / 원본 가로)
function encodeImage(canvas) {
  const png = canvas.toDataURL("image/png");
  if (png.length <= MAX_PNG_CHARS) return { dataUrl: png, ratio: 1 };
  const longSide = Math.max(canvas.width, canvas.height);
  const shrink = Math.min(1, STORE_MAX_SIDE / longSide);
  const scaled = shrink < 1 ? Preprocess.scaleCanvas(canvas, shrink) : canvas;
  return { dataUrl: scaled.toDataURL("image/jpeg", 0.92), ratio: scaled.width / canvas.width };
}

function buildSnapshot() {
  const ratio = state.encoded ? state.encoded.ratio : 1;
  return {
    image: state.encoded,
    region: MacRecognizer.scaleRegion(state.region, ratio),
    result: MacRecognizer.scaleResult(state.result, ratio),
    manualInput: els.macInput.value,
    manualHex: state.manualHex,
  };
}

async function persistNow() {
  clearTimeout(state.saveTimer);
  const hasContent = state.encoded || els.macInput.value || state.manualHex;
  try {
    if (hasContent) await savedStore.set(buildSnapshot());
    else await savedStore.remove();
  } catch (error) {
    console.error("상태 저장 실패", error);
    if (!state.saveWarned && state.encoded) {
      state.saveWarned = true;
      setStatus("이미지가 너무 커서 저장하지 못했습니다. 팝업을 닫으면 내용이 사라집니다.", true);
    }
  }
}

function persistSoon() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistNow, SAVE_DELAY_MS);
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function restoreSavedState() {
  let saved = null;
  try {
    saved = await savedStore.get();
  } catch (error) {
    console.error("저장된 상태를 읽지 못했습니다", error);
  }
  if (!saved) return false;

  if (saved.manualInput) els.macInput.value = saved.manualInput;
  if (saved.manualHex && MacUtils.isValidHex12(saved.manualHex)) {
    state.manualHex = saved.manualHex;
    renderManualChips();
  }

  if (saved.image && saved.image.dataUrl) {
    try {
      state.image = await imageFromDataUrl(saved.image.dataUrl);
    } catch (error) {
      console.error("저장된 이미지를 불러오지 못했습니다", error);
      return Boolean(saved.manualInput || saved.manualHex);
    }
    // 저장된 이미지가 지금부터의 원본이므로 좌표 비율은 1이다
    state.encoded = { dataUrl: saved.image.dataUrl, ratio: 1 };
    state.region = saved.region || null;
    state.result = saved.result || null;
    els.previewSection.hidden = false;
    els.resetRegion.hidden = !state.region;
    renderChips();
    drawPreview();
    if (state.result) {
      setStatus(
        state.result.chips.length
          ? "이전에 붙여넣은 이미지의 결과를 불러왔습니다. 칩을 누르면 복사됩니다."
          : "이전에 붙여넣은 이미지에서 MAC 주소를 찾지 못했습니다. [영역 직접 선택]을 써 보세요.",
        state.result.chips.length === 0
      );
    } else {
      runRecognition(); // 인식 도중 팝업이 닫혔던 경우 다시 인식한다
    }
  }
  updateClearButton();
  return true;
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

function displayChar(ch) {
  return els.letterCase.value === "upper" ? ch.toUpperCase() : ch.toLowerCase();
}

// 16진수 12자리 중 불확실한 위치에 밑줄을 그어 칩 안에 표시한다. separator가 빈 문자열이면 구분자 없는 번호
function chipLabel(hex, uncertain, separator) {
  const label = document.createElement("span");
  [...hex].forEach((ch, i) => {
    const part = document.createElement("span");
    part.textContent = displayChar(ch);
    if (uncertain && uncertain.includes(i)) part.className = "uncertain";
    label.appendChild(part);
    if (separator && i % 2 === 1 && i < 11) label.appendChild(document.createTextNode(separator));
  });
  return label;
}

// 칩 하나. 누르면 text를 복사한다
function createChipButton({ hex, uncertain, separator, text, plain }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = plain ? "chip plain" : "chip";
  button.setAttribute("aria-label", plain ? `구분자 없이 ${text} 복사` : `${text} 복사`);
  if (plain) button.title = "구분자 없이 복사";
  button.appendChild(chipLabel(hex, uncertain, separator));
  let hint = null;
  if (!plain) {
    hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "복사";
    button.appendChild(hint);
  }
  button.addEventListener("click", async () => {
    const ok = await copyText(text);
    button.classList.toggle("copied", ok);
    if (hint) hint.textContent = ok ? "복사됨" : "복사 실패";
    setStatus(ok ? `클립보드에 복사했습니다: ${text}` : "복사하지 못했습니다. 다시 시도해 주세요.", !ok);
  });
  return button;
}

// 후보 한 줄: [포맷된 칩][구분자 없는 칩]. 구분자 옵션이 "없음"이면 칩이 하나뿐이다
function createChipRow(hex, uncertain) {
  const options = formatOptions();
  const item = document.createElement("li");
  item.className = "chip-row";
  item.appendChild(
    createChipButton({ hex, uncertain, separator: options.separator, text: MacUtils.formatMac(hex, options) })
  );
  if (options.separator !== "") {
    item.appendChild(
      createChipButton({
        hex,
        uncertain,
        separator: "",
        text: MacUtils.formatMac(hex, { ...options, separator: "" }),
        plain: true,
      })
    );
  }
  return item;
}

function renderChips() {
  els.chips.textContent = "";
  const chips = state.result ? state.result.chips : [];
  chips.forEach((chip) => els.chips.appendChild(createChipRow(chip.hex, chip.uncertain)));
}

function renderManualChips() {
  els.manualChips.textContent = "";
  if (state.manualHex) els.manualChips.appendChild(createChipRow(state.manualHex, []));
}

function updateClearButton() {
  els.clearAll.hidden = !(state.image || state.manualHex || els.macInput.value);
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
    if (runId !== state.runId) return; // 그 사이 새 이미지가 들어오거나 지웠다

    state.result = result;
    renderChips();
    drawPreview();
    persistNow();
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
  state.encoded = encodeImage(state.image);
  state.saveWarned = false;
  state.region = null;
  els.resetRegion.hidden = true;
  setSelecting(false);
  els.previewSection.hidden = false;
  updateClearButton();
  persistNow(); // 인식이 끝나기 전에 팝업이 닫혀도 이미지는 남긴다
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
  const hex = els.macInput.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!MacUtils.isValidHex12(hex)) {
    state.manualHex = null;
    renderManualChips();
    els.result.textContent = "유효한 MAC 주소가 아닙니다 (16진수 12자리).";
    updateClearButton();
    persistNow();
    return;
  }
  state.manualHex = hex;
  renderManualChips();
  updateClearButton();
  persistNow();
  const formatted = MacUtils.formatMac(hex, formatOptions());
  const ok = await copyText(formatted);
  els.result.textContent = ok ? `${formatted} 복사됨. 아래 칩으로 다시 복사할 수 있습니다.` : "복사하지 못했습니다. 아래 칩을 눌러 보세요.";
});

els.macInput.addEventListener("input", () => {
  updateClearButton();
  persistSoon();
});

// 직접 입력 칸과 그 결과(포맷된 번호, 칩)를 지운다
function clearManual() {
  els.macInput.value = "";
  els.result.textContent = "";
  state.manualHex = null;
  renderManualChips();
  updateClearButton();
  persistNow();
  els.macInput.focus();
}

els.clearManual.addEventListener("click", clearManual);

// 붙여넣은 이미지, 인식 결과, 직접 입력까지 모두 지우고 처음 상태로 돌아간다
function clearAll() {
  state.runId += 1; // 진행 중인 인식 결과는 버린다
  setSelecting(false);
  state.image = null;
  state.encoded = null;
  state.result = null;
  state.region = null;
  state.manualHex = null;
  state.saveWarned = false;
  els.previewSection.hidden = true;
  els.resetRegion.hidden = true;
  els.macInput.value = "";
  els.result.textContent = "";
  renderChips();
  renderManualChips();
  updateClearButton();
  persistNow();
  setStatus("지웠습니다. 새 이미지를 붙여넣으세요.");
  els.pasteZone.focus();
}

els.clearAll.addEventListener("click", clearAll);

// --- 시작 ---------------------------------------------------------------

[els.separator, els.letterCase].forEach((select) =>
  select.addEventListener("change", () => {
    saveOptions();
    renderChips();
    renderManualChips();
  })
);

loadOptions();
els.pasteZone.focus();

restoreSavedState();

recognizerPromise.then(
  () => {
    if (!state.image) setStatus("준비 완료. 이미지를 붙여넣으세요.");
  },
  (error) => {
    console.error("모델 로딩 실패", error);
    setStatus(`모델을 불러오지 못했습니다: ${error && error.message ? error.message : error}`, true);
  }
);
