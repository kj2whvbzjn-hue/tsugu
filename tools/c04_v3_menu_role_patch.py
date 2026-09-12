from pathlib import Path

files=['tests/c04-ui-usability-v2.e2e.cjs','tests/longtext-fullscreen.e2e.cjs','tests/c04-ui-usability-v3.e2e.cjs']
for name in files:
    p=Path(name); s=p.read_text()
    if name.endswith('c04-ui-usability-v2.e2e.cjs'):
        old="async function workspaceAction(page,name,label){const button=page.getByRole('button',{name,exact:true});if(!(await button.isVisible().catch(()=>false))){const menu=page.getByRole('button',{name:'接続・取込メニュー',exact:true});await click(menu,`${label}:menu`);await button.waitFor({state:'visible',timeout:5000})}return button}"
        new="async function workspaceAction(page,name,label){const button=page.getByRole('button',{name,exact:true});if(await button.isVisible().catch(()=>false))return button;const menu=page.getByRole('button',{name:'接続・取込メニュー',exact:true});await click(menu,`${label}:menu`);const item=page.getByRole('menuitem',{name,exact:true});await item.waitFor({state:'visible',timeout:5000});return item}"
    elif name.endswith('longtext-fullscreen.e2e.cjs'):
        old="async function workspaceAction(page,name){const button=page.getByRole('button',{name,exact:true});if(!(await button.isVisible().catch(()=>false))){await page.getByRole('button',{name:'接続・取込メニュー',exact:true}).click();await button.waitFor({state:'visible',timeout:5000})}return button}"
        new="async function workspaceAction(page,name){const button=page.getByRole('button',{name,exact:true});if(await button.isVisible().catch(()=>false))return button;await page.getByRole('button',{name:'接続・取込メニュー',exact:true}).click();const item=page.getByRole('menuitem',{name,exact:true});await item.waitFor({state:'visible',timeout:5000});return item}"
    else:
        old="async function openWorkspaceAction(page,name){const b=page.getByRole('button',{name,exact:true});if(!(await isVisible(b))){const menu=page.getByRole('button',{name:'接続・取込メニュー',exact:true});await menu.click();await b.waitFor({state:'visible',timeout:5000})}return b}"
        new="async function openWorkspaceAction(page,name){const b=page.getByRole('button',{name,exact:true});if(await isVisible(b))return b;const menu=page.getByRole('button',{name:'接続・取込メニュー',exact:true});await menu.click();const item=page.getByRole('menuitem',{name,exact:true});await item.waitFor({state:'visible',timeout:5000});return item}"
    if old not in s: raise SystemExit(f'helper anchor missing: {name}')
    p.write_text(s.replace(old,new,1))
print('C04_V3_MENU_ROLE_PATCH_OK')
