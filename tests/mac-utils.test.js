// 테스트 러너(tests/index.html)가 전역 test, assert를 제공한다. Node가 있으면 node --test로도 실행 가능.
const isNode = typeof require === "function" && typeof window === "undefined";
const runTest = isNode ? require("node:test") : globalThis.test;
const check = isNode ? require("node:assert/strict") : globalThis.assert;
const utils = isNode ? require("../mac-utils.js") : globalThis.MacUtils;

runTest("normalizeConfusables: 혼동 문자를 16진수로 보정하고 구분자를 제거한다", () => {
  check.equal(utils.normalizeConfusables("OO:5O:56-ac.56 21"), "005056AC5621");
  check.equal(utils.normalizeConfusables("l1|1"), "1111");
  check.equal(utils.normalizeConfusables("SZsz"), "5252");
});

runTest("extractMacCandidates: 12자 연속, 구분자, 점 표기를 모두 인식한다", () => {
  const expected = [{ hex: "005056AC5621", score: 0 }];
  check.deepEqual(utils.extractMacCandidates("005056ac5621"), expected);
  check.equal(utils.extractMacCandidates("00:50:56:ac:56:21")[0].hex, "005056AC5621");
  check.equal(utils.extractMacCandidates("00-50-56-AC-56-21")[0].hex, "005056AC5621");
  check.equal(utils.extractMacCandidates("0050.56ac.5621")[0].hex, "005056AC5621");
});

runTest("extractMacCandidates: 샘플 형태(MAC 라벨 + 숫자 줄)에서 MAC 키워드 근처 후보가 1순위", () => {
  const text = "MAC\n005056ac5621\nS/N\nABCDEF012345";
  const result = utils.extractMacCandidates(text);
  check.equal(result[0].hex, "005056AC5621");
  check.equal(result.length, 2);
  check.equal(result[1].hex, "ABCDEF012345");
  check.ok(result[0].score > result[1].score);
});

runTest("extractMacCandidates: 16진수로 만들 수 없는 문자열과 길이가 다른 문자열은 제외한다", () => {
  check.deepEqual(utils.extractMacCandidates("HELLOWORLD12"), []);
  check.deepEqual(utils.extractMacCandidates("00:50:56:ac:56"), []);
  check.deepEqual(utils.extractMacCandidates(""), []);
  check.deepEqual(utils.extractMacCandidates(null), []);
});

runTest("extractMacCandidates: O/I/l 등 혼동 문자가 섞여도 후보로 인식한다", () => {
  check.equal(utils.extractMacCandidates("OO5O56ac562l")[0].hex, "005056AC5621");
});

runTest("buildChips: 모든 패스가 같으면 칩 1개, 불확실 위치 없음", () => {
  const result = utils.buildChips(["005056AC5621", "005056AC5621", null]);
  check.deepEqual(result.chips, [{ hex: "005056AC5621", votes: 2 }]);
  check.deepEqual(result.uncertain, []);
});

runTest("buildChips: 패스가 한 글자만 다르면 그 위치를 불확실로 표시하고 대안 칩을 만든다", () => {
  const result = utils.buildChips(["005056AC5621", "005056AC5621", "005056AC5B21"]);
  check.equal(result.consensus, "005056AC5621");
  check.deepEqual(result.uncertain, [9]);
  check.equal(result.chips[0].hex, "005056AC5621");
  check.ok(result.chips.some((c) => c.hex === "005056AC5B21"));
  check.ok(result.chips.length <= 3);
});

runTest("buildChips: 유효한 후보가 없으면 빈 결과", () => {
  check.deepEqual(utils.buildChips([null, "XYZ"]), { chips: [], uncertain: [], consensus: null });
});

runTest("formatMac: 구분자와 대소문자 옵션", () => {
  check.equal(utils.formatMac("005056ac5621"), "00-50-56-AC-56-21");
  check.equal(utils.formatMac("005056AC5621", { separator: ":", uppercase: false }), "00:50:56:ac:56:21");
  check.equal(utils.formatMac("005056AC5621", { separator: "" }), "005056AC5621");
});

runTest("charErrors: 글자 단위 오류 수", () => {
  check.equal(utils.charErrors("005056AC5621", "005056AC5621"), 0);
  check.equal(utils.charErrors("005056AC5B21", "005056AC5621"), 1);
  check.equal(utils.charErrors("0050", "005056AC5621"), Infinity);
});
