// İnternetsiz tek dosya: oyunun tüm kodu, stili, simgesi ve Three.js tek bir HTML'e gömülür.
// Çıktılar:
//   dist/ok-kup.html          → telefona/bilgisayara kaydedilip açılabilen tam HTML
//   dist/ok-kup-artifact.html → claude.ai Artifact olarak yayınlanan sürüm (doctype/head olmadan)
//   docs/index.html           → GitHub Pages sayfası (dist/ok-kup.html ile aynı)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => path.join(ROOT, 'public', p);

const result = await build({
  entryPoints: [pub('js/main.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['safari15'],
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(pub('style.css'), 'utf8');
const html = fs.readFileSync(pub('index.html'), 'utf8');
const icon = 'data:image/png;base64,' + fs.readFileSync(pub('icons/apple-touch-icon.png')).toString('base64');

const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script type="module" src="\/js\/main.js"><\/script>\s*/, '\n');

const headCommon = `<title>Ok Küp</title>
<meta name="description" content="Küpün üzerindeki okları temizle, en zor noktadaki tatlı dostunu kurtar!">
<meta name="theme-color" content="#e6eef3">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Ok Küp">
<link rel="apple-touch-icon" href="${icon}">
<link rel="icon" href="${icon}">`;

const scripts = `<script>window.OKKUP_OFFLINE = true;</script>
<script type="module">${js}</script>`;

const full = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
${headCommon}
<style>${css}</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`;

// Artifact sürümü: sayfa iskeleti yayınlarken eklenir; oyun kendi tek görünümlü temasını kullanır.
const artifact = `${headCommon}
<style>${css}
:root { color-scheme: light; }
body { background-color: #e3ecf1; }
</style>
${body}
${scripts}
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'ok-kup.html'), full);
fs.writeFileSync(path.join(ROOT, 'dist', 'ok-kup-artifact.html'), artifact);
// GitHub Pages: docs/ klasörü doğrudan yayınlanır (Settings → Pages → Branch, /docs)
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), full);
fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), '');
console.log(`dist/ok-kup.html ${(full.length / 1024).toFixed(0)} KB`);
