/* 前端：发送问题、解析 SSE 事件流、渲染过程与答案、显示知识库状态 */
(function () {
  const $ = (id) => document.getElementById(id);
  const thread = $('thread');
  const inner = $('threadInner');
  const input = $('input');
  const sendBtn = $('send');
  const side = $('side');

  const STARTERS = [
    ['税务', '我是个体户（ditta individuale），适用 regime forfettario 需要满足什么条件？超过营业额上限会怎样？'],
    ['用工', '餐馆想雇一个兼职服务员，要签什么合同、办哪些手续？被查到没签合同会怎么罚？'],
    ['居留', '我的自雇居留（lavoro autonomo）快到期了，续签需要准备哪些材料？营业额太低会被拒吗？'],
    ['公司', '想把个体户转成有限责任公司（SRL），流程、费用和税负上有什么变化？'],
    ['文书', '收到税务局的 avviso bonario，这是什么？我该在多少天内做什么？'],
    ['补贴', '最近有哪些中小企业可以申请的政府补贴或税收优惠？'],
  ];

  let sessionId = null;
  let controller = null;

  marked.setOptions({ gfm: true, breaks: false });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const renderMd = (el, text) => {
    el.innerHTML = DOMPurify.sanitize(marked.parse(text));
    el.querySelectorAll('table').forEach((t) => {
      const w = document.createElement('div');
      w.className = 'table-wrap';
      t.replaceWith(w);
      w.appendChild(t);
    });
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function toast(text, kind) {
    const t = el('div', 'toast' + (kind ? ' toast-' + kind : ''), text);
    $('toasts').appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 2800);
  }

  // 只有当用户本来就在底部附近时才跟随滚动，不打断他往上翻看
  const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140;
  const toBottom = () => (thread.scrollTop = thread.scrollHeight);

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  function setBusy(busy) {
    sendBtn.classList.toggle('busy', busy);
    sendBtn.setAttribute('aria-label', busy ? '停止' : '发送');
    sendBtn.disabled = !busy && !input.value.trim();
  }

  /** 一条 AI 回复的界面：可折叠的查证过程 + 正文 + 出处 */
  function createAnswer() {
    const msg = el('div', 'msg ai');
    const steps = el('div', 'steps');
    const toggle = el('button', 'steps-toggle');
    toggle.type = 'button';
    const spin = el('span', 'spinner');
    const label = el('span', null, '正在思考…');
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('class', 'chev');
    chev.setAttribute('width', '10');
    chev.setAttribute('height', '10');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.innerHTML = '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    toggle.append(spin, label, chev);
    chev.style.display = 'none';
    const list = el('ul', 'steps-list');
    toggle.onclick = () => list.children.length && steps.classList.toggle('open');
    steps.append(toggle, list);
    const body = el('div', 'answer');
    msg.append(steps, body);
    inner.appendChild(msg);

    let text = '';
    let nTools = 0;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const stick = nearBottom();
      renderMd(body, text);
      body.classList.add('caret');
      if (stick) toBottom();
    };

    return {
      delta(t) {
        text += t;
        if (!raf) raf = requestAnimationFrame(paint);
      },
      tool(ev) {
        // 工具调用之前说的话是过程说明，不是最终答案，收进过程列表
        const note = text.trim();
        if (note) {
          const li = el('li', 'note');
          li.append(el('span', null, note.length > 160 ? note.slice(0, 160) + '…' : note));
          list.appendChild(li);
        }
        text = '';
        cancelAnimationFrame(raf);
        raf = 0;
        body.innerHTML = '';
        body.classList.remove('caret');
        nTools++;
        const li = el('li');
        li.append(el('span', 'tag' + (ev.kind === 'kb' ? ' kb' : ''), ev.kind === 'kb' ? '知识库' : ev.kind === 'web' ? '联网' : '工具'), el('span', null, ev.text));
        list.appendChild(li);
        chev.style.display = '';
        label.textContent = ev.text.length > 46 ? ev.text.slice(0, 46) + '…' : ev.text;
        if (nearBottom()) toBottom();
      },
      finish(ev) {
        cancelAnimationFrame(raf);
        const stick = nearBottom();
        renderMd(body, text);
        body.classList.remove('caret');
        spin.remove();
        if (nTools) label.textContent = `查阅了 ${nTools} 次资料`;
        else steps.remove();
        if (ev && ev.sources && ev.sources.length) {
          const box = el('div', 'sources');
          box.appendChild(el('div', 'sources-title', '引用的知识库文件'));
          const ol = el('ol');
          ev.sources.forEach((s) => {
            const li = el('li');
            const a = el('a', null, s.title);
            a.href = s.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.append(a, el('small', null, [s.source, s.published].filter(Boolean).join(' · ')));
            ol.appendChild(li);
          });
          box.appendChild(ol);
          msg.appendChild(box);
        }
        if (ev && ev.durationMs) msg.appendChild(el('div', 'meta-line', `用时 ${Math.round(ev.durationMs / 1000)} 秒`));
        if (stick) toBottom();
      },
      fail(message) {
        cancelAnimationFrame(raf);
        spin.remove();
        body.classList.remove('caret');
        if (text.trim()) renderMd(body, text);
        if (nTools) label.textContent = `查阅了 ${nTools} 次资料`;
        else steps.remove();
        msg.appendChild(el('div', 'error', message));
        toBottom();
      },
      stopped() {
        cancelAnimationFrame(raf);
        spin.remove();
        body.classList.remove('caret');
        if (text.trim()) renderMd(body, text);
        if (nTools) label.textContent = `查阅了 ${nTools} 次资料`;
        else steps.remove();
        msg.appendChild(el('div', 'meta-line', '已停止'));
      },
    };
  }

  async function send(question) {
    if (controller) return;
    $('welcome')?.remove();
    const u = el('div', 'msg user');
    u.appendChild(el('div', 'bubble', question));
    inner.appendChild(u);
    const view = createAnswer();
    toBottom();

    controller = new AbortController();
    setBusy(true);
    let finished = false;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, sessionId }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `服务器返回 ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.sessionId) sessionId = ev.sessionId;
          if (ev.type === 'delta') view.delta(ev.text);
          else if (ev.type === 'tool') view.tool(ev);
          else if (ev.type === 'done') (finished = true), view.finish(ev);
          else if (ev.type === 'error') (finished = true), view.fail(ev.message);
        }
      }
      if (!finished) view.fail('连接中断了，答案可能不完整。请重新提问。');
    } catch (e) {
      if (e.name === 'AbortError') view.stopped();
      else view.fail(`无法连接到本地服务：${e.message}。请确认已在终端运行 npm start。`);
    } finally {
      controller = null;
      setBusy(false);
      input.focus();
    }
  }

  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) return controller.abort();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    autosize();
    send(q);
  });
  input.addEventListener('input', () => {
    autosize();
    if (!controller) sendBtn.disabled = !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('composer').requestSubmit();
    }
  });

  const welcomeHtml = $('welcome').outerHTML;
  function mountStarters() {
    const box = $('starters');
    if (!box) return;
    STARTERS.forEach(([tag, q]) => {
      const b = el('button', 'starter');
      b.type = 'button';
      b.append(el('b', null, tag), el('span', null, q));
      b.onclick = () => send(q);
      box.appendChild(b);
    });
  }
  $('newChat').onclick = () => {
    controller?.abort();
    sessionId = null;
    inner.innerHTML = welcomeHtml;
    mountStarters();
    side.classList.remove('open');
    input.focus();
  };

  // 侧栏抽屉（窄屏）与主题
  $('menuBtn').onclick = () => side.classList.add('open');
  $('scrim').onclick = () => side.classList.remove('open');
  $('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (e) {}
  };

  // 知识库状态
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  let pollTimer = 0;
  async function loadKb() {
    try {
      const kb = await (await fetch('/api/kb')).json();
      $('kbTotal').textContent = kb.total.toLocaleString('zh-CN');
      $('modelName').textContent = kb.model;
      const meta = $('kbMeta');
      meta.innerHTML = '';
      const dot = el('span', 'dot' + (kb.crawling ? ' busy' : kb.total ? '' : ' warn'));
      meta.append(dot, el('span', null, kb.crawling ? '正在从官网更新…' : kb.total ? `上次更新 ${fmtDate(kb.lastRun)}` : '还没有资料，点“更新”开始抓取'));
      const btn = $('crawlBtn');
      btn.disabled = kb.crawling;
      btn.textContent = kb.crawling ? '更新中' : '更新';
      const list = $('kbList');
      list.innerHTML = '';
      kb.sources.forEach((s) => {
        const li = el('li');
        li.title = s.name;
        li.append(el('span', null, s.nameZh), el('span', null, String(s.count)));
        list.appendChild(li);
      });
      clearTimeout(pollTimer);
      if (kb.crawling) pollTimer = setTimeout(loadKb, 4000);
      return kb;
    } catch (e) {
      $('kbMeta').textContent = '读取不到知识库状态';
    }
  }
  $('crawlBtn').onclick = async () => {
    const before = Number($('kbTotal').textContent.replace(/\D/g, '')) || 0;
    await fetch('/api/kb/crawl', { method: 'POST' });
    toast('开始从官网抓取最新文件');
    const wait = async () => {
      const kb = await loadKb();
      if (kb && kb.crawling) return setTimeout(wait, 4000);
      if (kb) toast(`更新完成，新增 ${Math.max(0, kb.total - before)} 篇`, 'success');
    };
    setTimeout(wait, 1500);
  };

  mountStarters();
  loadKb();
  setBusy(false);
  input.focus();
})();
