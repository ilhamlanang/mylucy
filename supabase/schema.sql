-- ============================================================================
-- MyLucy - Supabase PostgreSQL Database Schema & RLS Policies (Phase 1)
-- ============================================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- 1. PROFILES TABLE
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  currency text not null default 'IDR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 2. WALLETS TABLE (Dompet / Sumber Dana)
create table if not exists public.wallets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash', 'bank', 'ewallet')),
  initial_balance bigint not null default 0,
  color text default '#6366f1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallets enable row level security;

create policy "Users can manage their own wallets"
  on public.wallets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. CATEGORIES TABLE (Sistem & Kustom per User)
create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade, -- NULL = kategori sistem bawaan
  name text not null,
  icon text not null default 'Tag',
  color text not null default '#6366f1',
  type text not null check (type in ('income', 'expense')),
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "Users can view system and their own categories"
  on public.categories for select
  using (user_id is null or auth.uid() = user_id);

create policy "Users can insert their own categories"
  on public.categories for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own categories"
  on public.categories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own categories"
  on public.categories for delete
  using (auth.uid() = user_id);

-- 4. TRANSACTIONS TABLE
create table if not exists public.transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  amount bigint not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  merchant text,
  description text,
  transaction_date date not null default current_date,
  source text not null default 'manual' check (source in ('manual', 'ai_parsed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_date
  on public.transactions(user_id, transaction_date desc);

alter table public.transactions enable row level security;

create policy "Users can manage their own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. BUDGETS TABLE (Envelope Budgeting per Kategori & Bulan)
create table if not exists public.budgets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month text not null, -- Format: 'YYYY-MM'
  amount_limit bigint not null check (amount_limit > 0),
  alert_threshold int not null default 80 check (alert_threshold between 1 and 100),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category_id, month)
);

alter table public.budgets enable row level security;

create policy "Users can manage their own budgets"
  on public.budgets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 6. DEBTS TABLE (Komitmen Hutang, Cicilan & Piutang)
create table if not exists public.debts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  counterparty text not null,
  direction text not null check (direction in ('payable', 'receivable')),
  total_amount bigint not null check (total_amount > 0),
  remaining_amount bigint not null default 0 check (remaining_amount >= 0),
  monthly_installment bigint not null check (monthly_installment >= 0),
  due_day int not null default 1 check (due_day between 1 and 31),
  last_paid_month text, -- Format: 'YYYY-MM'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.debts enable row level security;

create policy "Users can manage their own debts"
  on public.debts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- SEED DATA: Default System Categories (user_id = NULL)
-- ============================================================================
insert into public.categories (user_id, name, icon, color, type)
values
  (null, 'Makan & Minum', 'Utensils', '#f97316', 'expense'),
  (null, 'Transportasi', 'Car', '#3b82f6', 'expense'),
  (null, 'Belanja', 'ShoppingBag', '#ec4899', 'expense'),
  (null, 'Tagihan & Utilitas', 'Receipt', '#eab308', 'expense'),
  (null, 'Cicilan & Hutang', 'CreditCard', '#e11d48', 'expense'),
  (null, 'Hiburan', 'Film', '#8b5cf6', 'expense'),
  (null, 'Kesehatan', 'HeartPulse', '#ef4444', 'expense'),
  (null, 'Tabungan & Investasi', 'PiggyBank', '#14b8a6', 'expense'),
  (null, 'Gaji', 'Wallet', '#10b981', 'income'),
  (null, 'Bonus & Freelance', 'Sparkles', '#06b6d4', 'income'),
  (null, 'Pelunasan Piutang', 'HandCoins', '#22c55e', 'income'),
  (null, 'Pemasukan Lainnya', 'PlusCircle', '#22c55e', 'income')
on conflict do nothing;

-- ============================================================================
-- TRIGGER: Auto-create Profile & Default Wallet on User Signup
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, currency)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'IDR'
  );

  insert into public.wallets (user_id, name, type, initial_balance, color)
  values
    (new.id, 'Dompet Utama', 'bank', 0, '#6366f1'),
    (new.id, 'Tunai (Cash)', 'cash', 0, '#10b981'),
    (new.id, 'E-Wallet', 'ewallet', 0, '#0ea5e9');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

