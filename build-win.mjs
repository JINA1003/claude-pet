// Windows exe 빌드. Linux(WSL)에서는 electron-builder가 exe 아이콘을 못 바꾸므로(wine 필요)
// 풀린 앱을 먼저 만들고 rcedit(Windows 실행 파일)로 아이콘·이름을 넣은 뒤 portable로 묶는다.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const RCEDIT = 'build/rcedit-x64.exe'
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

if (!fs.existsSync(RCEDIT)) {
  const res = await fetch('https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe')
  if (!res.ok) throw new Error(`rcedit 내려받기 실패: ${res.status}`)
  fs.writeFileSync(RCEDIT, Buffer.from(await res.arrayBuffer()))
}

fs.rmSync('dist', { recursive: true, force: true })
run('npx', ['electron-builder', '--win', 'dir', '--x64'])
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const icon = fs.existsSync('build/icon.ico') ? ['--set-icon', 'build/icon.ico'] : []
run(RCEDIT, ['dist/win-unpacked/Claude Pet.exe', ...icon,
  '--set-version-string', 'ProductName', 'Claude Pet', '--set-version-string', 'FileDescription', 'Claude Pet',
  '--set-file-version', version, '--set-product-version', version])
run('npx', ['electron-builder', '--win', 'portable', '--x64', '--prepackaged', 'dist/win-unpacked'])
