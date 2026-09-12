import base64
import gzip
from pathlib import Path

bundle = Path('static/app.js.gz.b64')
text = gzip.decompress(base64.b64decode(bundle.read_text().strip())).decode()

anchors = [
    ('目的', 'purpose'),
    ('現在の焦点', 'focus'),
    ('次にすること', 'next'),
]

for label, field in anchors:
    old = f'<label class="field full"><span>{label}</span><textarea data-field="{field}">'
    new = f'<label class="field full decision-field"><span>{label}</span><textarea data-field="{field}">'
    count = text.count(old)
    print(f'C04_DECISION_CLASS_ANCHOR {field} {count}')
    if count != 1:
        raise SystemExit(f'{field}: expected exactly one undecorated decision field anchor, got {count}')
    text = text.replace(old, new, 1)

for _, field in anchors:
    marker = f'decision-field"><span>'
    # Per-field exact verification below avoids accepting an unrelated class occurrence.
    exact = f'class="field full decision-field"><span>{dict((f,l) for l,f in anchors)[field]}</span><textarea data-field="{field}">'
    if text.count(exact) != 1:
        raise SystemExit(f'{field}: semantic class verification failed')

payload = gzip.compress(text.encode(), mtime=0)
bundle.write_text(base64.b64encode(payload).decode() + '\n')
print('C04_V3_DECISION_CLASSES_PATCH_OK')
