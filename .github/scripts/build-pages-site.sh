#!/usr/bin/env bash
set -euo pipefail

site_dir="${1:-_site}"
rm -rf "$site_dir"
mkdir -p "$site_dir"

runtime_assets=(
  index.html
  styles.css
  structure-v4.css
  box-registry-v5.css
  box-registry-v5.js
  longtext-focus.css
  longtext-focus.js
  favicon.svg
  stage-b-mvp-scenarios.json
  core-reference.js
  core-architecture.js
  core-changeset.js
  core-box.js
  core-box-changeset.js
  core-rule-test.js
  core-rule-test-changeset.js
  core-governance.js
  core-governance-changeset.js
  core-check-evidence.js
  core-evidence-storage.js
  core-check-evidence-changeset.js
  core-planned-actual-change.js
  core-git-diff.js
  core-planned-actual-change-changeset.js
  core-assurance-event.js
  core-task-execution.js
  core-assurance-event-changeset.js
  core-impact-graph.js
  core-architecture-health.js
  core-sync.js
  core-sync-storage.js
  core-sync-reconcile.js
  core-sync-recovery.js
  core-sync-admin.js
  core-guard.js
)

for asset in "${runtime_assets[@]}"; do
  test -f "static/$asset" || { echo "missing source runtime asset: $asset" >&2; exit 1; }
  cp "static/$asset" "$site_dir/$asset"
done

base64 --decode static/app.js.gz.b64 | gzip --decompress > "$site_dir/app.js"

for js in "$site_dir"/*.js; do
  node --check "$js"
done
node --input-type=module --check < "$site_dir/app.js"

SITE_DIR="$site_dir" python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import os

site = Path(os.environ['SITE_DIR'])

class LocalAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ('src', 'href'):
            value = attrs.get(key, '')
            if value.startswith('./'):
                self.paths.append(urlsplit(value).path.removeprefix('./'))

parser = LocalAssets()
parser.feed((site / 'index.html').read_text())
missing = sorted({path for path in parser.paths if not (site / path).is_file()})
if missing:
    raise SystemExit('missing runtime assets: ' + ', '.join(missing))
print('Verified runtime assets:', ', '.join(sorted(set(parser.paths))))
PY
