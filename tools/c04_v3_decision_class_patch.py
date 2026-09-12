import base64
import gzip
import re
from pathlib import Path

bundle = Path('static/app.js.gz.b64')
text = gzip.decompress(base64.b64decode(bundle.read_text().strip())).decode()

anchors = [
    ('目的', 'purpose'),
    ('現在の焦点', 'focus'),
    ('次にすること', 'next'),
]

for label, field in anchors:
    pattern = re.compile(
        rf'<label class="([^"]*)"><span>{re.escape(label)}</span><textarea data-field="{field}">'
    )
    matches = list(pattern.finditer(text))
    print(f'C04_DECISION_CLASS_ANCHOR {field} {len(matches)}')
    if len(matches) != 1:
        raise SystemExit(f'{field}: expected exactly one semantic label anchor, got {len(matches)}')
    classes = matches[0].group(1).split()
    if 'field' not in classes:
        raise SystemExit(f'{field}: target label is not a field: {classes}')
    if 'decision-field' in classes:
        raise SystemExit(f'{field}: decision-field already present; refusing duplicate patch')
    new_classes = ' '.join(classes + ['decision-field'])
    replacement = f'<label class="{new_classes}"><span>{label}</span><textarea data-field="{field}">'
    text = text[:matches[0].start()] + replacement + text[matches[0].end():]

for label, field in anchors:
    verify = re.compile(
        rf'<label class="[^"]*\bdecision-field\b[^"]*"><span>{re.escape(label)}</span><textarea data-field="{field}">'
    )
    if len(list(verify.finditer(text))) != 1:
        raise SystemExit(f'{field}: semantic class verification failed')

payload = gzip.compress(text.encode(), mtime=0)
bundle.write_text(base64.b64encode(payload).decode() + '\n')
print('C04_V3_DECISION_CLASSES_PATCH_OK')
