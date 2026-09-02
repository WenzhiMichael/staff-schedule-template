import { neon } from "@neondatabase/serverless";

function connectionString() {
  const value = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.STORAGE_URL || process.env.NEON_DATABASE_URL;
  if (!value) throw new Error("Staff Schedule 数据库尚未连接。请在 Vercel 项目中连接 Neon 数据库。");
  return value;
}

function normalizeSql(source: string) {
  if (/^\s*PRAGMA\b/i.test(source)) return null;
  const ignoredInsert = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i.test(source);
  let query = source
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO")
    .replace(/display_name\s*=\s*\?\s+COLLATE\s+NOCASE/gi, "LOWER(display_name) = LOWER(?)")
    .replace(/\s+COLLATE\s+NOCASE/gi, "")
    .replace(/strftime\('%w',\s*shift_date\)/gi, "EXTRACT(DOW FROM shift_date::date)::text");
  if (ignoredInsert) query = `${query.trim().replace(/;$/, "")} ON CONFLICT DO NOTHING`;
  let parameter = 0;
  return query.replace(/\?/g, () => `$${++parameter}`);
}

function normalizeRow<T>(row: T): T {
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) as T;
}

class PreparedStatement {
  private values: unknown[] = [];

  constructor(private readonly source: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  private async execute<T>() {
    const query = normalizeSql(this.source);
    if (!query) return [] as T[];
    const sql = neon(connectionString());
    const rows = await sql.query(query, this.values, { fullResults: false });
    return (rows as T[]).map(normalizeRow);
  }

  async all<T>() {
    return { results: await this.execute<T>() };
  }

  async first<T>() {
    return (await this.execute<T>())[0] ?? null;
  }

  async run() {
    await this.execute();
    return { success: true, meta: { changes: 0 } };
  }
}

export type PostgresStatement = PreparedStatement;

export function getPostgres() {
  return {
    prepare(source: string) {
      return new PreparedStatement(source);
    },
    async batch(statements: PreparedStatement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  };
}
