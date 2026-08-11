-- 001_init.sql — Supabase account 1
-- Creates the JARVIS memory table (category-routed long-term memory).

create table if not exists memory (
	id text primary key,
	kind text not null,
	category text not null default 'general',
	content text not null,
	metadata jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index if not exists idx_memory_kind on memory (kind);
create index if not exists idx_memory_category on memory (category);
create index if not exists idx_memory_created on memory (created_at);