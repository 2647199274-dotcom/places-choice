// 深挖参考应用：GitHub Actions 部署配置 + PWA 能力 + 用户仓库情况
const urls = [
  ['deploy.yml', 'https://raw.githubusercontent.com/mistydew/e-invoice-stock-form/main/.github/workflows/deploy.yml'],
  ['manifest', 'https://raw.githubusercontent.com/mistydew/e-invoice-stock-form/main/manifest.webmanifest'],
  ['README', 'https://raw.githubusercontent.com/mistydew/e-invoice-stock-form/main/README.md'],
];
for (const [n, u] of urls) {
  try {
    const res = await fetch(u, { headers: { 'User-Agent': 'trip-roulette/0.1' } });
    const t = await res.text();
    console.log(`\n===== [${n}] ${res.status} =====\n${t.slice(0, n === 'README' ? 1200 : 1600)}`);
  } catch (e) { console.log(`\n[${n}] ERR ${e.message}`); }
}

const user = await (await fetch('https://api.github.com/users/mistydew', { headers: { 'User-Agent': 'x' } })).json();
console.log(`\n===== 用户 mistydew =====`);
console.log(JSON.stringify({ login: user.login, name: user.name, public_repos: user.public_repos, created_at: user.created_at, html_url: user.html_url }, null, 2));

const repos = await (await fetch('https://api.github.com/users/mistydew/repos?per_page=100&sort=updated', { headers: { 'User-Agent': 'x' } })).json();
console.log('\n===== 该用户全部仓库 =====');
for (const r of repos) {
  console.log(`- ${r.name.padEnd(28)} pages=${String(r.has_pages).padEnd(5)} lang=${String(r.language).padEnd(12)} size=${String(r.size).padEnd(7)} pushed=${r.pushed_at?.slice(0, 10)}  ${r.description ?? ''}`);
}

// 检查是否已有 gh CLI / git 环境（部署要用）
console.log('\n===== 本机 git/gh 环境 =====');
