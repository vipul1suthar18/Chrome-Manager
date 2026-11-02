const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = (...parts) => path.join(root, 'node_modules', ...parts);
const dest = (...parts) => path.join(root, 'src', 'vendor', ...parts);

fs.mkdirSync(dest('fontawesome', 'css'), { recursive: true });
fs.mkdirSync(dest('fontawesome', 'webfonts'), { recursive: true });
fs.copyFileSync(src('@fortawesome', 'fontawesome-free', 'css', 'all.min.css'), dest('fontawesome', 'css', 'all.min.css'));
fs.cpSync(src('@fortawesome', 'fontawesome-free', 'webfonts'), dest('fontawesome', 'webfonts'), { recursive: true });

const weights = [300, 400, 500, 600, 700];
fs.mkdirSync(dest('inter', 'files'), { recursive: true });
const fontFaces = weights.map(weight => {
  const name = 'inter-latin-' + weight + '-normal.woff2';
  fs.copyFileSync(src('@fontsource', 'inter', 'files', name), dest('inter', 'files', name));
  return "@font-face{font-family:'Inter';font-style:normal;font-weight:" + weight + ";font-display:swap;src:url('./files/" + name + "') format('woff2')}";
});
fs.writeFileSync(dest('inter', 'inter.css'), fontFaces.join('\n') + '\n');
