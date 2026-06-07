const fs = require("fs");
const path = require("path");

const owner = process.env.PROFILE_OWNER;
const token = process.env.GITHUB_TOKEN;
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const outDir = process.env.PROFILE_STATS_OUT_DIR || path.join(workspace, "dist");

if (!owner) {
  throw new Error("PROFILE_OWNER is required");
}

fs.mkdirSync(outDir, { recursive: true });

const baseHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ao-chii-profile-readme",
};

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&apos;",
}[char]));

const formatNumber = (value) => new Intl.NumberFormat("en-US").format(value);
const pct = (value, total) => (total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%");

async function requestJson(url) {
  const attempts = token ? [true, false] : [false];
  let lastError = "";

  for (const useToken of attempts) {
    const headers = { ...baseHeaders };
    if (useToken) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });
    if (response.ok) {
      return response.json();
    }

    const body = await response.text();
    lastError = `${response.status} ${response.statusText}: ${url}\n${body}`;
    if (useToken && (response.status === 401 || response.status === 403)) {
      console.warn(`Retrying without GITHUB_TOKEN: ${url}`);
      continue;
    }

    throw new Error(lastError);
  }

  throw new Error(lastError);
}

async function listOwnerRepos() {
  const repos = [];

  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?type=owner&sort=updated&per_page=100&page=${page}`;
    const data = await requestJson(url);
    repos.push(...data);
    if (data.length < 100) break;
  }

  return repos.filter((repo) =>
    repo.owner.login.toLowerCase() === owner.toLowerCase() &&
    !repo.fork &&
    !repo.archived
  );
}

function metric(label, value, x, y) {
  return `
    <g transform="translate(${x},${y})">
      <polygon points="0,0 190,-6 181,46 -8,52" fill="#111111" stroke="#732424" stroke-width="2" />
      <text x="12" y="18" fill="#7b7b7b" font-family="Arial Black, Impact, sans-serif" font-size="11" font-weight="900">${esc(label)}</text>
      <text x="12" y="41" fill="#ffffff" font-family="Arial Black, Impact, sans-serif" font-size="24" font-weight="900">${esc(value)}</text>
    </g>`;
}

function renderStatsCard(repos, topLangs) {
  const totalStars = repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const activeRepos = repos.filter((repo) => new Date(repo.pushed_at || 0).getTime() >= oneYearAgo).length;
  const topLanguage = topLangs[0]?.name || "N/A";

  return `<svg width="495" height="195" viewBox="0 0 495 195" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
    <title id="title">AO-CHII profile stats</title>
    <desc id="desc">Self-generated GitHub profile statistics.</desc>
    <rect width="495" height="195" fill="#0d0d0d" />
    <polygon points="0,0 250,0 216,58 0,74" fill="#d92323" />
    <polygon points="386,0 495,0 495,195 332,195" fill="#732424" opacity="0.7" />
    <path d="M-20 160L190 -20M390 214L520 20" stroke="#ffffff" stroke-width="8" opacity="0.11" />
    <text x="24" y="38" fill="#ffffff" font-family="Arial Black, Impact, sans-serif" font-size="24" font-weight="900">PROFILE STATS</text>
    ${metric("PUBLIC REPOS", formatNumber(repos.length), 34, 78)}
    ${metric("TOTAL STARS", formatNumber(totalStars), 270, 78)}
    ${metric("ACTIVE 12M", formatNumber(activeRepos), 34, 136)}
    ${metric("TOP LANG", topLanguage.toUpperCase(), 270, 136)}
  </svg>`;
}

function shortLanguageName(name) {
  return ({
    TypeScript: "TS",
    JavaScript: "JS",
    Dockerfile: "Docker",
  }[name] || name);
}

function renderLanguageCard(langs, totalLangBytes) {
  const colors = ["#d92323", "#ffffff", "#732424", "#7b7b7b", "#ff5555"];
  const topLangs = langs.slice(0, 4);
  const otherBytes = langs.slice(4).reduce((sum, lang) => sum + lang.bytes, 0);
  const displayLangs = otherBytes > 0
    ? [...topLangs, { name: "Other", bytes: otherBytes }]
    : topLangs;

  let cursor = 32;
  const segments = displayLangs.map((lang, index) => {
    const width = (lang.bytes / Math.max(totalLangBytes, 1)) * 431;
    const segment = `<rect x="${cursor.toFixed(1)}" y="66" width="${width.toFixed(1)}" height="15" fill="${colors[index % colors.length]}" />`;
    cursor += width;
    return segment;
  }).join("");

  const rows = displayLangs.map((lang, index) => {
    const x = index % 2 === 0 ? 34 : 260;
    const y = 96 + Math.floor(index / 2) * 32;
    const color = colors[index % colors.length];
    const swatchStroke = color === "#ffffff" ? "#7b7b7b" : color;

    return `
    <g transform="translate(${x},${y})">
      <polygon points="0,0 200,-5 194,26 -6,31" fill="#111111" stroke="#732424" stroke-width="2" />
      <rect x="12" y="8" width="10" height="10" fill="${color}" stroke="${swatchStroke}" stroke-width="1.5" />
      <text x="32" y="19" fill="#ffffff" font-family="Arial Black, Impact, sans-serif" font-size="13" font-weight="900">${esc(shortLanguageName(lang.name).toUpperCase())}</text>
      <text x="178" y="19" fill="#7b7b7b" font-family="Arial Black, Impact, sans-serif" font-size="12" font-weight="900" text-anchor="end">${pct(lang.bytes, totalLangBytes)}</text>
    </g>`;
  }).join("");

  return `<svg width="495" height="195" viewBox="0 0 495 195" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
    <title id="title">AO-CHII language mix</title>
    <desc id="desc">Self-generated language distribution from GitHub Linguist byte counts.</desc>
    <rect width="495" height="195" fill="#0d0d0d" />
    <polygon points="0,0 260,0 220,58 0,74" fill="#d92323" />
    <polygon points="386,0 495,0 495,195 332,195" fill="#732424" opacity="0.7" />
    <path d="M-20 160L190 -20M390 214L520 20" stroke="#ffffff" stroke-width="8" opacity="0.11" />
    <text x="24" y="38" fill="#ffffff" font-family="Arial Black, Impact, sans-serif" font-size="24" font-weight="900">LANGUAGE MIX</text>
    <rect x="32" y="66" width="431" height="15" fill="#111111" stroke="#732424" stroke-width="2" />
    ${segments}
    ${rows || `<text x="34" y="112" fill="#7b7b7b" font-family="Arial, sans-serif" font-size="13">No language data found.</text>`}
  </svg>`;
}

function renderDashboard(repos, langs, totalLangBytes) {
  const totalStars = repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const activeRepos = repos.filter((repo) => new Date(repo.pushed_at || 0).getTime() >= oneYearAgo).length;
  const colors = ["#e60012", "#f2f2f2", "#8a0a14", "#7b7b7b", "#ff5555"];
  const topLangs = langs.slice(0, 4);
  const otherBytes = langs.slice(4).reduce((sum, lang) => sum + lang.bytes, 0);
  const displayLangs = otherBytes > 0
    ? [...topLangs, { name: "Other", bytes: otherBytes }]
    : topLangs;

  const dossierItems = [
    ["REPOS", formatNumber(repos.length)],
    ["ACTIVE 12M", formatNumber(activeRepos)],
    ["STARS", formatNumber(totalStars)],
    ["TOP LANG", shortLanguageName(langs[0]?.name || "N/A").toUpperCase()],
  ];

  const dossier = dossierItems.map(([label, value], index) => {
    const x = 34 + (index % 2) * 185;
    const y = 82 + Math.floor(index / 2) * 68;
    return `
    <g transform="translate(${x},${y})">
      <polygon points="0,0 162,-5 154,49 -8,55" fill="#111111" stroke="#8a0a14" stroke-width="2" />
      <text x="12" y="18" fill="#7b7b7b" font-family="Arial Black, Impact, sans-serif" font-size="11" font-weight="900">${esc(label)}</text>
      <text x="12" y="43" fill="#f2f2f2" font-family="Arial Black, Impact, sans-serif" font-size="25" font-weight="900">${esc(value)}</text>
    </g>`;
  }).join("");

  let cursor = 506;
  const segments = displayLangs.map((lang, index) => {
    const width = (lang.bytes / Math.max(totalLangBytes, 1)) * 420;
    const segment = `<rect x="${cursor.toFixed(1)}" y="88" width="${width.toFixed(1)}" height="18" fill="${colors[index % colors.length]}" />`;
    cursor += width;
    return segment;
  }).join("");

  const languageChips = displayLangs.map((lang, index) => {
    const major = index === 0;
    const x = major ? 506 : 506 + ((index - 1) % 2) * 215;
    const y = major ? 120 : 166 + Math.floor((index - 1) / 2) * 42;
    const width = major ? 420 : 202;
    const color = colors[index % colors.length];
    const swatchStroke = color === "#ffffff" ? "#7b7b7b" : color;
    const name = esc(shortLanguageName(lang.name).toUpperCase());
    const percent = pct(lang.bytes, totalLangBytes);

    return `
    <g transform="translate(${x},${y})">
      <polygon points="0,0 ${width},-6 ${width - 8},32 -8,38" fill="${major ? "#151515" : "#111111"}" stroke="#8a0a14" stroke-width="2" />
      <rect x="14" y="${major ? 10 : 9}" width="${major ? 13 : 10}" height="${major ? 13 : 10}" fill="${color}" stroke="${swatchStroke}" stroke-width="1.5" />
      <text x="${major ? 38 : 31}" y="${major ? 24 : 21}" fill="#f2f2f2" font-family="Arial Black, Impact, sans-serif" font-size="${major ? 19 : 13}" font-weight="900">${name}</text>
      <text x="${width - 20}" y="${major ? 24 : 21}" fill="#7b7b7b" font-family="Arial Black, Impact, sans-serif" font-size="${major ? 16 : 12}" font-weight="900" text-anchor="end">${percent}</text>
    </g>`;
  }).join("");

  return `<svg width="980" height="260" viewBox="0 0 980 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
    <title id="title">AO-CHII profile dashboard</title>
    <desc id="desc">Self-generated GitHub profile statistics and language distribution.</desc>
    <style>text{font-family:'Arial Black',Impact,'Franklin Gothic Heavy',sans-serif;font-weight:900;font-style:italic}</style>
    <rect width="980" height="260" fill="#0a0a0a" />
    <polygon points="0,0 424,0 364,72 0,88" fill="#e60012" />
    <polygon points="760,0 980,0 980,260 684,260" fill="#8a0a14" opacity="0.7" />
    <path d="M-30 220L220 -20M728 292L1014 -22" stroke="#f2f2f2" stroke-width="10" opacity="0.11" />
    <polygon points="458,0 530,0 454,260 382,260" fill="#0a0a0a" />
    <polygon points="458,0 472,0 396,260 382,260" fill="#e60012" />
    <polygon points="514,0 530,0 454,260 438,260" fill="#8a0a14" opacity="0.9" />
    <g transform="skewX(-8)">
      <text x="38" y="45" fill="#f2f2f2" font-size="26">PROFILE DOSSIER</text>
      <text x="518" y="45" fill="#f2f2f2" font-size="26">LANGUAGE MIX</text>
    </g>
    ${dossier}
    <rect x="506" y="88" width="420" height="18" fill="#111111" stroke="#8a0a14" stroke-width="2" />
    ${segments}
    ${languageChips || `<text x="506" y="144" fill="#7b7b7b" font-family="Arial, sans-serif" font-size="14">No language data found.</text>`}
    <g transform="translate(456,130)">
      <g>
        <animateTransform attributeName="transform" attributeType="XML" type="scale" values="0.95;1.05;0.95" dur="3.2s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
        <polygon points="0,-38 6.1,-14.7 26.9,-26.9 14.7,-6.1 38,0 14.7,6.1 26.9,26.9 6.1,14.7 0,38 -6.1,14.7 -26.9,26.9 -14.7,6.1 -38,0 -14.7,-6.1 -26.9,-26.9 -6.1,-14.7" fill="#e60012" stroke="#f2f2f2" stroke-width="4" />
        <line x1="-15" y1="-15" x2="15" y2="15" stroke="#f2f2f2" stroke-width="10" stroke-linecap="round" />
        <line x1="-15" y1="15" x2="15" y2="-15" stroke="#f2f2f2" stroke-width="10" stroke-linecap="round" />
      </g>
    </g>
  </svg>`;
}

async function main() {
  const repos = await listOwnerRepos();
  const languages = new Map();
  const failedRepos = [];

  for (const repo of repos) {
    try {
      const data = await requestJson(repo.languages_url);
      for (const [name, bytes] of Object.entries(data)) {
        languages.set(name, (languages.get(name) || 0) + bytes);
      }
    } catch (error) {
      console.warn(`Skipped ${repo.name}: ${error.message}`);
      failedRepos.push(repo.name);
    }
  }

  if (failedRepos.length > 0) {
    throw new Error(`Language generation aborted. Failed repos: ${failedRepos.join(", ")}`);
  }

  const totalLangBytes = [...languages.values()].reduce((sum, bytes) => sum + bytes, 0);
  const sortedLangs = [...languages.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  const topLangs = sortedLangs.slice(0, 6);

  fs.writeFileSync(path.join(outDir, "profile-stats.svg"), renderStatsCard(repos, topLangs).trim());
  fs.writeFileSync(path.join(outDir, "profile-langs.svg"), renderLanguageCard(sortedLangs, totalLangBytes).trim());
  fs.writeFileSync(path.join(outDir, "profile-dashboard.svg"), renderDashboard(repos, sortedLangs, totalLangBytes).trim());

  console.log(`Generated profile cards for ${repos.length} public non-fork repositories.`);
  console.log(topLangs.map((lang) => `${lang.name} ${pct(lang.bytes, totalLangBytes)}`).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
