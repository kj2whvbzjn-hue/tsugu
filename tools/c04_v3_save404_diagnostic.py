import base64
import gzip
from pathlib import Path

src = gzip.decompress(base64.b64decode(Path('static/app.js.gz.b64').read_text().strip())).decode()
needles = [
    'data/projects/',
    '/contents/',
    'GitHubへ保存しました',
    'sha:',
    'revision',
    'blobSha',
]

print('C04_SAVE404_SOURCE_LENGTH', len(src))
for needle in needles:
    positions=[]
    pos=0
    while True:
        i=src.find(needle,pos)
        if i<0: break
        positions.append(i)
        pos=i+len(needle)
    print('C04_SAVE404_NEEDLE', repr(needle), 'COUNT', len(positions), 'POSITIONS', positions[:20])
    for n,i in enumerate(positions[:8],1):
        lo=max(0,i-1800); hi=min(len(src),i+2600)
        print(f'C04_SAVE404_CONTEXT {needle!r} #{n} POS {i}')
        print(src[lo:hi].replace('\n','\\n'))
        print('C04_SAVE404_CONTEXT_END')
