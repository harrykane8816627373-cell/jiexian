const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: node scripts/package-pagelet.cjs <new-output-directory>');
  process.exit(1);
}

const repo = join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 8 * 1024 * 1024 });
const revision = git('rev-parse', 'HEAD').toString().trim();
const read = (file) => git('show', `${revision}:${file}`);
const wasm = 'vendor/z3smt2w.wasm.gz';
const signature = createHash('sha256').update(read(wasm)).digest('base64');
const asset = `https://raw.githubusercontent.com/harrykane8816627373-cell/jiexian/${revision}/${wasm}`;
const files = git('ls-tree', '-r', '--name-only', revision).toString().trim().split('\n')
  .filter((name) => /^[^/]+\.(html|css|js|png)$|^(?:vendor\/)?[\w-]*LICENSE\.txt$|^vendor\/z3smt2w\.js$/.test(name));

const worker = read('solver-worker.js').toString();
const localWasm = "fetch('./vendor/z3smt2w.wasm.gz')";
if (!worker.includes(localWasm)) throw new Error('The worker no longer uses the expected WASM path');
const deployedWorker = worker.replace(localWasm, `fetch('${asset}', { integrity: 'sha256-${signature}' })`);
const index = read('index.html').toString().replace('<meta charset="utf-8">',
  `<meta charset="utf-8">\n  <meta name="jiexian-revision" content="${revision}">`);

const directory = resolve(destination);
mkdirSync(directory);
for (const file of files) {
  const diskPath = join(directory, file);
  mkdirSync(dirname(diskPath), { recursive: true });
  const content = file === 'solver-worker.js' ? deployedWorker : file === 'index.html' ? index : read(file);
  writeFileSync(diskPath, content);
}
console.log(`Packaged ${revision} in ${directory}`);
