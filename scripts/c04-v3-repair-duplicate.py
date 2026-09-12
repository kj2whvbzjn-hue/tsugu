from pathlib import Path
import base64
import gzip

path = Path('static/app.js.gz.b64')
text = gzip.decompress(base64.b64decode(path.read_text().strip())).decode()
start = text.find('function projectItemByRef(')
end = text.find('function relationCandidates(', start)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('legacy relation helper block not found')
legacy = text[start:end]
for marker in ['function projectItemByRef(', 'function modalRelationItem(', 'function relationResolutionHtml(m)']:
    if marker not in legacy:
        raise SystemExit(f'legacy block missing {marker}')
text = text[:start] + text[end:]
if text.count('function relationResolutionHtml(') != 1:
    raise SystemExit('relationResolutionHtml declaration count is not 1 after repair')
if text.count('function relationCandidates(') != 1:
    raise SystemExit('relationCandidates declaration count is not 1 after repair')
path.write_text(base64.b64encode(gzip.compress(text.encode(), compresslevel=9, mtime=0)).decode() + '\n')
