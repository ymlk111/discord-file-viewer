// ビューワー画面のクライアント処理（Markdown / HTML / テキスト）
(() => {
  'use strict';

  const body = document.body;
  const { id, kind, charset, lang, name } = body.dataset;
  const app = document.getElementById('app');
  const actions = document.getElementById('actions');
  const toc = document.getElementById('toc');
  const rawUrl = `/raw/${encodeURIComponent(id)}`;
  const HIGHLIGHT_LIMIT = 400 * 1024;

  const prefs = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`viewer:${k}`);
        return v === null ? d : v;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`viewer:${k}`, v);
      } catch {
        // 保存できない環境では無視
      }
    },
  };

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, onClick, { pressed } = {}) {
    const b = el('button', '', label);
    b.type = 'button';
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  }

  function linkButton(label, href, { newTab = false } = {}) {
    const a = el('a', '', label);
    a.href = href;
    if (newTab) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    return a;
  }

  const isPressed = (b) => b.getAttribute('aria-pressed') === 'true';
  const setPressed = (b, v) => b.setAttribute('aria-pressed', String(v));

  // ---- 読み込み・文字コード ----
  let textPromise = null;
  function loadText() {
    if (!textPromise) {
      textPromise = fetch(rawUrl)
        .then((r) => {
          if (!r.ok) throw new Error(r.status === 404 ? '有効期限が切れています' : `HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then(decode);
    }
    return textPromise;
  }

  function decode(buf) {
    for (const label of [charset, 'utf-8']) {
      if (!label) continue;
      try {
        return new TextDecoder(label).decode(buf);
      } catch {
        // 未対応のラベル → 次へ
      }
    }
    return new TextDecoder().decode(buf);
  }

  function showError(err) {
    console.error(err);
    app.replaceChildren(el('p', 'status error', `読み込めませんでした: ${err && err.message ? err.message : err}`));
  }

  // ---- ハイライト付きソース表示 ----
  function highlightInto(code, text, language) {
    const hljs = window.hljs;
    if (hljs && language && hljs.getLanguage(language) && text.length <= HIGHLIGHT_LIMIT) {
      try {
        code.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        code.classList.add('hljs');
        return;
      } catch {
        // ハイライト失敗時はプレーン表示
      }
    }
    code.textContent = text;
  }

  function sourceView(text, language) {
    const pre = el('pre', 'plain');
    const code = el('code');
    pre.append(code);
    highlightInto(code, text, language);
    pre.classList.toggle('wrap', prefs.get('wrap', '1') === '1');
    return pre;
  }

  function wrapButton(getPre) {
    const b = button('折返し', () => {
      const on = !isPressed(b);
      setPressed(b, on);
      prefs.set('wrap', on ? '1' : '0');
      const pre = getPre();
      if (pre) pre.classList.toggle('wrap', on);
    }, { pressed: prefs.get('wrap', '1') === '1' });
    return b;
  }

  // ---- Markdown ----
  function frontMatterToCode(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
    if (!m) return text;
    return `\`\`\`yaml\n${m[1]}\n\`\`\`\n\n${text.slice(m[0].length)}`;
  }

  function slugify(text, used) {
    const base =
      text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s+/g, '-') || 'section';
    let slug = base;
    for (let i = 1; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    return slug;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.append(s);
    });
  }

  async function renderMermaid(root) {
    const codes = root.querySelectorAll('pre > code.language-mermaid');
    if (!codes.length) return;
    const nodes = [...codes].map((code) => {
      const div = el('div', 'mermaid');
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
      return div;
    });
    try {
      await loadScript('/vendor/mermaid.min.js');
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
      await window.mermaid.run({ nodes, suppressErrors: true });
    } catch (err) {
      console.error('mermaid', err);
    }
  }

  // スマホ幅で日本語の表が1文字ずつ折り返されないように、
  // 短いセルは折り返さず、長いセルは一定幅で折り返して、表全体を横スクロールにする
  function fitTables(article) {
    for (const table of article.querySelectorAll('table')) {
      const wrap = el('div', 'table-wrap');
      table.replaceWith(wrap);
      wrap.append(table);
      for (const cell of table.querySelectorAll('th, td')) {
        const len = [...cell.textContent.trim()].length;
        cell.classList.add(len <= 12 ? 'nw' : 'wide');
      }
    }
  }

  function buildToc(article) {
    const heads = [...article.querySelectorAll('h1, h2, h3')];
    if (heads.length < 3) return null;
    const list = el('ol');
    for (const h of heads) {
      const li = el('li', `lv${h.tagName[1]}`);
      const a = el('a', '', h.textContent);
      a.href = `#${encodeURIComponent(h.id)}`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        toc.hidden = true;
        h.scrollIntoView({ block: 'start' });
        history.replaceState(null, '', `#${encodeURIComponent(h.id)}`);
      });
      li.append(a);
      list.append(li);
    }
    toc.replaceChildren(list);
    const b = button('目次', () => {
      toc.hidden = !toc.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!toc.hidden && !toc.contains(e.target) && e.target !== b) toc.hidden = true;
    });
    return b;
  }

  async function renderMarkdown() {
    const text = await loadText();

    window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.hasAttribute('href') && !node.getAttribute('href').startsWith('#')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    const html = window.marked.parse(frontMatterToCode(text), { gfm: true });
    const article = el('article', 'markdown-body');
    article.innerHTML = window.DOMPurify.sanitize(html);

    const used = new Set();
    for (const h of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) h.id = slugify(h.textContent, used);

    for (const code of article.querySelectorAll('pre > code')) {
      const m = code.className.match(/language-([\w+#-]+)/);
      const language = m && m[1].toLowerCase();
      if (!language || language === 'mermaid' || !window.hljs || !window.hljs.getLanguage(language)) continue;
      try {
        window.hljs.highlightElement(code);
      } catch {
        // そのまま表示
      }
    }

    fitTables(article);
    app.replaceChildren(article);

    const tocButton = buildToc(article);
    let source = null;
    const wrapBtn = wrapButton(() => source);
    wrapBtn.hidden = true;
    const srcBtn = button('ソース', () => {
      const on = !isPressed(srcBtn);
      setPressed(srcBtn, on);
      if (on) {
        source = source || sourceView(text, 'markdown');
        app.replaceChildren(source);
      } else {
        app.replaceChildren(article);
      }
      toc.hidden = true;
      if (tocButton) tocButton.hidden = on;
      wrapBtn.hidden = !on;
      window.scrollTo(0, 0);
    }, { pressed: false });

    actions.append(...[tocButton, srcBtn, wrapBtn, linkButton('保存', `${rawUrl}?dl=1`)].filter(Boolean));

    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView({ block: 'start' });
    }
    await renderMermaid(article);
  }

  // ---- HTML ----
  async function renderHtml() {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = name;
    frame.src = rawUrl;
    app.replaceChildren(frame);

    let source = null;
    const wrapBtn = wrapButton(() => source);
    wrapBtn.hidden = true;
    const srcBtn = button('ソース', async () => {
      const on = !isPressed(srcBtn);
      setPressed(srcBtn, on);
      wrapBtn.hidden = !on;
      body.classList.toggle('show-source', on);
      if (on) {
        try {
          source = source || sourceView(await loadText(), lang || 'xml');
          app.replaceChildren(source);
        } catch (err) {
          showError(err);
        }
      } else {
        app.replaceChildren(frame);
      }
    }, { pressed: false });

    actions.append(srcBtn, wrapBtn, linkButton('全画面', rawUrl, { newTab: true }), linkButton('保存', `${rawUrl}?dl=1`));
  }

  // ---- テキスト・コード ----
  function prettyJson(text) {
    const firstBreak = text.indexOf('\n');
    if (firstBreak !== -1 && firstBreak < 400) return text; // すでに整形済み
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  async function renderText() {
    let text = await loadText();
    if (lang === 'json') text = prettyJson(text);
    const pre = sourceView(text, lang);
    app.replaceChildren(pre);
    actions.append(wrapButton(() => pre), linkButton('保存', `${rawUrl}?dl=1`));
  }

  const renderers = { md: renderMarkdown, html: renderHtml, text: renderText };
  (renderers[kind] || renderText)().catch(showError);
})();
