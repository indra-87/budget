// ─────────────────────────────────────────────────────────────
// 카드 적립 규칙 엔진
//  - 각 카드의 compute(txs, settings)는 "한 달(실적 기간) 동안 그 카드로 결제한
//    내역"을 시간순으로 받아 건별 적립액과 월 요약을 돌려줍니다.
//  - 금액 단위: 원 / 포인트(P) 1P = 1원 / 마일은 설정의 mileValue로 원화 환산
// ─────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  fuelPrice: 1650,          // 리터를 모를 때 쓰는 추정 단가 (원/L)
  mileValue: 20,            // 1마일 = ?원 (카드 간 비교용)
  cycleStartDay: 1,         // 실적 기간 시작일 (1 = 매월 1일~말일)
  favoriteMerchants: ['G마켓', '11번가', '쿠팡', '옥션', '네이버'],
};

export const DEFAULT_MERCHANTS = [
  'G마켓', '11번가', '쿠팡', '옥션', '네이버', 'SSG', '무신사', '29CM',
  '이마트', '홈플러스', '롯데마트', '롯데백화점', '현대백화점', 'CJ온스타일', '토이저러스',
  '배달의민족', '요기요', '쿠팡이츠', '땡겨요',
  'S-OIL', '현대오일뱅크', 'SK주유소', 'GS칼텍스',
  '스타벅스', 'GS25', 'CU', '세븐일레븐', '카카오T',
];

export const OTHER_METHODS = ['현금', '체크카드', '계좌이체', '기타'];
// 구글폼에서 옮겨온 기존 기록처럼 결제수단을 모르는 내역
export const LEGACY_METHOD = '미기록';

// ── 공통 유틸 ────────────────────────────────────────────────
export const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·()]/g, '');
const hit = (merchant, kws = []) => {
  const m = norm(merchant);
  return !!m && kws.some((k) => m.includes(norm(k)));
};
export const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const num = (n) => Math.round(n).toLocaleString('ko-KR');
const floor = Math.floor;

// ── 1) 신한 하이포인트 ───────────────────────────────────────
function computeHipoint(txs, s) {
  const CAP = 50000, FUEL_LIMIT = 200000, PER_L = 60;
  const results = new Map();
  let total = 0, fuelSpent = 0;
  for (const t of txs) {
    const a = Number(t.amount) || 0;
    const area = t.area || 'general';
    let raw = 0, detail = '', warn = '';
    if (area === 'fuel') {
      const room = Math.max(0, FUEL_LIMIT - fuelSpent);
      const elig = Math.min(a, room);
      const over = a - elig;
      const estimated = !(Number(t.liters) > 0);
      const liters = estimated ? a / (s.fuelPrice || 1650) : Number(t.liters);
      const eligLiters = a > 0 ? (liters * elig) / a : 0;
      raw = floor(eligLiters * PER_L) + floor(over * 0.02);
      detail = `${eligLiters.toFixed(2)}L${estimated ? '(추정)' : ''} × 60P`;
      if (over > 0) {
        detail += ` + 주유 20만원 초과분 ${won(over)} × 2%`;
        warn = '주유 월 20만원 초과분은 일반 2%로 적립';
      }
      fuelSpent += a;
    } else {
      const rate = area === 'shopping' || area === 'overseas' ? 0.05 : 0.02;
      raw = floor(a * rate);
      detail = `${won(a)} × ${rate * 100}%`;
    }
    const earned = Math.max(0, Math.min(raw, CAP - total));
    total += earned;
    if (earned < raw) warn = `통합 한도(5만P) 도달로 ${num(raw - earned)}P 미적립`;
    results.set(t.id, { raw, earned, detail, warn });
  }
  const remain = CAP - total;
  return {
    results, unit: 'P', totalEarned: total,
    bars: [
      { label: '통합 적립 한도', value: total, max: CAP, unit: 'P' },
      { label: '주유 특별적립 대상 금액', value: fuelSpent, max: FUEL_LIMIT, unit: '원' },
    ],
    hints: remain > 0
      ? [
          `남은 적립 한도 ${num(remain)}P`,
          `일반 2% 기준 약 ${won(remain / 0.02)} 더 결제하면 한도 도달`,
          `쇼핑·해외 5% 기준 약 ${won(remain / 0.05)} 더 결제하면 한도 도달`,
          `주유 특별적립 남은 금액 ${won(Math.max(0, FUEL_LIMIT - fuelSpent))}`,
        ]
      : ['이번 달 통합 적립 한도 도달 — 다른 카드 사용 권장'],
  };
}

// ── 2) 쏠 플랜+ ───────────────────────────────────────────────
const SOL_SPECIAL = ['fuel', 'online', 'delivery'];
const SOL_LABEL = { fuel: '주유', online: '온라인쇼핑', delivery: '배달' };
// 영역별 월 누적 이용금액이 30만원 "미만"인 결제까지만 적립.
// 누적이 30만원에 도달하거나 넘게 만드는 결제는 건 전체가 기본적립까지 제외되고,
// 그 금액도 누적에 포함되므로 이후 같은 영역 결제는 계속 제외됩니다.
// (예: 29만원 사용 후 9,000원 → 적립 / 10,000원 이상 → 제외)
function computeSol(txs) {
  const CAP = 60000, AREA_LIMIT = 300000;
  const results = new Map();
  const spent = { fuel: 0, online: 0, delivery: 0 };
  let total = 0;
  for (const t of txs) {
    const a = Number(t.amount) || 0;
    const area = t.area || 'general';
    let raw = 0, detail = '', warn = '';
    if (SOL_SPECIAL.includes(area)) {
      if (spent[area] + a < AREA_LIMIT) {
        raw = floor(a * 0.05);
        detail = `${won(a)} × 5%`;
      } else {
        raw = 0;
        detail = '영역 월 30만원 도달 → 적립 제외';
        warn = `${SOL_LABEL[area]} 영역 30만원 도달 — 이 결제는 기본적립까지 전액 제외`;
      }
      spent[area] += a;
    } else {
      raw = floor(a * 0.015);
      detail = `${won(a)} × 1.5%`;
    }
    const earned = Math.max(0, Math.min(raw, CAP - total));
    total += earned;
    if (earned < raw) warn = `통합 한도(6만원) 도달로 ${num(raw - earned)}원 미적립`;
    results.set(t.id, { raw, earned, detail, warn });
  }
  const remain = CAP - total;
  const areaHints = SOL_SPECIAL.map((k) => {
    const left = AREA_LIMIT - spent[k] - 1;
    return left > 0
      ? `${SOL_LABEL[k]}: ${won(left)}까지 결제 가능 (그 이상 결제하면 그 건 전액 적립 제외)`
      : `${SOL_LABEL[k]}: 이번 달 한도 소진 — 이 영역은 다른 카드로`;
  });
  return {
    results, unit: '원', totalEarned: total,
    bars: [
      { label: '통합 적립 한도', value: total, max: CAP, unit: '원' },
      ...SOL_SPECIAL.map((k) => ({ label: `${SOL_LABEL[k]} 영역`, value: spent[k], max: AREA_LIMIT, unit: '원' })),
    ],
    hints: [
      remain > 0 ? `남은 적립 한도 ${num(remain)}원 (기본 1.5% 기준 약 ${won(remain / 0.015)})` : '이번 달 통합 적립 한도 도달',
      ...areaHints,
    ],
  };
}

// ── 3) 삼성 앤마일리지 ───────────────────────────────────────
function computeSamsung(txs) {
  const EXTRA_CAP = 2000;
  const results = new Map();
  let base = 0, extraTotal = 0;
  for (const t of txs) {
    const a = Number(t.amount) || 0;
    const b = Math.round(a / 1000);
    const extraRaw = t.area === 'extra' ? Math.round(a / 1000) : 0;
    const extra = Math.max(0, Math.min(extraRaw, EXTRA_CAP - extraTotal));
    extraTotal += extra;
    base += b;
    let detail = `기본 ${b}`;
    if (extraRaw) detail += ` + 추가 ${extra}`;
    const warn = extra < extraRaw ? `추가적립 한도(2,000마일) 도달로 ${extraRaw - extra}마일 미적립 (기본만 적용)` : '';
    results.set(t.id, { raw: b + extraRaw, earned: b + extra, detail, warn });
  }
  const remain = EXTRA_CAP - extraTotal;
  return {
    results, unit: '마일', totalEarned: base + extraTotal,
    bars: [{ label: '추가적립 한도', value: extraTotal, max: EXTRA_CAP, unit: '마일' }],
    hints: [
      `기본 ${num(base)}마일 + 추가 ${num(extraTotal)}마일`,
      remain > 0
        ? `추가적립처에서 약 ${won(remain * 1000)} 더 결제하면 추가적립 한도 도달`
        : '추가적립 한도 도달 — 이후엔 1천원당 1마일(기본)만',
    ],
  };
}

// ── 카드 정의 ────────────────────────────────────────────────
// areas: 위에서부터 순서대로 사용처 키워드를 검사해 자동 추천합니다. keywords 없는 항목은 기본값.
export const CARDS = [
  {
    id: 'shinhan_hipoint', name: '신한 하이포인트', short: '하이포인트', unit: 'P', color: '#2563eb',
    defaultArea: 'general',
    areas: [
      { key: 'fuel', label: '주유 특별 (L당 60P)', keywords: ['S-OIL', '에쓰오일', '현대오일뱅크', '오일뱅크'] },
      { key: 'shopping', label: '쇼핑 특별 5%', keywords: ['롯데백화점', '현대백화점', '롯데마트', '이마트', '홈플러스', '토이저러스', 'CJ온스타일', 'CJ오쇼핑', '씨제이이엔엠'], exclude: ['이마트24'] },
      { key: 'overseas', label: '해외 5%', keywords: ['해외'] },
      { key: 'general', label: '일반 2%' },
    ],
    compute: computeHipoint,
  },
  {
    id: 'shinhan_solplan', name: '쏠 플랜+', short: '쏠플랜+', unit: '원', color: '#0d9488',
    defaultArea: 'general',
    areas: [
      { key: 'delivery', label: '배달 5%', keywords: ['땡겨요', '요기요', '위대한상사', '배달의민족', '우아한형제들', '배민', '쿠팡이츠'] },
      { key: 'online', label: '온라인쇼핑 5%', keywords: ['쿠팡', 'coupang', 'SSG', '쓱닷컴', '에스에스지닷컴', '무신사', '29CM'] },
      { key: 'fuel', label: '주유 5%', keywords: ['SK주유', 'SK에너지', '에스케이에너지', 'SK엔크린', 'GS칼텍스', '지에스칼텍스', 'GS주유', '칼텍스'] },
      { key: 'general', label: '기본 1.5%' },
    ],
    compute: computeSol,
  },
  {
    id: 'samsung_andmileage', name: '삼성 앤마일리지', short: '앤마일리지', unit: '마일', color: '#7c3aed',
    defaultArea: 'base',
    areas: [
      {
        key: 'extra', label: '추가적립처 (1천원당 2마일)',
        keywords: ['백화점', '주유', 'S-OIL', 'SK에너지', 'GS칼텍스', '칼텍스', '오일뱅크',
          '커피', '카페', '스타벅스', '투썸', '이디야', '메가커피', '메가MGC', '빽다방', '컴포즈', '폴바셋', '할리스', '커피빈',
          '편의점', 'GS25', '지에스25', 'CU', '씨유', '비지에프리테일', '세븐일레븐', '코리아세븐', '이마트24', '미니스톱', '택시', '카카오T', '카카오택시', '카카오모빌리티'],
      },
      { key: 'base', label: '기본 (1천원당 1마일)' },
    ],
    compute: computeSamsung,
  },
];

export const cardById = (id) => CARDS.find((c) => c.id === id);
export const payName = (p) => cardById(p)?.name || p || '';
export const areaLabel = (card, key) => card?.areas.find((a) => a.key === key)?.label || key || '';

export function suggestArea(card, merchant) {
  for (const a of card.areas) {
    if (a.keywords && hit(merchant, a.keywords) && !hit(merchant, a.exclude)) return a.key;
  }
  return card.defaultArea;
}

export function rewardWon(card, earned, s) {
  return card.unit === '마일' ? earned * (Number(s.mileValue) || 0) : earned;
}
export function fmtReward(card, earned) {
  return `${num(earned)}${card.unit === '원' ? '원' : card.unit}`;
}

// ── 실적 기간 ────────────────────────────────────────────────
export function periodKey(dateStr, startDay = 1) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  let yy = y, mm = m;
  if (d < startDay) { mm -= 1; if (mm === 0) { mm = 12; yy -= 1; } }
  return `${yy}-${String(mm).padStart(2, '0')}`;
}
export function shiftPeriod(p, delta) {
  let [y, m] = p.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function periodLabel(p, startDay = 1) {
  const [y, m] = p.split('-').map(Number);
  if (startDay <= 1) return `${y}년 ${m}월`;
  const next = shiftPeriod(p, 1).split('-').map(Number);
  return `${y}.${m}.${startDay} ~ ${next[0]}.${next[1]}.${startDay - 1}`;
}

export const sortTx = (a, b) =>
  String(a.tx_date).localeCompare(String(b.tx_date)) ||
  String(a.created_at || '~').localeCompare(String(b.created_at || '~'));

export function cardMonth(card, allTxs, period, s, excludeId) {
  const txs = allTxs
    .filter((t) => t.payment === card.id && t.id !== excludeId && periodKey(t.tx_date, s.cycleStartDay) === period)
    .sort(sortTx);
  return { txs, summary: card.compute(txs, s) };
}

// 아직 저장하지 않은 결제(draft)를 해당 카드로 했을 때의 예상 적립
export function simulate(card, allTxs, draft, s, excludeId) {
  const period = periodKey(draft.tx_date, s.cycleStartDay);
  const { txs } = cardMonth(card, allTxs, period, s, excludeId);
  const sim = { ...draft, id: '__sim__', payment: card.id, created_at: '~', area: draft.area || suggestArea(card, draft.merchant) };
  const list = [...txs.filter((t) => t.tx_date <= sim.tx_date), sim, ...txs.filter((t) => t.tx_date > sim.tx_date)];
  const summary = card.compute(list, s);
  const r = summary.results.get('__sim__');
  return { ...r, area: sim.area, valueWon: rewardWon(card, r.earned, s), summary };
}

// 전체 내역 → 건별 적립 결과 인덱스
export function rewardIndex(allTxs, s) {
  const idx = new Map();
  for (const card of CARDS) {
    const periods = new Set(allTxs.filter((t) => t.payment === card.id).map((t) => periodKey(t.tx_date, s.cycleStartDay)));
    for (const p of periods) {
      const { summary } = cardMonth(card, allTxs, p, s);
      for (const [id, r] of summary.results) idx.set(id, { ...r, card });
    }
  }
  return idx;
}
