---
name: branch-strategy
description: 새 작업을 시작하거나 브랜치를 만들/나눌 때 사용하는 브랜치 분기 가이드. "브랜치 만들어줘", "브랜치 따줘", "작업 시작", "핫픽스 브랜치", "릴리스 브랜치", "브랜치 이름 뭐로 하지" 같은 요청이나, 코드 변경 전에 main에서 어떤 브랜치를 어떤 이름으로 분기해야 하는지 판단해야 할 때 반드시 사용한다. GitHub Flow + Conventional Branch 네이밍을 기준으로 브랜치 유형 판단, 이름 규칙, 분기/병합/삭제 절차를 안내한다.
---

# 브랜치 분기 전략

이 프로젝트(MAC Formatter Extension, Chrome MV3 확장 프로그램)는 단일 배포물에 소규모 팀이 작업하므로 **GitHub Flow**를 기본으로 하고, 브랜치 이름은 **Conventional Branch** 규칙을 따른다. Gitflow(`develop` 상시 유지)는 쓰지 않는다.

## 왜 GitHub Flow인가

| 전략 | 구조 | 적합한 경우 | 이 프로젝트 |
|---|---|---|---|
| Trunk-based | `main` 하나 + 아주 짧은 브랜치 | 강한 CI/자동 테스트, 하루 여러 번 배포 | 자동 테스트가 없어 부담 |
| **GitHub Flow** | `main` + 짧은 작업 브랜치 + PR | 지속 배포, 소~중규모 팀 | **채택** |
| Gitflow | `main` + `develop` + feature/release/hotfix | 버전별 병행 지원, 정해진 릴리스 주기 | 과함. 병합 충돌/관리 비용만 증가 |

근거: Gitflow 원저자(Vincent Driessen)도 2020년 회고에서 지속 배포하는 앱에는 GitHub Flow 같은 단순한 흐름을 권장했고, Gitflow는 여러 버전을 동시에 지원해야 하는 소프트웨어에 적합하다고 밝혔다. 이 확장은 항상 최신 버전 하나만 배포하므로 해당하지 않는다.

핵심 원칙:
1. `main`은 항상 로드/배포 가능한 상태로 유지한다. `main`에 직접 커밋하지 않는다.
2. 서로 무관한 변경은 브랜치를 분리한다. 하나가 지연돼도 다른 것이 막히지 않게 한다.
3. 브랜치는 짧게 산다(권장: 며칠 이내, 개발자/페어 1명당 진행 중 1개). 오래 두면 `main`과 벌어져 충돌이 커진다.
4. 병합 후 브랜치는 삭제한다. PR과 커밋 이력은 남는다.

## 1단계: 브랜치 유형 판단

사용자의 요청 내용으로 유형을 고른다. 애매하면 한 줄로 되묻는다.

| 유형 | 접두사 | 언제 | 분기 기준 | 병합 대상 |
|---|---|---|---|---|
| 기능 추가/개선 | `feat/` (또는 `feature/`) | 새 기능, 동작 개선 | `main` | `main` (PR) |
| 버그 수정 | `fix/` (또는 `bugfix/`) | 일반 버그 수정 | `main` | `main` (PR) |
| 긴급 수정 | `hotfix/` | 이미 배포된 버전의 치명적 문제를 즉시 수정 | `main` (배포 태그) | `main` (PR) + 태그 |
| 릴리스 준비 | `release/` | 스토어 제출 전 버전 올림/최종 점검이 필요할 때만 | `main` | `main` + 태그 |
| 잡무/설정 | `chore/` | 문서, 설정, 의존성, 스킬 등 코드 동작 무관 작업 | `main` | `main` (PR) |
| 리팩터링 | `refactor/` | 동작 변경 없는 구조 개선 | `main` | `main` (PR) |

`release/`는 선택 사항이다. 버전 올림(`manifest.json`의 `version`)만 하면 되는 경우엔 `chore/bump-1.1.0` 같은 일반 브랜치로 충분하다. 릴리스 브랜치 안에서는 버그 수정과 버전 메타데이터 변경만 허용하고 신규 기능은 넣지 않는다.

## 2단계: 이름 짓기

형식: `<type>/<설명>` 또는 이슈 번호가 있으면 `<type>/<이슈번호>-<설명>`

- 소문자 영문, 숫자, 하이픈(`-`)만 사용한다. 설명은 kebab-case 2~5단어. (한글, 공백, 밑줄, 대문자 금지)
- 연속 하이픈, 앞/뒤 하이픈 금지. 점(`.`)은 `release/` 버전 문자열에서만 허용 (`release/v1.2.0`).
- 설명은 "무엇을 하는지"가 드러나게 쓴다. `fix/stuff`, `feat/test`, `feat/my-branch` 같은 이름은 쓰지 않는다.
- `main`, `master`, `develop`은 예약어라서 새 브랜치 이름으로 쓰지 않는다.
- 브랜치 유형과 커밋 유형을 맞춘다 (`feat/` 브랜치 → `feat` 커밋, `fix/` 브랜치 → `fix` 커밋).

예시:
```
feat/add-mac-case-toggle
fix/license-page-context-menu
fix/42-invalid-mac-popup
hotfix/clipboard-write-crash
chore/add-branch-strategy-skill
release/v1.1.0
```

## 3단계: 분기 절차

1. 현재 상태 확인. 커밋하지 않은 변경이 있으면 사용자에게 알리고, 새 브랜치로 가져갈지 먼저 정리한다.
   ```bash
   git status --short
   git branch --show-current
   ```
2. 최신 `main`을 기준으로 한다.
   ```bash
   git fetch origin
   git switch -c <type>/<설명> origin/main
   ```
   `hotfix/`는 배포된 상태를 기준으로 해야 하므로, 배포 태그가 있으면 그 태그에서 분기한다(`git switch -c hotfix/<설명> <tag>`). 태그가 없으면 `origin/main`에서 분기하되 그 사실을 사용자에게 알린다.
3. 첫 푸시는 upstream을 지정한다.
   ```bash
   git push -u origin <type>/<설명>
   ```
4. 작업은 작은 커밋 단위로 나눈다. 커밋 하나는 완결된 하나의 변경이어야 되돌리기 쉽다.

### 이미 `main`(또는 다른 브랜치) 위에서 작업을 시작해버린 경우

아직 커밋하지 않았다면 `git switch -c <새 브랜치>`로 변경 사항을 그대로 가져간다. 이미 `main`에 커밋했다면 임의로 `reset`하지 말고 상황을 설명한 뒤 사용자 확인을 받고 처리한다.

### 워크트리 사용 시

Claude Code 워크트리(`.claude/worktrees/...`) 세션은 이미 전용 브랜치(`claude/<이름>-<해시>`)가 만들어져 있다. 이 경우 새 브랜치를 또 만들지 말고 해당 브랜치에서 작업한다. 이름을 규칙에 맞게 바꾸고 싶으면 PR 올리기 전에 `git branch -m <새 이름>`으로 변경하되, 이미 푸시했다면 사용자에게 먼저 묻는다. 워크트리도 브랜치와 같은 수명 규칙을 따르며, 병합 후 정리한다.

## 4단계: 병합과 정리

1. 병합 전에 `main`의 최신 변경을 브랜치로 가져온다 (`git fetch origin && git merge origin/main` 또는 팀 합의에 따라 rebase). 충돌은 브랜치에서 해결한다.
2. PR을 만든다. 제목/본문에 "무엇을, 왜" 요약하고 관련 이슈를 링크한다. 이른 피드백이 필요하면 Draft로 연다.
3. 리뷰 반영은 같은 브랜치에 커밋을 추가한다.
4. 승인 후 `main`으로 병합한다. 히스토리를 단순하게 유지하려면 squash merge를 우선한다.
5. 병합 후 원격/로컬 브랜치를 삭제한다.
   ```bash
   git push origin --delete <브랜치>
   git branch -d <브랜치>
   ```
6. 배포 버전은 태그로 남긴다 (`git tag v1.1.0 && git push origin v1.1.0`).

## 하지 말 것

- `main`에 직접 커밋/푸시하거나 force push 하지 않는다.
- 사용자가 요청하지 않았는데 푸시, PR 생성, 브랜치 삭제를 하지 않는다. 원격에 영향을 주는 동작은 먼저 확인한다.
- 한 브랜치에 무관한 변경을 섞지 않는다. 섞인 것을 발견하면 분리를 제안한다.
- 다른 사람의 브랜치나 `release/` 브랜치에 작업 브랜치를 병합하지 않는다.
- 장기 브랜치(`develop`, 수 주짜리 feature)를 새로 만들지 않는다. 큰 작업은 `main`에 안전하게 병합 가능한 작은 PR 여러 개로 쪼갠다.

## 응답 방식

브랜치를 만들 때는 아래를 짧게 알려준다.
- 선택한 유형과 그 이유 (한 줄)
- 최종 브랜치 이름과 분기 기준 (`origin/main` 등)
- 실행한 명령과 현재 브랜치 상태
- 푸시/PR이 아직 안 된 상태라면 다음 단계 제안

## 참고 자료

- [AWS Prescriptive Guidance – Git branching strategies](https://docs.aws.amazon.com/prescriptive-guidance/latest/choosing-git-branch-approach/git-branching-strategies.html)
- [GitHub Docs – GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [nvie – A successful Git branching model (2020 note 포함)](https://nvie.com/posts/a-successful-git-branching-model/)
- [Trunk Based Development – Short-lived feature branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)
- [Conventional Branch](https://conventionalbranch.org/)
