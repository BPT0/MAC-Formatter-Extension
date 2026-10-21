// MAC 주소 후보 추출/포맷 유틸 (팝업, 벤치 페이지, 테스트 페이지에서 공용)
(function (root) {
  const HEX12 = /^[0-9A-F]{12}$/;

  // OCR이 16진수 대신 자주 내놓는 글자 -> 16진수로 보정 (A-F, 0-9로 읽힐 수 있는 글자는 건드리지 않음)
  const CONFUSABLE = { O: "0", o: "0", Q: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", Z: "2", z: "2" };

  // 후보 패턴: 2자리 6묶음(구분자 포함), 4자리 3묶음(점 표기), 12자리 연속
  const TOKEN = "[0-9A-Za-z|]";
  const PATTERNS = [
    new RegExp(`(?:${TOKEN}{2}[:\\-.\\s]){5}${TOKEN}{2}`, "g"),
    new RegExp(`(?:${TOKEN}{4}[:\\-.\\s]){2}${TOKEN}{4}`, "g"),
    new RegExp(`${TOKEN}{12}`, "g"),
  ];

  function normalizeConfusables(text) {
    return text
      .replace(/[:\-.\s]/g, "")
      .replace(/[OoQIl|SsZz]/g, (ch) => CONFUSABLE[ch])
      .toUpperCase();
  }

  function isValidHex12(hex) {
    return HEX12.test(hex);
  }

  // OCR 텍스트에서 MAC 후보를 점수순으로 반환: [{hex, score}]
  function extractMacCandidates(ocrText) {
    const lines = String(ocrText || "").split(/\r?\n/);
    const found = new Map();

    lines.forEach((line, lineIdx) => {
      const nearby = `${lines[lineIdx - 1] || ""} ${line}`;
      PATTERNS.forEach((pattern, patternIdx) => {
        for (const match of line.matchAll(pattern)) {
          const hex = normalizeConfusables(match[0]);
          if (!isValidHex12(hex)) continue;

          let score = 0;
          if (/mac/i.test(nearby)) score += 2;
          if (patternIdx < 2) score += 1; // 구분자가 있는 표기는 시리얼 번호일 가능성이 낮다
          if (/s\/?n|serial/i.test(nearby)) score -= 2;

          if (!found.has(hex) || found.get(hex) < score) {
            found.set(hex, score);
          }
        }
      });
    });

    return [...found.entries()]
      .map(([hex, score]) => ({ hex, score }))
      .sort((a, b) => b.score - a.score);
  }

  // 여러 전처리 패스의 최선 후보를 모아 칩 후보를 만든다.
  // passHexes: 패스마다 1순위 hex 문자열(없으면 null) 배열
  // 반환: {chips: [{hex, votes}], uncertain: [위치 인덱스], consensus}
  function buildChips(passHexes, maxChips = 3) {
    const valid = passHexes.filter(isValidHex12);
    if (valid.length === 0) return { chips: [], uncertain: [], consensus: null };

    const votes = new Map();
    valid.forEach((hex) => votes.set(hex, (votes.get(hex) || 0) + 1));

    // 위치별 다수결로 합의 문자열 생성 (동률이면 먼저 나온 패스 우선)
    const uncertain = [];
    const alternatives = [];
    let consensus = "";
    for (let i = 0; i < 12; i++) {
      const tally = new Map();
      valid.forEach((hex) => tally.set(hex[i], (tally.get(hex[i]) || 0) + 1));
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      consensus += ranked[0][0];
      if (ranked.length > 1) {
        uncertain.push(i);
        alternatives[i] = ranked.slice(1).map(([ch]) => ch);
      }
    }

    const chips = new Map();
    const add = (hex, count) => chips.set(hex, (chips.get(hex) || 0) + count);
    votes.forEach((count, hex) => add(hex, count));
    add(consensus, 0);
    uncertain.forEach((i) => {
      alternatives[i].forEach((ch) => {
        add(consensus.slice(0, i) + ch + consensus.slice(i + 1), 0);
      });
    });

    const list = [...chips.entries()]
      .map(([hex, count]) => ({ hex, votes: count }))
      .sort((a, b) => b.votes - a.votes || (a.hex === consensus ? -1 : 0))
      .slice(0, maxChips);

    return { chips: list, uncertain, consensus };
  }

  // 12자리 16진수 문자열을 표시 형식으로 변환
  function formatMac(hex, { separator = "-", uppercase = true } = {}) {
    const out = hex.replace(/.{2}(?=.)/g, `$&${separator}`);
    return uppercase ? out.toUpperCase() : out.toLowerCase();
  }

  // 정답과의 글자 단위 차이 개수 (길이가 다르면 Infinity)
  function charErrors(hex, truth) {
    if (!hex || hex.length !== truth.length) return Infinity;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) if (hex[i] !== truth[i]) diff++;
    return diff;
  }

  // 라이선스 등록 오류 시 DB 담당자가 실행할 insert 문. app_num은 고정값이다.
  const REGISTRATION_APP_NUM = 4;

  // 라이선스 키의 작은따옴표는 SQL 문자열 규칙대로 두 번 쓴다. 키나 MAC이 올바르지 않으면 null
  function buildRegistrationInsert(licenseKey, macHex, { uppercase = true } = {}) {
    const key = String(licenseKey || "").trim();
    if (!key || !isValidHex12(String(macHex || "").toUpperCase())) return null;
    const mac = formatMac(macHex, { separator: "", uppercase });
    const escapedKey = key.replace(/'/g, "''");
    return `insert into applications (app_num, license, recently_certified, isChecked, mac_address) values (${REGISTRATION_APP_NUM}, '${escapedKey}', GETDATE(), 'S', '${mac}');`;
  }

  const api = {
    normalizeConfusables,
    isValidHex12,
    extractMacCandidates,
    buildChips,
    formatMac,
    charErrors,
    buildRegistrationInsert,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MacUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
