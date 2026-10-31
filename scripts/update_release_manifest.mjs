#!/usr/bin/env node
/**
 * Updates `releases-manifest.json` with the newly published binaries and SHA-256
 * hashes so any Open Neom / app website can display live versions & download URLs.
 *
 * Usage:
 *   node update_release_manifest.mjs \
 *     --manifest releases-manifest.json \
 *     --slug itzli \
 *     --name Itzli \
 *     --version 1.2.0 \
 *     --build 1005 \
 *     --repo Open-Neom/releases \
 *     --artifacts-dir collected_artifacts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    out[key] = argv[i + 1];
  }
  return out;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const args = parseArgs(process.argv);
const manifestPath = path.resolve(args.manifest || 'releases-manifest.json');
const slug = args.slug;
const displayName = args.name || slug;
const version = args.version;
const buildNumber = Number(args.build || 1);
const repo = args.repo || 'Open-Neom/releases';
const artifactsDir = path.resolve(args['artifacts-dir'] || '.');

let manifest = { updatedAt: new Date().toISOString(), apps: {} };
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.apps = manifest.apps || {};
  } catch (_) {
    // Reinitialize if malformed
  }
}

const latestTag = `${slug}-latest`;
const versionTag = `${slug}-v${version}+${buildNumber}`;
const baseLatestUrl = `https://github.com/${repo}/releases/download/${latestTag}`;
const baseVersionUrl = `https://github.com/${repo}/releases/download/${versionTag}`;

const files = fs.existsSync(artifactsDir)
  ? fs.readdirSync(artifactsDir).filter((f) => {
      const full = path.join(artifactsDir, f);
      return fs.statSync(full).isFile() && f !== 'SHA256SUMS.txt' && !f.endsWith('.json');
    })
  : [];

const platforms = {};
const checksumLines = [];

for (const fileName of files) {
  const fullPath = path.join(artifactsDir, fileName);
  const sha256 = sha256File(fullPath);
  const sizeBytes = fs.statSync(fullPath).size;
  checksumLines.push(`${sha256}  ${fileName}`);

  const assetInfo = {
    fileName,
    url: `${baseLatestUrl}/${encodeURIComponent(fileName)}`,
    versionedUrl: `${baseVersionUrl}/${encodeURIComponent(fileName)}`,
    sha256,
    sizeBytes,
  };

  if (fileName.endsWith('.exe')) platforms.windows = assetInfo;
  else if (fileName.endsWith('.dmg')) platforms.macos = assetInfo;
  else if (fileName.endsWith('.AppImage')) platforms.linux = assetInfo;
  else if (fileName.endsWith('.tar.gz')) platforms.linuxTarball = assetInfo;
  else if (fileName.endsWith('.apk')) platforms.androidApk = assetInfo;
}

if (checksumLines.length > 0) {
  fs.writeFileSync(path.join(artifactsDir, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`);
}

manifest.updatedAt = new Date().toISOString();
manifest.apps[slug] = {
  slug,
  name: displayName,
  version,
  buildNumber,
  fullVersion: `${version}+${buildNumber}`,
  publishedAt: manifest.updatedAt,
  latestTag,
  versionTag,
  platforms,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${manifestPath} for ${slug} (${version}+${buildNumber})`);
