#!/usr/bin/env python3
"""배포 전에 실행: JS/CSS 주소의 ?v= 값을 새로 바꿔서 브라우저 캐시를 무효화합니다.
사용: python3 tools/bump-version.py"""
import re, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S')
pat = re.compile(r"""((?:from\s+|src=|href=)['"](?:\./|js/|css/)[\w./-]+\.(?:js|css))(\?v=\w+)?(['"])""")
for f in [root / 'index.html', *sorted((root / 'js').glob('*.js'))]:
    s = f.read_text(encoding='utf-8')
    n = pat.sub(lambda m: f"{m.group(1)}?v={v}{m.group(3)}", s)
    if n != s:
        f.write_text(n, encoding='utf-8')
        print('updated', f.name)
print('version', v)
