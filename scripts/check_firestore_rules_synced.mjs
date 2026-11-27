#!/usr/bin/env node
/**
 * Checks whether the active `cloud.firestore` release in Firebase Rules
 * already matches the local firestore.rules file byte-for-byte.
 *
 * Exits 0 if and only if the live Firebase release matches local firestore.rules.
 * Exits 1 if they differ, no release exists yet, or auth/API lookup fails
 * (so the caller safely falls back to `firebase deploy --only firestore:rules`).
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--') && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

function getAccessToken() {
  for (const cmdArgs of [
    ['auth', 'application-default', 'print-access-token'],
    ['auth', 'print-access-token'],
  ]) {
    try {
      const out = execFileSync('gcloud', cmdArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15000,
      }).trim();
      if (out && !out.includes('\n')) {
        return out;
      }
    } catch {
      // Try next token source.
    }
  }
  return null;
}

function normalize(text) {
  return String(text ?? '').replace(/\r\n/g, '\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

async function main() {
  const args = parseArgs(process.argv);
  const project = args.project;
  const rulesPath = args.rules || 'firestore.rules';
  const database = args.database || '(default)';

  if (!project || !fs.existsSync(rulesPath)) {
    process.exit(1);
  }

  const token = getAccessToken();
  if (!token) {
    console.log('[rules-check] Could not acquire ADC token; falling back to firebase deploy.');
    process.exit(1);
  }

  const releaseId =
    database && database !== '(default)'
      ? `cloud.firestore/${encodeURIComponent(database)}`
      : 'cloud.firestore';

  const headers = {
    Authorization: `Bearer ${token}`,
    'x-goog-user-project': project,
  };

  const relRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(project)}/releases/${releaseId}`,
    { headers },
  );
  if (!relRes.ok) {
    console.log(`[rules-check] Release lookup HTTP ${relRes.status}; falling back to firebase deploy.`);
    process.exit(1);
  }
  const release = await relRes.json();
  if (!release?.rulesetName) {
    process.exit(1);
  }

  const rsRes = await fetch(
    `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
    { headers },
  );
  if (!rsRes.ok) {
    process.exit(1);
  }
  const ruleset = await rsRes.json();
  const remoteFile = ruleset?.source?.files?.[0];
  if (!remoteFile || typeof remoteFile.content !== 'string') {
    process.exit(1);
  }

  const localContent = normalize(fs.readFileSync(rulesPath, 'utf8'));
  const remoteContent = normalize(remoteFile.content);

  if (localContent === remoteContent) {
    console.log(
      `[rules-check] Active release ${release.name} (${release.rulesetName}) already matches ${rulesPath} (sha256=${sha256(localContent)}).`,
    );
    process.exit(0);
  }

  console.log(
    `[rules-check] Local ${rulesPath} (sha256=${sha256(localContent)}) differs from active release (sha256=${sha256(remoteContent)}); deploy required.`,
  );
  process.exit(1);
}

main().catch(() => process.exit(1));
