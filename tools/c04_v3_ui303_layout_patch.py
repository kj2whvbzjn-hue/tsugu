from pathlib import Path

p = Path('static/styles.css')
s = p.read_text()
old = '.overview-panel{padding:14px}.overview-grid{gap:10px}.decision-field textarea{min-height:64px}'
new = '.overview-panel{padding:14px}.overview-grid{grid-template-columns:minmax(0,1.5fr) minmax(110px,.75fr);gap:8px}.decision-field textarea{min-height:64px}'
count = s.count(old)
if count != 1:
    raise SystemExit(f'UI3-03 CSS anchor expected once, got {count}')
s = s.replace(old, new, 1)
p.write_text(s)
print('C04_UI3_03_LAYOUT_PATCH_OK')
