// 探测参考应用的托管方式（GitHub Pages 等）
const targets = [
  ['page', 'https://mistydew.github.io/e-invoice-stock-form/'],
  ['repo-api', 'https://api.github.com/repos/mistydew/e-invoice-stock-form'],
  ['user-api', 'https://api.github.com/users/mistydew/repos?per_page=100&sort=updated'],
  ['pages-api', 'https://api.github.com/repos/mistydew/e-invoice-stock-form/pages'],
  ['cname', 'https://api.github.com/repos/mistydew/e-invoice-stock-form/contents/CNAME'],
  ['workflows', 'https://api.github.com/repos/mistydew/e-invoice-stock-form/contents/.github/workflows'],
  ['root-contents', 'https://api.github.com/repos/mistydew/e-invoice-stock-form/contents/'],
];

for (const [name, url] of targets) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'trip-roulette/0.1', Accept: 'application/vnd.github+json' },
      redirect: 'follow',
    });
    const txt = await res.text();
    console.log(`\n===== [${name}] ${res.status} ${txt.length}B =====`);
    if (url.includes('api.github.com')) {
      try {
        const j = JSON.parse(txt);
        if (Array.isArray(j)) {
          console.log(`数组 ${j.length} 项`);
          for (const it of j.slice(0, 12)) console.log(`  - ${it.name}${it.path ? ` (${it.path})` : ''}`);
        } else if (j.name && j.full_name && !j.message) {
          console.log(JSON.stringify({
            full_name: j.full_name, homepage: j.homepage, has_pages: j.has_pages, default_branch: j.default_branch,
            description: j.description, language: j.language, size: j.size, created_at: j.created_at, pushed_at: j.pushed_at,
            license: j.license?.spdx_id, topics: j.topics, stargazers_count: j.stargazers_count,
          }, null, 2));
        } else if (j.content) {
          console.log(Buffer.from(j.content, 'base64').toString('utf8'));
        } else if (j.html_url) {
          console.log(JSON.stringify({ html_url: j.html_url, status: j.status, source: j.source, cname: j.cname, build_type: j.build_type }, null, 2));
        } else {
          console.log(txt.slice(0, 600));
        }
      } catch { console.log(txt.slice(0, 400)); }
    } else {
      console.log(txt.slice(0, 1200));
      const m = txt.match(/<title>([^<]*)<\/title>/i);
      if (m) console.log(`\n<title> = ${m[1]}`);
      const assets = [...txt.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1]).slice(0, 12);
      console.log('资源引用:', JSON.stringify(assets, null, 1));
    }
  } catch (e) {
    console.log(`\n===== [${name}] ERR ${e.message} =====`);
  }
}
