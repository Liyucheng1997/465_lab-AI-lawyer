// 官网抓取器：读取 sources.mjs 里的来源，抓正文（网页或 PDF），写入本地知识库。
//
//   npm run crawl                 抓全部来源（已抓过的网址自动跳过）
//   npm run crawl -- inps-news    只抓指定来源（可写多个）
//   npm run crawl -- --refresh    已抓过的也重新抓
//   npm run crawl -- --probe ID   只列出会抓哪些链接，不入库（调试新来源用）
import * as cheerio from 'cheerio';
import { extractText, getDocumentProxy } from 'unpdf';
import { pathToFileURL } from 'node:url';
import { SOURCES } from './sources.mjs';
import { hasUrl, saveDoc, logCrawl, stats } from './db.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MIN_CHARS = 250;
const MAX_CHARS = 400_000;
const MAX_BYTES = 25 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5', Accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('文件过大');
      return { buf, type, finalUrl: res.url };
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

function decode(buf, type) {
  const m = /charset=([\w-]+)/i.exec(type);
  try {
    return new TextDecoder(m ? m[1] : 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

const clean = (s) =>
  (s || '')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function normUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    if (u.port === '443' || u.port === '80') u.port = '';
    return u.toString();
  } catch {
    return null;
  }
}

const IT_MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

/** 从文本里找第一个像样的日期，返回 YYYY-MM-DD。 */
export function findDate(s) {
  if (!s) return null;
  const pad = (n) => String(n).padStart(2, '0');
  let m = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = new RegExp(`\\b(\\d{1,2})[°º]?\\s+(${Object.keys(IT_MONTHS).join('|')})\\s+(20\\d{2})\\b`, 'i').exec(s);
  if (m) return `${m[3]}-${pad(IT_MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = /\b(\d{1,2})[\/._-](\d{1,2})[\/._-](20\d{2})\b/.exec(s);
  if (m && +m[2] <= 12 && +m[1] <= 31) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

function toIsoDate(s) {
  if (!s) return null;
  // 意大利写法是 日/月/年，交给 Date.parse 会被当成 月/日/年，所以先自己认
  if (/^\s*\d{1,2}[\/._-]\d{1,2}[\/._-]20\d{2}/.test(s)) return findDate(s);
  const t = Date.parse(s);
  return Number.isNaN(t) ? findDate(s) : new Date(t).toISOString().slice(0, 10);
}

/** 从 HTML 里取正文：去掉导航/页脚等，再选文字最多的主体容器。 */
export function extractHtml(html) {
  const $ = cheerio.load(html);
  const metaDate =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="dcterms.date"], meta[name="DC.date"], meta[name="date"]').attr('content') ||
    $('time[datetime]').first().attr('datetime');
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const docTitle = $('title').first().text();

  $(
    // 注意不能删 form：ASP.NET 类站点会把整页内容包在一个 form 里
    'script,style,noscript,svg,iframe,nav,header,footer,aside,button,select,input,textarea,' +
      '[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],' +
      '.breadcrumb,.breadcrumbs,.cookie,.cookiebar,.share,.social,.sr-only,.visually-hidden,.skiplinks',
  ).remove();
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article,blockquote').each((_, el) => {
    $(el).append('\n\n');
  });
  $('td,th').each((_, el) => {
    $(el).append(' | ');
  });

  let best = null;
  let bestLen = 0;
  $('article, main, [role=main], #main, #content, #main-content, .content, .main-content, .article, .news-detail, .item-page').each(
    (_, el) => {
      const len = $(el).text().replace(/\s+/g, ' ').length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    },
  );
  const root = best && bestLen > MIN_CHARS ? $(best) : $('body');
  const h1 = clean(root.find('h1').first().text()) || clean($('h1').first().text());
  const text = clean(root.text());
  const title = (h1 || clean(ogTitle) || clean(docTitle).split(/\s[|–-]\s/)[0] || '').slice(0, 300);
  // 页面上常同时有“截止日期”和“发布日期”，优先认明确标了发布的那个
  const pub = /(?:Pubblicazione|Pubblicato il|Data di pubblicazione)\s*:?\s*([^\n]{6,40})/i.exec(text.slice(0, 3000));
  return { title, text, published: toIsoDate(metaDate) || (pub && findDate(pub[1])) || findDate(text.slice(0, 1500)) };
}

async function extractPdf(buf) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return clean((Array.isArray(text) ? text : [text]).join('\n\n'));
}

function titleFromUrl(url) {
  const parts = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean);
  const name = parts.find((p) => /\.pdf$/i.test(p)) || parts.at(-1) || url;
  return name.replace(/\.pdf.*$/i, '').replace(/[+_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 抓取并解析一个正文地址（网页或 PDF）。 */
export async function fetchDocument(url, hint = {}) {
  const { buf, type, finalUrl } = await get(url);
  const isPdf = /pdf/i.test(type) || buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) {
    const text = await extractPdf(buf);
    // 文件名里有编号和日期（Circolare n. 9 del ...），链接文字里有主题，两者拼起来最有用
    const name = titleFromUrl(finalUrl);
    const title = (hint.title && hint.title.length > 8 ? `${name} — ${hint.title}` : name).replace(/\s+/g, ' ').slice(0, 300);
    return { title, text, published: hint.published || findDate(title) || findDate(text.slice(0, 2500)) };
  }
  const r = extractHtml(decode(buf, type));
  return { title: r.title || hint.title || titleFromUrl(finalUrl), text: r.text, published: hint.published || r.published };
}

async function linksFromRss(url) {
  const { buf, type } = await get(url);
  const $ = cheerio.load(decode(buf, type), { xmlMode: true });
  const items = [];
  $('item, entry').each((_, el) => {
    const it = $(el);
    const link = clean(it.children('link').first().text()) || it.children('link').attr('href') || clean(it.children('guid').text());
    const body = it.children('content\\:encoded').text() || it.children('description').text() || it.children('summary').text();
    items.push({
      url: normUrl(link, url),
      title: clean(it.children('title').first().text()),
      published: toIsoDate(it.children('pubDate').text() || it.children('pubdate').text() || it.children('updated').text() || it.children('dc\\:date').text()),
      summary: clean(cheerio.load(`<div>${body}</div>`).text()),
    });
  });
  return items.filter((i) => i.url);
}

async function linksFromListing(url, include) {
  const { buf, type, finalUrl } = await get(url);
  const $ = cheerio.load(decode(buf, type));
  const seen = new Set();
  const items = [];
  $('a[href]').each((_, a) => {
    const u = normUrl($(a).attr('href'), finalUrl);
    if (!u || seen.has(u) || !include.test(u)) return;
    seen.add(u);
    items.push({ url: u, title: clean($(a).text()) || clean($(a).attr('title')) });
  });
  return items;
}

async function candidates(src) {
  const all = [];
  for (const u of src.rss || []) all.push(...(await linksFromRss(u)));
  for (const u of src.listings || []) all.push(...(await linksFromListing(u, src.include)));
  const seen = new Set();
  return all.filter((i) => !seen.has(i.url) && seen.add(i.url)).slice(0, src.max || 30);
}

export async function crawlSource(src, { refresh = false, log = console.log } = {}) {
  let added = 0;
  let failed = 0;
  let skipped = 0;
  let items;
  try {
    items = await candidates(src);
  } catch (e) {
    log(`  ✗ 列表获取失败：${e.message}`);
    logCrawl(src.id, 0, 1, `列表获取失败：${e.message}`);
    return { added, failed: 1, skipped };
  }
  for (const it of items) {
    if (!refresh && hasUrl(it.url)) {
      skipped++;
      continue;
    }
    try {
      let doc;
      if (src.rssTextOnly) {
        doc = { title: it.title, text: `${it.title}\n\n${it.summary}`, published: it.published || findDate(it.title) };
      } else {
        doc = await fetchDocument(it.url, it);
        if (it.summary && it.summary.length > doc.text.length) doc.text = it.summary;
        await sleep(400); // 对官网客气一点，不要连续猛抓
      }
      const text = clean(doc.text).slice(0, MAX_CHARS);
      const minChars = src.rssTextOnly ? 60 : MIN_CHARS;
      if (text.length < minChars) throw new Error(`正文太短（${text.length} 字符）`);
      saveDoc({ source: src.id, topic: src.topic, url: it.url, title: doc.title || it.title || it.url, published: doc.published, text });
      added++;
      log(`  + ${(doc.title || it.url).slice(0, 80)}`);
    } catch (e) {
      failed++;
      log(`  ✗ ${it.url.slice(0, 90)} — ${e.message}`);
    }
  }
  logCrawl(src.id, added, failed, items.length ? '' : '列表里没有匹配的链接');
  return { added, failed, skipped, found: items.length };
}

export async function crawlAll({ only = [], refresh = false, log = console.log } = {}) {
  const list = only.length ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;
  const summary = [];
  for (const src of list) {
    log(`\n【${src.nameZh}】${src.name}`);
    const r = await crawlSource(src, { refresh, log });
    log(`  → 新增 ${r.added}，跳过 ${r.skipped}，失败 ${r.failed}（列表共 ${r.found ?? 0} 条）`);
    summary.push({ id: src.id, ...r });
  }
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const probe = args.includes('--probe');
  const only = args.filter((a) => !a.startsWith('--'));
  if (probe) {
    for (const src of SOURCES.filter((s) => !only.length || only.includes(s.id))) {
      console.log(`\n【${src.id}】`);
      try {
        for (const it of await candidates(src)) console.log(`  ${it.published || '          '}  ${it.url}\n      ${it.title.slice(0, 90)}`);
      } catch (e) {
        console.log(`  ✗ ${e.message}`);
      }
    }
  } else {
    const unknown = only.filter((id) => !SOURCES.some((s) => s.id === id));
    if (unknown.length) {
      console.error(`未知来源：${unknown.join(', ')}\n可用来源：${SOURCES.map((s) => s.id).join(', ')}`);
      process.exit(1);
    }
    await crawlAll({ only, refresh });
    const s = stats();
    console.log(`\n知识库现有 ${s.total} 篇文档、${s.chunks} 个片段。`);
  }
}
