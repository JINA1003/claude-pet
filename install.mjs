// ~/.claude/settings.json에 펫 훅을 등록한다(WSL·Mac). --uninstall로 제거.
// 사용: node install.mjs [--dir <상태 폴더>] [--hook <hook.mjs 경로>] [--node <node 실행 명령>] [--uninstall]
// WSL은 상태 파일을 Windows 홈(~/.claude-pet)에 쓴다 — 펫 앱이 Windows에서 돌기 때문.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const HOOK = arg('--hook') || path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.mjs')
const NODE = arg('--node') || `"${process.execPath}"`
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')
const EVENTS = {
  SessionStart: null, UserPromptSubmit: null, PreToolUse: null, PostToolUse: null, PermissionRequest: null,
  Notification: 'permission_prompt|elicitation_dialog', Stop: null, StopFailure: null, SessionEnd: null,
}

function stateDir() {
  if (arg('--dir')) return arg('--dir')
  if (!process.env.WSL_DISTRO_NAME) return path.join(os.homedir(), '.claude-pet')
  // cmd.exe는 한글 사용자 이름을 CP949로 내보내 깨진다. PowerShell에서 UTF-8로 받는다.
  const win = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $env:USERPROFILE'], { cwd: '/mnt/c', encoding: 'utf8' }).trim()
  return execFileSync('wslpath', ['-u', win], { encoding: 'utf8' }).trim() + '/.claude-pet'
}

const dir = stateDir()
const settings = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {}
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.claude-pet.bak`)
settings.hooks ??= {}
for (const ev of Object.keys(settings.hooks)) {
  settings.hooks[ev] = settings.hooks[ev].filter((g) => !JSON.stringify(g).includes('claude-pet'))
  if (!settings.hooks[ev].length) delete settings.hooks[ev]
}

const marker = path.join(dir, `connected-${process.env.WSL_DISTRO_NAME ? 'wsl' : os.platform()}.json`)
if (!process.argv.includes('--uninstall')) {
  const command = `${NODE} "${HOOK}" --dir "${dir}"`
  for (const [ev, matcher] of Object.entries(EVENTS)) {
    settings.hooks[ev] ??= []
    settings.hooks[ev].push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command, timeout: 5 }] })
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(marker, JSON.stringify({ at: Date.now(), settings: SETTINGS }))
  console.log(`훅 ${Object.keys(EVENTS).length}개 등록 · 상태 폴더 ${dir}`)
} else {
  fs.rmSync(marker, { force: true })
  console.log('훅 제거')
}

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
console.log(`백업: ${SETTINGS}.claude-pet.bak`)
