-- 가계부 앱 테이블 (여러 앱이 같이 쓰는 프로젝트라 gb_ 접두어 사용)
-- Supabase 대시보드 → SQL Editor 에서 실행 가능 (이미 적용됨)

-- 1) 결제/구매 내역
create table if not exists public.gb_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tx_date     date not null default current_date,
  item        text not null,                         -- 내역 (물품명)
  amount      integer not null check (amount >= 0),  -- 금액 (원)
  payment     text not null,                         -- 결제수단 (카드 id 또는 '현금' 등)
  merchant    text,                                  -- 사용처
  area        text,                                  -- 적립 구분 (카드별 영역 key)
  liters      numeric(8, 2),                         -- 주유량 (하이포인트 주유 적립 계산용)
  note        text,                                  -- 비고
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.gb_transactions is '가계부 앱: 구매/결제 내역 (본인 행만 접근)';

create index if not exists gb_transactions_user_date_idx on public.gb_transactions (user_id, tx_date desc);

create or replace function public.gb_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists gb_transactions_touch on public.gb_transactions;
create trigger gb_transactions_touch before update on public.gb_transactions
  for each row execute function public.gb_touch_updated_at();

-- 2) 앱 설정 (기기 간 동기화)
create table if not exists public.gb_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.gb_settings is '가계부 앱: 사용자별 설정';

-- 3) RLS: 로그인한 본인 데이터만 접근
alter table public.gb_transactions enable row level security;
alter table public.gb_settings     enable row level security;

drop policy if exists "gb own rows" on public.gb_transactions;
create policy "gb own rows" on public.gb_transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "gb own settings" on public.gb_settings;
create policy "gb own settings" on public.gb_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.gb_transactions, public.gb_settings from anon;
revoke execute on function public.gb_touch_updated_at() from anon, authenticated, public;

-- 4) 카드 명세서 가져오기용 (2026-11 추가)
alter table public.gb_transactions
  add column if not exists source text not null default 'manual',  -- manual | import | legacy
  add column if not exists import_key text;                        -- 명세서 행 식별키
create index if not exists gb_transactions_import_key_idx
  on public.gb_transactions (user_id, import_key) where import_key is not null;

-- 5) 충전 할인 결제(순천사랑) (2026-11 추가): amount = 실제 지출액
alter table public.gb_transactions
  add column if not exists face_amount integer check (face_amount is null or face_amount >= 0),
  add column if not exists discount_rate smallint check (discount_rate is null or (discount_rate between 0 and 100));
