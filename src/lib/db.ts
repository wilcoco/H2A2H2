import { Pool } from "pg";

type DBRow = Record<string, unknown>;
type DBQueryResult = { rowCount: number; rows: DBRow[] };
type DBClient = { query: (text: string, params?: unknown[]) => Promise<DBQueryResult>; release: () => void };
type DBPool = { connect: () => Promise<DBClient> };

let _pool: DBPool | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) throw new Error("DATABASE_URL/POSTGRES_URL is not set");
  return url;
}

export function getPool(): DBPool {
  if (_pool) return _pool;
  const isProd = process.env.NODE_ENV === "production";
  _pool = new Pool({
    connectionString: getConnectionString(),
    ssl: isProd ? { rejectUnauthorized: false } : undefined,
  }) as unknown as DBPool;
  return _pool;
}

export async function withConn<T>(fn: (c: DBClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ensureTables() {
  await withConn(async (c) => {
    await c.query(`
      create table if not exists works (
        id text primary key,
        title text not null,
        description text,
        node_count integer not null default 0,
        investment_score integer not null default 0,
        created_by text,
        created_at timestamptz not null default now(),
        graph jsonb
      );
    `);
    await c.query(`alter table works add column if not exists topic text`);
    await c.query(`alter table works add column if not exists is_public boolean not null default true`);
    await c.query(`
      create table if not exists qa_entries (
        id text primary key,
        question text not null,
        norm_question text,
        answer text,
        summary text,
        patch jsonb,
        work_id text,
        created_by text,
        created_at timestamptz not null default now()
      );
    `);
    await c.query(`alter table qa_entries add column if not exists parent_id text`);
    await c.query(`alter table qa_entries add column if not exists root_id text`);
    await c.query(`alter table qa_entries add column if not exists published boolean not null default true`);
    await c.query(`alter table qa_entries add column if not exists last_response_id text`);
    await c.query(`create index if not exists qa_entries_question_idx on qa_entries (lower(question))`);
    await c.query(`create index if not exists qa_entries_created_at_idx on qa_entries (created_at)`);
    await c.query(`create index if not exists qa_entries_parent_idx on qa_entries (parent_id)`);
    await c.query(`create index if not exists qa_entries_root_idx on qa_entries (root_id, created_at)`);
    await c.query(`create index if not exists qa_entries_published_idx on qa_entries (published)`);
    // Optional acceleration via trigram indexes if available
    try { await c.query(`create extension if not exists pg_trgm`); } catch {}
    try { await c.query(`create index if not exists qa_entries_question_trgm on qa_entries using gin (lower(question) gin_trgm_ops)`); } catch {}
    try { await c.query(`create index if not exists qa_entries_summary_trgm on qa_entries using gin (lower(coalesce(summary,'')) gin_trgm_ops)`); } catch {}
    // Optional vector search support
    try { await c.query(`create extension if not exists vector`); } catch {}
    try { await c.query(`alter table qa_entries add column if not exists embedding vector(1536)`); } catch {}
    try { await c.query(`create index if not exists qa_entries_embedding_idx on qa_entries using ivfflat (embedding vector_cosine_ops) with (lists = 100)`); } catch {}

    await c.query(`
      create table if not exists qa_feedback (
        qa_id text not null,
        user_id text not null,
        vote smallint not null,
        comment text,
        created_at timestamptz not null default now(),
        primary key (qa_id, user_id)
      );
    `);
    await c.query(`create index if not exists qa_feedback_qa_idx on qa_feedback (qa_id)`);

    await c.query(`
      create table if not exists qa_notes (
        id text primary key,
        qa_id text not null,
        user_id text,
        content text not null,
        created_at timestamptz not null default now()
      );
    `);
    await c.query(`create index if not exists qa_notes_qa_idx on qa_notes (qa_id)`);

    await c.query(`
      create table if not exists qa_relations (
        source_id text not null,
        target_id text not null,
        type text not null,
        weight smallint not null default 1,
        created_by text,
        created_at timestamptz not null default now(),
        primary key (source_id, target_id, type)
      );
    `);
    await c.query(`create index if not exists qa_relations_source_idx on qa_relations (source_id)`);
    await c.query(`create index if not exists qa_relations_target_idx on qa_relations (target_id)`);
    await c.query(`create index if not exists qa_relations_created_at_idx on qa_relations (created_at)`);

    await c.query(`
      create table if not exists qa_pins (
        user_id text not null,
        qa_id text not null,
        created_at timestamptz not null default now(),
        primary key (user_id, qa_id)
      );
    `);
    await c.query(`create index if not exists qa_pins_user_idx on qa_pins (user_id)`);
    await c.query(`create index if not exists qa_pins_qa_idx on qa_pins (qa_id)`);

    await c.query(`
      create table if not exists qa_intents (
        id text primary key,
        child_id text not null,
        parent_id text,
        l1 text,
        l2 text,
        target_pic text,
        created_by text,
        created_at timestamptz not null default now()
      );
    `);
    await c.query(`create index if not exists qa_intents_child_idx on qa_intents (child_id)`);
    await c.query(`create index if not exists qa_intents_parent_idx on qa_intents (parent_id)`);

    // Keywords cache for QAs
    await c.query(`
      create table if not exists qa_keywords (
        qa_id text not null,
        keyword text not null,
        weight smallint not null default 1,
        created_at timestamptz not null default now(),
        primary key (qa_id, keyword)
      );
    `);
    await c.query(`create index if not exists qa_keywords_qa_idx on qa_keywords (qa_id)`);
    await c.query(`create index if not exists qa_keywords_kw_idx on qa_keywords (keyword)`);
    await c.query(`
      create table if not exists stake_ledger (
        id text primary key,
        user_id text not null,
        qa_id text,
        qa_root_id text not null,
        amount integer not null,
        lock_days smallint not null default 7,
        created_at timestamptz not null default now(),
        lock_until timestamptz not null
      );
    `);
    await c.query(`create index if not exists stake_ledger_user_idx on stake_ledger (user_id)`);
    await c.query(`create index if not exists stake_ledger_root_idx on stake_ledger (qa_root_id)`);
    await c.query(`create index if not exists stake_ledger_created_idx on stake_ledger (created_at)`);
    try { await c.query(`alter table stake_ledger add column if not exists is_self boolean not null default false`); } catch {}

    // Teams and Work Logs
    await c.query(`
      create table if not exists teams (
        id text primary key,
        name text not null unique,
        created_at timestamptz not null default now()
      );
    `);
    await c.query(`
      create table if not exists team_members (
        team_id text not null,
        user_email text not null,
        user_name text,
        created_at timestamptz not null default now(),
        primary key (team_id, user_email)
      );
    `);
    await c.query(`create index if not exists team_members_team_idx on team_members (team_id)`);
    await c.query(`create index if not exists team_members_user_idx on team_members (user_email)`);
    await c.query(`
      create table if not exists work_logs (
        id text primary key,
        title text not null,
        content text not null,
        team_id text,
        user_email text,
        user_name text,
        created_at timestamptz not null default now()
      );
    `);
    await c.query(`create index if not exists work_logs_team_idx on work_logs (team_id)`);
    await c.query(`create index if not exists work_logs_user_idx on work_logs (user_email)`);
    await c.query(`create index if not exists work_logs_created_idx on work_logs (created_at)`);
  });
}
