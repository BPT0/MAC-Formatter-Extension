// 이미지 크롭/확대/블러 유틸 (캔버스 기반, 팝업과 벤치 페이지에서 공용)
(function (root) {
  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function sourceSize(src) {
    return { width: src.naturalWidth || src.width, height: src.naturalHeight || src.height };
  }

  // crop: {x, y, w, h} (원본 좌표). 이미지 밖으로 나가는 부분은 잘라낸다
  function cropCanvas(src, crop) {
    const { width, height } = sourceSize(src);
    const x = Math.max(0, Math.round(crop.x));
    const y = Math.max(0, Math.round(crop.y));
    const w = Math.max(1, Math.min(width - x, Math.round(crop.w)));
    const h = Math.max(1, Math.min(height - y, Math.round(crop.h)));
    const dst = createCanvas(w, h);
    dst.getContext("2d").drawImage(src, x, y, w, h, 0, 0, w, h);
    return dst;
  }

  function scaleCanvas(src, scale) {
    const { width, height } = sourceSize(src);
    const dst = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const ctx = dst.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  }

  // 화면 사진의 모아레를 줄이기 위한 박스 블러 (그레이스케일로 변환됨)
  function grayBlurCanvas(src, radius) {
    const { width, height } = sourceSize(src);
    const flat = createCanvas(width, height);
    const ctx = flat.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const px = image.data;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    }
    const blurred = radius >= 1 ? boxBlur(gray, width, height, radius) : gray;
    for (let i = 0, p = 0; i < blurred.length; i++, p += 4) {
      px[p] = px[p + 1] = px[p + 2] = blurred[i];
      px[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return flat;
  }

  function boxBlur(gray, width, height, radius) {
    const tmp = new Float32Array(gray.length);
    const out = new Float32Array(gray.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < width) {
            sum += gray[y * width + xx];
            count++;
          }
        }
        tmp[y * width + x] = sum / count;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < height) {
            sum += tmp[yy * width + x];
            count++;
          }
        }
        out[y * width + x] = sum / count;
      }
    }
    return out;
  }

  // method: color(그대로) | gray(그레이스케일). preBlur: 확대 전에 적용할 블러 반경
  function apply(src, { scale = 1, method = "color", crop = null, preBlur = 0 } = {}) {
    let canvas = crop ? cropCanvas(src, crop) : src;
    if (preBlur > 0 || method === "gray") canvas = grayBlurCanvas(canvas, preBlur);
    return scale === 1 && canvas !== src ? canvas : scaleCanvas(canvas, scale);
  }

  root.Preprocess = { apply, cropCanvas, scaleCanvas, grayBlurCanvas, createCanvas, sourceSize };
})(typeof globalThis !== "undefined" ? globalThis : this);
