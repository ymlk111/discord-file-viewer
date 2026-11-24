// ファイル名・Content-Type から表示方法（md / html / text）とハイライト言語を決める

const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx']);
const HTML = new Set(['html', 'htm', 'svg']);

// 拡張子 → highlight.js の言語名（'' はハイライトなし）
const TEXT = new Map(Object.entries({
  txt: '', text: '', log: '', csv: '', tsv: '', out: '',
  json: 'json', jsonc: 'json', json5: 'json', geojson: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  xml: 'xml', xhtml: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml', vue: 'xml', jsp: 'xml',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin', go: 'go', rs: 'rust',
  rb: 'ruby', php: 'php', pl: 'perl', lua: 'lua', r: 'r', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp',
  vb: 'vbnet', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'dos', cmd: 'dos',
  css: 'css', scss: 'scss', less: 'less',
  diff: 'diff', patch: 'diff',
  gradle: '', dockerfile: 'dockerfile',
}));

// 拡張子なしでよくあるファイル名
const NAMED = new Map(Object.entries({
  dockerfile: 'dockerfile', makefile: 'makefile', license: '', readme: '',
  '.gitignore': '', '.env': 'ini', '.editorconfig': 'ini',
}));

export function extOf(filename = '') {
  const base = String(filename).split(/[\\/]/).pop().toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

function baseName(filename = '') {
  return String(filename).split(/[\\/]/).pop().toLowerCase();
}

export function detectKind(filename, contentType) {
  const ext = extOf(filename);
  if (MARKDOWN.has(ext)) return 'md';
  if (HTML.has(ext)) return 'html';
  if (TEXT.has(ext) || NAMED.has(baseName(filename))) return 'text';

  const ct = String(contentType || '').toLowerCase();
  if (ct.startsWith('text/markdown')) return 'md';
  if (ct.startsWith('text/html')) return 'html';
  if (ct.startsWith('text/') || /\b(json|xml|yaml|javascript)\b/.test(ct)) return 'text';
  return null;
}

export function langOf(filename, kind) {
  if (kind === 'md') return 'markdown';
  if (kind === 'html') return 'xml';
  const ext = extOf(filename);
  if (TEXT.has(ext)) return TEXT.get(ext);
  return NAMED.get(baseName(filename)) ?? '';
}

export function isSvg(filename) {
  return extOf(filename) === 'svg';
}
