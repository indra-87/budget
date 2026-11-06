import { store } from './store.js';
import {
  CARDS, OTHER_METHODS, DEFAULT_MERCHANTS, DEFAULT_SETTINGS, cardById, payName, areaLabel,
  suggestArea, simulate, cardMonth, rewardIndex, periodKey, shiftPeriod, periodLabel,
  fmtReward, won, num, norm,
} from './cards.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseAmount = (v) => parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;

const state = {
  txs: [],
  settings: { ...DEFAULT_SETTINGS },
  rewards: new Map(),
  payment: CARDS[0].id,
  editingId: null,
  areaTouched: false,
  cardsPeriod: null,
  loaded: false,
};

// ── 시작 ──────────────────────────────────────────────────────
async function init() {
  bindTabs(); bindForm(); bindHistory(); bindCards(); bindSettings(); bindLogin();
  if (store.isDemo) {
    $('#modeBadge').hidden = false;
    return showApp();
  }
  $('#logoutBtn').hidden = false;
  store.onAuth((s) => (s ? showApp() : showLogin()));
  (await store.getSession()) ? showApp() : showLogin();
}

function showLogin() {
  state.loaded = false;
  $('#app').hidden = true;
  $('#login').hidden = false;
}

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (state.loaded) return;
  state.loaded = true;
  try {
    state.settings = { ...DEFAULT_SETTINGS, ...(await store.getSettings()) };
    state.txs = await store.list();
  } catch (e) {
    toast(`불러오기 실패: ${e.message}`);
  }
  state.cardsPeriod = periodKey(today(), state.settings.cycleStartDay);
  resetForm();
  renderAll();
}

function renderAll() {
  state.rewards = rewardIndex(state.txs, state.settings);
  renderDatalists();
  renderMerchantChips();
  renderPayChips();
  updateArea();
  renderPreview();
  renderRecent();
  renderHistory();
  renderCards();
  renderSettings();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

// ── 탭 ────────────────────────────────────────────────────────
function bindTabs() {
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));
}
function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  window.scrollTo({ top: 0 });
}

// ── 로그인 ────────────────────────────────────────────────────
function bindLogin() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    $('#loginError').textContent = '';
    try { await store.signIn(f.email.value, f.password.value); }
    catch (err) { $('#loginError').textContent = err.message; }
  });
  $('#logoutBtn').addEventListener('click', () => store.signOut());
}

// ── 입력 폼 ───────────────────────────────────────────────────
const form = () => $('#txForm');
// form.elements.item 은 내장 메서드와 이름이 겹쳐서 name으로 직접 찾습니다
const F = () => new Proxy({}, { get: (_, k) => form().querySelector(`[name="${String(k)}"]`) });

function bindForm() {
  const f = F();
  f.amount.addEventListener('input', () => {
    const n = parseAmount(f.amount.value);
    f.amount.value = n ? n.toLocaleString('ko-KR') : '';
    syncLitersFromPrice();
    renderPreview();
  });
  f.merchant.addEventListener('input', () => { updateArea(); renderPreview(); renderMerchantChips(); });
  f.tx_date.addEventListener('change', renderPreview);
  f.item.addEventListener('input', renderItemHistory);
  f.area.addEventListener('change', () => { state.areaTouched = true; updateArea(); renderPreview(); });
  f.liters.addEventListener('input', renderPreview);
  f.unit_price.addEventListener('input', () => { syncLitersFromPrice(); renderPreview(); });
  form().addEventListener('submit', onSave);
  $('#cancelEdit').addEventListener('click', () => { resetForm(); renderAll(); });
}

function syncLitersFromPrice() {
  const f = F();
  const price = parseAmount(f.unit_price.value);
  const amt = parseAmount(f.amount.value);
  if (price && amt) f.liters.value = (amt / price).toFixed(2);
}

function readDraft() {
  const f = F();
  return {
    tx_date: f.tx_date.value || today(),
    item: f.item.value.trim(),
    amount: parseAmount(f.amount.value),
    merchant: f.merchant.value.trim(),
    payment: state.payment,
    area: cardById(state.payment) ? f.area.value : null,
    liters: parseFloat(f.liters.value) || null,
    note: f.note.value.trim(),
  };
}

function resetForm() {
  const keepDate = F().tx_date.value || today();
  form().reset();
  F().tx_date.value = keepDate;
  state.editingId = null;
  state.areaTouched = false;
  $('#formTitle').textContent = '새 내역';
  $('#saveBtn').textContent = '저장';
  $('#cancelEdit').hidden = true;
  $('#itemHistory').innerHTML = '';
}

function loadIntoForm(t) {
  const f = F();
  resetForm();
  state.editingId = t.id;
  state.payment = t.payment;
  state.areaTouched = true;
  f.tx_date.value = t.tx_date;
  f.item.value = t.item;
  f.amount.value = Number(t.amount).toLocaleString('ko-KR');
  f.merchant.value = t.merchant || '';
  f.note.value = t.note || '';
  f.liters.value = t.liters ?? '';
  renderPayChips();
  updateArea(t.area);
  renderPreview();
  renderMerchantChips();
  $('#formTitle').textContent = '내역 수정';
  $('#saveBtn').textContent = '수정 저장';
  $('#cancelEdit').hidden = false;
  switchTab('input');
}

function selectPayment(p) {
  state.payment = p;
  state.areaTouched = false;
  renderPayChips();
  updateArea();
  renderPreview();
}

function renderPayChips() {
  const opts = [...CARDS.map((c) => ({ id: c.id, name: c.name, color: c.color })), ...OTHER_METHODS.map((m) => ({ id: m, name: m }))];
  $('#payChips').innerHTML = opts.map((o) =>
    `<button type="button" class="chip ${o.id === state.payment ? 'on' : ''}" data-pay="${esc(o.id)}">` +
    `${o.color ? `<span class="dot" style="background:${o.color}"></span>` : ''}${esc(o.name)}</button>`).join('');
  $('#payChips').querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => selectPayment(b.dataset.pay)));
}

function updateArea(forceKey) {
  const f = F();
  const card = cardById(state.payment);
  $('#areaWrap').hidden = !card;
  if (!card) { $('#fuelWrap').hidden = true; return; }
  const suggested = suggestArea(card, f.merchant.value);
  const current = forceKey || (state.areaTouched ? f.area.value : suggested);
  f.area.innerHTML = card.areas.map((a) => `<option value="${a.key}">${esc(a.label)}</option>`).join('');
  f.area.value = card.areas.some((a) => a.key === current) ? current : suggested;
  const badge = $('#areaBadge');
  if (f.area.value === suggested && !state.areaTouched) { badge.textContent = '자동 추천'; badge.className = 'badge'; }
  else if (f.area.value === suggested) { badge.textContent = '추천과 같음'; badge.className = 'badge good'; }
  else { badge.textContent = `직접 선택 · 추천: ${areaLabel(card, suggested)}`; badge.className = 'badge manual'; }
  $('#fuelWrap').hidden = !(card.id === 'shinhan_hipoint' && f.area.value === 'fuel');
}

function renderPreview() {
  const d = readDraft();
  const box = $('#rewardPreview');
  if (!d.amount) {
    box.innerHTML = '<div class="empty">금액과 사용처를 입력하면 카드별 예상 적립과 남은 한도를 보여줘요. 원하는 카드를 눌러 선택하세요.</div>';
    return;
  }
  const rows = CARDS.map((card) => {
    const same = card.id === state.payment;
    const draft = { ...d, area: same ? d.area : null, liters: same ? d.liters : null };
    const r = simulate(card, state.txs, draft, state.settings, state.editingId);
    return { card, r, same };
  });
  const best = Math.max(...rows.map((x) => x.r.valueWon));
  box.innerHTML = '<span class="lbl">카드별 예상 적립 (이번 실적 기간 기준)</span>' + rows.map(({ card, r, same }) => {
    const isBest = r.valueWon === best && best > 0;
    const val = card.unit === '마일' ? `${fmtReward(card, r.earned)} <span class="sub">≈${won(r.valueWon)}</span>` : fmtReward(card, r.earned);
    return `<div class="reco ${same ? 'sel' : ''}" data-pay="${card.id}">
      <span class="name"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${card.color};margin-right:6px"></span>${esc(card.name)} ${isBest ? '<span class="badge good">추천</span>' : ''}</span>
      <span class="val">${val}</span>
      <span class="sub">${esc(areaLabel(card, r.area))} · ${esc(r.detail)}</span><span></span>
      ${r.warn ? `<span class="warnline">⚠ ${esc(r.warn)}</span>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-pay]').forEach((el) => el.addEventListener('click', () => selectPayment(el.dataset.pay)));
}

function renderItemHistory() {
  const q = norm(F().item.value);
  const box = $('#itemHistory');
  if (q.length < 2) { box.innerHTML = ''; return; }
  const hits = state.txs.filter((t) => norm(t.item).includes(q)).slice(0, 5);
  box.innerHTML = hits.length
    ? '이전 구매: ' + hits.map((t) => `<div class="item">${t.tx_date} · <b>${esc(t.item)}</b> · ${won(t.amount)} · ${esc(t.merchant || '-')} · ${esc(payName(t.payment))}</div>`).join('')
    : '';
}

async function onSave(e) {
  e.preventDefault();
  const d = readDraft();
  if (!d.item) return toast('내역을 입력하세요');
  if (!d.amount) return toast('금액을 입력하세요');
  const card = cardById(d.payment);
  const rec = {
    tx_date: d.tx_date, item: d.item, amount: d.amount, payment: d.payment,
    merchant: d.merchant || null, area: card ? d.area : null,
    liters: card?.id === 'shinhan_hipoint' && d.area === 'fuel' ? d.liters : null,
    note: d.note || null,
  };
  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    if (state.editingId) {
      const row = await store.update(state.editingId, rec);
      state.txs = state.txs.map((t) => (t.id === row.id ? row : t));
      toast('수정했어요');
    } else {
      const row = await store.insert(rec);
      state.txs = [row, ...state.txs];
      toast('저장했어요');
    }
    resetForm();
    renderAll();
    F().item.focus();
  } catch (err) {
    toast(`저장 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ── 목록 공통 ─────────────────────────────────────────────────
function txRow(t, { actions = false } = {}) {
  const r = state.rewards.get(t.id);
  const card = cardById(t.payment);
  const rw = r ? `<span class="rw ${r.earned === 0 ? 'zero' : ''}" title="${esc(r.detail)}">+${fmtReward(r.card, r.earned)}</span>` : '<span></span>';
  return `<div class="tx ${actions ? '' : 'clickable'}" data-id="${t.id}">
    <span class="t1">${esc(t.item)}</span><span class="amt">${won(t.amount)}</span>
    <span class="t2">${t.tx_date} · ${esc(t.merchant || '-')} · ${esc(payName(t.payment))}${card && t.area ? ` · ${esc(areaLabel(card, t.area))}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</span>${rw}
    ${actions ? `<div class="acts"><button class="ghost small" data-edit>수정</button><button class="ghost small danger" data-del>삭제</button></div>` : ''}
  </div>`;
}

function renderRecent() {
  const list = [...state.txs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  const box = $('#recentList');
  box.innerHTML = list.length ? list.map((t) => txRow(t)).join('') : '<div class="empty-msg">아직 입력한 내역이 없어요</div>';
  box.querySelectorAll('.tx').forEach((el) => el.addEventListener('click', () => loadIntoForm(state.txs.find((t) => t.id === el.dataset.id))));
}

function renderDatalists() {
  const items = [...new Set(state.txs.map((t) => t.item))].slice(0, 300);
  $('#itemList').innerHTML = items.map((i) => `<option value="${esc(i)}">`).join('');
  $('#merchantList').innerHTML = allMerchants().map((m) => `<option value="${esc(m)}">`).join('');
}

function merchantFreq() {
  const c = new Map();
  for (const t of state.txs) if (t.merchant) c.set(t.merchant, (c.get(t.merchant) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}
function allMerchants() {
  return [...new Set([...state.settings.favoriteMerchants, ...merchantFreq(), ...DEFAULT_MERCHANTS])];
}

function renderMerchantChips() {
  const fav = state.settings.favoriteMerchants || [];
  const extra = merchantFreq().filter((m) => !fav.includes(m)).slice(0, 4);
  const cur = F().merchant.value.trim();
  $('#merchantChips').innerHTML = [...fav, ...extra].map((m) =>
    `<button type="button" class="chip ${m === cur ? 'on' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join('');
  $('#merchantChips').querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    F().merchant.value = b.dataset.m;
    updateArea(); renderPreview(); renderMerchantChips();
  }));
}

// ── 내역 탭 ───────────────────────────────────────────────────
function bindHistory() {
  $('#hq').addEventListener('input', renderHistory);
  $('#hpay').addEventListener('change', renderHistory);
  $('#hperiod').addEventListener('change', renderHistory);
  $('#csvBtn').addEventListener('click', exportCsv);
}

function filteredTxs() {
  const q = norm($('#hq').value);
  const pay = $('#hpay').value;
  const per = $('#hperiod').value;
  return state.txs
    .filter((t) => !q || [t.item, t.merchant, t.note].some((v) => norm(v).includes(q)))
    .filter((t) => !pay || t.payment === pay)
    .filter((t) => !per || periodKey(t.tx_date, state.settings.cycleStartDay) === per)
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)) || String(b.created_at).localeCompare(String(a.created_at)));
}

function renderHistory() {
  const payOpts = [['', '전체 결제수단'], ...CARDS.map((c) => [c.id, c.name]), ...OTHER_METHODS.map((m) => [m, m])];
  const curPay = $('#hpay').value;
  $('#hpay').innerHTML = payOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  $('#hpay').value = curPay;
  const periods = [...new Set(state.txs.map((t) => periodKey(t.tx_date, state.settings.cycleStartDay)))].sort().reverse();
  const curPer = $('#hperiod').value;
  $('#hperiod').innerHTML = `<option value="">전체 기간</option>` + periods.map((p) => `<option value="${p}">${periodLabel(p, state.settings.cycleStartDay)}</option>`).join('');
  $('#hperiod').value = periods.includes(curPer) ? curPer : '';

  const list = filteredTxs();
  const q = $('#hq').value.trim();
  const sum = list.reduce((s, t) => s + Number(t.amount), 0);
  let summary = `${list.length}건 · 합계 <b>${won(sum)}</b>`;
  if (q && list.length) {
    const amts = list.map((t) => Number(t.amount));
    const min = list.find((t) => Number(t.amount) === Math.min(...amts));
    summary = `“${esc(q)}” ${list.length}건 · 최저 <b>${won(min.amount)}</b> (${min.tx_date}, ${esc(min.merchant || '-')}) · 최고 ${won(Math.max(...amts))} · 평균 ${won(sum / list.length)}`;
  }
  $('#histSummary').innerHTML = state.txs.length ? summary : '';
  const box = $('#histList');
  box.innerHTML = list.length ? list.map((t) => txRow(t, { actions: true })).join('') : '<div class="empty-msg">해당하는 내역이 없어요</div>';
  box.querySelectorAll('.tx').forEach((el) => {
    const t = state.txs.find((x) => x.id === el.dataset.id);
    el.querySelector('[data-edit]').addEventListener('click', () => loadIntoForm(t));
    el.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`"${t.item}" (${won(t.amount)}) 내역을 삭제할까요?`)) return;
      try {
        await store.remove(t.id);
        state.txs = state.txs.filter((x) => x.id !== t.id);
        if (state.editingId === t.id) resetForm();
        renderAll();
        toast('삭제했어요');
      } catch (err) { toast(`삭제 실패: ${err.message}`); }
    });
  });
}

function exportCsv() {
  const rows = filteredTxs();
  const head = ['날짜', '내역', '금액', '결제수단', '사용처', '적립구분', '적립', '비고'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((t) => {
    const card = cardById(t.payment);
    const r = state.rewards.get(t.id);
    return [t.tx_date, t.item, t.amount, payName(t.payment), t.merchant, card ? areaLabel(card, t.area) : '', r ? fmtReward(r.card, r.earned) : '', t.note].map(cell).join(',');
  });
  const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `가계부_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── 카드 실적 탭 ──────────────────────────────────────────────
function bindCards() {
  $('#pPrev').addEventListener('click', () => { state.cardsPeriod = shiftPeriod(state.cardsPeriod, -1); renderCards(); });
  $('#pNext').addEventListener('click', () => { state.cardsPeriod = shiftPeriod(state.cardsPeriod, 1); renderCards(); });
}

function renderCards() {
  const p = state.cardsPeriod;
  const s = state.settings;
  $('#pLabel').textContent = periodLabel(p, s.cycleStartDay);
  const boards = CARDS.map((card) => {
    const { txs, summary } = cardMonth(card, state.txs, p, s);
    const spend = txs.reduce((a, t) => a + Number(t.amount), 0);
    const bars = summary.bars.map((b) => {
      const pct = b.max ? Math.min(100, (b.value / b.max) * 100) : 0;
      const cls = b.value > b.max ? 'over' : b.value >= b.max ? 'full' : '';
      const fmt = (v) => (b.unit === '원' ? won(v) : `${num(v)}${b.unit}`);
      return `<div class="bar ${cls}"><div class="lab"><span>${esc(b.label)}</span><span>${fmt(b.value)} / ${fmt(b.max)}</span></div>
        <div class="track"><div class="fill" style="width:${pct}%;background:${cls ? '' : card.color}"></div></div></div>`;
    }).join('');
    const byArea = card.areas.map((a) => {
      const list = txs.filter((t) => (t.area || card.defaultArea) === a.key);
      return list.length ? `<tr><td>${esc(a.label)}</td><td class="r">${list.length}건</td><td class="r">${won(list.reduce((x, t) => x + Number(t.amount), 0))}</td></tr>` : '';
    }).join('');
    const detail = txs.map((t) => {
      const r = summary.results.get(t.id);
      return `<tr><td>${t.tx_date.slice(5)}</td><td>${esc(t.item)}<div class="hint">${esc(t.merchant || '')} · ${esc(r.detail)}${r.warn ? ` · ⚠ ${esc(r.warn)}` : ''}</div></td><td class="r">${won(t.amount)}</td><td class="r">${fmtReward(card, r.earned)}</td></tr>`;
    }).join('');
    return `<div class="panel">
      <div class="board-head"><h2><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${card.color};margin-right:6px"></span>${esc(card.name)}</h2>
        <span class="spend">이용금액 ${won(spend)} · ${txs.length}건</span></div>
      <div class="big">${fmtReward(card, summary.totalEarned)}${card.unit === '마일' ? ` <span class="hint">≈ ${won(summary.totalEarned * s.mileValue)}</span>` : ''}</div>
      ${bars}
      <ul class="hints">${summary.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      ${txs.length ? `<details><summary>영역별 · 건별 상세</summary>
        <table><tbody>${byArea}</tbody></table>
        <table><thead><tr><th>날짜</th><th>내역</th><th class="r">금액</th><th class="r">적립</th></tr></thead><tbody>${detail}</tbody></table>
      </details>` : ''}
    </div>`;
  }).join('');
  const others = OTHER_METHODS.map((m) => {
    const list = state.txs.filter((t) => t.payment === m && periodKey(t.tx_date, s.cycleStartDay) === p);
    return list.length ? `<tr><td>${esc(m)}</td><td class="r">${list.length}건</td><td class="r">${won(list.reduce((x, t) => x + Number(t.amount), 0))}</td></tr>` : '';
  }).join('');
  $('#cardBoards').innerHTML = boards + (others ? `<div class="panel"><h3>기타 결제수단</h3><table><tbody>${others}</tbody></table></div>` : '');
}

// ── 설정 탭 ───────────────────────────────────────────────────
function bindSettings() {
  const sel = $('#settingsForm').elements.cycleStartDay;
  sel.innerHTML = Array.from({ length: 28 }, (_, i) => i + 1)
    .map((d) => `<option value="${d}">${d === 1 ? '매월 1일 ~ 말일' : `매월 ${d}일 ~ 다음 달 ${d - 1}일`}</option>`).join('');
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const next = {
      ...state.settings,
      fuelPrice: parseAmount(f.fuelPrice.value) || DEFAULT_SETTINGS.fuelPrice,
      mileValue: parseFloat(f.mileValue.value) || 0,
      cycleStartDay: Number(f.cycleStartDay.value) || 1,
      favoriteMerchants: f.favoriteMerchants.value.split(',').map((x) => x.trim()).filter(Boolean),
    };
    try {
      await store.saveSettings(next);
      state.settings = next;
      state.cardsPeriod = periodKey(today(), next.cycleStartDay);
      renderAll();
      toast('설정을 저장했어요');
    } catch (err) { toast(`저장 실패: ${err.message}`); }
  });
}

function renderSettings() {
  const f = $('#settingsForm').elements;
  const s = state.settings;
  f.fuelPrice.value = s.fuelPrice;
  f.mileValue.value = s.mileValue;
  f.cycleStartDay.value = s.cycleStartDay;
  f.favoriteMerchants.value = (s.favoriteMerchants || []).join(', ');
}

init();
