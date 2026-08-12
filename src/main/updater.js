const https = require('https');

const REPO = process.env.MINEHOST_REPO || 'DanielMadrid/MineHost';
const UA = 'MineHost-Updater';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          return reject(new Error('NO_RELEASES'));
        }
        if (res.statusCode === 403) {
          res.resume();
          return reject(new Error('RATE_LIMIT'));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (err) { reject(err); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(9000, () => req.destroy(new Error('TIMEOUT')));
  });
}

/** Compares dotted versions; returns true when `candidate` is newer. */
function isNewer(candidate, current) {
  const clean = (v) => String(v).replace(/^v/i, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
  const a = clean(candidate);
  const b = clean(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function check(currentVersion) {
  try {
    const release = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!latest) return { ok: true, upToDate: true, version: currentVersion };

    const asset = (release.assets || []).find((a) => /\.exe$/i.test(a.name));

    return {
      ok: true,
      upToDate: !isNewer(latest, currentVersion),
      version: latest,
      current: currentVersion,
      url: asset?.browser_download_url || release.html_url,
      notes: release.body || '',
      publishedAt: release.published_at || null,
    };
  } catch (err) {
    // A repo with no releases yet is not an error worth alarming anyone about.
    if (err.message === 'NO_RELEASES') {
      return { ok: true, upToDate: true, version: currentVersion, noReleases: true };
    }
    return { ok: false, error: err.message };
  }
}

module.exports = { check, isNewer, REPO };
