from pathlib import Path

v2 = Path('tests/c04-ui-usability-v2.e2e.cjs')
s = v2.read_text()
connect_anchor = "async function connect(page){"
idx = s.index(connect_anchor)
line_end = s.index('\n', idx)
helper = "\nasync function workspaceAction(page,name,label){const button=page.getByRole('button',{name,exact:true});if(!(await button.isVisible().catch(()=>false))){const menu=page.getByRole('button',{name:'接続・取込メニュー',exact:true});await click(menu,`${label}:menu`);await button.waitFor({state:'visible',timeout:5000})}return button}"
if 'async function workspaceAction(page,name,label)' not in s:
    s = s[:line_end] + helper + s[line_end:]
s = s.replace("await click(page.getByRole('button',{name:'JSONから新規取込',exact:true}),`${label}:import`);", "await click(await workspaceAction(page,'JSONから新規取込',`${label}:import`),`${label}:import`);")
for label in ['reload-before-delete','reload-after-first-delete','reload-after-final-delete']:
    old = f"await click(page.getByRole('button',{{name:'GitHubから再読込',exact:true}}),'{label}');"
    new = f"await click(await workspaceAction(page,'GitHubから再読込','{label}'),'{label}');"
    if old not in s:
        raise SystemExit(f'v2 reload anchor missing: {label}')
    s = s.replace(old,new)
v2.write_text(s)

lt = Path('tests/longtext-fullscreen.e2e.cjs')
t = lt.read_text()
insert_anchor = "function writeEvidence(){fs.writeFileSync('longtext-fullscreen-evidence.json',JSON.stringify(evidence,null,2)+'\\n')}"
lt_helper = "\nasync function workspaceAction(page,name){const button=page.getByRole('button',{name,exact:true});if(!(await button.isVisible().catch(()=>false))){await page.getByRole('button',{name:'接続・取込メニュー',exact:true}).click();await button.waitFor({state:'visible',timeout:5000})}return button}"
if 'async function workspaceAction(page,name)' not in t:
    if insert_anchor not in t:
        raise SystemExit('longtext helper anchor missing')
    t=t.replace(insert_anchor,insert_anchor+lt_helper,1)
old="await page.getByRole('button',{name:'JSONから新規取込',exact:true}).click();"
new="await (await workspaceAction(page,'JSONから新規取込')).click();"
if old not in t:
    raise SystemExit('longtext import anchor missing')
t=t.replace(old,new,1)
lt.write_text(t)

assert "JSONから新規取込',exact:true}),`${label}:import`" not in s
assert "GitHubから再読込',exact:true}),'reload-" not in s
print('C04_V3_LEGACY_HARNESS_PATCH_OK')
