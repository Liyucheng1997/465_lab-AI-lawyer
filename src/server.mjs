// 网站后端：静态页面 + 咨询接口（SSE 流式）+ 知识库状态与更新接口
import express from 'express';
import { resolve } from 'node:path';
import { ROOT, stats } from './db.mjs';
import { ask, MODEL } from './agent.mjs';
import { listDocs } from './kb.mjs';
import { crawlAll } from './crawl.mjs';
import { SOURCES, TOPICS } from './sources.mjs';

const PORT = Number(process.env.PORT || 4650);
const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(resolve(ROOT, 'public')));
app.get('/vendor/marked.js', (_, res) => res.sendFile(resolve(ROOT, 'node_modules/marked/lib/marked.umd.js')));
app.get('/vendor/purify.js', (_, res) => res.sendFile(resolve(ROOT, 'node_modules/dompurify/dist/purify.min.js')));

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
  if (!message) return res.status(400).json({ error: '问题不能为空' });
  if (message.length > 8000) return res.status(400).json({ error: '问题太长了，请控制在 8000 字以内' });

  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.flushHeaders();
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // 用户关掉页面或点了停止，就不再继续消耗额度
  const beat = setInterval(() => res.write(': ping\n\n'), 15000);
  try {
    for await (const ev of ask(message, { sessionId, signal: ac.signal })) {
      if (ac.signal.aborted) break;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
  } finally {
    clearInterval(beat);
    res.end();
  }
});

let crawl = { running: false, log: [], finishedAt: null };

app.get('/api/kb', (_, res) => {
  const s = stats();
  const by = Object.fromEntries(s.bySource.map((r) => [r.source, r]));
  res.json({
    model: MODEL,
    total: s.total,
    chunks: s.chunks,
    lastRun: s.lastRun,
    crawling: crawl.running,
    sources: SOURCES.map((x) => ({
      id: x.id,
      name: x.name,
      nameZh: x.nameZh,
      topic: TOPICS[x.topic],
      count: by[x.id]?.n || 0,
      latest: by[x.id]?.latest || null,
    })),
  });
});

app.get('/api/kb/docs', (req, res) => {
  const source = SOURCES.some((s) => s.id === req.query.source) ? req.query.source : undefined;
  res.json(listDocs({ source, limit: 100 }));
});

app.post('/api/kb/crawl', (_, res) => {
  if (crawl.running) return res.json({ started: false, running: true });
  crawl = { running: true, log: [], finishedAt: null };
  crawlAll({ log: (line) => crawl.log.push(line) })
    .catch((e) => crawl.log.push(`✗ ${e.message}`))
    .finally(() => {
      crawl.running = false;
      crawl.finishedAt = new Date().toISOString();
    });
  res.json({ started: true });
});

app.get('/api/kb/crawl', (_, res) => res.json({ running: crawl.running, finishedAt: crawl.finishedAt, log: crawl.log.slice(-40) }));

// 只监听本机：这个服务用的是你个人的 Claude 订阅，不应暴露到网络上
app.listen(PORT, '127.0.0.1', () => {
  const s = stats();
  console.log(`华商意大利法税顾问已启动：http://localhost:${PORT}`);
  console.log(`知识库 ${s.total} 篇文档｜模型 ${MODEL}`);
  if (!s.total) console.log('知识库还是空的，先运行 npm run crawl 抓取官方资料。');
});
