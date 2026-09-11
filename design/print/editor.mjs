// 명함 편집기. 인쇄 렌더와 똑같은 HTML·CSS 를 브라우저에 그대로 띄운다.
// 고치는 방법은 개발자도구다 — Elements 에서 <html> 을 고르면 Styles 에 :root 의 변수가 전부 보인다.
// 값에 커서를 두고 ↑↓ 로 0.1, Shift+↑↓ 로 1 씩 움직이고, 색은 스와치를 눌러 고른다.
// [저장] 을 누르면 기본값과 다른 것만 design/print/layout.json 에 남고, npm run print 가 그 값을 읽는다.
// 실행: npm run print:edit  →  http://localhost:4321
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SPEC, VARS, VARIANTS, FAMILIES, styleCss, cardBody, resolveVariant, resolveVars,
  saveOverrides, resetOverrides, ensureFonts, buildQrSvg,
} from './gen-print.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FONTS = join(HERE, 'fonts')
const PORT = Number(process.env.PORT || 4321)
const ZOOMS = [['8px', '보통'], ['12px', '확대'], ['16px', '크게'], ['3.7795px', '실제 크기']]

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

function page(variant, qrSvg) {
  const v = resolveVariant(variant)
  const base = resolveVars(v, {}) // 저장할 때 견줄 기본값 — 안(variant)까지 반영한 값이다
  const vars = resolveVars(v) // 여기에 layout.json 이 덮인 것
  const names = VARS.flatMap(([, e]) => Object.keys(e))
  const { trim, bleed, safe } = SPEC
  const mm = (n) => `calc(${n} * var(--mm))`
  const card = (side) => `
      <figure>
        <figcaption>${side === 'front' ? '앞면' : '뒷면'}</figcaption>
        <div class="card ${side}">${cardBody(side, qrSvg, v)}
          <div class="guides"><div class="g g-trim"></div><div class="g g-safe"></div></div>
        </div>
      </figure>`

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>CORELINK 명함 편집</title><style>
    ${styleCss({ unit: ZOOMS[0][0], vars, fontBase: '', families: Object.keys(FAMILIES) })}

    /* --- 여기부터는 편집기 화면용. 인쇄물에는 안 들어간다 --- */
    body { background: #2b2b30; color: #ddd; font: 13px/1.6 system-ui, 'Apple SD Gothic Neo', sans-serif; padding-bottom: 40px; }
    .bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 16px; background: #1b1b1f; border-bottom: 1px solid #000; }
    .bar label { display: flex; gap: 6px; align-items: center; color: #999; }
    button, select { font: inherit; padding: 5px 10px; background: #35353b; color: #eee; border: 1px solid #55555c; border-radius: 4px; cursor: pointer; }
    button.primary { background: #EFAD52; color: #1b1b1f; border-color: #EFAD52; font-weight: 600; }
    #status { color: #9c9; flex: 1 1 100%; margin: 0; min-height: 1.6em; white-space: pre-wrap; }
    main { display: flex; flex-wrap: wrap; gap: 28px; padding: 20px 16px; }
    figure { margin: 0; }
    figcaption { margin-bottom: 6px; color: #999; }
    .card { position: relative; width: ${mm(trim.w + bleed * 2)}; height: ${mm(trim.h + bleed * 2)}; }
    .guides { position: absolute; inset: 0; pointer-events: none; display: none; }
    body.guides-on .guides { display: block; }
    .g { position: absolute; }
    .g-trim { left: ${mm(bleed)}; top: ${mm(bleed)}; width: ${mm(trim.w)}; height: ${mm(trim.h)}; outline: 1px dashed rgba(255,90,90,.9); }
    .g-safe { left: ${mm(bleed + safe)}; top: ${mm(bleed + safe)}; width: ${mm(trim.w - safe * 2)}; height: ${mm(trim.h - safe * 2)}; outline: 1px dashed rgba(90,200,255,.7); }
    .how { margin: 0 16px; padding: 12px 16px; background: #1b1b1f; border-radius: 6px; max-width: 900px; }
    .how kbd { background: #35353b; border: 1px solid #55555c; border-radius: 3px; padding: 0 4px; }
    details { margin: 16px; max-width: 900px; }
    summary { cursor: pointer; color: #999; }
    .legend { margin-top: 10px; background: #1b1b1f; border-radius: 6px; padding: 12px 16px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
    .legend b { color: #EFAD52; font-weight: 600; }
  </style></head><body class="guides-on">
    <header class="bar">
      <button id="save" class="primary">저장</button>
      <button id="diff">바뀐 값 보기</button>
      <button id="reset">전부 기본값으로</button>
      <label>안 <select id="variant">${Object.entries(VARIANTS)
        .map(([k, o]) => `<option value="${k}"${k === variant ? ' selected' : ''}>${o.tag || '-'} ${esc(o.label)}</option>`).join('')}</select></label>
      <label>배율 <select id="zoom">${ZOOMS.map(([px, l], i) => `<option value="${px}"${i ? '' : ' selected'}>${l}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="guides" checked> 가이드(재단선·안전영역)</label>
      <p id="status"></p>
    </header>

    <main>${card('front')}${card('back')}</main>

    <p class="how">개발자도구를 열고(<kbd>F12</kbd>) Elements 에서 맨 위 <kbd>&lt;html&gt;</kbd> 을 고르면
      오른쪽 Styles 에 <kbd>:root</kbd> 의 변수가 전부 나옵니다. 숫자에 커서를 두고 <kbd>↑</kbd><kbd>↓</kbd> 로 0.1,
      <kbd>Shift</kbd>+<kbd>↑</kbd><kbd>↓</kbd> 로 1 씩 움직입니다. 다 됐으면 [저장] 을 누르세요.
      <br>저장되는 건 <kbd>:root</kbd> 의 변수뿐입니다 — 요소의 스타일을 직접 고치면 화면에만 보이고 저장되지 않습니다.
      바꾸고 싶은 값이 변수에 없으면 말씀해 주세요.</p>

    <details><summary>변수 목록 (${names.length}개)</summary><div class="legend">${VARS.map(([g, e]) =>
      `<b>${esc(g)}</b>\n` + Object.keys(e).map((k) => `  ${k.padEnd(22)} ${esc(vars[k])}`).join('\n')).join('\n\n')}</div></details>

    <script>
      const NAMES = ${JSON.stringify(names)}
      const BASE = ${JSON.stringify(base)}
      const $ = (id) => document.getElementById(id) // status 는 window.status 와 겹쳐 전역으로 잡히지 않는다
      const norm = (s) => String(s).trim().replace(/\\s+/g, ' ')

      // 계산된 값(getComputedStyle)이 아니라 :root 규칙에 적힌 원문을 읽는다.
      // 계산값은 var(--c-accent) 같은 참조를 색 리터럴로 바꿔 놓기 때문에, 그대로 저장하면 참조가 끊긴다.
      // 개발자도구가 고치는 것도 바로 이 규칙이라 화면에서 본 그대로가 저장된다.
      const rootRule = () => {
        for (const sheet of document.styleSheets) {
          let rules
          try { rules = sheet.cssRules } catch (e) { continue }
          for (const r of rules) if (r.selectorText === ':root') return r
        }
        throw new Error(':root 규칙을 못 찾았다')
      }
      const changed = () => {
        const st = rootRule().style
        const out = {}
        for (const n of NAMES) {
          const val = st.getPropertyValue(n).trim()
          if (val && norm(val) !== norm(BASE[n])) out[n] = val // 지워진 값은 기본값으로 본다
        }
        return out
      }
      const list = (d) => Object.entries(d).map(([k, val]) => k + ': ' + val + '  (기본 ' + BASE[k] + ')').join('\\n')

      $('diff').onclick = () => {
        const d = changed()
        $('status').textContent = Object.keys(d).length
          ? '바뀐 값 ' + Object.keys(d).length + '개\\n' + list(d)
          : '바뀐 값 없음 — 전부 기본값입니다.'
      }
      $('save').onclick = async () => {
        const d = changed()
        const res = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })
        const j = await res.json()
        $('status').textContent = j.count
          ? '저장했습니다 — ' + j.count + '개.\\n' + list(d) + '\\n이제 npm run print 가 이 값으로 뽑습니다.'
          : '기본값 그대로라 layout.json 을 비웠습니다.'
      }
      $('reset').onclick = async () => {
        if (!confirm('저장해 둔 값을 전부 지우고 기본값으로 되돌립니다.')) return
        await fetch('/reset', { method: 'POST' })
        location.reload()
      }
      $('variant').onchange = (e) => { location.search = '?v=' + e.target.value }
      $('zoom').onchange = (e) => document.documentElement.style.setProperty('--mm', e.target.value)
      $('guides').onchange = (e) => document.body.classList.toggle('guides-on', e.target.checked)
    </script>
  </body></html>`
}

const body = (req) => new Promise((ok) => {
  let s = ''
  req.on('data', (c) => { s += c })
  req.on('end', () => ok(s))
})

await ensureFonts(Object.keys(FAMILIES)) // 후보 폰트까지 전부 — 편집 중에 바로 바꿔 볼 수 있게
const qrSvg = await buildQrSvg()

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (req.method === 'POST' && url.pathname === '/save') {
      const changed = JSON.parse(await body(req))
      saveOverrides(changed)
      console.log(`저장: ${Object.keys(changed).length}개 → design/print/layout.json`)
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ count: Object.keys(changed).length }))
    }
    if (req.method === 'POST' && url.pathname === '/reset') {
      resetOverrides()
      console.log('기본값으로 되돌림 (layout.json 삭제)')
      return res.writeHead(200).end('ok')
    }
    if (url.pathname.startsWith('/fonts/')) {
      const file = join(FONTS, url.pathname.slice(7))
      if (!existsSync(file)) return res.writeHead(404).end()
      return res.writeHead(200, { 'content-type': 'font/ttf', 'cache-control': 'max-age=3600' }).end(readFileSync(file))
    }
    const html = page(url.searchParams.get('v') || 'none', qrSvg)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html)
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(e.stack || e))
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`명함 편집기: http://localhost:${PORT}`)
  console.log('개발자도구 Elements → <html> → Styles 의 :root 를 고치고 [저장] 을 누른다.')
  console.log('저장한 값은 design/print/layout.json 에 남고 npm run print 가 그대로 읽는다. 끝내려면 Ctrl+C.')
})
