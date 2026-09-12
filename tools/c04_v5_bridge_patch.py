from pathlib import Path
import base64, gzip

# v5 bridge materializer: intentionally idempotent; touched to trigger the bridge workflow after v5 assets/tests were added.
p=Path('static/app.js.gz.b64')
raw=gzip.decompress(base64.b64decode(p.read_bytes())).decode('utf-8')
marker='/* C04_BOX_REGISTRY_V5_BRIDGE */'
if marker not in raw:
    anchor='function renderItems(p){'
    if anchor not in raw:
        raise SystemExit('renderItems anchor missing')
    bridge="window.TSUGU_APP_BRIDGE={state,render,markDirty,clone,esc,coreId};\n"
    raw=raw.replace(anchor,marker+'\n'+bridge+anchor,1)
if 'const v5Hook=window.TSUGU_V5_RENDER?.(p,state.tab);' not in raw:
    anchor='function renderWorkspaceTab(p){'
    if anchor not in raw:
        raise SystemExit('renderWorkspaceTab anchor missing')
    raw=raw.replace(anchor,anchor+"const v5Hook=window.TSUGU_V5_RENDER?.(p,state.tab);if(v5Hook!==undefined&&v5Hook!==null)return v5Hook;",1)
if 'window.TSUGU_V5_BIND?.();' not in raw:
    anchor='bindCoreUI();if(state.modal){'
    if anchor not in raw:
        raise SystemExit('bind hook anchor missing')
    raw=raw.replace(anchor,'bindCoreUI();window.TSUGU_V5_BIND?.();if(state.modal){',1)
raw=raw.replace("state.tab='構造'","state.tab='Box'")
raw=raw.replace("tab:'構造'","tab:'Box'")
compiled=gzip.compress(raw.encode('utf-8'),compresslevel=9,mtime=0)
p.write_text(base64.b64encode(compiled).decode('ascii'))
Path('/tmp/c04-v5-app.js').write_text(raw)
print('bridge patched',len(raw))
