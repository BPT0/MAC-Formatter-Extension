# Third-party notices

이 확장 프로그램은 아래 오픈소스 구성요소를 `vendor/onnx/`에 그대로 포함한다. 모두 확장 프로그램 패키지 안의 파일이며, 실행 중 외부에서 코드나 모델을 내려받지 않는다.

| 구성요소 | 파일 | 버전 / 출처 | 라이선스 |
|---|---|---|---|
| ONNX Runtime Web | `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` | npm `onnxruntime-web@1.30.0` (`dist/`), https://github.com/microsoft/onnxruntime | MIT — `vendor/onnx/LICENSE-MIT-onnxruntime.txt` |
| PP-OCRv4 글자 줄 검출 모델 (ONNX 변환본) | `det_v4.onnx` | https://huggingface.co/SWHL/RapidOCR (`PP-OCRv4/ch_PP-OCRv4_det_infer.onnx`). 원본: PaddlePaddle/PaddleOCR | Apache-2.0 — `vendor/onnx/LICENSE-Apache-2.0.txt` |
| PP-OCRv5 영어 글자 인식 모델 (ONNX 변환본), 글자 사전 | `rec.onnx`, `dict.txt` | https://huggingface.co/monkt/paddleocr-onnx (`languages/english/`). 원본: PaddlePaddle/PaddleOCR | Apache-2.0 — `vendor/onnx/LICENSE-Apache-2.0.txt` |

- 변환본의 라이선스는 위 저장소의 표기(Apache-2.0)를 따랐다. 원본 프로젝트는 https://github.com/PaddlePaddle/PaddleOCR 이다.
- 파일 무결성은 `vendor/onnx/SHA256SUMS`로 확인한다 (`sha256sum -c SHA256SUMS`).
- 자세한 출처와 갱신 방법은 `vendor/onnx/README.md`에 적어 두었다.
