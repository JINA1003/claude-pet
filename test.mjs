// 훅 → 상태 파일 흐름 검사. 실패하면 assert가 던진다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-'))
const transcript = path.join(dir, 't.jsonl')
fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '다 고쳤어요.\n테스트 통과.' }] } }) + '\n')
const file = path.join(dir, 'sessions', 's1.json')
const send = (p) => execFileSync(process.execPath, ['hook.mjs', '--dir', dir], { input: JSON.stringify({ session_id: 's1', cwd: '/home/me/proj', transcript_path: transcript, ...p }) })
const state = () => JSON.parse(fs.readFileSync(file, 'utf8'))

send({ hook_event_name: 'UserPromptSubmit', prompt: '버그\n고쳐줘' })
assert.equal(state().prompt, '버그 고쳐줘')
assert.equal(state().project, 'proj')
assert.equal(state().status, 'working')

send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/b/main.js' } })
assert.equal(state().line, 'main.js 고치는 중')
assert.equal(state().prompt, '버그 고쳐줘', '진행 줄만 바뀌고 요청은 유지')
fs.mkdirSync(path.join(dir, 'repo', 'src'), { recursive: true })
fs.writeFileSync(path.join(dir, 'repo', 'package.json'), '{}')
send({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'repo', 'src', 'a.js') } })
assert.equal(state().workdir, 'repo', '고친 파일의 프로젝트 폴더')
send({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } })
assert.equal(state().workdir, 'repo', '읽기만 한 파일은 작업 위치를 바꾸지 않는다')
send({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `sed -i 's/a/b/' /tmp/x.txt` } })
assert.equal(state().workdir, 'repo', '임시 폴더 경로는 작업 위치가 아니다')

send({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x', description: '파일 지우기' } })
assert.equal(state().status, 'waiting')
assert.equal(state().hint, '파일 지우기', '승인 대상')
send({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })
assert.equal(state().status, 'working', '승인 뒤 진행으로 복귀')

send({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ status: 'in_progress', activeForm: '테스트 돌리는 중' }] } })
assert.equal(state().line, '테스트 돌리는 중')
assert.deepEqual(state().steps.map((x) => x.text), ['main.js 고치는 중', 'a.js 쓰는 중', 'hosts 읽는 중', "sed -i 's/a/b/' /tmp/x.txt", '테스트 돌리는 중'], '최근 활동 기록')
for (let i = 0; i < 10; i++) send({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: `/f${i}.js` } })
assert.equal(state().steps.length, 6, '최근 활동은 6개까지만')

// 서브에이전트: 호출 설명이 에이전트에 붙고, 에이전트 안의 도구는 세션 진행 줄을 덮지 않는다
const agentsDir = path.join(dir, 'sessions', 's1.agents')
const agent = (id) => JSON.parse(fs.readFileSync(path.join(agentsDir, `${id}.json`), 'utf8'))
send({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: '코드 위치 찾기', subagent_type: 'Explore' } })
send({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: '리뷰', subagent_type: 'Explore', run_in_background: true } })
assert.equal(state().line, '에이전트: 리뷰')
send({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' })
send({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Explore' })
assert.equal(agent('a1').desc, '코드 위치 찾기')
assert.equal(agent('a2').desc, '리뷰', '이미 가져간 설명은 건너뛴다')
send({ hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Grep', tool_input: { pattern: 'foo' } })
assert.equal(agent('a1').line, '검색: foo')
assert.equal(agent('a1').tools, 1)
assert.equal(state().line, '에이전트: 리뷰', '에이전트 안의 도구는 세션 줄을 바꾸지 않는다')
send({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore' })
assert.equal(agent('a1').status, 'done')

send({ hook_event_name: 'Stop' })
assert.equal(state().status, 'done')
assert.equal(agent('a2').status, 'working', '백그라운드 에이전트는 응답이 끝나도 진행 중')
send({ hook_event_name: 'UserPromptSubmit', prompt: '다음' })
assert.ok(!fs.existsSync(path.join(agentsDir, 'a1.json')), '새 요청이면 끝난 에이전트는 치운다')
assert.ok(fs.existsSync(path.join(agentsDir, 'a2.json')), '아직 도는 에이전트는 남는다')
send({ hook_event_name: 'Stop' })
assert.equal(state().line, '응답이 왔어요', '응답 본문이 아니라 상태')

send({ hook_event_name: 'SessionEnd' })
assert.ok(!fs.existsSync(file), 'SessionEnd면 파일 삭제')
assert.ok(!fs.existsSync(agentsDir), 'SessionEnd면 에이전트 기록도 삭제')

assert.equal(execFileSync(process.execPath, ['hook.mjs', '--dir', dir], { input: 'not json' }).length, 0, '깨진 입력에도 조용히 종료')
fs.rmSync(dir, { recursive: true })
console.log('ok')
