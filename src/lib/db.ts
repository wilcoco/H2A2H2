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
  });
}
