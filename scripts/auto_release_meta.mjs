#!/usr/bin/env node
/**
 * Zero-Touch Auto-Versioning & Auto-Changelog Engine for Open Neom CI/CD.
 *
 * Responsibilities:
 *  1. Sanitizes pubspec.yaml `version: X.Y.Z+N` (strips `-beta` / `-rc` suffixes
 *     that Apple App Store Connect rejects in CFBundleShortVersionString).
 *  2. Compares against already-published versions in `Open-Neom/releases` so that:
 *     - Developers NEVER have to manually bump `pubspec.yaml` before pushing/merging to `main`.
 *     - `buildNumber` (`versionCode` / `CFBundleVersion`) ALWAYS increases monotonically,
 *       preventing Google Play & App Store duplicate-build rejections.
 *  3. Auto-generates `CHANGELOG.md` entries + Google Play `whatsnew` (<=490 chars) +
 *     App Store `release_notes.txt` from Git commit history whenever the developer
 *     didn't manually add a section for the new version.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    out[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  }
  return out;
}

function parseSemverTuple(ver) {
  const clean = String(ver || '1.0.0').split('-')[0].trim();
  const parts = clean.split('.').map((n) => Number.parseInt(n, 10));
  return [
    Number.isFinite(parts[0]) ? parts[0] : 1,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ];
}

function compareSemver(a, b) {
  const ta = parseSemverTuple(a);
  const tb = parseSemverTuple(b);
  for (let i = 0; i < 3; i += 1) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

function formatSemver(tuple) {
  return `${tuple[0]}.${tuple[1]}.${tuple[2]}`;
}

function runGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function queryLatestPublished(releasesRepo, slug) {
  let highestSemver = null;
  let highestBuild = 0;

  // 1. Check local releases-manifest.json if downloaded by workflow
  if (fs.existsSync('releases-manifest.json')) {
    try {
      const manifest = JSON.parse(fs.readFileSync('releases-manifest.json', 'utf8'));
      const entry = manifest?.apps?.[slug];
      if (entry?.version) {
        highestSemver = formatSemver(parseSemverTuple(entry.version));
      }
      if (Number.isFinite(Number(entry?.buildNumber))) {
        highestBuild = Math.max(highestBuild, Number(entry.buildNumber));
      }
    } catch {
      // ignore malformed manifest
    }
  }

  // 2. Also inspect immutable tags `<slug>-vX.Y.Z+N` on Open-Neom/releases via `gh`
  if (process.env.GH_TOKEN && releasesRepo) {
    try {
      const raw = execFileSync(
        'gh',
        ['release', 'list', '--repo', releasesRepo, '--limit', '100', '--json', 'tagName'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const list = JSON.parse(raw);
      const prefix = `${slug}-v`;
      for (const item of list) {
        const tag = String(item?.tagName || '');
        if (!tag.startsWith(prefix)) continue;
        const verPart = tag.slice(prefix.length);
        const [sv, bld] = verPart.split('+');
        const cleanSv = formatSemver(parseSemverTuple(sv));
        if (!highestSemver || compareSemver(cleanSv, highestSemver) > 0) {
          highestSemver = cleanSv;
        }
        const bNum = Number.parseInt(bld, 10);
        if (Number.isFinite(bNum)) {
          highestBuild = Math.max(highestBuild, bNum);
        }
      }
    } catch {
      // repo may have zero releases yet
    }
  }

  return { highestSemver, highestBuild };
}

async function queryGooglePlayMaxVersionCode(packageName, saJsonRaw) {
  if (!packageName || !saJsonRaw) return 0;
  try {
    const sa = JSON.parse(saJsonRaw);
    if (!sa.client_email || !sa.private_key) return 0;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claim = Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 900,
      }),
    ).toString('base64url');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const jwt = `${header}.${claim}.${signer.sign(sa.private_key, 'base64url')}`;

    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return 0;

    const editRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    const edit = await editRes.json();
    if (!editRes.ok || !edit.id) return 0;

    const trkRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits/${edit.id}/tracks`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } },
    );
    const trks = await trkRes.json();
    await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits/${edit.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${tok.access_token}` } },
    );
    const codes = (trks.tracks || [])
      .flatMap((t) => (t.releases || []).flatMap((r) => r.versionCodes || []))
      .map(Number)
      .filter(Number.isFinite);
    return codes.length ? Math.max(...codes) : 0;
  } catch {
    return 0;
  }
}

function collectRecentCommits() {
  const lastReleaseSha = runGit(['log', '--grep=^chore(release):', '-n', '1', '--format=%H']);
  const rangeArgs = lastReleaseSha
    ? ['log', `${lastReleaseSha}..HEAD`, '--no-merges', '--format=%s']
    : ['log', '-n', '15', '--no-merges', '--format=%s'];

  const rawLines = runGit(rangeArgs)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^chore\(release\):/i.test(l) && !/\[skip ci\]/i.test(l));

  // Deduplicate preserving order
  return [...new Set(rawLines)].slice(0, 15);
}

function buildAutoChangelogSection(semver, buildNum, commits) {
  const today = new Date().toISOString().slice(0, 10);
  const features = [];
  const fixes = [];
  const others = [];

  for (const subject of commits) {
    const clean = subject
      .replace(/^(feat|fix|perf|refactor|chore|docs|style|test|build|ci)(\([^)]+\))?!?:\s*/i, '')
      .trim();
    const bullet = clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : subject;

    if (/^feat(\(|!|:)/i.test(subject)) {
      features.push(`- ${bullet}`);
    } else if (/^fix(\(|!|:)/i.test(subject)) {
      fixes.push(`- ${bullet}`);
    } else if (!/^(chore|ci|docs|style|test)(\(|:)/i.test(subject)) {
      others.push(`- ${bullet}`);
    }
  }

  const lines = [`## [${semver}+${buildNum}] - ${today}`];
  if (features.length > 0) {
    lines.push('', '### Novedades', ...features);
  }
  if (fixes.length > 0) {
    lines.push('', '### Correcciones', ...fixes);
  }
  if (others.length > 0) {
    lines.push('', '### Mejoras', ...others);
  }
  if (features.length === 0 && fixes.length === 0 && others.length === 0) {
    lines.push('', '- Mejoras generales de rendimiento, estabilidad y experiencia multiplataforma.');
  }
  return lines.join('\n');
}

const args = parseArgs(process.argv);
const slug = args.slug || 'app';
const displayName = args.name || slug;
const releasesRepo = args['releases-repo'] || 'Open-Neom/releases';
const androidPkg = args['android-package'] || '';
const buildOffset = Number.parseInt(args['build-offset'] || '0', 10) || 0;
const runNumber = Number.parseInt(args['run-number'] || '1', 10) || 1;
const outDir = path.resolve(args['out-dir'] || 'release-meta');

const pubspecPath = path.resolve('pubspec.yaml');
const pubspecRaw = fs.readFileSync(pubspecPath, 'utf8');
const verMatch = pubspecRaw.match(/^version:\s*['"]?([^\s#'"]+)['"]?/m);
const rawVersion = verMatch ? verMatch[1] : '1.0.0+1';

const [rawSemverPart, rawBuildPart] = rawVersion.split('+');
const pubspecTuple = parseSemverTuple(rawSemverPart);
const pubspecSemver = formatSemver(pubspecTuple);
const pubspecBuild = Number.isFinite(Number.parseInt(rawBuildPart, 10))
  ? Number.parseInt(rawBuildPart, 10)
  : buildOffset + runNumber;

const { highestSemver, highestBuild } = queryLatestPublished(releasesRepo, slug);
const playMaxBuild = await queryGooglePlayMaxVersionCode(
  androidPkg,
  process.env.GOOGLE_PLAY_SA_JSON || '',
);
const knownMaxBuild = Math.max(highestBuild, playMaxBuild);
const commits = collectRecentCommits();

let nextSemver = pubspecSemver;
let nextBuild = pubspecBuild;
let filesChanged = false;

if (highestSemver) {
  const cmp = compareSemver(pubspecSemver, highestSemver);
  if (cmp > 0) {
    // Developer manually bumped semver; ensure monotonic buildNumber for Play Store
    nextSemver = pubspecSemver;
    nextBuild = Math.max(pubspecBuild, knownMaxBuild + 1);
  } else {
    // Zero-touch auto-bump! Developer pushed/merged without touching pubspec.yaml
    const base = parseSemverTuple(highestSemver);
    const joined = commits.join('\n');
    if (/BREAKING CHANGE|\[major\]|^[a-z]+(\([^)]+\))?!:/im.test(joined)) {
      nextSemver = formatSemver([base[0] + 1, 0, 0]);
    } else if (/\[minor\]/i.test(joined)) {
      nextSemver = formatSemver([base[0], base[1] + 1, 0]);
    } else {
      nextSemver = formatSemver([base[0], base[1], base[2] + 1]);
    }
    nextBuild = Math.max(pubspecBuild, knownMaxBuild) + 1;
  }
} else {
  if (rawSemverPart !== pubspecSemver) {
    // Strip `-beta` / `-alpha` on initial release too so iOS App Store accepts it
    nextSemver = pubspecSemver;
  }
  if (knownMaxBuild >= nextBuild) {
    // Live Play Store already has >= pubspec buildNumber (e.g. Gigmeout +121); bump automatically!
    nextBuild = knownMaxBuild + 1;
    nextSemver = formatSemver([pubspecTuple[0], pubspecTuple[1], pubspecTuple[2] + 1]);
  }
}

const fullVersion = `${nextSemver}+${nextBuild}`;
if (rawVersion !== fullVersion) {
  const updatedPubspec = pubspecRaw.replace(
    /^version:\s*.*$/m,
    `version: ${fullVersion}`,
  );
  fs.writeFileSync(pubspecPath, updatedPubspec, 'utf8');
  filesChanged = true;
}

// Inspect or auto-prepend CHANGELOG.md
const changelogPath = path.resolve('CHANGELOG.md');
const existingChangelog = fs.existsSync(changelogPath)
  ? fs.readFileSync(changelogPath, 'utf8')
  : '# Changelog\n';

const escapedSemver = nextSemver.replace(/\./g, '\\.');
const hasManualEntry = new RegExp(`^##\\s+\\[?v?${escapedSemver}(\\+\\d+)?\\]?`, 'm').test(
  existingChangelog,
);

let latestSectionMd = '';
if (hasManualEntry) {
  const lines = existingChangelog.split(/\r?\n/);
  let inSection = false;
  const collected = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (!inSection) {
        inSection = true;
        collected.push(line);
        continue;
      }
      break;
    }
    if (inSection) collected.push(line);
  }
  latestSectionMd = collected.join('\n').trim();
} else {
  latestSectionMd = buildAutoChangelogSection(nextSemver, nextBuild, commits);
  let updatedChangelog;
  if (/^#\s+.*$/m.test(existingChangelog)) {
    updatedChangelog = existingChangelog.replace(
      /^(#\s+.*$)/m,
      `$1\n\n${latestSectionMd}`,
    );
  } else {
    updatedChangelog = `# Changelog\n\n${latestSectionMd}\n\n${existingChangelog}`;
  }
  fs.writeFileSync(changelogPath, `${updatedChangelog.trim()}\n`, 'utf8');
  filesChanged = true;
}

// Emit release-meta files for GitHub Releases, Google Play (<=490 chars), and App Store
fs.mkdirSync(path.join(outDir, 'whatsnew'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'release_notes.md'), `${latestSectionMd}\n`, 'utf8');

const plainNotes = latestSectionMd
  .replace(/^##\s+.*$/m, '')
  .replace(/^###\s+(.*)$/gm, '• $1:')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[*`]/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim() || `Nuevas mejoras y optimizaciones en ${displayName} v${nextSemver}.`;

const playNotes = plainNotes.slice(0, 490).trim();
const iosNotes = plainNotes.slice(0, 3800).trim();

fs.writeFileSync(path.join(outDir, 'ios_notes.txt'), `${iosNotes}\n`, 'utf8');
for (const locale of ['es-419', 'es-ES', 'en-US']) {
  fs.writeFileSync(path.join(outDir, 'whatsnew', `whatsnew-${locale}`), `${playNotes}\n`, 'utf8');
}

if (process.env.GITHUB_OUTPUT) {
  const safeName = displayName.replace(/\s+/g, '-');
  const outputs = [
    `semver=${nextSemver}`,
    `build_number=${nextBuild}`,
    `full_version=${fullVersion}`,
    `safe_name=${safeName}`,
    `files_changed=${filesChanged}`,
  ];
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`, 'utf8');
}

console.log(`Zero-Touch Release Ready: ${displayName} v${fullVersion} (auto-updated=${filesChanged})`);
