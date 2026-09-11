// 인쇄용 명함(앞/뒤) 생성기.
// 콘텐츠는 src/data/profile.ts, 아이콘은 src/icons.ts, 색은 앱 다크 테마와 같은 값을 쓴다.
// 실행: npm run print  →  design/print/out/ 에 4K 시안 · 600dpi PNG · PDF · QR · 인쇄 사양서 · zip 이 생긴다.
// 배치를 바꾸려면 front()/back(), 규격을 바꾸려면 SPEC, 인쇄 전용 문구는 PRINT 를 고친다.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import QRCode from 'qrcode'
import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'
import jsQR from 'jsqr'
import { profile } from '../../src/data/profile.ts'
import { icon } from '../../src/icons.ts'
import { SPEC, CARD, SHOP } from './spec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FONTS = join(HERE, 'fonts')
const OUT = join(HERE, 'out')
const MOCKUP_FRONT = join(HERE, '..', '..', 'externals', '명함 디자인 시안_앞_260902.png')
const MOCKUP_BACK = join(HERE, '..', '..', 'externals', '명함 디자인 시안_뒤_260902.png')

/* 규격(mm). 재단 90×50, 작업 92×52(도련 1mm), 안전 영역 4mm. */
/* 규격은 design/print/spec.mjs 한 곳에서 온다 — CARD(내 명함 값)와 SHOP(인쇄소 요구값)이 거기 나뉘어 있다. */
export { SPEC, CARD, SHOP }

/* 인쇄에만 쓰는 문구. 나머지는 전부 profile.ts 에서 온다. */
const PRINT = {
  title: 'Founder & Content Director', // 시안 표기. 앱(profile.title)은 '|' 구분
  tagline: ['PEOPLE', 'CONTENT', 'MARKETING'],
  services: profile.services.slice(0, 3), // 시안대로 앞 3개만
  // 시안 실측: 테두리 12mm(높이의 25%), 테두리 선 0.18mm, 테두리-흰판 간격 0.7mm, 흰판은 코드로 거의 꽉 참.
  // 에러 정정 L 이면 버전 3(29모듈)이라 9.3mm 에서 모듈 0.32mm. 흰 여백은 1.5모듈(스캔 최소치). M 으로 올리면 33모듈 0.28mm.
  qr: { size: 9.3, ec: 'L', quiet: .48, gap: .7, border: .18 },

  // 방송 협업 이력. 넣는 자리는 variant 로 고른다 — `npm run print:samples` 로 안을 전부 뽑아 비교한다.
  broadcasts: ['나는 SOLO', '솔로지옥'],
  broadcastLabel: '방송 협업',
  broadcastOn: 'users', // caption 안에서 이 아이콘을 쓰는 서비스 줄 아래에 붙는다
  variant: 'none',
}

/* 방송 이력 배치안. 패키지는 빌드마다 out/<태그_라벨>/ 에 따로 쌓여 여러 안이 공존한다.
   none    기본 디자인 (넣지 않음) → out/기본/
   caption 서비스 '방송 출연자 협업' 줄 아래 골드 캡션
   headline 직함 밑 골드 바 아래 한 줄
   chip    상단 빈 자리에 테두리 배지 2개
   credit  뒷면 왼쪽 아래 크레딧 한 줄
   front   뒷면은 그대로 두고 앞면 태그라인 아래에 표기
   tag 는 파일명·재단선 라벨에 붙어 인쇄소에서 다른 안과 섞이지 않게 한다.
   앞면 안과 뒷면 안은 'caption+front' 처럼 + 로 겹쳐 쓸 수 있다. */
export const VARIANTS = {
  none: { side: 'back', tag: '', label: '기본', where: '없음' },
  caption: { side: 'back', tag: 'A', label: '서비스 줄 캡션', where: '뒷면 서비스 줄 아래' },
  headline: { side: 'back', tag: 'B', label: '직함 아래 한 줄', where: '뒷면 직함 아래' },
  chip: { side: 'back', tag: 'C', label: '상단 배지', where: '뒷면 상단 QR 옆' },
  credit: { side: 'back', tag: 'D', label: '하단 크레딧', where: '뒷면 왼쪽 아래' },
  front: { side: 'front', tag: 'E', label: '앞면 표기', where: '앞면 태그라인 아래' },
  // H~N: externals/나는솔로_솔로지옥.png 의 로고타입 표기. 이 안들은 모두 우하단 골드 곡선을 지운다.
  cornerClean: { side: 'back', tag: 'H', label: '우하단 은색', where: '뒷면 오른쪽 아래, 골드 곡선 없음' },
  cornerGold: { side: 'back', tag: 'I', label: '우하단 골드 글자', where: '뒷면 오른쪽 아래, 골드 곡선 없음, 글자는 골드' },
  markLarge: { side: 'back', tag: 'K', label: '우하단 크게', where: '뒷면 오른쪽 아래, 글자 1.25배' },
  markCenter: { side: 'back', tag: 'L', label: '하단 중앙', where: '뒷면 아래 가운데' },
  markRule: { side: 'back', tag: 'M', label: '우하단 골드 라인', where: '뒷면 오른쪽 아래, 위에 골드 가는 선' },
  markContact: { side: 'back', tag: 'N', label: '연락처 열 정렬', where: '뒷면 연락처 열 아래, 왼쪽 정렬' },
}

/* 로고타입 표기 안의 배치 값. top 은 글자 윗선(mm), size 는 글자 크기(mm), align 은 right | center | contact(연락처 열 왼쪽에 맞춤).
   글자 아래끝이 안전 영역(46mm) 안에 들도록 top 을 잡는다. */
const MARK = {
  cornerClean: { top: 44.2 },
  cornerGold: { top: 44.2, gold: true },
  markLarge: { top: 43.4, size: 3.4 },
  markCenter: { top: 44.2, align: 'center' },
  markRule: { top: 44.2, rule: true },
  markContact: { top: 44.2, align: 'contact' },
}

/** 'caption' 또는 'caption+front' 를 해석한다. 같은 면에 두 안을 겹치면 서로 침범하므로 막는다. */
export function resolveVariant(spec) {
  const keys = String(spec).split('+').map((s) => s.trim()).filter((s) => s && s !== 'none')
  const bad = keys.find((k) => !VARIANTS[k])
  if (bad) throw new Error(`모르는 안: ${bad} (가능: ${Object.keys(VARIANTS).join(', ')})`)
  for (const side of ['front', 'back']) {
    const dup = keys.filter((k) => VARIANTS[k].side === side)
    if (dup.length > 1) throw new Error(`${side === 'front' ? '앞면' : '뒷면'} 안은 하나만 고를 수 있다: ${dup.join(', ')}`)
  }
  const picked = keys.map((k) => VARIANTS[k])
  return {
    keys,
    picked,
    has: (k) => keys.includes(k),
    backKey: keys.find((k) => VARIANTS[k].side === 'back'),
    tag: picked.map((p) => p.tag).join('+'),
    label: picked.map((p) => p.label).join(' + '),
  }
}
const buildName = (v) => (v.tag ? `${v.tag}_${v.label.replace(/ \+ /g, '+').replace(/ /g, '_')}` : '기본')

/* 시안(externals/명함 디자인 시안_앞·뒤_260902.png)에서 샘플링한 색. 앱보다 골드가 따뜻하고 흰색이 순백에 가깝다. */
const C = {
  bg: '#0B0B0C', bgEdge: '#181818', text: '#FAFAFA', textSoft: '#F2F2F2',
  accent: '#EFAD52', accentDeep: '#D49D4E', accentStrong: '#F7C66C',
  qrPanel: '#F7F6F4', qrModule: '#111111',
}

const GF = 'https://github.com/google/fonts/raw/main/ofl/'
const W4 = { 300: 'Light', 400: 'Regular', 500: 'Medium', 700: 'Bold' }
const statics = (dir, base, map = W4) =>
  Object.entries(map).map(([w, n]) => [`${base}-${n}.ttf`, w, `${GF}${dir}/${base}-${n}.ttf`])

/* 폰트. core 3종은 기본 디자인이 쓰고, 나머지는 --f-* 로 바꿔 볼 후보다.
   가변 폰트는 얼굴 하나가 굵기 전 구간을 덮고, 고정 폰트는 굵기별 파일을 따로 받는다(300·400·500·700 만).
   faces: [파일명, font-weight, 내려받을 주소]. 전부 SIL OFL 이라 인쇄물에 써도 된다. */
export const FAMILIES = {
  Pretendard: { core: true, faces: [['PretendardVariable.ttf', '45 920', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/variable/PretendardVariable.ttf']] },
  Montserrat: { core: true, faces: [['Montserrat.ttf', '100 900', `${GF}montserrat/Montserrat%5Bwght%5D.ttf`]] },
  // 우하단 로고타입 표기의 영문(SOLO)용 굵은 세리프
  'Playfair Display': { core: true, faces: [['PlayfairDisplay.ttf', '400 900', `${GF}playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf`]] },
  'Noto Sans KR': { faces: [['NotoSansKR.ttf', '100 900', `${GF}notosanskr/NotoSansKR%5Bwght%5D.ttf`]] },
  'IBM Plex Sans KR': { faces: statics('ibmplexsanskr', 'IBMPlexSansKR') },
  'Gothic A1': { faces: statics('gothica1', 'GothicA1') },
  Inter: { faces: [['Inter.ttf', '100 900', `${GF}inter/Inter%5Bopsz,wght%5D.ttf`]] },
  Poppins: { faces: statics('poppins', 'Poppins') },
  Raleway: { faces: [['Raleway.ttf', '100 900', `${GF}raleway/Raleway%5Bwght%5D.ttf`]] },
  'Cormorant Garamond': { faces: [['CormorantGaramond.ttf', '300 700', `${GF}cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf`]] },
  Cinzel: { faces: [['Cinzel.ttf', '400 900', `${GF}cinzel/Cinzel%5Bwght%5D.ttf`]] },
  Marcellus: { faces: [['Marcellus.ttf', '400', `${GF}marcellus/Marcellus-Regular.ttf`]] },
}
const CORE = Object.keys(FAMILIES).filter((n) => FAMILIES[n].core)

/* 손으로 만질 수 있는 값 전부. 이 표가 :root 의 CSS 변수로 나가고, 컴포넌트는 리터럴 대신 var() 만 쓴다.
   `npm run print:edit` 에서 브라우저 개발자도구로 :root 를 고친 뒤 저장하면 바뀐 값만
   design/print/layout.json 에 남고, 인쇄 렌더가 같은 값을 읽는다 — 화면과 인쇄물이 값 하나를 본다.
   단위: 표시 없는 수는 mm, track 은 em, weight 는 font-weight, size 가 em 인 것은 이름 옆에 적어 뒀다. */
const VARS = [
  ['색', {
    '--c-bg': C.bg, '--c-bg-edge': C.bgEdge, '--c-text': C.text, '--c-text-soft': C.textSoft,
    '--c-accent': C.accent, '--c-accent-deep': C.accentDeep, '--c-accent-strong': C.accentStrong,
    '--c-qr-panel': C.qrPanel, '--c-qr-module': C.qrModule,
  }],
  ['폰트 · kr=이름·서비스·연락처, logo=COR≡LINK, tag=태그라인, serif=로고타입의 영문 (이름은 FAMILIES 참고. 공백이 들면 따옴표)', {
    '--f-kr': 'Pretendard', '--f-logo': 'Montserrat', '--f-tag': 'Montserrat', '--f-serif': "'Playfair Display'",
  }],
  ['바탕 그라데이션', {
    '--vig-front': 'radial-gradient(ellipse 80% 95% at 50% 45%, var(--c-bg) 28%, var(--c-bg-edge) 100%)',
    '--vig-back': 'radial-gradient(ellipse 60% 55% at 22% 25%, #121212, var(--c-bg) 100%)',
  }],
  ['앞면 · 로고', {
    '--logo-y': '16.1', '--logo-size': '6', '--logo-weight': '560', '--logo-track': '.17',
    '--logo-scale-x': '1.06', '--logo-e-w': '.58', '--logo-e-h': '.7', '--logo-e-color': 'var(--c-accent)',
  }],
  ['앞면 · 골드 라인 (시안에서 떼어 온 그림이라 크기는 배율로만)', { '--line-y': '28', '--line-scale': '1' }],
  ['앞면 · 태그라인', {
    '--tag-y': '33.2', '--tag-size': '2.2', '--tag-weight': '400', '--tag-track': '.32',
    '--tag-color': 'var(--c-text-soft)', '--tag-x-size': '.85', '--tag-x-gap': '.9',
  }],
  ['앞면 · 방송 표기 (E안)', { '--fb-label-y': '38.4', '--fb-names-y': '41.8', '--fb-names-size': '2.5', '--fb-sep-gap': '.7' }],
  ['뒷면 · 이름', {
    '--name-x': '6', '--name-y': '6', '--name-size': '5.8', '--name-weight': '600',
    '--name-track': '.1', '--name-color': 'var(--c-text)',
  }],
  ['뒷면 · 직함', {
    '--title-x': '6', '--title-y': '13.4', '--title-size': '2.6', '--title-weight': '500',
    '--title-track': '.01', '--title-color': 'var(--c-accent)',
  }],
  ['뒷면 · 골드 바', { '--bar-x': '6', '--bar-y': '18', '--bar-w': '9', '--bar-h': '.4' }],
  ['뒷면 · 서비스 목록', {
    '--svc-x': '6', '--svc-y': '24.2', '--svc-y-cap': '23.6', '--svc-icon': '3.4', '--svc-row-h': '5.15',
    '--svc-size': '2.2', '--svc-weight': '500', '--svc-track': '.02', '--svc-gap': '2.4',
    '--svc-cap-row-h': '6.4', '--svc-cap-gap': '1.05', '--svc-sub-size': '1.95',
  }],
  ['뒷면 · 세로 구분선', { '--div-x': '36.6', '--div-y': '25.4', '--div-w': '.35', '--div-h': '13.1' }],
  ['뒷면 · 연락처', {
    '--ct-x': '45.5', '--ct-y': '24.3', '--ct-icon': '3.2', '--ct-row-h': '5.15',
    '--ct-size': '2.2', '--ct-weight': '500', '--ct-track': '.02', '--ct-gap': '2.4',
  }],
  ['뒷면 · QR (right·cy 는 오른쪽 끝과 세로 중심)', {
    '--qr-right': '6', '--qr-cy': '12.2', '--qr-size': '4.65', '--qr-quiet': '.24', '--qr-gap': '.35', '--qr-border': '.18',
  }],
  ['뒷면 · 우하단 곡선 (시안에서 떼어 온 그림)', { '--fan-scale': '1' }],
  ['방송 표기 A~D안 · 모양', {
    '--bcast-size': '2.2', '--bcast-gap': '1.7', '--bcast-sep-w': '.25', '--bcast-sep-h': '2.4',
    '--bcast-label-size': '1.85', '--bcast-label-track': '.16',
    '--chip-size': '2', '--chip-gap': '1.4', '--chip-pad-y': '.8', '--chip-pad-x': '1.7', '--chip-border': '.18', '--chip-radius': '2',
  }],
  ['방송 표기 A~D안 · 자리', {
    '--bcast-headline-x': '6', '--bcast-headline-y': '19.6',
    '--bcast-chip-x': '41.5', '--bcast-chip-label-y': '7', '--bcast-chip-y': '10.2',
    '--bcast-credit-x': '6', '--bcast-credit-rule-y': '42.4', '--bcast-credit-rule-w': '6', '--bcast-credit-rule-h': '.3', '--bcast-credit-y': '43.6',
  }],
  ['로고타입 표기 H~N · 자리 (좌우 정렬은 안으로 고른다)', {
    '--mark-top': '42.2', '--mark-size': '2.8', '--mark-right': '6', '--mark-color': '#D0D0D0',
    '--mark-rule-gap': '2.6', '--mark-rule-h': '.25',
  }],
  ['로고타입 표기 H~N · 조판 (참고 이미지 실측값. 바꾸면 참고본과 멀어진다. size 는 em)', {
    '--mark-head-weight': '240', '--mark-head-track': '.0225',
    '--mark-lat-size': '1.255', '--mark-lat-weight': '600', '--mark-lat-track': '.0163',
    '--mark-solo-size': '1.05', '--mark-solo-weight': '210', '--mark-solo-track': '.1175',
    '--mark-gap1': '.7125', '--mark-gap2': '.8125',
    '--mark-bar-w': '.0322', '--mark-bar-h': '.775', '--mark-bar-drop': '.0675', '--mark-width': '10.71',
  }],
]
export { VARS }

const LAYOUT = join(HERE, 'layout.json')
const loadOverrides = () => (existsSync(LAYOUT) ? JSON.parse(readFileSync(LAYOUT, 'utf8')) : {})
export const saveOverrides = (o) => writeFileSync(LAYOUT, JSON.stringify(o, null, 2) + '\n')
export const resetOverrides = () => rmSync(LAYOUT, { force: true })
const varDefaults = () => Object.assign({}, ...VARS.map(([, e]) => e))

/** 기본값 → 안별 기본값(로고타입 표기의 자리·색) → layout.json 순으로 덮는다. */
export function resolveVars(v, overrides = loadOverrides()) {
  const m = MARK[v?.backKey]
  return {
    ...varDefaults(),
    ...(!m ? {} : {
      '--mark-top': String(m.top),
      ...(m.size ? { '--mark-size': String(m.size) } : {}),
      ...(m.gold ? { '--mark-color': 'var(--c-accent)' } : {}),
    }),
    ...overrides,
  }
}

const familyOf = (val) => String(val).replace(/^['"]|['"]$/g, '').split(',')[0].trim()
/** 렌더에 실제로 쓰이는 폰트 — core 3종 + --f-* 가 가리키는 것. 이것만 내려받으면 된다. */
export const familiesInUse = (vars) =>
  [...new Set([...CORE, ...['--f-kr', '--f-logo', '--f-tag', '--f-serif'].map((k) => familyOf(vars[k]))])].filter((n) => FAMILIES[n])

const mm = (n) => `calc((${n}) * var(--mm))`
const em = (v) => `calc(var(${v}) * 1em)`
const today = () => {
  const d = new Date()
  return [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('')
}

export async function ensureFonts(families = CORE) {
  mkdirSync(FONTS, { recursive: true })
  for (const name of families) {
    for (const [file, , url] of FAMILIES[name]?.faces ?? []) {
      const path = join(FONTS, file)
      if (existsSync(path)) continue
      console.log(`폰트 내려받기: ${file}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${file} 다운로드 실패 (${res.status})`)
      writeFileSync(path, Buffer.from(await res.arrayBuffer()))
    }
  }
}

/* ---------- 부품 ---------- */

/* 로고. 시안 실측: I 획/캡 높이 = 15.5%, 글자 폭/캡 높이가 Montserrat 보다 평균 9% 넓어 가로 6% 를 늘려 맞춘다
   (AI 생성 시안이라 실제 폰트보다 넓게 그려져 있음). 시안 글자는 외곽이 부드러워 실측보다 굵어 보이므로 굵기 560. 자간 .17em, E 폭은 캡 높이의 .83. */
const logo = () =>
  `<div class="logo">COR<svg viewBox="0 0 116 140" class="logo-e"><rect width="116" height="22" y="0"/><rect width="116" height="22" y="59"/><rect width="116" height="22" y="118"/></svg>LINK</div>`

/* 시안 원본에서 빛 효과(라인·곡선)를 그대로 떼어 오는 래스터 추출.
   손으로 그리면 원본과 달라지는 부분이라, 해당 영역 픽셀의 밝기를 알파로 바꿔 투명 PNG 로 만든다.
   - 배경(검정 위 합성값)은 열마다 위쪽 가장자리 행 평균과 아래쪽 가장자리 행 평균을 세로로 보간해 빼서
     질감·비네팅이 딸려 오지 않게 한다. 영역은 빛 효과가 가장자리 행까지 닿지 않게 잡아야 한다
   - 빛 = 픽셀 − 배경. 알파 = 빛의 밝기 / 200, 색 = 빛 × (200 / 밝기). 이렇게 하면 검정 위에 합성했을 때
     배경 + 빛 이 그대로 복원되고(가산 합성), 어두운 픽셀에서도 색이 클램핑으로 튀지 않아 선이 매끈하다
   - dilate 를 주면 3×3 이웃 최대 알파의 55% 로 살짝 굵힌다 — 인쇄에서 헤어라인이 끊기지 않게
   반환값의 w/h 는 mm(축척 scale 을 곱한 값). */
const overlayCache = new Map()
function extractOverlay(file, { x0, y0, x1, y1, scale, dilate = false, edgeRows = 6, floor = 6 }) {
  const L_REF = 200 // 이 밝기부터 알파 1. 골드는 R 이 밝기의 1.25배라 200 이어야 색이 255 를 넘지 않는다
  const key = `${file}:${x0},${y0},${x1},${y1}`
  if (overlayCache.has(key)) return overlayCache.get(key)
  const img = PNG.sync.read(readFileSync(file))
  x1 ??= img.width; y1 ??= img.height
  const W = x1 - x0, H = y1 - y0
  const at = (x, y) => ((y0 + y) * img.width + x0 + x) * 4
  const lumAt = (i) => img.data[i] * .3 + img.data[i + 1] * .59 + img.data[i + 2] * .11
  const bgTop = new Float32Array(W), bgBot = new Float32Array(W)
  for (let x = 0; x < W; x++) {
    let t = 0, b = 0
    for (let k = 0; k < edgeRows; k++) { t += lumAt(at(x, k)); b += lumAt(at(x, H - 1 - k)) }
    bgTop[x] = t / edgeRows; bgBot[x] = b / edgeRows
  }
  const bgAt = (x, y) => bgTop[x] + (bgBot[x] - bgTop[x]) * y / (H - 1)
  const light = new Float32Array(W * H) // 배경을 뺀 밝기
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = lumAt(at(x, y)) - bgAt(x, y)
    light[y * W + x] = l < floor ? 0 : l
  }
  const alphaOf = (l) => Math.min(1, l / L_REF)
  const out = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sx = x, sy = y, a = alphaOf(light[y * W + x])
    if (dilate) {
      let m = 0, mx = x, my = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue
        if (light[yy * W + xx] > m) { m = light[yy * W + xx]; mx = xx; my = yy }
      }
      if (alphaOf(m) * .55 > a) { a = alphaOf(m) * .55; sx = mx; sy = my }
    }
    const o = (y * W + x) * 4
    if (a <= .01) { out.data.fill(0, o, o + 4); continue }
    const src = at(sx, sy), l = light[sy * W + sx], b = bgAt(sx, sy)
    const gain = l >= L_REF ? 1 : L_REF / l
    for (let k = 0; k < 3; k++) out.data[o + k] = Math.min(255, Math.max(0, Math.round((img.data[src + k] - b) * gain + (l >= L_REF ? 11 : 0))))
    out.data[o + 3] = Math.round(a * 255)
  }
  const res = { dataUrl: `data:image/png;base64,${PNG.sync.write(out).toString('base64')}`, w: W * scale, h: H * scale, px: { w: W, h: H } }
  overlayCache.set(key, res)
  return res
}

/* 앞면 골드 라인. 시안 실측: 라인 중심이 높이의 53.6%(475/887), 심 3px, 점 5개가 가로 22.5/35.1/49.0/62.7/77.1% 에 있고
   글로우가 위아래 ±30px 까지 미친다. 양끝은 2~20% / 80~95% 구간에서 서서히 사라진다.
   이 모든 것을 시안 원본의 라인 띠(가로 전체 × 세로 475±60px, 배경 추정용 여유 포함)를 그대로 옮겨 재현한다.
   가로 축척 = 90mm/1774px ≈ 500dpi. */
function lineOverlay() {
  const LINE_ROW = 475, HALF = 60
  return { ...extractOverlay(MOCKUP_FRONT, { x0: 0, y0: LINE_ROW - HALF, x1: 1774, y1: LINE_ROW + HALF + 1, scale: SPEC.trim.w / 1774 }), lineOffset: HALF * SPEC.trim.w / 1774 }
}

/* 뒷면 우하단 골드 곡선. 시안 원본(MOCKUP_BACK)에서 세로 구분선(x≤838)과 QR 프레임(y≤573) 바깥 영역을 떼어 온다.
   축척은 시안(1895×777)과 명함(90×50) 가로·세로 비율의 기하평균, 약 460dpi. */
function fanOverlay() {
  return extractOverlay(MOCKUP_BACK, { x0: 850, y0: 582, scale: Math.sqrt((SPEC.trim.w / 1895) * (SPEC.trim.h / 777)), floor: 3 })
}

const row = (name, text, iconVar) =>
  `<div class="row"><span class="ico" style="width: ${mm(`var(${iconVar})`)}; height: ${mm(`var(${iconVar})`)}">${icon(name, 24, 1.5)}</span><span>${text}</span></div>`

/* 방송 이력 조각들. 각 안이 카드의 어느 빈 자리를 쓰는지는 VARS 의 '방송 표기 A~D안 · 자리' 에 있다. */
const names = () => PRINT.broadcasts.join(' · ')
const labelWithNames = (topVar, leftVar) =>
  `<div class="bcast" style="left: ${mm(`var(${leftVar})`)}; top: ${mm(`var(${topVar})`)}">
     <span class="bcast-label">${PRINT.broadcastLabel}</span><span class="bcast-sep"></span><span>${names()}</span>
   </div>`

/* 로고타입 표기를 그린다. 영문이 든 이름은 한글 라이트 + 영문 세리프, 영문이 없는 이름은 자간을 넓힌다.
   한글과 영문 사이 공백은 붙인다('나는 SOLO' → '나는SOLO').
   조판 값은 전부 --mark-* 변수이고, 참고 이미지(externals/나는솔로_솔로지옥.png)를 수평으로 편 뒤
   낱덩어리 잉크 치수를 재서 맞춘 것이다(잔여 오차 최대 2.2%p). 전부 em 이라 --mark-size 하나만
   바꾸면 비율이 유지되고, 총 잉크폭은 --mark-size 의 --mark-width 배가 된다. */
function cornerMark({ align = 'right', rule = false }) {
  const item = (name) => {
    const tight = name.replace(/\s+(?=[A-Za-z])|(?<=[A-Za-z])\s+/g, '')
    if (!/[A-Za-z]/.test(tight)) return `<span class="mark-solo">${tight}</span>`
    return tight.replace(/[A-Za-z]+/g, (m) => `<span class="mark-lat">${m}</span>`)
  }
  const sep = `<span style="display: inline-block; width: ${em('--mark-gap1')}"></span>`
    + `<span class="mark-bar"></span>`
    + `<span style="display: inline-block; width: ${em('--mark-gap2')}"></span>`
  const pos = {
    right: `right: ${mm('var(--mark-right)')}`,
    center: `left: 0; right: 0; justify-content: center`,
    contact: `left: ${mm('var(--ct-x)')}`,
  }[align]
  const line = !rule ? '' : `<div style="position: absolute; right: ${mm('var(--mark-right)')}; top: ${mm('var(--mark-top) - var(--mark-rule-gap)')}; width: ${mm('var(--mark-width) * var(--mark-size)')}; height: ${mm('var(--mark-rule-h)')}; background: var(--c-accent-deep)"></div>`
  return `${line}<div class="mark" style="${pos}">${PRINT.broadcasts.map(item).join(sep)}</div>`
}

/* 서비스 목록. caption 안에서는 방송 줄만 두 줄이 되어 목록이 1.4mm 길어진다. */
function servicesList(v) {
  const cap = v.has('caption')
  const items = PRINT.services.map((s) => {
    if (!cap || s.icon !== PRINT.broadcastOn) return row(s.icon, s.label, '--svc-icon')
    return `<div class="row" style="height: ${mm('var(--svc-cap-row-h)')}">
      <span class="ico" style="width: ${mm('var(--svc-icon)')}; height: ${mm('var(--svc-icon)')}">${icon(s.icon, 24, 1.5)}</span>
      <span style="display: flex; flex-direction: column; gap: ${mm('var(--svc-cap-gap)')}"><span>${s.label}</span><span class="sub">${names()}</span></span>
    </div>`
  }).join('')
  return `<div class="list list-svc" style="left: ${mm('var(--svc-x)')}; top: ${mm(`var(${cap ? '--svc-y-cap' : '--svc-y'})`)}">${items}</div>`
}

function front(v) {
  const x = `<span class="x">×</span>`
  const line = lineOverlay()
  // 앞면 표기: 태그라인 아래 빈 자리. 라벨과 이름을 두 줄로 가운데 맞춤.
  const bcast = !v.has('front') ? '' : `
      <div class="bcast-label" style="position: absolute; left: 0; right: 0; top: ${mm('var(--fb-label-y)')}; text-align: center">${PRINT.broadcastLabel}</div>
      <div class="fb-names" style="top: ${mm('var(--fb-names-y)')}">${PRINT.broadcasts.join(`<span class="x" style="margin: 0 ${em('--fb-sep-gap')}">·</span>`)}</div>`
  // 라인은 시안에서 떼어 온 그림이라 크기를 배율로만 바꾼다. lineOffset 은 그림 위끝에서 라인 중심까지.
  return `
    <div class="trim">
      <div style="position: absolute; left: 0; right: 0; top: ${mm('var(--logo-y)')}; text-align: center">${logo()}</div>
      <img src="${line.dataUrl}" style="position: absolute; left: 0; top: ${mm(`var(--line-y) - ${line.lineOffset} * var(--line-scale)`)}; width: ${mm(`${line.w} * var(--line-scale)`)}; height: ${mm(`${line.h} * var(--line-scale)`)}; display: block">
      <div class="tagline" style="top: ${mm('var(--tag-y)')}">${PRINT.tagline.join(x)}</div>
      ${bcast}
    </div>`
}

function back(qrSvg, v) {
  const fan = fanOverlay()

  // headline: 골드 바와 서비스 목록 사이
  // chip: 직함이 끝나는 x=41 부터 QR 이 시작하는 x=72.9 사이의 빈 자리
  // credit: 서비스 목록이 끝나는 41.1mm 아래, 곡선이 닿지 않는 왼쪽
  const bcast = {
    headline: labelWithNames('--bcast-headline-y', '--bcast-headline-x'),
    chip: `<div class="bcast-label" style="position: absolute; left: ${mm('var(--bcast-chip-x)')}; top: ${mm('var(--bcast-chip-label-y)')}">${PRINT.broadcastLabel}</div>
      <div class="chips" style="left: ${mm('var(--bcast-chip-x)')}; top: ${mm('var(--bcast-chip-y)')}">${PRINT.broadcasts.map((b) => `<span class="chip">${b}</span>`).join('')}</div>`,
    credit: `<div style="position: absolute; left: ${mm('var(--bcast-credit-x)')}; top: ${mm('var(--bcast-credit-rule-y)')}; width: ${mm('var(--bcast-credit-rule-w)')}; height: ${mm('var(--bcast-credit-rule-h)')}; background: var(--c-accent)"></div>
      ${labelWithNames('--bcast-credit-y', '--bcast-credit-x')}`, // 글자 아래끝 45.8mm — 안전 영역(46mm) 안
  }[v.backKey] ?? (MARK[v.backKey] ? cornerMark(MARK[v.backKey]) : '')

  // 로고타입 표기 안(H~N)은 우하단 골드 곡선을 지운다 — 참고 이미지처럼 여백 위에 글자만 둔다
  const fanImg = MARK[v.backKey] ? '' :
    `<img src="${fan.dataUrl}" style="position: absolute; right: 0; bottom: 0; width: ${mm(`${fan.w} * var(--fan-scale)`)}; height: ${mm(`${fan.h} * var(--fan-scale)`)}; display: block">`

  return `
    ${fanImg}
    <div class="trim">
      ${bcast}
      <div class="name" style="left: ${mm('var(--name-x)')}; top: ${mm('var(--name-y)')}">${profile.name}</div>
      <div class="title" style="left: ${mm('var(--title-x)')}; top: ${mm('var(--title-y)')}">${PRINT.title}</div>
      <div style="position: absolute; left: ${mm('var(--bar-x)')}; top: ${mm('var(--bar-y)')}; width: ${mm('var(--bar-w)')}; height: ${mm('var(--bar-h)')}; background: linear-gradient(90deg, var(--c-accent-strong), var(--c-accent))"></div>

      ${servicesList(v)}

      <!-- 그라데이션에 transparent 를 쓰면 Chrome PDF 출력에서 색이 깨진다(분홍으로 나옴). 배경색으로 페이드한다. -->
      <div style="position: absolute; left: ${mm('var(--div-x)')}; top: ${mm('var(--div-y)')}; width: ${mm('var(--div-w)')}; height: ${mm('var(--div-h)')}; background: linear-gradient(180deg, var(--c-bg), var(--c-accent-deep) 18%, var(--c-accent-deep) 82%, var(--c-bg))"></div>

      <div class="list list-ct" style="left: ${mm('var(--ct-x)')}; top: ${mm('var(--ct-y)')}">
        ${row('phone', profile.phone, '--ct-icon')}
        ${row('mail', profile.email, '--ct-icon')}
      </div>

      <div class="qr-frame"></div>
      <div class="qr-panel"><div class="qr-code">${qrSvg}</div></div>
    </div>`
}

/* ---------- 페이지 ---------- */

/** :root 블록. VARS 순서와 그룹 주석을 그대로 내보내 개발자도구에서 찾아보기 쉽게 한다.
    --mm 과 --qr-*-size 는 파생값이라 저장 대상에서 뺀다. */
function rootCss(vars, unit) {
  const groups = VARS.map(([g, e]) =>
    `      /* ${g} */\n` + Object.keys(e).map((k) => `      ${k}: ${vars[k]};`).join('\n')).join('\n\n')
  return `:root {
      --mm: ${unit};

${groups}

      /* 파생값 — 이건 두고 위의 --qr-* 를 고친다 */
      --qr-panel-size: calc(var(--qr-size) + var(--qr-quiet) * 2);
      --qr-frame-size: calc(var(--qr-panel-size) + (var(--qr-gap) + var(--qr-border)) * 2);
    }`
}

/** 파일이 있는 얼굴만 @font-face 로 낸다 — 후보 폰트를 안 받았어도 렌더가 깨지지 않게. */
const fontFaceCss = (base, families) => families
  .flatMap((n) => (FAMILIES[n]?.faces ?? []).filter(([f]) => existsSync(join(FONTS, f)))
    .map(([f, w]) => `@font-face { font-family: '${n}'; src: url('${base}/fonts/${f}'); font-weight: ${w}; }`))
  .join('\n    ')

/** 카드 스타일 전체(페이지 바깥 틀은 뺀다). 앞·뒤가 한 문서에 같이 떠도 되게 면별 값은 클래스로 가른다. */
export function styleCss({ unit, vars, fontBase = 'https://print.local', families = familiesInUse(vars) }) {
  const { trim, bleed } = SPEC
  return `${fontFaceCss(fontBase, families)}
    ${rootCss(vars, unit)}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    /* 시안: 앞면은 가운데가 어둡고 가장자리로 갈수록 밝아진다. 뒷면은 거의 평탄. */
    .card { position: absolute; overflow: hidden; color: var(--c-text); font-family: var(--f-kr), sans-serif; }
    .card.front { background: var(--vig-front); }
    .card.back { background: var(--vig-back); }
    .trim { position: absolute; left: ${mm(bleed)}; top: ${mm(bleed)}; width: ${mm(trim.w)}; height: ${mm(trim.h)}; }
    .logo { font-family: var(--f-logo); font-weight: var(--logo-weight); font-size: ${mm('var(--logo-size)')}; letter-spacing: ${em('--logo-track')}; text-indent: ${em('--logo-track')}; line-height: 1; color: var(--c-text); white-space: nowrap; transform: scaleX(var(--logo-scale-x)); transform-origin: 50% 50%; }
    .logo-e { display: inline-block; width: ${em('--logo-e-w')}; height: ${em('--logo-e-h')}; vertical-align: baseline; margin-right: ${em('--logo-track')}; fill: var(--logo-e-color); }
    .tagline { position: absolute; left: 0; right: 0; text-align: center; font-family: var(--f-tag); font-weight: var(--tag-weight); font-size: ${mm('var(--tag-size)')}; letter-spacing: ${em('--tag-track')}; text-indent: ${em('--tag-track')}; line-height: 1; color: var(--tag-color); white-space: nowrap; }
    .tagline .x { color: var(--c-accent); font-size: ${em('--tag-x-size')}; margin: 0 ${em('--tag-x-gap')}; letter-spacing: 0; }
    .fb-names { position: absolute; left: 0; right: 0; text-align: center; font-size: ${mm('var(--fb-names-size)')}; font-weight: 500; line-height: 1; color: var(--c-text); white-space: nowrap; }
    .name { position: absolute; font-weight: var(--name-weight); font-size: ${mm('var(--name-size)')}; letter-spacing: ${em('--name-track')}; line-height: 1; color: var(--name-color); }
    .title { position: absolute; font-weight: var(--title-weight); font-size: ${mm('var(--title-size)')}; letter-spacing: ${em('--title-track')}; line-height: 1; color: var(--title-color); }
    .list { position: absolute; display: flex; flex-direction: column; }
    .row { display: flex; align-items: center; line-height: 1; white-space: nowrap; color: var(--c-text); }
    .list-svc .row { gap: ${mm('var(--svc-gap)')}; height: ${mm('var(--svc-row-h)')}; font-weight: var(--svc-weight); font-size: ${mm('var(--svc-size)')}; letter-spacing: ${em('--svc-track')}; }
    .list-ct .row { gap: ${mm('var(--ct-gap)')}; height: ${mm('var(--ct-row-h)')}; font-weight: var(--ct-weight); font-size: ${mm('var(--ct-size)')}; letter-spacing: ${em('--ct-track')}; }
    .ico { flex: 0 0 auto; display: block; color: var(--c-text); }
    .ico svg { width: 100%; height: 100%; display: block; }
    .sub { font-size: ${mm('var(--svc-sub-size)')}; font-weight: 500; letter-spacing: ${em('--svc-track')}; color: var(--c-accent); }
    /* 테두리와 흰 판은 서로 겹치지 않는 형제다. border 굵기는 브라우저가 정수 픽셀로 내림하므로
       테두리를 크기에 더하는 방식으로 짜면 --qr-border 를 바꿔도 바깥 치수가 따라오지 않는다.
       둘 다 오른쪽 끝(--qr-right)과 세로 중심(--qr-cy)에 각각 맞춘다. */
    .qr-frame { position: absolute; right: ${mm('var(--qr-right)')}; top: ${mm('var(--qr-cy) - var(--qr-frame-size) / 2')}; width: ${mm('var(--qr-frame-size)')}; height: ${mm('var(--qr-frame-size)')}; border: ${mm('var(--qr-border)')} solid var(--c-accent); }
    .qr-panel { position: absolute; right: ${mm('var(--qr-right) + var(--qr-border) + var(--qr-gap)')}; top: ${mm('var(--qr-cy) - var(--qr-panel-size) / 2')}; width: ${mm('var(--qr-panel-size)')}; height: ${mm('var(--qr-panel-size)')}; background: var(--c-qr-panel); display: flex; align-items: center; justify-content: center; }
    .qr-code { width: ${mm('var(--qr-size)')}; height: ${mm('var(--qr-size)')}; color: var(--c-qr-module); }
    .bcast { position: absolute; display: flex; align-items: center; gap: ${mm('var(--bcast-gap)')}; font-size: ${mm('var(--bcast-size)')}; font-weight: 500; line-height: 1; color: var(--c-text); white-space: nowrap; }
    .bcast-sep { width: ${mm('var(--bcast-sep-w)')}; height: ${mm('var(--bcast-sep-h)')}; background: var(--c-accent-deep); }
    .bcast-label { font-size: ${mm('var(--bcast-label-size)')}; font-weight: 600; letter-spacing: ${em('--bcast-label-track')}; text-indent: ${em('--bcast-label-track')}; line-height: 1; color: var(--c-accent); white-space: nowrap; }
    .chips { position: absolute; display: flex; gap: ${mm('var(--chip-gap)')}; }
    .chip { border: ${mm('var(--chip-border)')} solid var(--c-accent-deep); border-radius: ${mm('var(--chip-radius)')}; padding: ${mm('var(--chip-pad-y)')} ${mm('var(--chip-pad-x)')}; font-size: ${mm('var(--chip-size)')}; font-weight: 500; line-height: 1; color: var(--c-text); white-space: nowrap; }
    .mark { position: absolute; display: inline-flex; align-items: baseline; line-height: 1; white-space: nowrap; top: ${mm('var(--mark-top)')}; font-size: ${mm('var(--mark-size)')}; color: var(--mark-color); font-weight: var(--mark-head-weight); letter-spacing: ${em('--mark-head-track')}; }
    /* 자간은 마지막 글자 뒤에도 붙는다. 음수 여백으로 그만큼 되돌려야 오른쪽 끝이 QR 과 맞는다. */
    .mark-lat { font-family: var(--f-serif), serif; font-weight: var(--mark-lat-weight); font-size: ${em('--mark-lat-size')}; letter-spacing: ${em('--mark-lat-track')}; margin-right: calc(var(--mark-lat-track) * -1em); }
    .mark-solo { font-weight: var(--mark-solo-weight); font-size: ${em('--mark-solo-size')}; letter-spacing: ${em('--mark-solo-track')}; margin-right: calc(var(--mark-solo-track) * -1em); }
    .mark-bar { display: inline-block; width: ${em('--mark-bar-w')}; height: ${em('--mark-bar-h')}; background: currentColor; transform: translateY(${em('--mark-bar-drop')}); }`
}

/** 카드 한 면의 내용. 편집기가 앞·뒤를 한 문서에 나란히 놓을 때도 이걸 쓴다. */
export const cardBody = (side, qrSvg, v) => (side === 'front' ? front(v) : back(qrSvg, v))

/** unit: '10px'(래스터) 또는 '1mm'(PDF). marks 가 true 면 재단선 여백을 두른다. */
export function pageHtml({ side, unit, marks, qrSvg, variant = PRINT.variant, vars }) {
  const v = resolveVariant(variant)
  vars ??= resolveVars(v)
  const { trim, bleed, marksMargin } = SPEC
  const bw = trim.w + bleed * 2
  const bh = trim.h + bleed * 2
  const m = marks ? marksMargin : 0
  const pw = bw + m * 2
  const ph = bh + m * 2

  const cropMarks = () => {
    const x0 = m + bleed, x1 = m + bleed + trim.w
    const y0 = m + bleed, y1 = m + bleed + trim.h
    const L = [
      ...[y0, y1].flatMap((y) => [[m - 5, y, m - 1, y], [m + bw + 1, y, m + bw + 5, y]]),
      ...[x0, x1].flatMap((x) => [[x, m - 5, x, m - 1], [x, m + bh + 1, x, m + bh + 5]]),
    ].map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join('')
    const label = `CORELINK 명함 · ${side === 'front' ? '앞면' : '뒷면'}${v.tag ? ` · ${v.tag}안 ${v.label}` : ''} · 재단 ${trim.w}×${trim.h}mm · 도련 ${bleed}mm 포함 ${bw}×${bh}mm · ${today()}`
    return `<svg viewBox="0 0 ${pw} ${ph}" style="position: absolute; inset: 0; width: 100%; height: 100%" stroke="#000" stroke-width=".1">${L}
      <text x="${pw / 2}" y="3.6" text-anchor="middle" font-family="Pretendard" font-size="1.8" fill="#555" stroke="none">${label}</text></svg>`
  }

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    ${styleCss({ unit, vars })}
    html, body { background: #fff; }
    @page { size: ${pw}mm ${ph}mm; margin: 0; }
    .page { position: relative; width: ${mm(pw)}; height: ${mm(ph)}; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .card { left: ${mm(m)}; top: ${mm(m)}; width: ${mm(bw)}; height: ${mm(bh)}; }
  </style></head><body>
    <div class="page">
      <div class="card ${side}">${cardBody(side, qrSvg, v)}</div>
      ${marks ? cropMarks() : ''}
    </div>
  </body></html>`
}

/* ---------- 출력 ---------- */

/** PNG 에 pHYs(해상도) 청크를 심어 인쇄소 소프트웨어가 물리 크기를 읽게 한다. */
function withDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254)
  const data = Buffer.alloc(9)
  data.writeUInt32BE(ppm, 0); data.writeUInt32BE(ppm, 4); data[8] = 1
  const type = Buffer.from('pHYs')
  const chunk = Buffer.concat([Buffer.alloc(4), type, data, Buffer.alloc(4)])
  chunk.writeUInt32BE(9, 0)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 17)
  const ihdrEnd = 8 + 4 + 4 + 13 + 4 // 시그니처 + IHDR 청크
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)])
}

function decodeQr(pngBuffer, region) {
  const img = PNG.sync.read(pngBuffer)
  const { x, y, w, h } = region
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(img, out, x, y, w, h, 0, 0)
  const r = jsQR(new Uint8ClampedArray(out.data), w, h)
  return r?.data ?? null
}

/* ---------- 인쇄소 접수 규격 (docs/인쇄소_작업파일_가이드) ---------- */

/* 가이드가 요구하는 것: 색상모드 CMYK(별색 금지) · 서체 전부 아웃라인 · 작업 92×52 재단 90×50 ·
   안전영역은 재단에서 3~4mm 안 · 그림자·그라데이션·투명도를 쓴 부분은 300dpi 이상 CMYK 로 래스터화 ·
   이미지는 링크가 아니라 포함 · 재단선과 작업선을 그려 넣지 않음 · 접수 파일은 AI 또는 EPS.
   이 카드는 배경 그라데이션과 시안에서 떼어 온 반투명 그림이 화면 전체를 덮어서, 가이드대로 하면
   결국 전면 래스터화다. 그래서 600dpi CMYK 래스터를 EPS 한 장으로 감싸 접수용으로 낸다.
   글자도 화소가 되므로 아웃라인 요구는 저절로 충족된다. */

/* 리치 블랙. 넓은 검정을 K 단색으로 찍으면 회색빛으로 뜬다. 어두운 곳에만 CMY 를 깔아 준다.
   밝기 max(R,G,B) 가 full 이하면 그대로 리치 블랙, upTo 이상이면 손대지 않고, 사이는 선형으로 섞는다.
   시안 배경 #0B0B0C 는 밝기 .047 이라 정확히 C60 M40 Y40 K100 이 된다. */
const RICH = { c: .60, m: .40, y: .40, full: .05, upTo: .22 } // 합 240% — 아래 TAC 상한 안

/* 총 잉크량(TAC) 상한. 가이드: CMYK 합이 250% 를 넘으면 뒷묻음 사고가 나도 재작업이 안 된다.
   K100 은 자동 오버프린트라 밑색이 비쳐 보일 수 있어서, 검정에는 CMY 를 조금이라도 섞어 둔다
   (리치 블랙이 이미 C60 M40 Y40 이라 해당 없음). */
const TAC = SHOP.tac

/* QR 모듈 한 칸의 인쇄 권장 최소 치수(mm). 이보다 작으면 잉크 번짐과 카메라 해상도에 걸린다.
   빌드를 막지는 않는다 — 크기를 줄이는 건 디자인 선택이라 숫자만 알려 준다. */
const QR_MIN_MODULE = .25

/** RGB PNG → CMYK 8bit 버퍼. kOnly 사각형 안에서는 리치 블랙을 쓰지 않는다 —
    0.32mm 짜리 QR 모듈을 4도로 찍으면 판이 조금만 어긋나도 가장자리가 흐려진다.
    잉크 합이 상한을 넘으면 K 는 두고 CMY 만 비례로 줄인다 — 어두움은 지키고 잉크만 덜어낸다. */
function toCmyk(png, kOnly = []) {
  const out = Buffer.alloc(png.width * png.height * 4)
  const plainK = (x, y) => kOnly.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  let clamped = 0, maxTac = 0, flatK = 0
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4
    const R = png.data[i] / 255, G = png.data[i + 1] / 255, B = png.data[i + 2] / 255
    const m = Math.max(R, G, B)
    let C = m ? (m - R) / m : 0, M = m ? (m - G) / m : 0, Y = m ? (m - B) / m : 0, K = 1 - m
    const f = plainK(x, y) ? 0 : Math.min(1, Math.max(0, (RICH.upTo - m) / (RICH.upTo - RICH.full)))
    if (f > 0) { C += (RICH.c - C) * f; M += (RICH.m - M) * f; Y += (RICH.y - Y) * f; K += (1 - K) * f }
    if ((C + M + Y + K) * 100 > TAC) {
      const cmy = C + M + Y
      const scale = cmy > 0 ? Math.max(0, TAC / 100 - K) / cmy : 0
      C *= scale; M *= scale; Y *= scale
      clamped++
    }
    maxTac = Math.max(maxTac, (C + M + Y + K) * 100)
    if (K > .995 && C + M + Y < .005) flatK++ // K100 단색은 자동 오버프린트 대상
    out[i] = Math.round(C * 255); out[i + 1] = Math.round(M * 255)
    out[i + 2] = Math.round(Y * 255); out[i + 3] = Math.round(K * 255)
  }
  return { buf: out, clamped, maxTac, flatK }
}

const cmykAt = (buf, w, x, y) => [0, 1, 2, 3].map((k) => Math.round(buf[(y * w + x) * 4 + k] / 2.55))

/** ASCII85. PostScript 의 ASCII85Decode 가 읽는 형식. 7비트 텍스트라 옮기다 깨질 일이 없다. */
function ascii85(buf) {
  const lines = []
  let line = ''
  for (let i = 0; i < buf.length; i += 4) {
    const n = Math.min(4, buf.length - i)
    let v = 0
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? buf[i + k] : 0)
    const c = []
    for (let k = 0; k < 5; k++) { c.unshift(33 + (v % 85)); v = Math.floor(v / 85) }
    for (let k = 0; k <= n; k++) {
      line += String.fromCharCode(c[k])
      if (line.length >= 75) { lines.push(line); line = '' }
    }
  }
  lines.push(line + '~>')
  return lines.join('\n')
}

function unAscii85(s) {
  const t = s.replace(/\s/g, '').replace(/~>$/, '')
  const out = Buffer.alloc(Math.ceil(t.length / 5) * 4)
  let p = 0
  for (let i = 0; i < t.length; i += 5) {
    const n = Math.min(5, t.length - i)
    let v = 0
    for (let k = 0; k < 5; k++) v = v * 85 + ((k < n ? t.charCodeAt(i + k) : 117) - 33)
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    for (let k = 0; k < n - 1; k++) out[p++] = b[k]
  }
  return out.subarray(0, p)
}

/** 이미지 한 장짜리 EPS(Adobe EPSF-3.0). 화소는 Flate 로 줄이고 ASCII85 로 싣는다. */
function epsFromCmyk({ cmyk, w, h, wMm, hMm, title }) {
  const pt = (n) => +(n / 25.4 * 72).toFixed(3)
  const [wpt, hpt] = [pt(wMm), pt(hMm)]
  const data = ascii85(deflateSync(cmyk, { level: 9 }))
  return `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: corelink-mobile design/print/gen-print.mjs
%%Title: ${title}
%%CreationDate: ${new Date().toISOString()}
%%BoundingBox: 0 0 ${Math.ceil(wpt)} ${Math.ceil(hpt)}
%%HiResBoundingBox: 0 0 ${wpt} ${hpt}
%%LanguageLevel: 3
%%DocumentProcessColors: Cyan Magenta Yellow Black
%%DocumentData: Clean7Bit
%%Pages: 1
%%EndComments
%%Page: 1 1
gsave
0 0 translate
${wpt} ${hpt} scale
/DeviceCMYK setcolorspace
<<
  /ImageType 1
  /Width ${w}
  /Height ${h}
  /BitsPerComponent 8
  /Decode [0 1 0 1 0 1 0 1]
  /ImageMatrix [${w} 0 0 -${h} 0 ${h}]
  /DataSource currentfile /ASCII85Decode filter /FlateDecode filter
>>
image
${data}
grestore
showpage
%%EOF
`
}

/** CMYK 래스터를 그대로 담은 PDF. 가이드의 PDF 접수 규격 — 작업사이즈 도큐멘트, 1p 앞·2p 뒤.
    Chrome 이 낸 PDF 는 페이지 크기를 0.34mm 단위로 끊어 92×52mm 를 못 맞추고 색도 RGB 라,
    이 파일만 직접 쓴다. MediaBox 와 DeviceCMYK 를 우리가 정확히 적는다. */
function pdfFromCmyk(pages, { wMm, hMm, title }) {
  const pt = (n) => +(n / 25.4 * 72).toFixed(4)
  const [W, H] = [pt(wMm), pt(hMm)]
  const chunks = []
  const offsets = []
  let len = 0
  const put = (s) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'); chunks.push(b); len += b.length }
  const obj = (n, body, stream) => {
    offsets[n] = len
    put(`${n} 0 obj\n${body}\n`)
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n') }
    put('endobj\n')
  }
  // 1 카탈로그, 2 페이지 트리, 페이지마다 [페이지, 이미지, 내용] 3개씩
  const pageId = (i) => 3 + i * 3
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((p, i) => {
    const [id, img, content] = [pageId(i), pageId(i) + 1, pageId(i) + 2]
    const data = deflateSync(p.cmyk, { level: 9 })
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /TrimBox [0 0 ${W} ${H}]`
      + ` /Resources << /XObject << /Im0 ${img} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${content} 0 R >>`)
    obj(img, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceCMYK`
      + ` /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`, data)
    obj(content, `<< /Length ${draw.length} >>`, draw)
  })
  const info = 4 + pages.length * 3
  obj(info, `<< /Title (${title.replace(/[()\\]/g, '')}) /Producer (corelink-mobile gen-print.mjs) >>`)
  const xref = len
  const n = info + 1
  put(`xref\n0 ${n}\n0000000000 65535 f \n`)
  for (let i = 1; i < n; i++) put(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${n} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(chunks)
}

/** 위에서 쓴 PDF 를 도로 읽어 페이지·크기·색공간·화소가 그대로인지 본다. */
function checkCmykPdf(buf, pages, wMm, hMm) {
  const s = buf.toString('latin1')
  const pt = (n) => +(n / 25.4 * 72).toFixed(4)
  const boxes = [...s.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [+m[1], +m[2]])
  const cs = (s.match(/\/ColorSpace \/DeviceCMYK/g) || []).length
  const bad = []
  if (boxes.length !== pages.length) bad.push(`페이지 ${boxes.length}`)
  if (!boxes.every(([w, h]) => w === pt(wMm) && h === pt(hMm))) bad.push('페이지 크기')
  if (cs !== pages.length) bad.push('색공간')
  // 이미지 스트림을 순서대로 뽑아 원본과 대조
  const streams = [...s.matchAll(/\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)]
  streams.forEach((m, i) => {
    const start = m.index + m[0].length
    const got = inflateSync(buf.subarray(start, start + Number(m[1])))
    if (!pages[i] || !got.equals(pages[i].cmyk)) bad.push(`${i + 1}p 화소`)
  })
  if (streams.length !== pages.length) bad.push(`이미지 ${streams.length}`)
  return bad
}

/** EPS 에 실은 화소를 도로 풀어낸다. 여기엔 EPS 를 열어 볼 프로그램이 없으니 적어도
    데이터가 온전한지는 확인하고 넘긴다(PostScript 문법 자체는 확인하지 못한다). */
function epsPixels(text) {
  const start = text.indexOf('\nimage\n') + 7
  const end = text.indexOf('\ngrestore')
  if (start < 7 || end < 0) return null
  return inflateSync(unAscii85(text.slice(start, end)))
}

/** CMYK → RGBA. 검사용 근사식이다(색 관리 없이 잉크를 곱하기만 한다). */
function cmykToRgba(cmyk, w, h, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4)
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = ((r.y + y) * w + r.x + x) * 4, o = (y * r.w + x) * 4
    const k = 1 - cmyk[i + 3] / 255
    for (let c = 0; c < 3; c++) out[o + c] = 255 * (1 - cmyk[i + c] / 255) * k
    out[o + 3] = 255
  }
  return out
}

/** 폰트는 라우트로 먹이고, 나머지 요청은 전부 이 페이지 HTML 로 응답한다. */
async function openPage(context, html) {
  const page = await context.newPage()
  await page.route('https://print.local/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/fonts/')) {
      const file = join(FONTS, url.pathname.slice(7))
      if (!existsSync(file)) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ body: readFileSync(file), contentType: 'font/ttf' })
    }
    return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' })
  })
  await page.goto('https://print.local/card.html', { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  return page
}

const PX = 10 // 래스터 모드: 1mm = 10 CSS px

/** 재단 크기만 잘라 previewWidth 픽셀 폭으로 뽑는다. */
async function render4k(browser, { side, qrSvg, variant, vars }) {
  const { trim, bleed, previewWidth } = SPEC
  const ctx = await browser.newContext({
    viewport: { width: (trim.w + bleed * 2) * PX, height: (trim.h + bleed * 2) * PX },
    deviceScaleFactor: previewWidth / (trim.w * PX),
  })
  const page = await openPage(ctx, pageHtml({ side, unit: `${PX}px`, marks: false, qrSvg, variant, vars }))
  const png = await page.screenshot({ clip: { x: bleed * PX, y: bleed * PX, width: trim.w * PX, height: trim.h * PX } })
  await ctx.close()
  return withDpi(png, previewWidth / trim.w * 25.4)
}

/** 앞·뒤를 한 PDF 로. 인쇄소 규정대로 앞면이 1페이지(대지 1), 뒷면이 2페이지(대지 2). */
function spreadHtml({ unit, qrSvg, variant = PRINT.variant, vars }) {
  const v = resolveVariant(variant)
  vars ??= resolveVars(v)
  const { trim, bleed } = SPEC
  const bw = trim.w + bleed * 2
  const bh = trim.h + bleed * 2
  const sheet = (side) => `<div class="page"><div class="card ${side}">${cardBody(side, qrSvg, v)}</div></div>`
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    ${styleCss({ unit, vars })}
    html, body { background: #fff; }
    @page { size: ${bw}mm ${bh}mm; margin: 0; }
    .page { position: relative; width: ${mm(bw)}; height: ${mm(bh)}; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page + .page { break-before: page; }
    .card { left: 0; top: 0; width: ${mm(bw)}; height: ${mm(bh)}; }
  </style></head><body>${sheet('front')}${sheet('back')}</body></html>`
}

/** PDF 의 페이지 수와 페이지 크기(pt). Chrome 이 낸 PDF 는 카탈로그가 압축되지 않아 그대로 읽힌다. */
function pdfInfo(buf) {
  const s = buf.toString('latin1')
  const count = s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/)?.[1]
  const box = s.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  return {
    pages: count ? Number(count) : (s.match(/\/Type\s*\/Page[^s]/g) || []).length,
    size: box ? [+(box[3] - box[1]).toFixed(2), +(box[4] - box[2]).toFixed(2)] : null,
  }
}

export async function buildQrSvg() {
  const svg = await QRCode.toString(profile.siteUrl, {
    type: 'svg', margin: 0, errorCorrectionLevel: PRINT.qr.ec, color: { dark: '#000000', light: '#0000' },
  })
  return svg.replace(/(stroke|fill)="#000000"/g, '$1="currentColor"')
    .replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')
}

/** 방송 이력 배치안을 전부 4K 로 뽑는다. 인쇄 패키지와 섞이지 않게 out/ 밖에 따로 쌓는다. */
async function samples() {
  await ensureFonts(familiesInUse(resolveVars()))
  const dir = join(HERE, 'samples')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const qrSvg = await buildQrSvg()
  const browser = await chromium.launch()
  for (const [variant, v] of Object.entries(VARIANTS)) {
    writeFileSync(join(dir, `${buildName(v)}_${v.side === 'front' ? '앞면' : '뒷면'}.png`),
      await render4k(browser, { side: v.side, qrSvg, variant }))
    console.log(`샘플: ${v.tag || '-'} ${v.label} (${v.side})`)
  }
  await browser.close()
  console.log(`\n${dir}\n고른 안은 npm run print -- --variant=<키> 로 패키지를 뽑는다 (키: ${Object.keys(VARIANTS).join(', ')}).`
    + `\n앞면 안과 뒷면 안은 --variant=caption+front 처럼 겹쳐 쓸 수 있다.`)
}

async function main(variant = PRINT.variant) {
  const v = resolveVariant(variant)
  const vars = resolveVars(v)
  await ensureFonts(familiesInUse(vars))
  const BUILD = join(OUT, buildName(v)) // 빌드마다 따로 쌓아 여러 안의 패키지가 공존한다
  rmSync(BUILD, { recursive: true, force: true })
  const dirs = {
    preview: join(BUILD, '01_시안_4K'),
    dtpia: join(BUILD, '02_인쇄소_접수용'), // CMYK 래스터. PDF(1p 앞·2p 뒤)와 EPS 를 같이 두고 하나만 골라 접수한다
    other: join(BUILD, '03_기타_PDF_PNG'), // PDF 를 받는 인쇄소·교정용
    qr: join(BUILD, '04_QR'),
  }
  Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }))

  const qrSvg = await buildQrSvg()
  await QRCode.toFile(join(dirs.qr, 'corelink_qr.png'), profile.siteUrl, { errorCorrectionLevel: PRINT.qr.ec, margin: 4, scale: 24 })
  writeFileSync(join(dirs.qr, 'corelink_qr.svg'), await QRCode.toString(profile.siteUrl, { type: 'svg', margin: 4, errorCorrectionLevel: PRINT.qr.ec }))
  writeFileSync(join(dirs.qr, 'QR_내용.txt'), `${profile.siteUrl}\n에러 정정: ${PRINT.qr.ec}\n`)

  const { trim, bleed, dpi } = SPEC
  const bw = trim.w + bleed * 2
  const bh = trim.h + bleed * 2
  const tag = v.tag ? '_' + v.tag : ''

  const browser = await chromium.launch()
  const results = {}
  const fails = []
  const margins = [] // 면마다 재단선에 가장 가까운 요소
  const inks = [] // 면마다 잉크량 통계
  for (const side of ['front', 'back']) {
    const base = `corelink_namecard${tag}_${side}`

    // 4K 시안
    const png4k = await render4k(browser, { side, qrSvg, variant, vars })
    writeFileSync(join(dirs.preview, `${base}_4K_${trim.w}x${trim.h}mm.png`), png4k)

    // 600dpi 도련 포함 렌더. QR 흰 판의 위치도 같이 재 둔다 — CMYK 로 옮길 때 그 안만 K 단색으로 둔다.
    const ctxDpi = await browser.newContext({ viewport: { width: bw * PX, height: bh * PX }, deviceScaleFactor: dpi / 25.4 / PX })
    const page = await openPage(ctxDpi, pageHtml({ side, unit: `${PX}px`, marks: false, qrSvg, variant, vars }))
    const shot = await page.screenshot()
    const s = dpi / 25.4 / PX
    const qb = await page.locator('.qr-panel').boundingBox().catch(() => null)
    // 안전영역 확인. 배경·곡선처럼 일부러 도련까지 채우는 것은 빼고, 글자와 QR 만 본다.
    // 재는 것은 글자 상자라 실제 잉크보다 폰트 디센트만큼(0.3mm 안팎) 크게 나온다 — 그래서 여유 있게 본다.
    const boxes = await page.evaluate(() => {
      const sel = '.logo, .tagline, .fb-names, .name, .title, .list, .qr-frame, .mark, .bcast, .bcast-label, .chips'
      const els = [...document.querySelectorAll(sel)]
      return els.map((el, i) => {
        const r = el.getBoundingClientRect()
        // 서로 품고 있는 짝(.bcast 안의 .bcast-label 같은)은 겹침이 아니라 중첩이다
        return { idx: i, name: el.className || el.tagName, x: r.left, y: r.top, w: r.width, h: r.height,
          nest: els.map((o, j) => i !== j && (el.contains(o) || o.contains(el))) }
      })
    })
    await ctxDpi.close()

    // 1px 안으로 밀어 넣는다. 반올림 오차로 사각형이 판 밖 배경까지 덮으면 그 줄만 리치 블랙이 빠진다.
    const kOnly = !qb ? [] : [{
      x: Math.round(qb.x * s) + 1, y: Math.round(qb.y * s) + 1,
      w: Math.round(qb.width * s) - 2, h: Math.round(qb.height * s) - 2,
    }]
    writeFileSync(join(dirs.other, `${base}_${bw}x${bh}mm_bleed${bleed}mm_${dpi}dpi_RGB.png`), withDpi(shot, dpi))
    const rgb = PNG.sync.read(shot)

    // 안전영역. 요소 상자는 폰트 디센트만큼 커서 실제보다 짜게 나오므로, 렌더된 화소에서 잉크 경계를 찾는다.
    // 카드 바탕은 #181818 이하로 어둡고 글자·QR·골드는 훨씬 밝아서 밝기 하나로 갈린다.
    const outside = boxes.map((b) => {
      const [x0, y0] = [Math.max(0, Math.floor(b.x * s)), Math.max(0, Math.floor(b.y * s))]
      const [x1, y1] = [Math.min(rgb.width, Math.ceil((b.x + b.w) * s)), Math.min(rgb.height, Math.ceil((b.y + b.h) * s))]
      let l = Infinity, t = Infinity, r = -1, bo = -1
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * rgb.width + x) * 4
        if (Math.max(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]) <= 60) continue
        l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); bo = Math.max(bo, y)
      }
      if (r < 0) return null // 잉크 없음(빈 요소)
      const toMm = (px) => px / s / PX - bleed // 페이지 화소 → 재단선 기준 mm
      const box = { l: toMm(l), t: toMm(t), r: toMm(r + 1), b: toMm(bo + 1) }
      const gap = Math.min(box.l, box.t, trim.w - box.r, trim.h - box.b)
      return { idx: b.idx, name: b.name, mm: gap, box, nest: b.nest }
    }).filter(Boolean).sort((a, b) => a.mm - b.mm)

    margins.push({ side, ...outside[0] })
    for (const e of outside.filter((x) => x.mm < SPEC.safe - .05))
      fails.push(`안전영역(${side}) ${e.name} ${e.mm.toFixed(2)}mm`)

    // 요소끼리 겹치는지. 규격을 바꾸면 가로가 줄면서 열이 부딪히는 게 가장 흔한 사고다.
    for (let i = 0; i < outside.length; i++) for (let j = i + 1; j < outside.length; j++) {
      if (outside[i].nest[outside[j].idx]) continue
      const [A, B] = [outside[i].box, outside[j].box]
      const ov = Math.min(A.r, B.r) - Math.max(A.l, B.l)
      const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t)
      if (ov > .1 && oy > .1) fails.push(`겹침(${side}) ${outside[i].name} × ${outside[j].name} ${ov.toFixed(1)}×${oy.toFixed(1)}mm`)
    }

    // 접수용 CMYK EPS
    const ink = toCmyk(rgb, kOnly)
    const cmyk = ink.buf
    inks.push({ side, ...ink })
    const eps = epsFromCmyk({
      cmyk, w: rgb.width, h: rgb.height, wMm: bw, hMm: bh,
      title: `CORELINK 명함 ${side === 'front' ? '앞면' : '뒷면'}${v.tag ? ` (${v.tag}안)` : ''} ${bw}x${bh}mm`,
    })
    const epsPath = join(dirs.dtpia, `${base}_CMYK_${bw}x${bh}mm_${dpi}dpi.eps`)
    writeFileSync(epsPath, eps, 'latin1')
    const back = epsPixels(eps)
    if (!back || !back.equals(cmyk)) fails.push(`EPS 화소 복원: ${side}`)

    // 낱장 PDF: 재단선 없음 / 재단선 포함
    for (const marks of [false, true]) {
      const ctxPdf = await browser.newContext()
      const p = await openPage(ctxPdf, pageHtml({ side, unit: '1mm', marks, qrSvg, variant, vars }))
      const m = marks ? SPEC.marksMargin * 2 : 0
      await p.pdf({
        path: join(dirs.other, `${base}_${bw}x${bh}mm_bleed${bleed}mm${marks ? '_재단선' : ''}.pdf`),
        width: `${bw + m}mm`, height: `${bh + m}mm`, printBackground: true, preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      })
      await ctxPdf.close()
    }

    results[side] = { png4k, shot, cmyk, rgb, kOnly, epsPath }
  }

  // 접수용 CMYK PDF — 작업사이즈 도큐멘트, 1페이지 앞 · 2페이지 뒤 (가이드의 PDF 접수 규격)
  const pdfPages = ['front', 'back'].map((side) => ({ cmyk: results[side].cmyk, w: results[side].rgb.width, h: results[side].rgb.height }))
  const cmykPdfPath = join(dirs.dtpia, `corelink_namecard${tag}_CMYK_양면_${bw}x${bh}mm_${dpi}dpi.pdf`)
  const cmykPdf = pdfFromCmyk(pdfPages, { wMm: bw, hMm: bh, title: `CORELINK 명함${v.tag ? ` ${v.tag}안` : ''} ${bw}x${bh}mm` })
  writeFileSync(cmykPdfPath, cmykPdf)
  const pdfBad = checkCmykPdf(cmykPdf, pdfPages, bw, bh)
  console.log(`접수용 CMYK PDF 검증: ${pdfBad.length ? 'FAIL → ' + pdfBad.join(', ') : 'OK'} → 2페이지, ${bw}×${bh}mm, DeviceCMYK`)
  if (pdfBad.length) fails.push('접수용 CMYK PDF')

  // 참고용 양면 PDF(벡터, RGB) — 1페이지 앞, 2페이지 뒤
  const spreadPath = join(dirs.other, `corelink_namecard${tag}_양면_${bw}x${bh}mm_bleed${bleed}mm.pdf`)
  const ctxSpread = await browser.newContext()
  const sp = await openPage(ctxSpread, spreadHtml({ unit: '1mm', qrSvg, variant, vars }))
  await sp.pdf({
    path: spreadPath, width: `${bw}mm`, height: `${bh}mm`, printBackground: true, preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  })
  await ctxSpread.close()
  await browser.close()

  // --- 검증 ---
  // QR: 렌더된 그림에서 다시 읽어 siteUrl 과 같은지
  const k4 = PNG.sync.read(results.back.png4k)
  const kp = results.back.rgb
  for (const [label, buf, img] of [['4K', results.back.png4k, k4], ['600dpi', results.back.shot, kp]]) {
    const x = Math.floor(img.width * .68)
    const decoded = decodeQr(buf, { x, y: 0, w: img.width - x, h: Math.floor(img.height * .56) })
    const ok = decoded === profile.siteUrl
    console.log(`QR 검증(${label}): ${ok ? 'OK' : 'FAIL'} → ${decoded}`)
    if (!ok) fails.push(`QR ${label}`)
  }

  // CMYK: 시안 색이 사양서에 적은 값으로 옮겨졌는지 확인한다.
  // QR 판 안에서는 좌표를 찍지 않고 가장 밝은/어두운 화소를 찾는다 — 해상도가 바뀌면 좌표가 어긋난다.
  const b = results.back
  const extreme = (rect, pick) => {
    let best = null, bestK = pick === 'light' ? 256 : -1
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const k = b.cmyk[(y * b.rgb.width + x) * 4 + 3]
      if (pick === 'light' ? k < bestK : k > bestK) { bestK = k; best = [x, y] }
    }
    return best && cmykAt(b.cmyk, b.rgb.width, best[0], best[1])
  }
  const probes = [
    ['배경(리치 블랙)', cmykAt(b.cmyk, b.rgb.width, 30, Math.floor(b.rgb.height * .8)), (g) => g.every((n, i) => Math.abs(n - [60, 40, 40, 100][i]) <= 1)],
    ['QR 흰 판', extreme(b.kOnly[0], 'light'), (g) => g && g.every((n, i) => Math.abs(n - [0, 0, 1, 3][i]) <= 1)],
    // 모듈은 K 단색이어야 한다 — 네 판으로 찍으면 0.32mm 모듈이 판 어긋남에 흐려진다
    ['QR 모듈 K 단색', extreme(b.kOnly[0], 'dark'), (g) => g && g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] > 80],
  ]
  for (const [what, got, ok] of probes) {
    const pass = !!got && ok(got)
    console.log(`CMYK 검증(${what}): ${pass ? 'OK' : 'FAIL'} → ${got ? `C${got[0]} M${got[1]} Y${got[2]} K${got[3]}` : '못 찾음'}`)
    if (!pass) fails.push(`CMYK ${what}`)
  }

  // 접수용 EPS 에 실린 화소에서 QR 이 여전히 읽히는지 — 인쇄소가 실제로 받는 파일로 확인한다.
  {
    const px = epsPixels(readFileSync(b.epsPath, 'latin1'))
    const x = Math.floor(b.rgb.width * .68)
    const r = { x, y: 0, w: b.rgb.width - x, h: Math.floor(b.rgb.height * .56) }
    const decoded = px && jsQR(cmykToRgba(px, b.rgb.width, b.rgb.height, r), r.w, r.h)?.data
    const ok = decoded === profile.siteUrl
    console.log(`QR 검증(접수용 EPS): ${ok ? 'OK' : 'FAIL'} → ${decoded}`)
    if (!ok) fails.push('QR EPS')
  }

  // 양면 PDF: 앞이 1페이지, 뒤가 2페이지여야 한다.
  // 페이지 치수는 Chrome 이 약 0.34mm 단위로 끊어 내보내서 92×52mm 를 정확히 못 맞춘다(91.9~92.05mm 가 같은 값).
  // 그래서 인쇄소에 내는 건 치수를 우리가 직접 쓰는 EPS 다. 여기서는 그 오차가 한 칸(0.35mm) 안인지만 본다.
  const info = pdfInfo(readFileSync(spreadPath))
  const offMm = info.size ? [bw, bh].map((n, i) => (info.size[i] - n / 25.4 * 72) / 72 * 25.4) : null
  const pdfOk = info.pages === 2 && offMm && offMm.every((d) => Math.abs(d) < .35)
  console.log(`양면 PDF 검증: ${pdfOk ? 'OK' : 'FAIL'} → ${info.pages}페이지, `
    + `${info.size?.map((n) => (n / 72 * 25.4).toFixed(3)).join('×')}mm (${offMm?.map((d) => (d >= 0 ? '+' : '') + d.toFixed(3)).join(' / ')}mm)`)
  if (!pdfOk) fails.push('양면 PDF')

  const overlaps = fails.filter((f) => f.startsWith('겹침'))
  console.log(`요소 겹침 검증: ${overlaps.length ? 'FAIL → ' + overlaps.join(', ') : 'OK'}`)
  const safeFails = fails.filter((f) => f.startsWith('안전영역'))
  console.log(`안전영역 검증(잉크 기준 ${SPEC.safe}mm): ${safeFails.length ? 'FAIL → ' + safeFails.join(', ') : 'OK'} — `
    + margins.map((m) => `${m.side === 'front' ? '앞' : '뒤'} ${m.mm.toFixed(2)}mm(${m.name})`).join(', '))
  // QR 모듈의 실제 크기. 인쇄물에서 읽히느냐는 화면 판독이 아니라 이 치수가 정한다.
  const modules = Number(qrSvg.match(/viewBox="0 0 (\d+)/)?.[1] || 0)
  const qrMm = Number(vars['--qr-size'])
  const modMm = modules ? qrMm / modules : 0
  const modPx = modMm / 25.4 * dpi
  const qrWarn = modMm < QR_MIN_MODULE
  console.log(`QR 모듈 크기: ${modMm.toFixed(3)}mm (${modules}모듈 × ${qrMm}mm, ${dpi}dpi 에서 ${modPx.toFixed(1)}px)`
    + (qrWarn ? ` ← 인쇄 권장 최소 ${QR_MIN_MODULE}mm 미만. 화면으로는 읽혀도 인쇄물에서 스캔이 안 될 수 있다` : ''))

  const tacMax = Math.max(...inks.map((i) => i.maxTac))
  const tacOk = tacMax <= TAC + .5 && inks.every((i) => i.flatK === 0)
  console.log(`잉크량 검증(상한 ${TAC}%): ${tacOk ? 'OK' : 'FAIL'} → 최대 ${tacMax.toFixed(1)}%, `
    + `상한에 걸려 줄인 화소 ${inks.reduce((n, i) => n + i.clamped, 0)}개, K100 단색(자동 오버프린트) ${inks.reduce((n, i) => n + i.flatK, 0)}개`)
  if (!tacOk) fails.push('잉크량')
  console.log(`4K: ${k4.width}×${k4.height}px, 인쇄용 EPS: ${kp.width}×${kp.height}px @${dpi}dpi CMYK`)
  if (fails.length) { console.error(`\n검증 실패: ${fails.join(', ')}`); process.exitCode = 1 }

  // 사양서 + zip. 실제로 쓴 폰트를 채우고, 빌드마다 다른 것(방송 이력·손으로 고친 값)은 뒤에 절을 붙인다.
  const readme = join(BUILD, 'README_인쇄사양.md')
  let spec = readFileSync(join(HERE, 'README_인쇄사양.md'), 'utf8')
    .replace('{{폰트}}', familiesInUse(vars).join(' · '))
    .replace(/\{\{재단mm\}\}/g, `${trim.w} × ${trim.h} mm`)
    .replace(/\{\{작업mm\}\}/g, `${bw} × ${bh} mm`)
    .replace(/\{\{작업파일\}\}/g, `${bw}x${bh}mm`)
    .replace(/\{\{도련\}\}/g, `${bleed} mm`)
    .replace(/\{\{dpi\}\}/g, String(dpi))
    .replace(/\{\{화소\}\}/g, `${kp.width} × ${kp.height} px`)
    .replace(/\{\{pt\}\}/g, [bw, bh].map((n) => (n / 25.4 * 72).toFixed(3)).join(' × '))
    .replace(/\{\{평량\}\}/g, CARD.paper)
    .replace(/\{\{QR규격\}\}/g, `${modules}×${modules} 모듈, 에러 정정 ${PRINT.qr.ec}`)
    .replace(/\{\{QR크기\}\}/g, `모듈 영역 ${qrMm} mm (모듈 ${modMm.toFixed(3)} mm), `
      + `흰 바탕 ${(qrMm + Number(vars['--qr-quiet']) * 2).toFixed(2)} mm, 골드 테두리 선 ${vars['--qr-border']} mm`)
    .replace(/\{\{QR주의\}\}/g, !qrWarn ? '' :
      `\n> **주의 — 모듈이 작습니다.** 한 칸이 ${modMm.toFixed(3)} mm 로 인쇄 권장 최소치(${QR_MIN_MODULE} mm)의 `
      + `${(modMm / QR_MIN_MODULE * 100).toFixed(0)}% 입니다. 디자인상 일부러 줄인 것이니 그대로 찍어 주시되,\n`
      + `> 잉크 번짐이 크면 알려 주세요. 스캔 거리는 코드 폭의 10배 안팎이라 약 ${(qrMm * 10 / 10).toFixed(0)} cm 이내입니다.\n`)
    .replace(/\{\{선굵기\}\}/g, [0.2, 0.18].map((n) => (n / 25.4 * dpi).toFixed(1) + ' px').join(', ')
      + ` (${dpi}dpi 기준)` + (dpi >= 600 ? '' : ' — CARD.dpi 를 600 으로 올리면 두 배로 또렷해집니다'))
    .replace('{{안전여유}}', margins.map((m) => `${m.side === 'front' ? '앞면' : '뒷면'} ${m.mm.toFixed(1)}mm`).join(', ')
      + ' — 재단선에 가장 가까운 잉크까지의 거리(600dpi 렌더에서 실측)')
    .replace('{{잉크량}}', `**최대 ${tacMax.toFixed(0)}%**. 250% 를 넘는 화소 0개`)
    .replace('{{K100}}', `K100 단색 화소 **${inks.reduce((n, i) => n + i.flatK, 0)}개**. 검정은 전부 CMY 가 섞인 리치 블랙`)
  const extra = []
  if (v.tag) {
    extra.push(`이 패키지의 추가 표기 (${v.tag}안 · ${v.label})\n\n| 항목 | 값 |\n|---|---|\n`
      + `| ${PRINT.broadcastLabel} | ${names()} |\n`
      + v.picked.map((p) => `| 위치 (${p.tag}) | ${p.where} |\n`).join('')
      + `| 구분 | 파일명과 재단선 라벨의 "${v.tag}" 가 이 안 표시. 다른 안의 파일과 섞지 말 것 |\n`)
  }
  const tweaks = Object.entries(loadOverrides())
  if (tweaks.length) {
    extra.push(`손으로 고친 디자인 값 (${tweaks.length}개)\n\n`
      + `기본 디자인에서 아래 값을 바꿔 뽑은 판입니다. 3·5·6절의 색·QR·글자 크기 표와 어긋나는 항목이 있으면 **이 표가 맞습니다**.\n\n`
      + `| 변수 | 이 빌드의 값 |\n|---|---|\n`
      + tweaks.map(([k, val]) => `| \`${k}\` | ${val} |\n`).join(''))
  }
  // 절 번호는 사양서에 이미 있는 마지막 번호 다음부터 이어 붙인다
  const last = Math.max(0, ...[...spec.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1])))
  extra.forEach((s, i) => { spec += `\n## ${last + 1 + i}. ${s}` })
  writeFileSync(readme, spec)
  const zipName = `corelink_namecard_print${v.tag ? '_' + v.tag : ''}_${today()}.zip`
  execFileSync('python3', ['-m', 'zipfile', '-c', join(BUILD, zipName), ...Object.values(dirs), readme], { cwd: BUILD })
  console.log(`패키지: ${join(BUILD, zipName)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv.find((a) => a.startsWith('--variant='))
  const run = process.argv.includes('--samples') ? samples : () => main(arg ? arg.slice('--variant='.length) : PRINT.variant)
  run().catch((e) => { console.error(e); process.exit(1) })
}
