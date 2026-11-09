import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'pipe.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('text', 'file')),
    text_content TEXT,
    original_name TEXT,
    stored_name TEXT,
    mime_type TEXT,
    size INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('retention', 'never');
`);

export interface PipeItem {
  id: number;
  type: 'text' | 'file';
  text_content: string | null;
  original_name: string | null;
  stored_name: string | null;
  mime_type: string | null;
  size: number | null;
  created_at: number;
}

export const dbOps = {
  getAllItems(): PipeItem[] {
    return db.prepare('SELECT * FROM items ORDER BY created_at DESC, id DESC').all() as PipeItem[];
  },

  getItemById(id: number): PipeItem | undefined {
    return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as PipeItem | undefined;
  },

  insertText(content: string): PipeItem {
    const now = Date.now();
    const info = db
      .prepare("INSERT INTO items (type, text_content, created_at) VALUES ('text', ?, ?)")
      .run(content, now);
    return this.getItemById(Number(info.lastInsertRowid))!;
  },

  insertFile(meta: {
    original_name: string;
    stored_name: string;
    mime_type: string;
    size: number;
  }): PipeItem {
    const now = Date.now();
    const info = db
      .prepare(
        "INSERT INTO items (type, original_name, stored_name, mime_type, size, created_at) VALUES ('file', ?, ?, ?, ?, ?)"
      )
      .run(meta.original_name, meta.stored_name, meta.mime_type, meta.size, now);
    return this.getItemById(Number(info.lastInsertRowid))!;
  },

  deleteItem(id: number): PipeItem | undefined {
    const item = this.getItemById(id);
    if (item) {
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
      if (item.type === 'file' && item.stored_name) {
        const filePath = path.join(UPLOADS_DIR, item.stored_name);
        fs.unlink(filePath, () => {});
      }
    }
    return item;
  },

  clearAll(): void {
    const files = db.prepare("SELECT stored_name FROM items WHERE type = 'file'").all() as {
      stored_name: string;
    }[];
    for (const f of files) {
      if (f.stored_name) {
        fs.unlink(path.join(UPLOADS_DIR, f.stored_name), () => {});
      }
    }
    db.prepare('DELETE FROM items').run();
  },

  createSession(token: string): void {
    db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
  },

  isValidSession(token: string | undefined): boolean {
    if (!token) return false;
    const row = db.prepare('SELECT token FROM sessions WHERE token = ?').get(token);
    return !!row;
  },

  getRetention(): 'never' | '24h' | '7d' {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'retention'").get() as
      | { value: string }
      | undefined;
    const val = row?.value;
    if (val === '24h' || val === '7d') return val;
    return 'never';
  },

  setRetention(val: 'never' | '24h' | '7d'): void {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('retention', ?)").run(val);
  },

  purgeExpired(): number[] {
    const retention = this.getRetention();
    if (retention === 'never') return [];

    const ttl = retention === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ttl;

    const expired = db
      .prepare('SELECT * FROM items WHERE created_at < ?')
      .all(cutoff) as PipeItem[];

    const deletedIds: number[] = [];
    for (const item of expired) {
      this.deleteItem(item.id);
      deletedIds.push(item.id);
    }
    return deletedIds;
  }
};
