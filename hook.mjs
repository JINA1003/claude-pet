// Claude Code 훅 → 세션 상태 파일 하나(덮어쓰기). 펫 앱이 이 파일만 읽는다.
// 사용: node hook.mjs --dir <상태 폴더>   (stdin = 훅 payload JSON)
import fs from 'node:fs'
import path from 'node:path'

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

// 이 훅을 띄운 Claude 프로세스: 부모를 따라 올라가 이름이 claude인 첫 프로세스. 시작 시각을 같이 남겨
// 끌 때 pid가 다른 프로세스로 재사용됐는지 가린다. ponytail: /proc이 없는 macOS는 기록 없음(끄기는 목록에서만 지움)
export function claudeProcess(pid = process.ppid) {
  for (let i = 0; i < 6 && pid > 1; i++) {
    let stat
    try { stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8') } catch { return null }
    const [, comm, rest] = stat.match(/^\d+ \((.*)\) (.*)$/s)
    const f = rest.split(' ') // f[1] = 부모 pid, f[19] = 시작 시각(stat 22번째 칸)
    if (comm === 'claude') return { pid, start: f[19] }
    pid = +f[1]
  }
  return null
}

export function nextState(s, p, now = Date.now()) {
  const base = { ...s, id: p.session_id, project: path.basename(String(p.cwd || '').replace(/[\\/]+$/, '')), updated: now }
  switch (p.hook_event_name) {
    case 'SessionStart': return { status: 'idle', line: '세션 시작', ...s, ...base }
    case 'UserPromptSubmit': return { ...base, prompt: oneLine(p.prompt), status: 'working', line: '생각하는 중', hint: '', started: now, steps: [], pending: [] }
    case 'PreToolUse': {
      const line = describeTool(p.tool_name, p.tool_input)
      // 실제 작업 위치: 고친 파일, 또는 셸 명령이 다룬 경로의 프로젝트
      const edited = TOOL_VERBS[p.tool_name] && p.tool_name !== 'Read' && (p.tool_input?.file_path || p.tool_input?.notebook_path)
      const where = edited ? projectOf(edited) : p.tool_name === 'Bash' ? projectInCommand(p.tool_input?.command) : null
      if (where) base.workdir = where
      const steps = [...(s.steps || []), { at: now, text: line }].slice(-STEPS)
      // 서브에이전트 호출: 설명을 줄 세워 두었다가 SubagentStart가 가져간다(그 이벤트엔 설명이 없다)
      if (p.tool_name === 'Task' || p.tool_name === 'Agent') {
        base.pending = [...(s.pending || []), { type: p.tool_input?.subagent_type || 'general-purpose', desc: oneLine(p.tool_input?.description, 80), bg: !!p.tool_input?.run_in_background }].slice(-10)
      }
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
// taken = 이미 다른 에이전트가 가져간 호출 설명
export function nextAgent(a, p, pending = [], taken = [], now = Date.now()) {
  const base = { ...a, id: p.agent_id, type: a.type || p.agent_type || 'agent', updated: now }
  if (!base.desc) {
    const free = pending.filter((x) => !taken.includes(x.desc))
    const hit = free.find((x) => x.type === base.type) || free[0]
    if (hit) Object.assign(base, { desc: hit.desc, bg: hit.bg })
  }
  switch (p.hook_event_name) {
    case 'SubagentStart': return { ...base, status: 'working', line: '시작', started: now, tools: 0 }
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
    const taken = agentFiles(agents).filter((x) => x !== f).map((x) => readJSON(x)?.desc)
    const a = nextAgent(readJSON(f) || {}, p, s.pending, taken)
    return a && writeJSON(f, a)
  }

  const next = nextState(s, p)
  if (!next) return
  next.proc = claudeProcess() || s.proc // --resume으로 다시 열면 프로세스가 바뀐다
  writeJSON(file, next)
  // 새 요청: 끝난 에이전트는 치운다(백그라운드로 아직 도는 것은 남긴다)
  // 응답 끝: 앞에서 기다린 에이전트는 끝났어야 한다. SubagentStop 없이 끊긴 것(Esc 등)은 멈춤으로 둔다.
  if (p.hook_event_name === 'UserPromptSubmit' || p.hook_event_name === 'Stop' || p.hook_event_name === 'StopFailure') {
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
