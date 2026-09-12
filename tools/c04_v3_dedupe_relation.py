import base64
import gzip
import re
from pathlib import Path

bundle = Path('static/app.js.gz.b64')
text = gzip.decompress(base64.b64decode(bundle.read_text().strip())).decode()

patterns = [
    r'function\s+relationResolutionHtml\s*\(',
    r'const\s+relationResolutionHtml\b',
    r'let\s+relationResolutionHtml\b',
    r'var\s+relationResolutionHtml\b',
]

matches = []
for pattern in patterns:
    for m in re.finditer(pattern, text):
        matches.append((m.start(), m.group(0), pattern))
matches.sort()

print('RELATION_DECLARATION_COUNT', len(matches))
for n, (pos, token, pattern) in enumerate(matches, 1):
    lo = max(0, pos - 500)
    hi = min(len(text), pos + 1400)
    context = text[lo:hi].replace('\n', '\\n')
    print(f'RELATION_DECLARATION_{n}', token, 'POS', pos)
    print(f'RELATION_CONTEXT_{n}', context)

if len(matches) < 2:
    raise SystemExit(f'expected at least 2 conflicting declarations, got {len(matches)}')
raise SystemExit('diagnostic only: declarations printed; no bundle change')
