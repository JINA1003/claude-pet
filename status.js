// 펫 창과 앱 창이 함께 쓰는 상태 정의
window.STATUS = {
  waiting: { rank: 0, label: '답변 필요', detail: '세션에서 답하거나 승인해 주세요.' },
  error: { rank: 1, label: '실패', detail: '세션에서 원인을 확인해 주세요.' },
  done: { rank: 2, label: '응답 도착', detail: '응답이 왔어요. 테스트·배포까지 끝났다는 뜻은 아니에요.' },
  working: { rank: 3, label: '진행 중', detail: '작업하고 있어요.' },
  idle: { rank: 4, label: '대기 중', detail: '다음 요청을 기다리고 있어요.' },
}
// 확인한 응답·실패는 대기 중으로 내려간다(세션은 그대로 남는다)
window.viewStatus = (s) => (s.acked && ['done', 'error', 'waiting'].includes(s.status) ? 'idle' : s.status)
window.needsLook = (s) => ['waiting', 'error', 'done'].includes(viewStatus(s))
window.bySeverity = (a, b) => STATUS[viewStatus(a)].rank - STATUS[viewStatus(b)].rank || b.updated - a.updated

window.ago = (t, now = Date.now()) => {
  const m = Math.floor((now - t) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`
}
// 목록의 상태 줄: 응답 본문이 아니라 지금 상태를 적는다
window.statusLine = (s) => {
  const v = viewStatus(s)
  if (v === 'working') return s.line || '작업 이어가는 중'
  if (v === 'waiting') return s.hint ? `승인 대상 ${s.hint}` : s.line
  if (v === 'error') return s.line
  return ''
}
window.metaText = (s) => {
  const v = viewStatus(s)
  if (v === 'working') {
    const m = Math.floor((Date.now() - (s.started || s.updated)) / 60000)
    return m < 1 ? '방금 시작' : `${m}분째 진행`
  }
  if (v === 'done') return ago(s.updated)
  return v === 'idle' ? ago(s.updated) : STATUS[v].label
}

// 상태 아이콘(펫·앱 공통). <svg><use href="#i-waiting"/></svg>
document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-waiting" viewBox="0 0 20 20"><path d="M10 2.5v15M3.5 6.25l13 7.5M3.5 13.75l13-7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></symbol>
  <symbol id="i-working" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2.2"/><path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></symbol>
  <symbol id="i-done" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="currentColor"/><path d="m6.3 10.2 2.5 2.5 5-5.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-error" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="currentColor"/><path d="M10 5.8v5M10 13.9v.2" stroke="#fff" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-idle" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 6.5V10l2.4 1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-star" viewBox="0 0 20 20"><path d="M10 1.5c.7 4.6 2.9 7.1 8.5 8.5-5.6 1.4-7.8 3.9-8.5 8.5-.7-4.6-2.9-7.1-8.5-8.5 5.6-1.4 7.8-3.9 8.5-8.5Z" fill="currentColor"/></symbol>
  <symbol id="i-close" viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
  <symbol id="i-open" viewBox="0 0 20 20"><path d="M7 13 13 7M8 7h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-check" viewBox="0 0 20 20"><path d="m5 10.5 3.2 3.2L15 6.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
</svg>`)
window.star = () => `<svg class="star" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5c.7 4.6 2.9 7.1 8.5 8.5-5.6 1.4-7.8 3.9-8.5 8.5-.7-4.6-2.9-7.1-8.5-8.5 5.6-1.4 7.8-3.9 8.5-8.5Z" fill="currentColor"/></svg>`
// 실제 작업 위치(마지막으로 고친 파일의 프로젝트). 세션을 연 폴더와 다르면 그것도 알려 준다.
window.placeOf = (s) => s.workdir || s.project
window.fromOf = (s) => (s.workdir && s.workdir !== s.project ? `${s.project}에서` : '')
window.icon = (name, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`
window.esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
