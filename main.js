const { app, BrowserWindow, Menu, dialog, ipcMain, screen } = require('electron')
const { execFile } = require('node:child_process')
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
      return Date.now() - s.updated < STALE_MS ? [{ ...s, acked: acks.get(s.id) === s.updated }] : []
    } catch { return [] }
  })
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

function readConfig() {
  let config = { character: 'ink' }
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } } catch {}
  let entries = []
  try { entries = fs.readdirSync(CUSTOM, { withFileTypes: true }) } catch {}
  config.customs = entries.flatMap((e) => {
    const full = path.join(CUSTOM, e.name)
    if (e.isDirectory()) {
      const frames = readPack(full)
      return frames.idle ? [{ id: `pack:${e.name}`, name: e.name, frames }] : []
    }
    return /\.(png|gif|webp|jpe?g|svg)$/i.test(e.name) ? [{ id: `custom:${e.name}`, name: path.parse(e.name).name, image: dataURL(full) }] : []
  })
  return config
}

let pet, main
const broadcast = (ch, data) => [pet, main].forEach((w) => w && !w.isDestroyed() && w.webContents.send(ch, data))

function setConfig(patch) {
  fs.mkdirSync(HOME, { recursive: true })
  const { customs, ...config } = readConfig()
  fs.writeFileSync(CONFIG, JSON.stringify({ ...config, ...patch }))
  broadcast('config', readConfig())
}
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

function petMenu() {
  const { character, customs, size = 128 } = readConfig()
  const item = (id, label) => ({ label, type: 'radio', checked: character === id, click: () => setCharacter(id) })
  Menu.buildFromTemplate([
    { label: 'Claude Pet 열기', click: openApp },
    { label: '캐릭터 바꾸기', submenu: [
      ...Object.entries(BUILTIN).map(([id, n]) => item(id, n)),
      ...customs.map((c) => item(c.id, c.name)),
      { type: 'separator' }, { label: '그림 한 장 가져오기…', click: importCharacter }, { label: '캐릭터 폴더 가져오기…', click: importPack },
    ] },
    { label: '크기', submenu: Object.entries(SIZES).map(([px, label]) => ({ label, type: 'radio', checked: +px === size, click: () => setConfig({ size: +px }) })) },
    { label: '제자리로', click: () => { placePet(); setConfig({ pos: null }) } },
    { type: 'separator' },
    { label: '끄기', click: () => app.quit() },
  ]).popup({ window: pet })
}

function placePet() {
  const { workArea } = screen.getPrimaryDisplay()
  pet.setPosition(workArea.x + workArea.width - W - 12, workArea.y + workArea.height - H)
}

// 하나만 띄운다. 다시 실행하면 작업함을 연다.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => openApp())

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
  if (process.platform === 'darwin') { pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); app.dock?.hide() }
  pet.setIgnoreMouseEvents(true)
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
  setInterval(() => pet.setAlwaysOnTop(true, 'screen-saver'), 2000) // 다른 '항상 위' 창에 밀리지 않게
  setInterval(() => {
    if (dragging) return
    const c = screen.getCursorScreenPoint(), b = pet.getBounds(), x = c.x - b.x, y = c.y - b.y
    if (x !== last.x || y !== last.y) pet.webContents.send('cursor', x, y) // 캐릭터 시선용
    last = { x, y }
    const over = rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    if (over !== ignoring) return
    ignoring = !over
    pet.setIgnoreMouseEvents(ignoring)
  }, 16)

  ipcMain.on('menu', petMenu)
  ipcMain.on('open-app', openApp)
  ipcMain.on('set-character', (_e, id) => setCharacter(id))
  ipcMain.on('set-size', (_e, px) => setConfig({ size: px }))
  ipcMain.on('ack', (_e, id, updated) => { acks.set(id, updated); broadcast('sessions', readSessions()) })
  ipcMain.on('connect', connect)
  setInterval(() => broadcast('connection', readConnection()), 5000)
  ipcMain.on('import-character', importCharacter)
  ipcMain.on('import-pack', importPack)
  setInterval(() => broadcast('sessions', readSessions()), 800)
})

app.on('window-all-closed', () => {}) // 앱 창을 닫아도 펫은 남는다
