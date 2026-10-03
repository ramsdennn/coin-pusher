# -*- coding: utf-8 -*-
"""
Builds the mouse cursor from the hand icon.

    python tools/build-cursor.py

Source is assets/cursor/hand-source.svg, exactly as downloaded - one filled
path, near-black, hand pointing straight up. It is drawn as an OUTLINE RING:
the first subpath is the outside edge of the hand, the second is the inside
edge, and the fill rule between them leaves the hollow middle. Three more
subpaths are the little bars that mark the folded fingers.

That structure is the whole trick here. To get a WHITE hand with the outline
kept, nothing has to be redrawn:

    the first subpath on its own, filled white   = the hand's body
    the original path over the top, filled black = the outline and the creases

Everything else stays transparent, so what lands on screen is a hand and its
shadow and nothing else.

Two things are then done to it:

  ROTATED 45 degrees anticlockwise, so it points up-left the way the arrow it
  replaces does. The source points straight up, which reads oddly as a pointer
  and puts the click point in the middle of the top edge instead of the corner.

  PADDED, because the drop shadow is part of the image - CSS filters do not
  apply to cursors, so the shadow has to be drawn into the file, and it needs
  somewhere to fall or it is clipped off at the edge.

The script prints the HOTSPOT - where the click actually lands, as a fraction
of the image - and those two numbers go in config.js. Re-run this if the
artwork or the rotation ever changes, and copy the printed numbers across.
"""
import io, math, os, re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(HERE, 'assets', 'cursor', 'hand-source.svg')
OUT  = os.path.join(HERE, 'assets', 'cursor', 'hand.svg')

ROT   = -45.0   # anticlockwise on screen: tips the finger over to the left
CX, CY = 25.0, 25.0    # the source viewBox is 0 0 50 50, so its middle

# The shadow, in source units - the whole hand is about 40 of them across, so
# these are small numbers by design. Defaults only: config.js can override all
# four at runtime without rebuilding this file.
DX, DY, BLUR, OPACITY = 1.0, 1.3, 0.9, 0.45

# Room for the shadow to fall into. Down and right need more, because that is
# where it goes.
PAD_TL, PAD_BR = 3.5, 5.5

# --------------------------------------------------------------- the source --
svg = io.open(SRC, encoding='utf-8').read()
d = re.search(r'\sd="([^"]+)"', svg).group(1)

# The outer contour is the first subpath: the start up to and including its Z.
outer = d[:d.index('Z') + 1].strip()

# ------------------------------------------------------- where does it sit? --
# Flattened rather than solved: sampling the curves is exact enough to place a
# viewBox, and avoids a bezier-extrema routine that would earn its keep nowhere
# else in this project.
TOKEN = re.compile(r'([MLCZmlcz])|(-?\d*\.?\d+)')

def points(path):
    cmd, nums, out, cur = None, [], [], (0.0, 0.0)
    def flush():
        if cmd in ('M', 'L'):
            for i in range(0, len(nums), 2):
                out.append((nums[i], nums[i + 1]))
        elif cmd == 'C':
            for i in range(0, len(nums), 6):
                p0 = out[-1] if out else cur
                p1, p2, p3 = nums[i:i+2], nums[i+2:i+4], nums[i+4:i+6]
                for s in range(1, 17):
                    t = s / 16.0; u = 1 - t
                    out.append((
                        u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
                        u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]))
    for m in TOKEN.finditer(path):
        if m.group(1):
            flush(); cmd, nums = m.group(1).upper(), []
        else:
            nums.append(float(m.group(2)))
    flush()
    return out

def rotate(p):
    a = math.radians(ROT); c, s = math.cos(a), math.sin(a)
    x, y = p[0] - CX, p[1] - CY
    return (x * c - y * s + CX, x * s + y * c + CY)

pts = [rotate(p) for p in points(d)]
xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
minx, maxx = min(xs) - PAD_TL, max(xs) + PAD_BR
miny, maxy = min(ys) - PAD_TL, max(ys) + PAD_BR

# Squared off so the cursor is one number wide and tall, which keeps the sizing
# in config.js to a single value instead of a width and a height that must be
# kept in step.
side = max(maxx - minx, maxy - miny)
minx -= (side - (maxx - minx)) / 2.0
miny -= (side - (maxy - miny)) / 2.0

# THE HOTSPOT. (17, 3) is the top of the pointing finger in the source - the
# highest point on the outline, dead centre of the fingertip's curve. Rotating
# is a rigid move, so the tip stays the tip.
hx, hy = rotate((17.0, 3.0))
fx, fy = (hx - minx) / side, (hy - miny) / side

# --------------------------------------------------------------- the output --
io.open(OUT, 'w', encoding='utf-8').write(u'''<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="{mx:.3f} {my:.3f} {s:.3f} {s:.3f}" width="48" height="48">
  <!-- Built by tools/build-cursor.py from hand-source.svg. Do not hand-edit;
       change the script and re-run it. The width and height above are only a
       default - game.js rewrites them to whatever cursor.size says. -->
  <defs>
    <filter id="handShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="{dx}" dy="{dy}" stdDeviation="{b}"
                    flood-color="#000000" flood-opacity="{o}"/>
    </filter>
  </defs>
  <g filter="url(#handShadow)" transform="rotate({r:.0f} {cx} {cy})">
    <path fill="#FFFFFF" d="{outer}"/>
    <path fill="#000000" d="{full}"/>
  </g>
</svg>
'''.format(mx=minx, my=miny, s=side, dx=DX, dy=DY, b=BLUR, o=OPACITY,
           r=ROT, cx=CX, cy=CY, outer=outer, full=d))

print('wrote %s' % os.path.relpath(OUT, HERE))
print('viewBox %.3f %.3f %.3f %.3f' % (minx, miny, side, side))
print('')
print('  hotspot, as a fraction of the image - copy into config.js:')
print('    hotspotX: %.4f,' % fx)
print('    hotspotY: %.4f,' % fy)
