#!/usr/bin/env python3
"""
build.py — bundles the multi-file dev sources (index.dev.html + style.css +
js/*.js + assets/**) into a single self-contained index.html with every
stylesheet, script, sprite frame and HUD panel inlined (images as base64
data: URIs). The result needs no local server and no network access —
it can be opened directly as a file:// URL or emailed/shared as one file.

Edit the sources (index.dev.html / style.css / js / assets), never
index.html directly — it's a generated build artifact. Then rebuild:
    python3 build.py
"""
import base64
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
JS_ORDER = [
    'data.js', 'assets.js', 'audio.js', 'input.js', 'save.js',
    'sprites.js', 'particles.js', 'entities.js', 'hud.js', 'ui.js', 'game.js', 'main.js'
]
SPRITE_CHARACTERS = ['agumon', 'greymon', 'vmon', 'vdramon', 'guilmon', 'growlmon']
HUD_PARTS = ['hud_status', 'hud_minimap', 'hud_digivice']


def read(path):
    with open(os.path.join(ROOT, path), 'r', encoding='utf-8') as f:
        return f.read()


def b64_data_uri(path):
    with open(os.path.join(ROOT, path), 'rb') as f:
        data = f.read()
    return 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')


def build():
    # 1) embed every sprite frame + manifest
    manifests = {}
    images = {}
    for char in SPRITE_CHARACTERS:
        char_dir = f'assets/sprites/{char}'
        manifest = json.loads(read(f'{char_dir}/manifest.json'))
        manifests[char] = manifest
        seen = set()
        for files in manifest.values():
            for fn in files:
                if fn in seen:
                    continue
                seen.add(fn)
                images[f'sprites/{char}/{fn}'] = b64_data_uri(f'{char_dir}/{fn}')

    for part in HUD_PARTS:
        images[f'hud/{part}.png'] = b64_data_uri(f'assets/hud/{part}.png')

    embedded_js = (
        '<script>\n'
        f'const EMBEDDED_MANIFESTS = {json.dumps(manifests)};\n'
        f'const EMBEDDED_IMAGES = {json.dumps(images)};\n'
        '</script>'
    )

    # 2) inline CSS
    css = read('style.css')
    style_tag = f'<style>\n{css}\n</style>'

    # 3) inline JS files in dependency order
    js_tags = [embedded_js]
    for fname in JS_ORDER:
        code = read(f'js/{fname}')
        js_tags.append(f'<script>\n{code}\n</script>')
    js_block = '\n'.join(js_tags)

    # 4) splice into the dev template markup
    html = read('index.dev.html')
    html = re.sub(r'<link rel="stylesheet" href="style\.css">', style_tag, html)
    html = re.sub(r'(\s*<script src="js/[a-zA-Z_.]+"></script>)+', '\n' + js_block + '\n', html)

    out_path = os.path.join(ROOT, 'index.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f'Built {out_path} ({size_mb:.2f} MB)')
    return out_path


if __name__ == '__main__':
    build()
