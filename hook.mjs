// Claude Code 훅 → 세션 상태 파일 하나(덮어쓰기). 펫 앱이 이 파일만 읽는다.
// 사용: node hook.mjs --dir <상태 폴더>   (stdin = 훅 payload JSON)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const STEPS = 6 // 최근 활동은 이만큼만 남긴다(누적 안 함)
const TOOL_VERBS = { Read: '읽는 중', Edit: '고치는 중', MultiEdit: '고치는 중', Write: '쓰는 중', NotebookEdit: '고치는 중' }

const oneLine = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function describeTool(name, input = {}) {
  if (TOOL_VERBS[name]) return `${path.basename(input.file_path || input.notebook_path || '')} ${TOOL_VERBS[name]}`
  if (name === 'Bash') return oneLine(input.description || input.command)
  if (name === 'Grep' || name === 'Glob') return `검색: ${oneLine(input.pattern, 80)}`
  if (name === 'WebSearch') return `웹 검색: ${oneLine(input.query, 80)}`
  if (name === 'WebFetch') { try { return `웹 읽는 중: ${new URL(input.url).host}` } catch { return '웹 읽는 중' } }
  if (name === 'Task' || name === 'Agent') return `에이전트: ${oneLine(input.description, 80)}`
  if (name === 'TodoWrite') {
    const t = (input.todos || []).find((t) => t.status === 'in_progress')
    return t ? oneLine(t.activeForm || t.content) : '할 일 정리 중'
  }
  if (name === 'AskUserQuestion') return oneLine(input.questions?.[0]?.question || '질문이 있어요')
  return name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')
}

// 고친 파일의 프로젝트 폴더: 위로 올라가며 .git 또는 package.json이 있는 첫 폴더, 없으면 파일이 든 폴더
export function projectOf(file) {
  let dir = path.dirname(file)
  for (let i = 0; i < 12 && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) return path.basename(dir)
  }
  return path.basename(path.dirname(file))
}

// 셸 명령에 적힌 절대 경로 중 실제로 있는 첫 경로의 프로젝트(sed·python·cd로 고치는 경우)
const SKIP = /^\/(tmp|usr|etc|proc|dev|bin|sbin|var|opt|sys|run|lib)\b|\/\.(claude|claude-pet|cache|config|local|npm)\b|\/node_modules\//
export function projectInCommand(cmd) {
  for (const m of String(cmd).matchAll(/(?:^|[\s"'=(])(\/(?:mnt|home|Users)\/[^\s"'|;&<>()$`*]+)/g)) {
    const p = m[1].replace(/[\/.,:]+$/, '')
    if (SKIP.test(p) || !fs.existsSync(p)) continue
    return projectOf(fs.statSync(p).isDirectory() ? path.join(p, '_') : p)
  }
  return null
}

// 프로세스 하나의 { 부모 pid, 이름, 시작 시각 }. Linux · WSL은 /proc, macOS는 ps(/proc이 없다)
// 시작 시각은 끌 때 · 살아 있는지 볼 때 pid가 다른 프로세스로 재사용됐는지 가리는 데 쓴다. main.js의 procStart와 같은 값이어야 한다
export function procInfo(pid) {
  try {
    if (process.platform === 'darwin') {
      const [, ppid, comm, start] = execFileSync('ps', ['-o', 'ppid=,comm=,lstart=', '-p', String(pid)], { encoding: 'utf8' }).match(/^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/s)
      return { ppid: +ppid, comm: path.basename(comm), start }
    }
    const [, comm, rest] = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').match(/^\d+ \((.*)\) (.*)$/s)
    const f = rest.split(' ') // f[1] = 부모 pid, f[19] = 시작 시각(stat 22번째 칸)
    return { ppid: +f[1], comm, start: f[19] }
  } catch { return null }
}

// Claude Code가 사용자 입력 자리로 넣는 시스템 글(서브에이전트 결과 · 작업 알림 · 시스템 알림)
export const isEnvelope = (t) => /^\s*(<(agent-message|task-notification|system-reminder)\b|\[SYSTEM NOTIFICATION)/.test(String(t || ''))

// 이 훅을 띄운 Claude 프로세스: 부모를 따라 올라가 이름이 claude인 첫 프로세스
export function claudeProcess(pid = process.ppid) {
  for (let i = 0; i < 6 && pid > 1; i++) {
    const p = procInfo(pid)
    if (!p) return null
    if (p.comm === 'claude') return { pid, start: p.start }
    pid = p.ppid
  }
  return null
}

// 서브에이전트 종류가 하는 일. 기본 종류는 여기에, 사용자 · 프로젝트 · 플러그인 에이전트는 정의 파일의 description에서 읽는다
const ROLES = {
  'general-purpose': '범용 · 조사와 여러 단계 작업', claude: '범용 · 조사와 여러 단계 작업', Explore: '탐색 · 파일과 코드 찾기(읽기만)',
  Plan: '설계 · 구현 계획 세우기', fork: '분기 · 같은 대화를 이어받은 복제', 'claude-code-guide': 'Claude Code 사용법 안내', 'statusline-setup': '상태 줄 설정',
}
export function agentRole(type, cwd = '') {
  if (ROLES[type]) return ROLES[type]
  const [plugin, name] = type.includes(':') ? type.split(':') : ['', type]
  const home = os.homedir()
  const files = plugin ? fs.globSync(`${home}/.claude/plugins/cache/*/${plugin}/*/agents/${name}.md`)
    : [path.join(home, '.claude', 'agents', `${name}.md`), path.join(cwd, '.claude', 'agents', `${name}.md`)]
  for (const f of files) {
    let m
    try { m = fs.readFileSync(f, 'utf8').match(/^description:\s*(?:[|>]-?\s*\n\s*)?["']?(.+?)["']?\s*$/m) } catch { continue }
    if (m) return oneLine(m[1], 120)
  }
  return ''
}

export function nextState(s, p, now = Date.now()) {
  // 상태 파일 없이 도구 이벤트부터 오면(앱 설치 · 훅 갱신이 작업 도중) 진행 중으로 본다. 상태가 비면 화면이 깨진다
  const base = { status: 'working', ...s, id: p.session_id, project: path.basename(String(p.cwd || '').replace(/[\\/]+$/, '')), updated: now }
  switch (p.hook_event_name) {
    case 'SessionStart': return { line: '세션 시작', ...base, status: s.status || 'idle' }
    case 'UserPromptSubmit':
      // 서브에이전트 결과 · 백그라운드 알림도 이 이벤트로 들어온다. 사용자 요청이 아니니 요청 · 기록을 덮지 않는다
      if (isEnvelope(p.prompt)) return { ...base, status: 'working', line: /^\s*<agent-message/.test(p.prompt) ? '서브에이전트 결과 받는 중' : '알림 받는 중', hint: '' }
      return { ...base, prompt: oneLine(p.prompt), status: 'working', line: '생각하는 중', hint: '', started: now, steps: [], pending: undefined }
    case 'PreToolUse': {
      const line = describeTool(p.tool_name, p.tool_input)
      // 실제 작업 위치: 고친 파일, 또는 셸 명령이 다룬 경로의 프로젝트
      const edited = TOOL_VERBS[p.tool_name] && p.tool_name !== 'Read' && (p.tool_input?.file_path || p.tool_input?.notebook_path)
      const where = edited ? projectOf(edited) : p.tool_name === 'Bash' ? projectInCommand(p.tool_input?.command) : null
      if (where) base.workdir = where
      const steps = [...(s.steps || []), { at: now, text: line }].slice(-STEPS)
      if (p.tool_name === 'AskUserQuestion') return { ...base, status: 'waiting', line, hint: line, steps }
      return { ...base, status: 'working', line, hint: '', steps }
    }
    case 'PostToolUse': return s.status === 'waiting' ? { ...base, status: 'working', hint: '' } : base
    case 'PermissionRequest': {
      const hint = describeTool(p.tool_name, p.tool_input)
      return { ...base, status: 'waiting', line: `승인 필요 · ${hint}`, hint }
    }
    case 'Notification': return { ...base, status: 'waiting', line: oneLine(p.message) || '답이 필요해요', hint: s.hint || oneLine(p.message) }
    // 응답 본문은 담지 않는다. 상태만 남긴다.
    case 'Stop': return { ...base, status: 'done', line: '응답이 왔어요', hint: '', finished: now }
    case 'StopFailure': return { ...base, status: 'error', line: oneLine(p.error || p.message) || '실패', finished: now }
    default: return null
  }
}

// 서브에이전트 하나의 상태. 세션 파일과 따로 써서, 나란히 도는 에이전트끼리 덮어쓰지 않는다.
// call = SubagentStart 때 가져온 호출 기록(설명 · 맡긴 일 · 백그라운드)
export function nextAgent(a, p, call = null, now = Date.now()) {
  const base = { ...a, id: p.agent_id, type: a.type || p.agent_type || 'agent', updated: now }
  if (call) Object.assign(base, { desc: call.desc, task: call.task, bg: call.bg })
  switch (p.hook_event_name) {
    case 'SubagentStart': return { ...base, status: 'working', line: '시작', role: agentRole(base.type, p.cwd), started: now, tools: 0 }
    case 'PreToolUse': return { ...base, status: 'working', line: describeTool(p.tool_name, p.tool_input), started: a.started || now, tools: (a.tools || 0) + 1 }
    case 'PostToolUse': return base
    case 'SubagentStop': return { ...base, status: 'done', line: '끝남', finished: now }
    default: return null
  }
}

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const writeJSON = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v))
  fs.renameSync(`${f}.tmp`, f)
}

// 서브에이전트 호출 기록: 호출(PreToolUse Agent)마다 파일 하나를 <세션>.agents/calls/에 두고 SubagentStart가 하나를 가져간다.
// 세션 파일에 줄 세우면 같은 순간 도는 다른 훅(나란히 부른 Read 등)이 세션 파일을 다시 쓰며 지워 버린다
function putCall(agents, p) {
  writeJSON(path.join(agents, 'calls', `${Date.now()}-${process.pid}.json`), { type: p.tool_input?.subagent_type || 'general-purpose',
    desc: oneLine(p.tool_input?.description, 80), task: oneLine(p.tool_input?.prompt, 400), bg: !!p.tool_input?.run_in_background }) // task = 메인이 맡긴 일(지시문 앞부분)
}
function takeCall(agents, type) {
  const dir = path.join(agents, 'calls')
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort() } catch { return null }
  const calls = names.map((n) => ({ f: path.join(dir, n), c: readJSON(path.join(dir, n)) })).filter((x) => x.c)
  for (const { f, c } of [...calls.filter((x) => x.c.type === type), ...calls.filter((x) => x.c.type !== type)]) {
    try { fs.renameSync(f, `${f}.taken`) } catch { continue } // 나란히 시작한 에이전트가 먼저 가져갔다
    fs.rmSync(`${f}.taken`, { force: true })
    return c
  }
  return null
}
const agentFiles = (dir) => { try { return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => path.join(dir, n)) } catch { return [] } }

function main() {
  const dir = process.argv[process.argv.indexOf('--dir') + 1]
  const p = JSON.parse(fs.readFileSync(0, 'utf8'))
  if (!dir || !p.session_id) return
  const id = p.session_id.replace(/[^\w-]/g, '')
  const file = path.join(dir, 'sessions', `${id}.json`)
  const agents = path.join(dir, 'sessions', `${id}.agents`) // 세션의 서브에이전트: 에이전트마다 파일 하나
  if (p.hook_event_name === 'SessionEnd') return fs.rmSync(file, { force: true }), fs.rmSync(agents, { recursive: true, force: true })
  const s = readJSON(file) || {}

  // 서브에이전트 안에서 난 도구 이벤트는 그 에이전트 파일로만 간다(세션의 진행 줄을 덮지 않는다)
  if (p.agent_id && ['SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse'].includes(p.hook_event_name)) {
    const f = path.join(agents, `${String(p.agent_id).replace(/[^\w-]/g, '')}.json`)
    const a = nextAgent(readJSON(f) || {}, p, p.hook_event_name === 'SubagentStart' ? takeCall(agents, p.agent_type) : null)
    return a && writeJSON(f, a)
  }

  if (p.hook_event_name === 'PreToolUse' && (p.tool_name === 'Task' || p.tool_name === 'Agent')) putCall(agents, p)
  const next = nextState(s, p)
  if (!next) return
  // --resume으로 다시 열면 프로세스가 바뀐다(SessionStart가 온다). 도구 이벤트마다 ps를 돌리지 않게 그때만 다시 찾는다
  next.proc = ['SessionStart', 'UserPromptSubmit'].includes(p.hook_event_name) || !s.proc ? claudeProcess() || s.proc : s.proc
  writeJSON(file, next)
  // 새 요청: 끝난 에이전트는 치운다(백그라운드로 아직 도는 것은 남긴다)
  // 응답 끝: 앞에서 기다린 에이전트는 끝났어야 한다. SubagentStop 없이 끊긴 것(Esc 등)은 멈춤으로 둔다.
  if (p.hook_event_name === 'UserPromptSubmit' && !isEnvelope(p.prompt)) fs.rmSync(path.join(agents, 'calls'), { recursive: true, force: true }) // 가져가지 않은 호출 기록
  if ((p.hook_event_name === 'UserPromptSubmit' && !isEnvelope(p.prompt)) || p.hook_event_name === 'Stop' || p.hook_event_name === 'StopFailure') {
    for (const f of agentFiles(agents)) {
      const a = readJSON(f)
      if (!a) continue
      if (p.hook_event_name === 'UserPromptSubmit' && a.status !== 'working') fs.rmSync(f, { force: true })
      else if (p.hook_event_name !== 'UserPromptSubmit' && a.status === 'working' && !a.bg) writeJSON(f, { ...a, status: 'stopped', line: '멈춤', finished: Date.now() })
    }
  }
}

if (process.argv.includes('--dir')) {
  // 훅은 관찰만 한다. 어떤 실패도 Claude 작업을 막지 않는다(exit 0, stdout 없음).
  try { main() } catch {}
  process.exit(0)
}
