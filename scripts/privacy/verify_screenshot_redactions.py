"""Verify reviewed screenshot bytes and opaque masks without reading originals.

Run with Python + Pillow. This is a structural/hash check, not a substitute for
visual privacy review. It does not stage files or change the media guard.
"""
import hashlib
import json
import struct
import zlib
from pathlib import Path

from PIL import Image


def main():
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / 'docs/evaluation/screenshot-privacy-inventory.json').read_text(encoding='utf-8'))
    assets = manifest['assets']
    assert manifest['schemaVersion'] == 1 and len(assets) == 14
    assert len({a['path'] for a in assets}) == 14
    for asset in assets:
        path = (root / asset['path']).resolve()
        assert path.is_relative_to(root / 'screenshots') and path.suffix == '.png'
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == asset['sanitizedSha256']
        assert asset['originalSha256'] != asset['sanitizedSha256']
        assert raw[:8] == b'\x89PNG\r\n\x1a\n'
        pos, chunks = 8, []
        while pos < len(raw):
            length = struct.unpack('>I', raw[pos:pos + 4])[0]
            kind = raw[pos + 4:pos + 8]
            assert kind in (b'IHDR', b'IDAT', b'IEND'), 'Unexpected PNG data'
            data = raw[pos + 8:pos + 8 + length]
            crc = struct.unpack('>I', raw[pos + 8 + length:pos + 12 + length])[0]
            assert zlib.crc32(kind + data) == crc
            chunks.append(kind)
            pos += length + 12
            if kind == b'IEND':
                assert length == 0 and pos == len(raw), 'Trailing data'
                break
        assert chunks[0] == b'IHDR' and chunks[-1] == b'IEND'
        assert chunks.count(b'IHDR') == chunks.count(b'IEND') == 1 and b'IDAT' in chunks
        with Image.open(path) as im:
            im.load()
            assert im.mode == 'RGB' and not im.info and im.n_frames == 1
            assert list(im.size) == asset['dimensions'] == [1024, 2216]
            assert asset['opaqueBlackRectanglesXYXY']
            for x0, y0, x1, y1 in asset['opaqueBlackRectanglesXYXY']:
                assert 0 <= x0 < x1 <= im.width and 0 <= y0 < y1 <= im.height
                assert im.crop((x0, y0, x1, y1)).getbbox() is None, 'Non-opaque redaction'
    print('PASS: 14 exact sanitized hashes, RGB PNG structure/CRC, metadata removal and opaque masks.')


if __name__ == '__main__':
    main()
