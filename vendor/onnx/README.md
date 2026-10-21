# vendor/onnx

브라우저 안에서 MAC 주소 이미지를 인식하기 위한 로컬 OCR 번들이다. 외부 서버와 통신하지 않는다(CDN 사용 금지, 파일은 모두 확장 프로그램 안에서 로드).

| 파일 | 용도 | 출처 / 버전 | 라이선스 |
|---|---|---|---|
| `ort.wasm.min.js` | onnxruntime-web 로더 | npm `onnxruntime-web@1.30.0` (`dist/ort.wasm.min.js`) | MIT (`LICENSE-MIT-onnxruntime.txt`) |
| `ort-wasm-simd-threaded.mjs` / `.wasm` | onnxruntime-web WASM 백엔드 (CPU) | 위와 동일 (`dist/`) | MIT |
| `det_v4.onnx` | 글자 줄 검출 (PP-OCRv4 det) | [SWHL/RapidOCR](https://huggingface.co/SWHL/RapidOCR) `PP-OCRv4/ch_PP-OCRv4_det_infer.onnx` | Apache-2.0 표기 (원본: PaddlePaddle/PaddleOCR) (`LICENSE-Apache-2.0.txt`) |
| `rec.onnx` | 글자 인식 (PP-OCRv5 영어 mobile rec) | [monkt/paddleocr-onnx](https://huggingface.co/monkt/paddleocr-onnx) `languages/english/rec.onnx` | Apache-2.0 표기 (원본: PaddlePaddle/PaddleOCR) |
| `dict.txt` | 인식 모델 글자 사전 | 위 `languages/english/dict.txt` | 위와 동일 |

가져온 날짜: 2026-10-21

## 무결성

`SHA256SUMS`에 모든 파일의 전체 SHA-256이 있다. 확인 방법:

```bash
cd vendor/onnx && sha256sum -c SHA256SUMS
```

`.gitattributes`의 `vendor/** -text` 설정으로 이 폴더의 파일은 줄바꿈 변환 없이 원본 그대로 저장/체크아웃된다. (설정이 없으면 Windows에서 체크아웃할 때 JS 파일의 줄바꿈이 바뀌어 체크섬이 달라진다.) `tools/package.ps1`은 패키지를 만들 때 이 체크섬을 다시 확인한다.

## 사용 방식

- 단일 스레드 WASM만 사용한다(`ort.env.wasm.numThreads = 1`). 교차 출처 격리(SharedArrayBuffer)가 필요 없다.
- 확장 프로그램 페이지에서는 CSP에 `'wasm-unsafe-eval'`이 필요하다(`manifest.json`). 코드는 모두 패키지 안에 있으며 원격 코드를 실행하지 않는다.
- 변환본(ONNX)의 라이선스는 각 저장소 표기를 따랐으며 원본 모델은 PaddleOCR이다. 전체 고지는 저장소 루트의 `THIRD_PARTY_NOTICES.md`에 있다.
- 갱신 시 이 표의 버전, `SHA256SUMS`, `THIRD_PARTY_NOTICES.md`를 함께 갱신한다.
