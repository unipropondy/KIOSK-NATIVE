const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const files = [
  '+not-found.html',
  'explore.html',
  'index.html',
  'KioskStartPage.html',
  'LoginPage.html',
  'OrderingScreen.html',
  'SettlementSuccessScreen.html',
  '_sitemap.html'
];

// Copy pos-logo.png to dist/favicon.ico and dist/favicon.png
const logoSource = path.join(projectRoot, 'assets', 'images', 'pos-logo.png');
fs.copyFileSync(logoSource, path.join(distDir, 'favicon.ico'));
fs.copyFileSync(logoSource, path.join(distDir, 'favicon.png'));

files.forEach(file => {
  const filePath = path.join(distDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const oldTag = '<link rel="icon" href="/favicon.ico"/>';
    const newTags = '<link rel="icon" type="image/png" href="/favicon.png"/><link rel="shortcut icon" type="image/png" href="/favicon.png"/><link rel="apple-touch-icon" href="/favicon.png"/>';
    if (content.includes(oldTag)) {
      content = content.replace(oldTag, newTags);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${file}`);
    }
  }
});

console.log('Dist favicon patch complete.');
