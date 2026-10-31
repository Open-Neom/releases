#!/usr/bin/env node
/**
 * Resolves the root directory on disk of a Dart/Flutter dependency from
 * `.dart_tool/package_config.json` after `flutter pub get`.
 *
 * Usage:
 *   node resolve_package_path.mjs <package_name> [project_dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgName = process.argv[2];
const projectDir = path.resolve(process.argv[3] || process.cwd());

if (!pkgName) {
  console.error('Usage: node resolve_package_path.mjs <package_name> [project_dir]');
  process.exit(1);
}

const configPath = path.join(projectDir, '.dart_tool', 'package_config.json');
if (!fs.existsSync(configPath)) {
  console.error(`package_config.json not found at ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const entry = (config.packages || []).find((p) => p.name === pkgName);

if (!entry || !entry.rootUri) {
  console.error(`Package "${pkgName}" not found in ${configPath}`);
  process.exit(1);
}

let resolvedPath;
if (entry.rootUri.startsWith('file://')) {
  resolvedPath = fileURLToPath(entry.rootUri);
} else {
  // Relative URI in package_config.json is relative to `.dart_tool/`
  resolvedPath = path.resolve(path.dirname(configPath), entry.rootUri);
}

process.stdout.write(resolvedPath);
