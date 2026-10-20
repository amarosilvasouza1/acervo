"""Package corresponding Android sources without private data or signing keys."""
import argparse
import hashlib
import pathlib
import zipfile
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--dependency-sources', required=True, type=pathlib.Path)
args = parser.parse_args()
android = pathlib.Path(__file__).resolve().parent
project = android.parent
version = ET.parse(android / 'app/src/main/AndroidManifest.xml').getroot().get('{http://schemas.android.com/apk/res/android}versionName')
output = project / 'releases' / ('acervo-' + version + '-source.zip')
sources = []
for name in ['index.html', 'app.js', 'views.js', 'connect.js', 'radio.js', 'explore.js',
             'styles.css', 'mobile.css', 'icon.svg', 'manifest.webmanifest']:
    sources.append((project / 'public' / name, 'public/' + name))
for name in ['app/src', 'tests']:
    for file in (android / name).rglob('*'):
        relative = file.relative_to(android)
        if not file.is_file() or any(part in {'classes', 'generated', 'build', '__pycache__'} for part in relative.parts):
            continue
        sources.append((file, 'android/' + relative.as_posix()))
for name in ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md', 'settings.gradle', 'build.gradle',
             'gradle.properties', 'app/build.gradle', 'build-gradle.ps1', 'build.ps1', 'build.cmd', 'package-source.py']:
    sources.append((android / name, 'android/' + name))
dependencies = sorted(file for file in args.dependency_sources.iterdir() if file.suffix in {'.jar', '.zip'})
if len(dependencies) < 9:
    raise SystemExit('Missing dependency sources; include all pinned source artifacts before distribution.')
sources.extend((file, 'third-party-sources/' + file.name) for file in dependencies)
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file, name in sorted(sources, key=lambda item: item[1]):
        if any(part.lower() in {'signing', 'data', 'node_modules', '.git', '.gradle'} for part in pathlib.PurePosixPath(name).parts):
            raise SystemExit('Private path refused: ' + name)
        archive.write(file, name)
    archive.writestr('README.txt', 'Acervo Android ' + version + ' corresponding source\n\n'
        'See android/README.md for JDK21, Gradle8.9 and SDK35 build instructions.\n'
        'Source archives for every runtime dependency are in third-party-sources/.\n'
        'No signing key, account credential or personal music is included.\n'
        'For your own build use gradle -p android :app:assembleRelease, then sign\n'
        'with your own key. The original private signing key is not required to\n'
        'build the application; it is required only to update an existing install\n'
        'signed by that key. Source and dependency notices are preserved.\n')
digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(output.suffix + '.sha256').write_text(digest + '  ' + output.name + '\n', encoding='utf-8')
print(output)
print('SHA256=' + digest)
