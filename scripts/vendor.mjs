// node_modules から表示用ライブラリを public/vendor にコピーする
// （wrangler.toml の [build] から deploy / dev の前に自動で実行される）
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

const files = [
  ['marked/lib/marked.umd.js', 'marked.umd.js'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['@highlightjs/cdn-assets/highlight.min.js', 'highlight.min.js'],
  ['@highlightjs/cdn-assets/languages/powershell.min.js', 'hljs-powershell.min.js'],
  ['@highlightjs/cdn-assets/languages/dos.min.js', 'hljs-dos.min.js'],
  ['@highlightjs/cdn-assets/languages/dockerfile.min.js', 'hljs-dockerfile.min.js'],
  ['@highlightjs/cdn-assets/styles/github.min.css', 'hljs-github.min.css'],
  ['@highlightjs/cdn-assets/styles/github-dark.min.css', 'hljs-github-dark.min.css'],
  ['github-markdown-css/github-markdown.css', 'github-markdown.css'],
  ['mermaid/dist/mermaid.min.js', 'mermaid.min.js'],
];

mkdirSync(out, { recursive: true });
for (const [src, dest] of files) {
  try {
    copyFileSync(join(nm, src), join(out, dest));
  } catch (err) {
    console.error(`[vendor] ${src} が見つかりません。先に npm install（または npm ci）を実行してください。`);
    process.exit(1);
  }
}
console.log(`[vendor] ${files.length} files → public/vendor`);
