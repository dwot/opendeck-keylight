"""Generate simple PNG placeholder icons for the plugin."""
import struct, zlib

def png(w, h, pixels):
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            r,g,b,a = pixels[y*w + x]
            raw += bytes([r,g,b,a])
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def circle_icon(size, fg, bg=(0,0,0,0), inner=None):
    pixels = []
    cx, cy = size/2, size/2
    r = size*0.42
    ir = size*0.18 if inner else 0
    for y in range(size):
        for x in range(size):
            d = ((x-cx)**2 + (y-cy)**2)**0.5
            if inner and d <= ir:
                pixels.append(inner)
            elif d <= r:
                pixels.append(fg)
            elif d <= r+1:
                a = max(0, min(255, int(255*(r+1-d))))
                pixels.append((fg[0], fg[1], fg[2], a))
            else:
                pixels.append(bg)
    return pixels

ON     = (255, 220, 130, 255)
OFF    = (90, 90, 100, 255)
DARK   = (40, 40, 45, 255)
ACCENT = (255, 200, 80, 255)
BLUE   = (130, 180, 255, 255)
GREEN  = (130, 220, 150, 255)
ORANGE = (255, 160, 100, 255)

def write(name, w, h, pixels):
    with open(name, 'wb') as f:
        f.write(png(w, h, pixels))

for size, suffix in [(72, ''), (144, '@2x')]:
    write(f'plugin{suffix}.png',      size, size, circle_icon(size, ON, inner=DARK))
    write(f'category{suffix}.png',    size, size, circle_icon(size, ON, inner=DARK))
    write(f'toggle{suffix}.png',      size, size, circle_icon(size, ACCENT, inner=DARK))
    write(f'state-on{suffix}.png',    size, size, circle_icon(size, ON))
    write(f'state-off{suffix}.png',   size, size, circle_icon(size, OFF))
    write(f'brightness{suffix}.png',  size, size, circle_icon(size, BLUE, inner=DARK))
    write(f'temperature{suffix}.png', size, size, circle_icon(size, ORANGE, inner=DARK))
    write(f'scene{suffix}.png',       size, size, circle_icon(size, GREEN, inner=DARK))

print('Generated icons')
