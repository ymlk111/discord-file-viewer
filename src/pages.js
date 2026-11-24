// サーバー側で組み立てる HTML

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const head = (title, extra = '') => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/viewer.css">
${extra}
</head>`;

export function renderViewer({ id, name, kind, charset, lang }) {
  const styles = [
    kind === 'md' ? '<link rel="stylesheet" href="/vendor/github-markdown.css">' : '',
    '<link rel="stylesheet" href="/vendor/hljs-github.min.css" media="(prefers-color-scheme: light)">',
    '<link rel="stylesheet" href="/vendor/hljs-github-dark.min.css" media="(prefers-color-scheme: dark)">',
  ].join('\n');
  const scripts = [
    '/vendor/highlight.min.js',
    '/vendor/hljs-powershell.min.js',
    '/vendor/hljs-dos.min.js',
    '/vendor/hljs-dockerfile.min.js',
    ...(kind === 'md' ? ['/vendor/marked.umd.js', '/vendor/purify.min.js'] : []),
    '/viewer.js',
  ]
    .map((src) => `<script src="${src}"></script>`)
    .join('\n');

  return `${head(name, styles)}
<body class="kind-${esc(kind)}" data-id="${esc(id)}" data-kind="${esc(kind)}" data-charset="${esc(charset)}" data-lang="${esc(lang)}" data-name="${esc(name)}">
<header class="bar">
  <span class="name" title="${esc(name)}">${esc(name)}</span>
  <div class="actions" id="actions"></div>
</header>
<nav class="toc" id="toc" hidden></nav>
<main id="app"><p class="status">読み込み中…</p></main>
${scripts}
</body>
</html>`;
}

export function renderMessage(title, message) {
  return `${head(title)}
<body class="kind-message">
<main class="message">
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
</main>
</body>
</html>`;
}
