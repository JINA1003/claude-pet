const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, screen } = require('electron')
const { execFile, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HOME = path.join(os.homedir(), '.claude-pet')
const SESSIONS = path.join(HOME, 'sessions')
const CUSTOM = path.join(HOME, 'characters')
const CONFIG = path.join(HOME, 'config.json')
const STALE_MS = 6 * 3600_000 // ponytail: 비정상 종료로 SessionEnd가 없던 세션은 6시간 뒤 숨김
const W = 600, H = 640 // 가장 큰 캐릭터(220) + 말풍선(320) + 목록(300)이 들어가는 크기
const BUILTIN = { ink: '먹물', mochi: '모찌', sprout: '새싹', tin: '깡통' }
const SIZES = { 96: '작게', 128: '기본', 168: '크게', 220: '아주 크게' }

const acks = new Map() // 확인한 응답·실패·답변 필요: 세션 id → 그때의 updated

function readSessions() {
  let names = []
  try { names = fs.readdirSync(SESSIONS).filter((n) => n.endsWith('.json')) } catch { return [] }
  return names.flatMap((n) => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS, n), 'utf8'))
      return Date.now() - s.updated < STALE_MS ? [{ ...s, acked: acks.get(s.id) === s.updated, agents: readAgents(n.slice(0, -5)) }] : []
    } catch { return [] }
  })
}

// 세션의 서브에이전트(hook.mjs가 <세션 id>.agents/에 하나씩 쓴다), 시작 순
function readAgents(id) {
  const dir = path.join(SESSIONS, `${id}.agents`)
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch { return [] }
  return names.flatMap((n) => { try { return [JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))] } catch { return [] } })
    .sort((a, b) => (a.started || a.updated) - (b.started || b.updated))
}

// 프로세스 시작 시각(hook.mjs procInfo와 같은 값). 없는 pid면 null
function procStart(pid) {
  try {
    if (process.platform === 'darwin') return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[19]
  } catch { return null }
}
const procAlive = (proc) => !!proc && procStart(proc.pid) === String(proc.start)

// 터미널을 닫거나 강제 종료돼 SessionEnd 없이 끝난 세션: Claude 프로세스가 없으면 기록을 지운다.
// shortcut: Windows는 Claude가 WSL 안에 있어 확인하지 않음(6시간 숨김만), 필요해지면 wsl.exe로 한 번에 묻기
function sweepDead() {
  if (process.platform === 'win32') return
  let names = []
  try { names = fs.readdirSync(SESSIONS).filter((n) => n.endsWith('.json')) } catch { return }
  for (const n of names) {
    let s
    try { s = JSON.parse(fs.readFileSync(path.join(SESSIONS, n), 'utf8')) } catch { continue }
    // 프로세스 기록이 없는 옛 파일(맥 기록 전 훅)은 6시간 지나면 지운다. 숨기기만 하면 폴더에 계속 쌓인다
    if (s.proc?.pid ? !procAlive(s.proc) : Date.now() - (s.updated || 0) > STALE_MS) removeSession(n.slice(0, -5))
    else if (idleTooLong(s)) {
      killProc(s.proc)
      removeSession(n.slice(0, -5))
      fs.appendFileSync(path.join(HOME, 'app.log'), `${new Date().toISOString()} auto-close ${s.id} ${s.workdir || s.project} · ${s.status} · ${Math.round((Date.now() - s.updated) / 60000)}분 · ${s.prompt || ''}\n`)
    }
  }
}

// 놀고 있는 세션 자동 끄기: 응답이 끝난 뒤(대기 · 응답 도착 · 실패) 30분 동안 아무 활동이 없으면 끈다.
// 진행 중 · 답변 필요(승인 · 질문 대기) · 서브에이전트가 도는 세션 · Remote Control(claude rc)은 끄지 않는다. 대화는 남아 --resume으로 다시 연다
const IDLE_CLOSE_MS = 30 * 60000
function idleTooLong(s) {
  if (readConfig().autoClose === false || !procAlive(s.proc)) return false
  if (!['idle', 'done', 'error'].includes(s.status) || Date.now() - (s.updated || Date.now()) < IDLE_CLOSE_MS) return false
  if (readAgents(s.id).some((a) => a.status === 'working')) return false
  try { return !/\bclaude\s+(rc|remote-control)\b/.test(execFileSync('ps', ['-o', 'command=', '-p', String(s.proc.pid)], { encoding: 'utf8' })) } catch { return false }
}
// 시작 시각이 같을 때만 끈다(그사이 pid가 다른 프로세스에 재사용됐으면 건드리지 않음)
function killProc(proc) {
  const pid = parseInt(proc?.pid), start = String(proc?.start ?? '')
  if (!(pid > 1)) return
  if (process.platform === 'win32') {
    if (!/^\d+$/.test(start)) return // WSL 셸에 넣는 값은 숫자만 받는다
    execFile('wsl.exe', ['-e', 'sh', '-c', `set -- $(sed 's/.*) //' /proc/${pid}/stat) && [ "\${20}" = ${start} ] && kill -TERM ${pid}`], () => {})
  } else if (procAlive(proc)) try { process.kill(pid, 'SIGTERM') } catch {}
}
function removeSession(id) {
  fs.rmSync(path.join(SESSIONS, `${id}.json`), { force: true })
  fs.rmSync(path.join(SESSIONS, `${id}.agents`), { recursive: true, force: true })
}

// 훅 연결 표시: install.mjs가 남긴 connected-<환경>.json
function readConnection() {
  const out = {}
  for (const env of ['wsl', 'darwin', 'linux']) {
    try { out[env] = JSON.parse(fs.readFileSync(path.join(HOME, `connected-${env}.json`), 'utf8')).at } catch {}
  }
  return out
}

// 훅 연결: hook.mjs·install.mjs를 ~/.claude-pet에 복사하고 그 자리에서 install.mjs를 돌린다.
// (앱 자체 경로는 portable exe면 실행마다 바뀌므로 훅이 가리키면 안 된다)
function connect() {
  fs.mkdirSync(HOME, { recursive: true })
  for (const f of ['hook.mjs', 'install.mjs']) fs.writeFileSync(path.join(HOME, f), fs.readFileSync(path.join(__dirname, f)))
  const done = (err, stdout, stderr) => {
    dialog.showMessageBox({ type: err ? 'error' : 'info', message: err ? 'Claude 연결에 실패했어요' : 'Claude와 연결했어요',
      detail: err ? `${stderr || err.message}`.trim() : `${stdout}`.trim() + '\n\nClaude 세션을 새로 시작하면 여기에 나타나요.' })
    broadcast('connection', readConnection())
  }
  if (process.platform === 'win32') {
    const wsl = HOME.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')
    return execFile('wsl.exe', ['-e', 'bash', '-lc', `node '${wsl}/install.mjs' --dir '${wsl}' --hook '${wsl}/hook.mjs'`], done)
  }
  // Mac·Linux: 앱에 든 Electron을 node로 써서 따로 node가 없어도 된다
  const node = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}"`
  execFile(process.execPath, [path.join(HOME, 'install.mjs'), '--hook', path.join(HOME, 'hook.mjs'), '--node', node],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, done)
}

const dataURL = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase()
  const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg' }[ext] || `image/${ext}`
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

// 캐릭터 폴더(idle-01.png, working-01.png …)는 상태별 프레임 묶음으로 읽는다
function readPack(dir) {
  const frames = {}
  for (const f of fs.readdirSync(dir).filter((f) => /^[a-z]+-\d+\.png$/i.test(f)).sort()) {
    const state = f.split('-')[0].toLowerCase()
    ;(frames[state] ??= []).push(dataURL(path.join(dir, f)))
  }
  return frames
}

// 캐릭터 폴더의 선택 설정 pack.json: { "scale": 1.4, "ms": { "working": 120 } } — 그림 배율 · 상태별 프레임 간격(ms)
function readPackMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')) } catch { return {} }
}

function readConfig() {
  let config = { character: 'ink' }
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } } catch {}
  let entries = []
  try { entries = fs.readdirSync(CUSTOM, { withFileTypes: true }) } catch {}
  config.customs = entries.flatMap((e) => {
    const full = path.join(CUSTOM, e.name)
    if (e.isDirectory()) {
      const frames = readPack(full)
      return frames.idle ? [{ id: `pack:${e.name}`, name: e.name, frames, ...readPackMeta(full) }] : []
    }
    return /\.(png|gif|webp|jpe?g|svg)$/i.test(e.name) ? [{ id: `custom:${e.name}`, name: path.parse(e.name).name, image: dataURL(full) }] : []
  })
  return config
}

let pet, main, pop
const broadcast = (ch, data) => [pet, main, pop].forEach((w) => w && !w.isDestroyed() && w.webContents.send(ch, data))

function setConfig(patch) {
  fs.mkdirSync(HOME, { recursive: true })
  const { customs, ...config } = readConfig()
  fs.writeFileSync(CONFIG, JSON.stringify({ ...config, ...patch }))
  broadcast('config', readConfig())
  if ('petHidden' in patch) showPet()
}
// 펫 숨기기(맥): 앱은 상단바에 남고 펫 창만 감춘다
const showPet = () => pet && !pet.isDestroyed() && (readConfig().petHidden ? pet.hide() : pet.showInactive())
const setCharacter = (id) => setConfig({ character: id })

async function importCharacter() {
  const r = await dialog.showOpenDialog({ title: '캐릭터 그림 고르기', properties: ['openFile'], filters: [{ name: '그림', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg', 'svg'] }] })
  if (r.canceled) return
  fs.mkdirSync(CUSTOM, { recursive: true })
  const name = path.basename(r.filePaths[0])
  fs.copyFileSync(r.filePaths[0], path.join(CUSTOM, name))
  setCharacter(`custom:${name}`)
}

async function importPack() {
  const r = await dialog.showOpenDialog({ title: '캐릭터 폴더 고르기 (idle-01.png 등이 든 폴더)', properties: ['openDirectory'] })
  if (r.canceled) return
  const src = r.filePaths[0], name = path.basename(src), dst = path.join(CUSTOM, name)
  const files = fs.readdirSync(src).filter((f) => /^[a-z]+-\d+\.png$/i.test(f))
  if (!files.includes('idle-01.png')) return dialog.showMessageBox({ type: 'warning', message: '이 폴더에 idle-01.png가 없어요.', detail: '상태별 그림(idle-01.png, working-01.png …)이 든 폴더를 골라 주세요.' })
  fs.mkdirSync(dst, { recursive: true })
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f))
  setCharacter(`pack:${name}`)
}

function openApp() {
  if (process.platform === 'darwin') app.focus({ steal: true }) // Dock을 숨긴 앱은 창을 열어도 다른 앱 뒤에 깔린다
  if (main && !main.isDestroyed()) return main.show(), main.focus()
  main = new BrowserWindow({ icon: path.join(__dirname, 'build', 'icon.png'), width: 980, height: 720, minWidth: 720, minHeight: 480, backgroundColor: '#f1f7fe', title: 'Claude Pet', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') } })
  main.loadFile('app.html')
  // 흰 화면으로 남는 경우를 잡기 위한 기록과 복구: 렌더러 오류·충돌은 ~/.claude-pet/app.log에 남기고 다시 불러온다
  const log = (...m) => fs.appendFileSync(path.join(HOME, 'app.log'), `${new Date().toISOString()} ${m.join(' ')}\n`)
  main.webContents.on('console-message', (e) => { if (e.level === 'error') log('console', e.message, e.sourceId, e.lineNumber) })
  main.webContents.on('did-fail-load', (_e, code, desc) => { log('fail-load', code, desc); main.loadFile('app.html') })
  main.webContents.on('render-process-gone', (_e, d) => { log('gone', d.reason); if (!main.isDestroyed()) main.loadFile('app.html') })
  main.on('unresponsive', () => log('unresponsive'))
  main.webContents.on('did-finish-load', () => {
    main.webContents.send('config', readConfig())
    main.webContents.send('sessions', readSessions())
    main.webContents.send('connection', readConnection())
  })
}

// 펫 오른쪽 클릭과 맥 메뉴 막대 아이콘이 같은 메뉴를 쓴다(누를 때마다 지금 설정으로 새로 만든다)
function petMenu() {
  const { character, customs, size = 128, petHidden, autoClose } = readConfig()
  const item = (id, label) => ({ label, type: 'radio', checked: character === id, click: () => setCharacter(id) })
  return Menu.buildFromTemplate([
    { label: 'Claude Pet 열기', click: openApp },
    ...(tray ? [{ label: '펫 띄우기', type: 'checkbox', checked: !petHidden, click: () => setConfig({ petHidden: !petHidden }) }] : []),
    ...(process.platform === 'win32' ? [] : [{ label: '놀고 있는 세션 30분 뒤 끄기', type: 'checkbox', checked: autoClose !== false, click: () => setConfig({ autoClose: autoClose === false }) }]),
    { label: '캐릭터 바꾸기', submenu: [
      ...Object.entries(BUILTIN).map(([id, n]) => item(id, n)),
      ...customs.map((c) => item(c.id, c.name)),
      { type: 'separator' }, { label: '그림 한 장 가져오기…', click: importCharacter }, { label: '캐릭터 폴더 가져오기…', click: importPack },
    ] },
    { label: '크기', submenu: Object.entries(SIZES).map(([px, label]) => ({ label, type: 'radio', checked: +px === size, click: () => setConfig({ size: +px }) })) },
    { label: '제자리로', click: () => { placePet(); setConfig({ pos: null }) } },
    { type: 'separator' },
    { label: 'Claude Pet 끝내기', click: () => app.quit() },
  ])
}

// 상단바 팝업: 아이콘을 누르면 아래로 펼쳐지는 작은 세션 요약. 펫을 숨겨도 쓸 수 있다
const POP_W = 360
let popHiddenAt = 0
function togglePopover() {
  if (pop?.isVisible()) return pop.hide()
  if (Date.now() - popHiddenAt < 300) return // 아이콘을 눌러 닫을 때: blur로 먼저 닫힌 걸 다시 열지 않는다
  if (!pop || pop.isDestroyed()) {
    pop = new BrowserWindow({ width: POP_W, height: 200, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, webPreferences: { preload: path.join(__dirname, 'preload.js') } })
    pop.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    pop.on('blur', () => { popHiddenAt = Date.now(); pop.hide() })
    pop.loadFile('popover.html')
    pop.webContents.on('did-finish-load', () => { pop.webContents.send('config', readConfig()); pop.webContents.send('sessions', readSessions()); placePopover(); pop.show() })
    return
  }
  pop.webContents.send('sessions', readSessions())
  placePopover(); pop.show()
}
function placePopover() {
  const t = tray.getBounds(), { workArea: wa } = screen.getDisplayNearestPoint({ x: t.x, y: t.y })
  pop.setPosition(Math.round(Math.min(Math.max(t.x + t.width / 2 - POP_W / 2, wa.x + 8), wa.x + wa.width - POP_W - 8)), wa.y + 4)
}

function placePet() {
  const { workArea } = screen.getPrimaryDisplay()
  pet.setPosition(workArea.x + workArea.width - W - 12, workArea.y + workArea.height - H)
}

// 하나만 띄운다. 다시 실행하면 작업함을 연다.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => openApp())
app.on('activate', () => app.isReady() && openApp()) // 맥은 실행 중인 앱을 다시 열면 second-instance 대신 이것만 온다

let tray // 지역 변수면 가비지 컬렉션으로 아이콘이 사라진다

app.whenReady().then(() => {
  if (process.argv.includes('--open')) openApp()
  // 이미 연결돼 있으면 훅 스크립트를 앱 버전에 맞춰 둔다(설정은 그대로)
  if (fs.existsSync(path.join(HOME, 'hook.mjs'))) fs.writeFileSync(path.join(HOME, 'hook.mjs'), fs.readFileSync(path.join(__dirname, 'hook.mjs')))
  pet = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, focusable: false, webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  // 저장된 위치가 화면 밖으로 나가면 그 모니터 안으로 당긴다(창 크기가 바뀌었을 때도)
  const { pos } = readConfig()
  if (pos) {
    const { workArea: wa } = screen.getDisplayNearestPoint(pos)
    pet.setPosition(Math.min(Math.max(pos.x, wa.x), wa.x + wa.width - W), Math.min(Math.max(pos.y, wa.y), wa.y + wa.height - H))
  } else placePet()
  pet.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') {
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); app.dock?.hide()
    // Dock 대신 메뉴 막대에 아이콘. 앱 아이콘과 같은 고양이 그림을 그대로 줄여 쓴다(Template로 단색 변환하지 않음)
    tray = new Tray(path.join(__dirname, 'build', 'tray.png'))
    tray.setToolTip('Claude Pet')
    tray.on('click', togglePopover) // 왼쪽 클릭 = 세션 요약, 오른쪽 클릭 = 설정 메뉴
    tray.on('right-click', () => tray.popUpContextMenu(petMenu()))
    ipcMain.on('pop-height', (_e, h) => pop && !pop.isDestroyed() && pop.setSize(POP_W, Math.min(Math.ceil(h), 640)))
    ipcMain.on('pet-visible', (_e, on) => setConfig({ petHidden: !on }))
    ipcMain.on('pop-close', () => pop?.hide())
  }
  pet.setIgnoreMouseEvents(true)
  if (tray && readConfig().petHidden) pet.hide()
  pet.loadFile('index.html')
  pet.webContents.on('did-finish-load', () => { pet.webContents.send('config', readConfig()); pet.webContents.send('sessions', readSessions()) })

  // 투명한 곳은 클릭을 아래 창으로 흘려보낸다. 렌더러가 알려 준 클릭 영역 안에 커서가 있을 때만 받는다.
  // (setIgnoreMouseEvents의 forward 옵션은 Windows에서 마우스 이벤트가 오지 않아 쓰지 않는다)
  // 드래그는 렌더러가 포인터 캡처로 몰고, 그동안은 클릭 통과를 바꾸지 않는다.
  let rects = [], ignoring = true, dragging = false, last = {}
  ipcMain.on('rects', (_e, r) => (rects = r))
  ipcMain.on('move-to', (_e, x, y) => { dragging = true; pet.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H }) })
  ipcMain.on('drag-end', () => {
    if (!dragging) return
    dragging = false
    const [x, y] = pet.getPosition()
    setConfig({ pos: { x, y } })
  })
  // 끄는 도중(창은 닫혔고 프로세스는 아직)에 타이머가 돌면 'Object has been destroyed'가 뜬다
  setInterval(() => !pet.isDestroyed() && pet.setAlwaysOnTop(true, 'screen-saver'), 2000) // 다른 '항상 위' 창에 밀리지 않게
  setInterval(() => {
    if (dragging || pet.isDestroyed()) return
    const c = screen.getCursorScreenPoint(), b = pet.getBounds(), x = c.x - b.x, y = c.y - b.y
    if (x !== last.x || y !== last.y) pet.webContents.send('cursor', x, y) // 캐릭터 시선용
    last = { x, y }
    const over = rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    if (over !== ignoring) return
    ignoring = !over
    pet.setIgnoreMouseEvents(ignoring)
  }, 16)

  ipcMain.on('menu', () => petMenu().popup({ window: pet }))
  ipcMain.on('open-app', openApp)
  ipcMain.on('set-character', (_e, id) => setCharacter(id))
  ipcMain.on('set-size', (_e, px) => setConfig({ size: px }))
  // 앱 창 설정 탭: 노치에 가려 상단바 아이콘이 안 보일 때도 메뉴와 같은 설정을 바꾼다
  ipcMain.on('auto-close', (_e, on) => setConfig({ autoClose: !!on }))
  ipcMain.on('reset-pos', () => { placePet(); setConfig({ pos: null }) })
  ipcMain.on('quit', () => app.quit())
  ipcMain.on('ack', (_e, id, updated) => { acks.set(id, updated); broadcast('sessions', readSessions()) })
  // 대기 세션 끄기: 훅이 남긴 Claude 프로세스가 있으면 물어보고 끝낸다(SIGTERM, claude --resume으로 다시 열 수 있음).
  // 상태 파일은 어느 쪽이든 지운다. 프로세스를 남겨 둔 세션은 다음 요청 때 다시 나타난다.
  ipcMain.on('dismiss', async (_e, id) => {
    const safe = String(id).replace(/[^\w-]/g, '')
    let proc
    try { proc = JSON.parse(fs.readFileSync(path.join(SESSIONS, `${safe}.json`), 'utf8')).proc } catch {}
    // 맥 · Linux의 시작 시각은 ps 날짜 글자라 숫자가 아니다. WSL 셸에 넣는 값은 숫자만 받는다
    const pid = parseInt(proc?.pid), start = String(proc?.start ?? '')
    if (pid > 1 && (process.platform === 'win32' ? /^\d+$/.test(start) : procAlive(proc))) {
      const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['세션 끝내기', '목록에서만 지우기', '취소'], defaultId: 0, cancelId: 2,
        message: '이 Claude 세션을 끝낼까요?', detail: '터미널의 Claude가 종료돼요. 대화는 남아 있어 claude --resume으로 다시 열 수 있어요.' })
      if (response === 2) return
      if (response === 0) killProc(proc)
    }
    removeSession(safe)
    broadcast('sessions', readSessions())
  })
  ipcMain.on('connect', connect)
  setInterval(() => broadcast('connection', readConnection()), 5000)
  ipcMain.on('import-character', importCharacter)
  ipcMain.on('import-pack', importPack)
  setInterval(() => {
    const list = readSessions()
    broadcast('sessions', list)
    // 확인할 세션이 있으면 상단바 고양이 오른쪽에 별(status.js needsLook과 같은 기준). 급한 순서(status.js rank)대로
    // 답변 필요 = 노랑 깜빡임(노랑 ↔ 옅은 노랑), 실패 = 분홍, 응답 도착 = 노랑.
    // 그림 원본은 build/tray-star.svg(노랑, 채움 · 테두리 · 반짝이 색만 바꿔 만든다). 깜빡임 프레임도 폭이 같아 메뉴 막대가 흔들리지 않는다
    const st = list.filter((s) => !s.acked).map((s) => s.status)
    const look = st.includes('waiting') ? 'wait' : st.includes('error') ? 'error' : st.includes('done') ? 'done' : ''
    if (tray && look !== tray.look) {
      tray.look = look
      clearInterval(tray.blink)
      const img = (n) => tray.setImage(path.join(__dirname, 'build', n))
      if (look === 'wait') { let on = true; img('tray-done.png'); tray.blink = setInterval(() => img((on = !on) ? 'tray-done.png' : 'tray-dim.png'), 700) }
      else img(look ? `tray-${look}.png` : 'tray.png')
    }
  }, 800)
  sweepDead(); setInterval(sweepDead, 10_000)
})

app.on('window-all-closed', () => {}) // 앱 창을 닫아도 펫은 남는다
