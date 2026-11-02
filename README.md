# Claude Pet

**English** | [한국어](README.ko.md)

A desktop pet that sits in the corner of your screen and shows what each of your Claude Code sessions is doing right now.

## Purpose

When you run several Claude Code sessions at once and switch to other work, you lose track of them: one is stuck waiting for your approval, another finished ten minutes ago, a third is still editing files. Claude Pet answers two questions at a glance, without switching windows:

1. **Does any session need me right now?** (approval, a question, a failure)
2. **How far along is each session?** (what it is doing at this moment)

It only observes. It never answers prompts, approves commands, or sends anything off your machine.

## Features

- **One-line status bubble** — your request in small text on top, the current step below (e.g. `index.html 고치는 중`, "editing index.html"). The line is replaced, never accumulated.
- **Urgency order** — needs input → failed → response arrived → working → idle. The most urgent session is the one the bubble shows.
- **Real work location** — sessions are named after the project folder of the file they last edited (nearest folder with `.git` or `package.json`), not the folder the session was started in. Paths in shell commands count too.
- **Inbox window** — per session: state, request, approval target, and the last 6 steps. Response text is not stored; only the state is.
- **Stacked cards** — when several sessions need you, cards pile up behind the bubble with a `+N` count.
- **Characters** — 4 built-in characters, a single image, or a folder of per-state frames. Each state has its own motion (breathing, typing, hopping, jump, shake, sleep). The pet looks toward the cursor.
- **UI language** — Korean.
- **Desktop behavior** — always on top, drag to move (position is remembered), click-through on transparent areas, 4 sizes, light/dark follows the OS.

## Specifications

| Item | Value |
|---|---|
| App runtime | Electron 45 (Chromium + Node.js bundled; no separate Node needed to run the app) |
| Hook runtime | Node.js 20+ in the environment where Claude Code runs |
| Claude Code hooks used | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification` (`permission_prompt`, `elicitation_dialog`), `Stop`, `StopFailure`, `SessionEnd` |
| Data flow | hook → one JSON file per session in `~/.claude-pet/sessions/` → app polls every 0.8 s |
| Network | none |
| Stored per session | project, work location, request (one line), current step, state, last 6 steps, timestamps |
| Session expiry | file removed on `SessionEnd`; hidden after 6 h without updates |
| Hook safety | hook never prints and always exits 0, so it cannot block Claude Code; 5 s timeout |
| Settings changes | adds hook entries to `~/.claude/settings.json` only, keeps a backup at `settings.json.claude-pet.bak`; uninstall removes only its own entries |
| Windows build | portable `.exe` (x64), unsigned |
| macOS build | universal `.dmg`, unsigned |

## Environment

| | Supported | Tested |
|---|---|---|
| Windows | Windows 10/11 x64, with Claude Code running inside **WSL2** | Windows 11 (build 26200), WSL2 Ubuntu 26.04 |
| macOS | macOS 12+ (Intel and Apple Silicon) | not yet tested |
| Claude Code | CLI with hooks support | 2.1.285 |
| Node.js (build / hooks) | 20+ | 26.7.0 |
| Electron / electron-builder | 45 / 26 | 45.1.0 / 26.18.0 |

On Windows the app runs natively while Claude Code runs in WSL. The hook writes state files into the **Windows** home folder (`C:\Users\<you>\.claude-pet`) so the app can read them.

Font: the UI uses `Jetendard` if installed, otherwise Pretendard, then the system font.

## Install

### Windows + WSL

```bash
# inside WSL
npm install
ELECTRON_INSTALL_PLATFORM=win32 node node_modules/electron/install.js   # fetch the Windows Electron binary
npm run dist:win    # → dist/ClaudePet-<version>-windows-x64.exe
```

1. Run the `.exe`. The pet appears at the bottom-right of the screen.
2. Right-click the pet → **Claude Pet 열기** (Open Claude Pet) → press **Claude 연결하기** (Connect Claude) in the inbox.
3. Start a new Claude Code session.

To start on login, put a shortcut to the `.exe` in `shell:startup`.

### macOS

```bash
npm install
npm run dist:mac    # → dist/ClaudePet-<version>-macOS-universal.dmg (macOS only)
```

The app is unsigned, so the first launch shows a warning: Control-click → Open. Connect from the app the same way as on Windows.

### Hooks only

```bash
node install.mjs              # register hooks
node install.mjs --uninstall  # remove them
```

## Usage

- **Click** the pet to open the session list. **Drag** it to move.
- **Right-click**: Claude Pet 열기 (open) · 캐릭터 바꾸기 (change character) · 크기 (size) · 제자리로 (reset position) · 끄기 (quit).
- **×** on the bubble marks it as seen; the session stays and drops to idle.
- The session-count chip folds into a small star above the pet after a few seconds. Click the star to open the list.

### Character folders

Put per-state PNGs in one folder and choose **캐릭터 폴더 가져오기** (import character folder). Missing states fall back to `idle`.

| State | File names |
|---|---|
| Idle | `idle-01.png` (required) |
| Working | `working-01.png`, `working-02.png`, … |
| Needs input | `attention-01.png`, … |
| Response arrived | `result-01.png`, … |
| Failed | `failed-01.png`, … |
| No session (asleep) | `dormant-01.png` |
| Greeting on click | `greeting-01.png`, … |
| Looking at cursor | `look-00.png` … `look-15.png` (16 frames; `00` up, `04` right, `08` down, `12` left) |

Multiple frames for a state are played in turn. Transparent background with the feet at the bottom works best.

## Files

| File | Role |
|---|---|
| `hook.mjs` | Claude Code hook; turns events into session state |
| `install.mjs` | registers / removes hooks in `~/.claude/settings.json` |
| `main.js`, `preload.js` | Electron main: pet window, inbox window, menu, click-through |
| `index.html` | pet window (character, bubble, session list) |
| `app.html` | inbox and character picker |
| `status.js`, `characters.js`, `style.css` | states, characters, shared styles |
| `build-win.mjs` | Windows build (stamps the icon with rcedit) |
| `test.mjs` | hook → state file test |

## Test

```bash
node test.mjs
```

## License

MIT
