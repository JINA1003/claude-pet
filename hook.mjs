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

export function nextState(s, p, now = Date.now()) {
  const base = { ...s, id: p.session_id, project: path.basename(String(p.cwd || '').replace(/[\\/]+$/, '')), updated: now }
  switch (p.hook_event_name) {
    case 'SessionStart': return { status: 'idle', line: '세션 시작', ...s, ...base }
    case 'UserPromptSubmit': return { ...base, prompt: oneLine(p.prompt), status: 'working', line: '생각하는 중', hint: '', started: now, steps: [] }
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

function main() {
  const dir = process.argv[process.argv.indexOf('--dir') + 1]
  const p = JSON.parse(fs.readFileSync(0, 'utf8'))
  if (!dir || !p.session_id) return
  const file = path.join(dir, 'sessions', `${p.session_id.replace(/[^\w-]/g, '')}.json`)
  if (p.hook_event_name === 'SessionEnd') return fs.rmSync(file, { force: true })
  let s = {}
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  const next = nextState(s, p)
  if (!next) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next))
  fs.renameSync(`${file}.tmp`, file)
}

if (process.argv.includes('--dir')) {
  // 훅은 관찰만 한다. 어떤 실패도 Claude 작업을 막지 않는다(exit 0, stdout 없음).
  try { main() } catch {}
  process.exit(0)
}
