// 官方数据源清单。新增来源只需在这里加一项，然后运行 `npm run crawl`。
//
// 每个来源二选一（也可都写）：
//   rss:      RSS 地址列表，条目的链接就是正文页
//   listings: 列表页地址，配合 include（正则）从页面里挑出正文链接
// max: 每次最多抓多少篇（按列表顺序，通常是最新的在前）

export const TOPICS = {
  fisco: '税务',
  lavoro: '劳动与社保',
  immigrazione: '移民与居留',
  impresa: '企业经营',
  norme: '法律法规',
};

export const SOURCES = [
  {
    id: 'ade-circolari',
    name: 'Agenzia delle Entrate · Circolari',
    nameZh: '意大利税务局 · 通函',
    topic: 'fisco',
    listings: ['https://www.agenziaentrate.gov.it/portale/normativa-e-prassi/circolari'],
    include: /\/portale\/documents\/.+\.pdf/i,
    max: 25,
  },
  {
    id: 'ade-risoluzioni',
    name: 'Agenzia delle Entrate · Risoluzioni',
    nameZh: '意大利税务局 · 决议',
    topic: 'fisco',
    listings: ['https://www.agenziaentrate.gov.it/portale/normativa-e-prassi/risoluzioni'],
    include: /\/portale\/documents\/.+\.pdf/i,
    max: 25,
  },
  {
    id: 'mef-finanze',
    name: 'MEF · Dipartimento delle Finanze',
    nameZh: '经济财政部 · 财政司',
    topic: 'fisco',
    rss: ['https://www.finanze.gov.it/it/rss.xml'],
    max: 30,
  },
  {
    id: 'inps-circolari',
    name: 'INPS · Circolari',
    nameZh: '国家社保局 · 通函',
    topic: 'lavoro',
    rss: ['https://www.inps.it/it/it.rss.circolari.xml'],
    max: 30,
    // 正文由页面脚本动态加载，抓不到；先收录编号和主题摘要，AI 需要细节时会联网查
    rssTextOnly: true,
  },
  {
    id: 'inps-messaggi',
    name: 'INPS · Messaggi',
    nameZh: '国家社保局 · 通知',
    topic: 'lavoro',
    rss: ['https://www.inps.it/it/it.rss.messaggi.xml'],
    max: 30,
    rssTextOnly: true,
  },
  {
    id: 'inps-news',
    name: 'INPS · Notizie',
    nameZh: '国家社保局 · 新闻',
    topic: 'lavoro',
    rss: ['https://www.inps.it/it/it.rss.news.xml'],
    max: 30,
  },
  {
    id: 'inail-news',
    name: 'INAIL · News',
    nameZh: '工伤保险局 · 新闻',
    topic: 'lavoro',
    listings: ['https://www.inail.it/portale/it/inail-comunica/news.html'],
    include: /\/inail-comunica\/news\/notizia\./i,
    max: 20,
  },
  {
    id: 'lavoro-notizie',
    name: 'Ministero del Lavoro · Notizie',
    nameZh: '劳动部 · 新闻',
    topic: 'lavoro',
    listings: ['https://www.lavoro.gov.it/notizie/Pagine/Notizie', 'https://www.lavoro.gov.it/'],
    include: /\/notizie\/pagine\/(?!notizie$)/i,
    max: 25,
  },
  {
    id: 'inl-news',
    name: 'Ispettorato Nazionale del Lavoro · News',
    nameZh: '国家劳动监察局 · 新闻',
    topic: 'lavoro',
    listings: ['https://www.ispettorato.gov.it/comunicazione/comunicati/news-inl/'],
    include: /ispettorato\.gov\.it\/\d{4}\/\d{2}\/\d{2}\/|\/comunicazione\/comunicati\/news-inl\/.+/i,
    max: 20,
  },
  {
    id: 'integrazione-migranti',
    name: 'Integrazione Migranti · News',
    nameZh: '移民融合门户 · 新闻',
    topic: 'immigrazione',
    listings: ['https://www.integrazionemigranti.gov.it/it-it/Ricerca-news'],
    include: /\/Ricerca-news\/Dettaglio-news\/id\/\d+/i,
    max: 40,
  },
  {
    id: 'mimit-notizie',
    name: 'MIMIT · Notizie',
    nameZh: '企业与意大利制造部 · 新闻',
    topic: 'impresa',
    rss: ['https://www.mimit.gov.it/index.php/it/notizie-stampa?format=feed&type=rss'],
    max: 30,
  },
  {
    id: 'mimit-incentivi',
    name: 'MIMIT · Incentivi',
    nameZh: '企业与意大利制造部 · 补贴与激励',
    topic: 'impresa',
    rss: ['https://www.mimit.gov.it/index.php/it/incentivi-aggiornamenti?format=feed&type=rss'],
    max: 30,
  },
  {
    id: 'gazzetta-ufficiale',
    name: 'Gazzetta Ufficiale · Serie Generale',
    nameZh: '政府公报 · 普通系列',
    topic: 'norme',
    rss: ['https://www.gazzettaufficiale.it/rss/SG'],
    max: 40,
    // 公报正文页是框架结构，抓不到正文时就用 RSS 里的摘要
    rssTextOnly: true,
  },
];

export const sourceById = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
