// 知识库检索：BM25 全文检索。文档是意大利语，所以查询词也要用意大利语
// （由 AI 把用户的中文问题改写成意大利语关键词后再调用）。
import { getDb } from './db.mjs';
import { sourceById, TOPICS } from './sources.mjs';

const STOP = new Set(
  `a ad al allo alla ai agli alle anche che chi ci con come cui da dal dallo dalla dai dagli dalle
   dei del dello della degli delle di e ed gli ha hanno i il in io la le lo loro ma mi ne nei nel nello
   nella negli nelle noi non o per piu quale quali quando questa queste questi questo se si sia sono
   su sul sullo sulla sui sugli sulle tra fra un una uno è era essere the of and to for`.split(/\s+/),
);

/** 把自然语言查询变成 FTS5 表达式。长词去掉词尾做前缀匹配，粗略兼容意大利语的单复数和变位。 */
export function toFtsQuery(q) {
  const tokens = (q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
  const uniq = [...new Set(tokens)].slice(0, 16);
  return uniq.map((t) => (t.length >= 6 && !/\d/.test(t) ? `${t.slice(0, -1)}*` : `"${t}"`)).join(' OR ');
}

export function searchKb(query, { topic, limit = 6 } = {}) {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT c.doc_id, c.seq, c.body, bm25(chunks, 4.0, 1.0) AS score,
              d.title, d.url, d.source, d.topic, d.published
       FROM chunks c JOIN docs d ON d.id = c.doc_id
       WHERE chunks MATCH ? ${topic ? 'AND d.topic = ?' : ''}
       ORDER BY score LIMIT 60`,
    )
    .all(...(topic ? [fts, topic] : [fts]));

  // 同一篇文档最多取两段，避免一篇长文把结果占满
  const perDoc = new Map();
  const out = [];
  for (const r of rows) {
    const n = perDoc.get(r.doc_id) || 0;
    if (n >= 2) continue;
    perDoc.set(r.doc_id, n + 1);
    out.push({
      docId: r.doc_id,
      title: r.title,
      url: r.url,
      source: sourceById[r.source]?.name || r.source,
      topic: TOPICS[r.topic] || r.topic,
      published: r.published,
      excerpt: r.body,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function readDoc(docId, maxChars = 24000) {
  const r = getDb().prepare('SELECT * FROM docs WHERE id = ?').get(docId);
  if (!r) return null;
  return {
    docId: r.id,
    title: r.title,
    url: r.url,
    source: sourceById[r.source]?.name || r.source,
    published: r.published,
    truncated: r.text.length > maxChars,
    text: r.text.slice(0, maxChars),
  };
}

export function listDocs({ source, limit = 50 } = {}) {
  return getDb()
    .prepare(
      `SELECT id, source, topic, url, title, published, fetched_at, length(text) AS chars
       FROM docs ${source ? 'WHERE source = ?' : ''}
       ORDER BY COALESCE(published, fetched_at) DESC LIMIT ?`,
    )
    .all(...(source ? [source, limit] : [limit]));
}
