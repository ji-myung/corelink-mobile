// 명함 규격 두 벌. 생성기·편집기·사양서가 전부 여기를 본다.
//
//   CARD — 내가 정한 내 명함 값. 크기·해상도·용지. 바꾸고 싶으면 여기만 고치면 된다.
//   SHOP — 인쇄소가 요구하는 값. docs/ 의 작업파일 가이드에서 온 것이라 임의로 바꾸지 않는다.
//
// 고친 뒤에는 `npm run print` 를 돌린다. 크기가 바뀌면 요소 위치가 어긋날 수 있는데,
// 빌드 검증이 안전영역·요소 겹침을 잡아 준다. 위치는 `npm run print:edit` 에서 옮긴다.

/* 내 명함 규격. 길이는 mm. */
export const CARD = {
  trim: { w: 86, h: 52 }, // 재단 크기 — 잘려 나온 명함의 실제 크기
  work: { w: 88, h: 54 }, // 작업 크기 — 재단 크기 + 도련(사방 1mm). 배경은 여기까지 채운다
  dpi: 300, // 인쇄용 래스터 해상도. 인쇄소 최소치가 300 이다
  paper: '250~300g', // 평량. 사양서에 그대로 적힌다
  colorMode: 'CMYK',
}

/* 인쇄소 요구값. 근거는 docs/인쇄소_작업파일_가이드 · docs/공통_작업방법 · docs/명함_작업방법. */
export const SHOP = {
  name: '디티피아',
  safe: 4, // 안전영역: 재단선 안 4mm. 재단오차가 1~2mm 난다
  tac: 250, // 총 잉크량 상한 %. 넘으면 뒷묻음 사고가 나도 재작업이 안 된다
  minDpi: 300,
  formats: 'AI · EPS · PDF · JPG(ZIP)',
  foil: { gold: 'FOCOLTONE 1150', silver: 'FOCOLTONE 2250' },
}

/* 파생값. 도련은 작업–재단 차이의 절반이라 앞뒤가 어긋나면 여기서 막는다. */
const bleedW = (CARD.work.w - CARD.trim.w) / 2
const bleedH = (CARD.work.h - CARD.trim.h) / 2
if (bleedW !== bleedH) {
  throw new Error(`도련이 가로 ${bleedW}mm, 세로 ${bleedH}mm 로 다르다 — CARD.work 와 CARD.trim 을 확인한다`)
}
if (bleedW <= 0) throw new Error('작업 크기가 재단 크기보다 커야 한다')

export const px = (mm, dpi = CARD.dpi) => Math.round(mm / 25.4 * dpi)

/* 생성기가 쓰는 형태로 묶은 것. trim·work·bleed·dpi 는 CARD 에서, safe 는 SHOP 에서 온다. */
export const SPEC = {
  trim: CARD.trim,
  work: CARD.work,
  bleed: bleedW,
  safe: SHOP.safe,
  dpi: CARD.dpi,
  marksMargin: 6, // 재단선 포함 PDF 의 바깥 여백(mm). 인쇄 규격이 아니라 확인용
  previewWidth: 3840, // 4K 시안 PNG 의 가로 화소
}
