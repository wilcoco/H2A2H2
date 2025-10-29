import { Pool, PoolClient } from "pg";

let _pool: Pool | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) throw new Error("DATABASE_URL/POSTGRES_URL is not set");
  return url;
}

export function getPool(): Pool {
  if (_pool) return _pool;
  const isProd = process.env.NODE_ENV === "production";
  _pool = new Pool({
    connectionString: getConnectionString(),
    ssl: isProd ? { rejectUnauthorized: false } : undefined,
  });
  return _pool;
}

export async function withConn<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
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
    await c.query(`create index if not exists qa_entries_question_idx on qa_entries (lower(question))`);
    await c.query(`create index if not exists qa_entries_created_at_idx on qa_entries (created_at)`);
    await c.query(`create index if not exists qa_entries_parent_idx on qa_entries (parent_id)`);
    await c.query(`create index if not exists qa_entries_root_idx on qa_entries (root_id, created_at)`);
    // Optional acceleration via trigram indexes if available
    try { await c.query(`create extension if not exists pg_trgm`); } catch {}
    try { await c.query(`create index if not exists qa_entries_question_trgm on qa_entries using gin (lower(question) gin_trgm_ops)`); } catch {}
    try { await c.query(`create index if not exists qa_entries_summary_trgm on qa_entries using gin (lower(coalesce(summary,'')) gin_trgm_ops)`); } catch {}

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
  });
}
