// 本地知识库：SQLite + FTS5 全文索引（Node 自带，无需额外安装）
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.KB_PATH || resolve(ROOT, 'data', 'kb.sqlite');

let db;

export function getDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      topic TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      published TEXT,
      fetched_at TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS docs_source ON docs(source);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
      title, body, doc_id UNINDEXED, seq UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS crawl_log (
      source TEXT PRIMARY KEY,
      last_run TEXT,
      added INTEGER,
      failed INTEGER,
      note TEXT
    );
  `);
  return db;
}

/** 按段落切块，每块约 size 字符，块之间保留一小段重叠，避免把一句话切断在两块之间。 */
export function chunkText(text, size = 1400, overlap = 180) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
  };
  for (const p of paras) {
    if (p.length > size) {
      push();
      cur = '';
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size));
      continue;
    }
    if (cur.length + p.length + 2 > size) {
      push();
      cur = cur.slice(-overlap).replace(/^\S*\s/, '') + '\n\n' + p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
  }
  push();
  return chunks;
}

export function hasUrl(url) {
  return !!getDb().prepare('SELECT 1 FROM docs WHERE url = ?').get(url);
}

export function saveDoc({ source, topic, url, title, published, text }) {
  const d = getDb();
  const old = d.prepare('SELECT id FROM docs WHERE url = ?').get(url);
  if (old) {
    d.prepare('DELETE FROM chunks WHERE doc_id = ?').run(old.id);
    d.prepare('DELETE FROM docs WHERE id = ?').run(old.id);
  }
  const info = d
    .prepare('INSERT INTO docs (source, topic, url, title, published, fetched_at, text) VALUES (?,?,?,?,?,?,?)')
    .run(source, topic, url, title, published || null, new Date().toISOString(), text);
  const id = Number(info.lastInsertRowid);
  const ins = d.prepare('INSERT INTO chunks (title, body, doc_id, seq) VALUES (?,?,?,?)');
  chunkText(text).forEach((c, i) => ins.run(title, c, id, i));
  return id;
}

export function logCrawl(source, added, failed, note = '') {
  getDb()
    .prepare(
      `INSERT INTO crawl_log (source, last_run, added, failed, note) VALUES (?,?,?,?,?)
       ON CONFLICT(source) DO UPDATE SET last_run=excluded.last_run, added=excluded.added, failed=excluded.failed, note=excluded.note`,
    )
    .run(source, new Date().toISOString(), added, failed, note);
}

export function stats() {
  const d = getDb();
  const total = d.prepare('SELECT COUNT(*) n FROM docs').get().n;
  const chunks = d.prepare('SELECT COUNT(*) n FROM chunks').get().n;
  const bySource = d
    .prepare(
      `SELECT d.source, COUNT(*) n, MAX(d.published) latest, l.last_run
       FROM docs d LEFT JOIN crawl_log l ON l.source = d.source GROUP BY d.source`,
    )
    .all();
  const lastRun = d.prepare('SELECT MAX(last_run) t FROM crawl_log').get().t;
  return { total, chunks, bySource, lastRun };
}
