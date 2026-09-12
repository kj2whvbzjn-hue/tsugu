import base64
import gzip
import hashlib
from pathlib import Path

bundle = Path('static/app.js.gz.b64')
text = gzip.decompress(base64.b64decode(bundle.read_text().strip())).decode()
needle = 'function relationResolutionHtml('

starts = []
pos = 0
while True:
    i = text.find(needle, pos)
    if i < 0:
        break
    starts.append(i)
    pos = i + len(needle)

print('relationResolutionHtml occurrences:', len(starts))
if len(starts) != 2:
    raise SystemExit(f'expected exactly 2 duplicate declarations, got {len(starts)}')


def extract_function(src: str, start: int) -> tuple[int, str]:
    body = src.find('{', start)
    if body < 0:
        raise SystemExit('function body start not found')
    depth = 0
    for j in range(body, len(src)):
        ch = src[j]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return j + 1, src[start:j + 1]
    raise SystemExit('unterminated function body')

end1, fn1 = extract_function(text, starts[0])
end2, fn2 = extract_function(text, starts[1])
sha1 = hashlib.sha256(fn1.encode()).hexdigest()
sha2 = hashlib.sha256(fn2.encode()).hexdigest()
print('helper hashes:', sha1, sha2)
if fn1 != fn2:
    raise SystemExit('duplicate declarations differ; refusing automatic removal')

# Keep the first declaration and remove only the second identical declaration.
fixed = text[:starts[1]] + text[end2:]
if fixed.count(needle) != 1:
    raise SystemExit('dedupe did not leave exactly one declaration')

payload = base64.b64encode(gzip.compress(fixed.encode(), mtime=0)).decode() + '\n'
bundle.write_text(payload)
print('C04_V3_DEDUPE_RELATION_OK')
