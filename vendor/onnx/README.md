# vendor/onnx

브라우저 안에서 MAC 주소 이미지를 인식하기 위한 로컬 OCR 번들이다. 외부 서버와 통신하지 않는다(CDN 사용 금지, 파일은 모두 확장 프로그램 안에서 로드).

| 파일 | 용도 | 출처 / 버전 | 라이선스 |
|---|---|---|---|
| `ort.wasm.min.js` | onnxruntime-web 로더 | npm `onnxruntime-web@1.30.0` (`dist/ort.wasm.min.js`) | MIT (package.json 표기) |
| `ort-wasm-simd-threaded.mjs` / `.wasm` | onnxruntime-web WASM 백엔드 (CPU) | 위와 동일 (`dist/`) | MIT |
| `det_v4.onnx` | 글자 줄 검출 (PP-OCRv4 det) | [SWHL/RapidOCR](https://huggingface.co/SWHL/RapidOCR) `PP-OCRv4/ch_PP-OCRv4_det_infer.onnx` | Apache-2.0 표기 (원본: PaddlePaddle/PaddleOCR) |
| `rec.onnx` | 글자 인식 (PP-OCRv5 영어 mobile rec) | [monkt/paddleocr-onnx](https://huggingface.co/monkt/paddleocr-onnx) `languages/english/rec.onnx` | Apache-2.0 표기 (원본: PaddlePaddle/PaddleOCR) |
| `dict.txt` | 인식 모델 글자 사전 | 위 `languages/english/dict.txt` | 위와 동일 |

가져온 날짜: 2026-10-21

## SHA-256 (앞 16자리)

```
4e16deb22c4da646  rec.onnx
d2a7720d45a54257  det_v4.onnx
e025a66d31f327ba  dict.txt
faece07e84faa900  ort.wasm.min.js
e13f7f94fc51b4ca  ort-wasm-simd-threaded.mjs
3398c10d07d229bd  ort-wasm-simd-threaded.wasm
```

## 사용 방식

- 단일 스레드 WASM만 사용한다(`ort.env.wasm.numThreads = 1`). 교차 출처 격리(SharedArrayBuffer)가 필요 없다.
- 확장 프로그램 페이지에서는 CSP에 `'wasm-unsafe-eval'`이 필요하다(`manifest.json`).
- 모델 파일은 사내 오픈소스 정책 검토가 필요하다. 변환본(ONNX)의 라이선스는 각 저장소 표기를 따랐으며 원본 모델은 PaddleOCR이다.
- 갱신 시 이 표의 버전/체크섬도 함께 갱신한다.
