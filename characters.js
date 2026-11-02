// 기본 캐릭터. 몸통만 다르고 표정·소품·효과는 공통이다.
window.CHARACTERS = {
  ink: { name: '먹물', fill: '#26232a', eye: '#f4f1ec', cheek: '#f08a6c',
    body: 'M38 10c17 0 28 13 28 32v20c0 4-3 6-6 6H16c-3 0-6-2-6-6V42c0-19 11-32 28-32Z' },
  mochi: { name: '모찌', fill: '#f1e6d2', eye: '#2b2622', cheek: '#f2a38c', stroke: '#d9c8aa',
    body: 'M14 31 16 12l12 10q10-3 20 0l12-10 2 19q4 7 4 15v16c0 4-3 6-6 6H16c-3 0-6-2-6-6V46q0-8 4-15Z' },
  sprout: { name: '새싹', fill: '#4f8f62', eye: '#f6fbf4', cheek: '#f3a48f',
    body: 'M38 18c16 0 28 11 28 28v16c0 4-3 6-6 6H16c-3 0-6-2-6-6V46c0-17 12-28 28-28Z',
    extra: 'M38 18c0-7 4-12 12-13-1 8-5 12-12 13Zm0 0c-1-6-4-9-10-10 0 6 4 9 10 10Z', extraFill: '#86c08f' },
  tin: { name: '깡통', fill: '#6f7c8b', eye: '#e8f2ff', cheek: '#f39a86',
    body: 'M18 22h40a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8Z',
    extra: 'M37 12h2v10h-2ZM38 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z', extraFill: '#9aa6b4' },
}

// 표정: 상태에 따라 CSS가 하나만 보여 준다(open=평소, wide=답변 필요, happy=응답·인사, closed=잠, x=실패)
const face = (c) => `
  <g class="face open"><g class="eyes"><ellipse class="eye" cx="30" cy="40" rx="3.2" ry="5" fill="${c.eye}"/><ellipse class="eye" cx="46" cy="40" rx="3.2" ry="5" fill="${c.eye}"/></g></g>
  <g class="face wide"><g class="eyes"><circle cx="30" cy="40" r="4.6" fill="${c.eye}"/><circle cx="46" cy="40" r="4.6" fill="${c.eye}"/></g></g>
  <g class="face happy" fill="none" stroke="${c.eye}" stroke-width="2.6" stroke-linecap="round"><path d="M26 42q4-6 8 0M42 42q4-6 8 0"/></g>
  <g class="face closed" fill="none" stroke="${c.eye}" stroke-width="2.4" stroke-linecap="round"><path d="M26 41q4 3 8 0M42 41q4 3 8 0"/></g>
  <g class="face x" stroke="${c.eye}" stroke-width="2.4" stroke-linecap="round"><path d="m27 37 6 6m0-6-6 6M43 37l6 6m0-6-6 6"/></g>
  <ellipse cx="24" cy="48" rx="3" ry="1.8" fill="${c.cheek}" opacity=".75"/><ellipse cx="52" cy="48" rx="3" ry="1.8" fill="${c.cheek}" opacity=".75"/>`

// 캐릭터 → 마크업. 그림 한 장이면 { image }, 캐릭터 폴더면 { frames: { idle: [...], working: [...] } }
window.PACKS = {}
window.petMarkup = (c) => {
  if (c.frames) { PACKS[c.id] = c.frames; return `<img class="frame" data-pack="${esc(c.id)}" alt="" draggable="false">` }
  const figure = c.image
    ? `<image href="${c.image}" x="4" y="4" width="68" height="68" preserveAspectRatio="xMidYMax meet"/>`
    : `<path d="${c.body}" fill="${c.fill}" ${c.stroke ? `stroke="${c.stroke}" stroke-width="1.5"` : ''}/>
       ${c.extra ? `<path d="${c.extra}" fill="${c.extraFill}"/>` : ''}${face(c)}
       <g class="laptop"><path d="M20 53h30l4 12H24Z" fill="#c9c3ba"/><path class="glow" d="M33 57h8l1 3h-8Z"/></g>`
  return `<svg viewBox="0 0 76 76" aria-hidden="true">${figure}</svg>`
}

window.pickCharacter = (config) =>
  window.CHARACTERS[config.character] || config.customs?.find((c) => c.id === config.character) || window.CHARACTERS.ink

// 캐릭터 폴더: 펫 상태 → 그림 이름. 없으면 idle로.
const FRAME_STATE = { idle: 'idle', working: 'working', waiting: 'attention', done: 'result', error: 'failed', none: 'dormant' }
const FRAME_MS = { working: 420, waiting: 380, done: 520, error: 320, greet: 280, idle: 1800, none: 2400 }
let frameAt = 0, frameIndex = 0
window.paintFrames = (now = performance.now()) => document.querySelectorAll('img.frame').forEach((img) => {
  const frames = PACKS[img.dataset.pack] || {}
  const pet = img.closest('.pet')?.dataset || {}
  let list
  if (pet.greet && frames.greeting) list = frames.greeting
  // 커서가 가까우면 쳐다본다(잠들어 있어도 깬다). 답변 필요·실패 동작은 가리지 않는다.
  else if (pet.look && frames.look?.length === 16 && !['waiting', 'error'].includes(pet.pet)) list = [frames.look[+pet.look]]
  else list = frames[FRAME_STATE[pet.pet]] || (pet.pet === 'waiting' && frames.waiting) || frames.idle || []
  if (now - frameAt > (FRAME_MS[pet.greet ? 'greet' : pet.pet] || 500)) { frameAt = now; frameIndex++ }
  const src = list[frameIndex % list.length]
  if (src && img.getAttribute('src') !== src) img.setAttribute('src', src)
})
const loop = (t) => { paintFrames(t); requestAnimationFrame(loop) }
requestAnimationFrame(loop)
