# Claude Pet

[English](README.md) | **한국어**

Claude Code 세션이 지금 무엇을 하는지 화면 구석의 작은 캐릭터로 보여 주는 데스크톱 펫이다.
여러 세션을 띄워 두고 다른 일을 하다가, 펫 쪽으로 눈만 돌려 **손을 대야 하는 세션이 있는지**와 **어디까지 왔는지**를 판단하는 데 쓴다.

- 말풍선: 위에 작은 글씨로 보낸 요청, 아래에 지금 하는 일 한 줄(덮어쓰기, 쌓이지 않는다)
- 상태: 답변 필요(승인 · 질문) → 실패 → 응답 도착 → 진행 중 → 대기 순으로 급한 것을 먼저 보여 준다
- 작업 위치: 세션을 연 폴더가 아니라 **마지막으로 고친 파일의 프로젝트 폴더**를 이름으로 쓴다
- 작업함: 세션별 상태 · 요청 · 승인 대상 · 최근 활동 6개. 응답 본문은 저장하지 않고 상태만 남긴다
- 캐릭터: 기본 4종, 그림 한 장, 또는 상태별 그림 폴더. 커서를 쳐다보고, 상태마다 다른 동작을 한다
- Windows(WSL에서 돌리는 Claude Code 포함)와 macOS

## 목적

Claude Code 세션 여러 개를 동시에 돌리며 다른 일을 하다 보면, 어느 세션이 승인을 기다리며 멈춰 있는지, 어느 세션이 이미 끝났는지 놓치게 된다. Claude Pet은 창을 바꾸지 않고 두 가지를 한눈에 답한다.

1. **지금 내가 손대야 하는 세션이 있는가?** (승인 · 질문 · 실패)
2. **각 세션이 어디까지 왔는가?** (지금 하고 있는 일)

관찰만 한다. 질문에 답하거나 명령을 승인하지 않고, 컴퓨터 밖으로 아무것도 보내지 않는다.

## 사양

| 항목 | 값 |
|---|---|
| 앱 런타임 | Electron 45 (Chromium · Node.js 포함, 앱 실행에 Node 따로 필요 없음) |
| 훅 런타임 | Claude Code가 도는 환경의 Node.js 20 이상 |
| 쓰는 Claude Code 훅 | `SessionStart` · `UserPromptSubmit` · `PreToolUse` · `PostToolUse` · `PermissionRequest` · `Notification`(`permission_prompt` · `elicitation_dialog`) · `Stop` · `StopFailure` · `SessionEnd` |
| 데이터 흐름 | 훅 → 세션마다 JSON 하나(`~/.claude-pet/sessions/`) → 앱이 0.8초마다 읽음 |
| 네트워크 | 쓰지 않음 |
| 세션별 저장 항목 | 프로젝트 · 작업 위치 · 요청(한 줄) · 지금 하는 일 · 상태 · 최근 활동 6개 · 시각 |
| 세션 정리 | `SessionEnd`에 파일 삭제, 6시간 갱신 없으면 숨김 |
| 훅 안전장치 | 출력 없이 항상 0으로 끝나 Claude Code를 막지 않음, 제한 시간 5초 |
| 설정 변경 | `~/.claude/settings.json`에 훅 항목만 더하고 `settings.json.claude-pet.bak`에 백업, 제거 시 자기 항목만 뺌 |
| Windows 빌드 | portable `.exe`(x64), 서명 없음 |
| macOS 빌드 | universal `.dmg`, 서명 없음 |

## 환경

| | 지원 | 시험한 환경 |
|---|---|---|
| Windows | Windows 10/11 x64, Claude Code는 **WSL2** 안에서 실행 | Windows 11(빌드 26200), WSL2 Ubuntu 26.04 |
| macOS | macOS 12 이상(Intel · Apple Silicon) | 아직 시험 안 함 |
| Claude Code | 훅을 지원하는 CLI | 2.1.285 |
| Node.js(빌드 · 훅) | 20 이상 | 26.7.0 |
| Electron / electron-builder | 45 / 26 | 45.1.0 / 26.18.0 |

Windows에서는 앱이 Windows에서, Claude Code는 WSL에서 돈다. 훅은 앱이 읽을 수 있게 상태 파일을 **Windows 홈**(`C:\Users\<사용자>\.claude-pet`)에 쓴다.

글꼴은 `Jetendard`가 설치돼 있으면 그것을, 없으면 Pretendard, 그다음 시스템 글꼴을 쓴다.

## 동작 방식

```
Claude Code ──훅(hook.mjs)──▶ ~/.claude-pet/sessions/<세션 id>.json ──▶ 펫 앱(Electron)이 0.8초마다 읽음
```

- 훅은 세션마다 상태 파일 하나를 덮어쓴다. 네트워크는 쓰지 않고, 모든 기록은 이 컴퓨터에만 남는다.
- 훅은 관찰만 한다. 어떤 오류가 나도 출력 없이 끝나서 Claude 작업을 막지 않는다.
- WSL에서 돌리는 Claude Code는 상태 파일을 **Windows 홈**의 `.claude-pet`에 쓴다(펫 앱이 Windows에서 돌기 때문).

| Claude Code 이벤트 | 펫에 남는 것 |
|---|---|
| `UserPromptSubmit` | 보낸 요청, 진행 시작 |
| `PreToolUse` | 지금 하는 일 한 줄(예: `index.html 고치는 중`), 최근 활동, 작업 위치 |
| `PermissionRequest` · `Notification` | 답변 필요와 승인 대상 |
| `Stop` · `StopFailure` | 응답 도착 · 실패 |
| `SessionEnd` | 상태 파일 삭제 |

## 설치

Node.js 20 이상이 필요하다.

### Windows + WSL

```bash
# WSL에서
npm install
ELECTRON_INSTALL_PLATFORM=win32 node node_modules/electron/install.js   # Windows용 Electron 받기
npm run dist:win    # dist/ClaudePet-<버전>-windows-x64.exe (설치 없이 실행하는 portable)
```

1. exe를 실행한다. 펫이 화면 오른쪽 아래에 뜬다.
2. 펫을 오른쪽 클릭 → **Claude Pet 열기** → 작업함의 **Claude 연결하기**를 누른다.
   WSL의 `~/.claude/settings.json`에 훅이 더해진다. 다른 설정은 건드리지 않고 `settings.json.claude-pet.bak`에 백업을 남긴다.
3. Claude Code 세션을 새로 시작한다.

로그인할 때 띄우려면 exe 바로가기를 `shell:startup`에 둔다.

### macOS

```bash
npm install
npm run dist:mac    # dist/ClaudePet-<버전>-macOS-universal.dmg (macOS에서만 만들어진다)
```

서명하지 않은 앱이라 처음 열 때 경고가 뜬다. Control-클릭 → 열기로 연다. 연결은 Windows와 같이 앱의 **Claude 연결하기**로 한다.

### 훅만 직접 다루기

```bash
node install.mjs              # 훅 등록
node install.mjs --uninstall  # 훅 제거
```

## 쓰는 법

- **펫을 누르면** 세션 목록이 펼쳐지고, **끌면** 옮겨진다. 놓은 자리는 기억한다.
- **오른쪽 클릭**: Claude Pet 열기 · 캐릭터 바꾸기 · 크기(작게 · 기본 · 크게 · 아주 크게) · 제자리로 · 끄기
- 말풍선의 **×**는 확인 표시다. 확인한 응답 · 실패는 대기로 내려가고 세션은 남는다.
- 확인할 일이 여러 개면 말풍선 뒤에 카드가 겹쳐 보이고 `+N`이 붙는다.
- 세션 수 칩은 몇 초 뒤 캐릭터 머리 위 별로 접힌다. 별을 누르면 목록이 열린다.

### 캐릭터 폴더

상태별 PNG를 한 폴더에 넣고 **캐릭터 폴더 가져오기**로 고른다. 없는 상태는 `idle`로 대신한다.

| 상태 | 파일 이름 |
|---|---|
| 대기 | `idle-01.png` (필수) |
| 진행 중 | `working-01.png`, `working-02.png` … |
| 답변 필요 | `attention-01.png` … |
| 응답 도착 | `result-01.png` … |
| 실패 | `failed-01.png` … |
| 세션 없음(잠) | `dormant-01.png` |
| 눌렀을 때 인사 | `greeting-01.png` … |
| 커서 쳐다보기 | `look-00.png` ~ `look-15.png` (16장, `00` = 위, `04` = 오른쪽, `08` = 아래, `12` = 왼쪽) |

같은 상태의 그림이 여러 장이면 번갈아 보여 준다. 투명 배경, 발이 아래에 닿게 그리면 자연스럽다.

## 파일

| 파일 | 역할 |
|---|---|
| `hook.mjs` | Claude Code 훅. 이벤트를 세션 상태로 바꿔 파일에 쓴다 |
| `install.mjs` | `~/.claude/settings.json`에 훅 등록 · 제거 |
| `main.js` · `preload.js` | Electron 메인. 펫 창 · 작업함 창 · 메뉴 · 클릭 통과 처리 |
| `index.html` | 펫 창(캐릭터 · 말풍선 · 세션 목록) |
| `app.html` | 작업함 · 캐릭터 고르기 |
| `status.js` · `characters.js` · `style.css` | 상태 정의 · 캐릭터 · 공통 스타일 |
| `build-win.mjs` | Windows exe 빌드(아이콘 넣기 포함) |
| `test.mjs` | 훅 → 상태 파일 흐름 검사 |

## 검사

```bash
node test.mjs
```

## 라이선스

MIT
