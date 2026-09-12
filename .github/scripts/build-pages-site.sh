#!/usr/bin/env bash
set -euo pipefail
site_dir="${1:-_site}"
# Do not permit a caller to replace source or arbitrary directories.
case "$site_dir" in _site|_site-*) ;; *) echo 'output must be _site or _site-*' >&2; exit 1 ;; esac
rm -rf -- "$site_dir"
mkdir -p "$site_dir"
for asset in index.html workflow.css favicon.svg workflow-domain.mjs workflow-git.mjs workflow-app.mjs workflow-import.mjs manual.html project-import-example.json; do
  test -f "static/$asset"
  cp "static/$asset" "$site_dir/$asset"
done
for source in "$site_dir"/*.mjs; do node --check "$source"; done
python3 - "$site_dir" <<'PY'
from pathlib import Path
from html.parser import HTMLParser
import sys,re
root=Path(sys.argv[1])
class Assets(HTMLParser):
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k in ('src','href') and v.startswith('./'):
    assert (root/v[2:].split('#')[0]).is_file(),v
for path in root.glob('*.html'):
 Assets().feed(path.read_text())
for path in root.glob('*.mjs'):
 for name in re.findall(r"from ['\"](\./[^'\"]+)['\"]",path.read_text()):
  assert (root/name[2:]).is_file(),name
print('Verified standalone TSUGU Workflow assets')
PY
