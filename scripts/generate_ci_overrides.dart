import 'dart:io';

/// Replaces developer-machine `pubspec_overrides.yaml` (`../neom_modules/...`)
/// with a CI-portable `pubspec_overrides.yaml` derived from `pubspec.yaml`.
///
/// Why this prevents CI version-solving failures:
/// Several transitive Neom modules declare `neom_core: ^2.0.0` or `^3.0.0`
/// (hosted) while app `pubspec.yaml` files declare `neom_core` via `git:`.
/// Promoting the app's canonical `git:` blocks (plus any existing portable
/// `dependency_overrides:` in `pubspec.yaml`) unifies every transitive source.
void main(List<String> args) {
  final dir = args.isNotEmpty ? Directory(args.first) : Directory.current;
  final pubspecFile = File('${dir.path}/pubspec.yaml');
  final overridesFile = File('${dir.path}/pubspec_overrides.yaml');

  if (overridesFile.existsSync()) {
    overridesFile.deleteSync();
  }
  if (!pubspecFile.existsSync()) return;

  final lines = pubspecFile.readAsLinesSync();
  final depsBlocks = _extractSectionEntries(lines, 'dependencies');
  final existingOverrides = _extractSectionEntries(lines, 'dependency_overrides');

  final merged = <String, List<String>>{};

  // 1. Promote all `git:` dependencies from `dependencies:`, plus canonical
  // ecosystem packages (`sint`, `neom_*`, `saia_*`) even when hosted so an
  // older transitive repo declaring `sint:` from `git:` never clashes with
  // the app's canonical `sint: ^2.3.0` (or vice versa).
  for (final entry in depsBlocks.entries) {
    final body = entry.value.join('\n');
    final isGit = RegExp(r'^\s+git:\s*$', multiLine: true).hasMatch(body);
    final isEcosystemCore = entry.key == 'sint' ||
        entry.key == 'sint_sentinel' ||
        entry.key.startsWith('neom_') ||
        entry.key.startsWith('saia_');
    if (isGit || isEcosystemCore) {
      merged[entry.key] = entry.value;
    }
  }

  // 2. Ensure core shared media primitives resolve to canonical private GitHub repos
  // whenever the app uses `neom_posts`, `neom_image_editor`, or `neom_video_editor`.
  if (depsBlocks.containsKey('neom_posts') ||
      depsBlocks.containsKey('neom_image_editor') ||
      depsBlocks.containsKey('neom_video_editor')) {
    void putCraftGit(String pkg, String subPath) {
      merged.putIfAbsent(pkg, () => [
            '    git:',
            '      url: git@github.com:Open-Neom/neom_craft_workspace.git',
            if (subPath.isNotEmpty) '      path: $subPath',
          ]);
    }

    putCraftGit('neom_craft_workspace', '');
    putCraftGit('neom_craft_libs', 'packages/neom_craft_libs');
    putCraftGit('neom_photocraft', 'packages/neom_photocraft');
    putCraftGit('neom_lightcraft', 'packages/neom_lightcraft');
    putCraftGit('neom_vectorcraft', 'packages/neom_vectorcraft');
    putCraftGit('neom_filmcraft', 'packages/neom_filmcraft');
    putCraftGit('neom_effectcraft', 'packages/neom_effectcraft');
    putCraftGit('pro_video_editor', 'vendor/pro_video_editor');
    merged.putIfAbsent('neom_media_recovery', () => [
          '    git:',
          '      url: git@github.com:Open-Neom/neom_media_recovery.git',
        ]);
  }

  // 2b. Ensure VR / SAIA transitive packages resolve to canonical private GitHub repos
  // whenever an app includes `neom_vr` (whose pubspec declares them as hosted semvers).
  if (depsBlocks.containsKey('neom_vr')) {
    void putOpenNeomGit(String pkg, [String? repoName]) {
      final repo = repoName ?? pkg;
      merged.putIfAbsent(pkg, () => [
            '    git:',
            '      url: git@github.com:Open-Neom/$repo.git',
          ]);
    }

    for (final pkg in const [
      'vrlizate',
      'vrlizate_widgets',
      'vrlizate_scene',
      'vrlizate_joystick',
      'vrlizate_home',
      'vrlizate_assistant',
      'vrlizate_apps',
      'vrlizate_avatar',
      'vrlizate_ble',
      'vrlizate_cast',
      'vrlizate_search',
      'vrlizate_tracking',
      'vrlizate_spatial_audio',
      'vrlizate_physics',
      'vrlizate_world',
      'vrlizate_games',
      'vrlizate_mudras',
      'saia_core',
      'saia_gguf',
      'saia_hey',
      'saia_turbovec',
      'neom_ollama',
    ]) {
      putOpenNeomGit(pkg);
    }
    putOpenNeomGit('fllama', 'saia_fllama');
  }

  // Guard against pub.dev image >=4.11.0 pairing with archive <4.4.0 (missing ZLibDecoder.decodeLazy)
  // and legacy transitive flutter_secure_storage <11.0.0 constraints (e.g. neom_vr).
  merged.putIfAbsent('archive', () => ['INLINE:^4.7.1']);
  merged.putIfAbsent('image', () => ['INLINE:^4.13.1']);
  merged.putIfAbsent('flutter_secure_storage', () => ['INLINE:^11.2.0']);

  // 3. Explicit `dependency_overrides:` inside `pubspec.yaml` take highest precedence
  for (final entry in existingOverrides.entries) {
    merged[entry.key] = entry.value;
  }

  if (merged.isEmpty) return;

  final buf = StringBuffer('dependency_overrides:\n');
  for (final entry in merged.entries) {
    final inlineFirst = entry.value.first;
    if (inlineFirst.startsWith('INLINE:')) {
      buf.writeln('  ${entry.key}: ${inlineFirst.substring(7)}');
    } else {
      buf.writeln('  ${entry.key}:');
      for (final l in entry.value) {
        buf.writeln(l);
      }
    }
  }

  overridesFile.writeAsStringSync(buf.toString());
  stdout.writeln(
    'Generated CI pubspec_overrides.yaml with ${merged.length} unified package sources.',
  );
}

Map<String, List<String>> _extractSectionEntries(
  List<String> lines,
  String sectionName,
) {
  final result = <String, List<String>>{};
  var inSection = false;
  String? currentPkg;

  for (final raw in lines) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty || trimmed.startsWith('#')) continue;

    if (!raw.startsWith(' ')) {
      inSection = raw.startsWith('$sectionName:');
      currentPkg = null;
      continue;
    }

    if (!inSection) continue;

    final pkgMatch = RegExp(r'^  ([a-zA-Z0-9_]+):(.*)$').firstMatch(raw);
    if (pkgMatch != null) {
      currentPkg = pkgMatch.group(1)!;
      final rest = pkgMatch.group(2)!.trim();
      if (rest.isNotEmpty && !rest.startsWith('#')) {
        result[currentPkg] = ['INLINE:$rest'];
        currentPkg = null;
      } else {
        result[currentPkg] = <String>[];
      }
    } else if (currentPkg != null && raw.startsWith('    ')) {
      result[currentPkg]!.add(raw);
    }
  }
  return result;
}
