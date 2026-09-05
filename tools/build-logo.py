"""
TIPPING POINT logo, built as SVG.

The letterforms are drawn as PATHS rather than set in a typeface. Nothing
installed matches that heavy condensed italic, and paths mean the logo renders
identically on any machine and can be baked to a texture later without a font
dependency.

Every glyph lives in a 100-unit cap-height box, upright. Italic, perspective
and rotation are all applied by transform at placement time, so the shapes
themselves stay simple enough to reason about.
"""
import io, math, os

# Output sits next to this script rather than at an absolute path, so the
# logo can be rebuilt from a checkout anywhere.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "logo")

# --------------------------------------------------------------------------
# Glyphs. Cap height 100, stems 27, horizontals ~20-24, drawn upright.
# --------------------------------------------------------------------------
GLYPHS = {
    # crossbar full width, stem centred
    'T': (64, "M0 0H64V20H45.5V100H18.5V20H0Z"),

    'I': (27, "M0 0H27V100H0Z"),

    # stem plus bowl; the counter is the second subpath, a hole under evenodd
    'P': (64, "M0 0H42C54 0 64 8 64 20V38C64 50 54 58 42 58H27V100H0Z"
              "M27 20H38C42 20 44 23 44 29C44 35 42 38 38 38H27Z"),

    # the diagonal all but fills the gap between the stems, which is what a
    # condensed heavy N does - the counters are two small triangles
    'N': (74, "M0 100V0H26L48 72V0H74V100H48L26 28V100Z"),

    'O': (74, "M28 0H46C61 0 74 12 74 28V72C74 88 61 100 46 100H28"
              "C13 100 0 88 0 72V28C0 12 13 0 28 0Z"
              "M30 20H44C46 20 47 22 47 25V75C47 78 46 80 44 80H30"
              "C28 80 27 78 27 75V25C27 22 28 20 30 20Z"),

    # ONE contour, not two: the counter opens to the right through the notch
    # between the top arm's terminal and the bar, so there is no enclosed hole.
    # Traced from the terminal face, out around the outside, back in along the
    # bar and round the counter.
    'G': (74, "M52 30H74C74 12 61 0 46 0H28C13 0 0 12 0 28V72"
              "C0 88 13 100 28 100H46C61 100 74 88 74 72V52H36V76H30"
              "C28 76 27 74 27 72V28C27 26 28 24 30 24H52Z"),
}

SKEW = 16.0                      # degrees of forward italic
SKEW_T = math.tan(math.radians(SKEW))
GAP = 5                          # letter spacing, in glyph units

# --------------------------------------------------------------------------
# Placement
# --------------------------------------------------------------------------
W, H = 1240, 620

class Word:
    def __init__(self, text, ox, oy, rot, s0, s1):
        self.text, self.ox, self.oy, self.rot = text, ox, oy, rot
        self.s0, self.s1 = s0, s1
        self.place()

    def place(self):
        """Walk the baseline, giving each glyph its own scale.

        The scale ramp is what stands in for perspective. A single transform
        cannot do a projective foreshortening in SVG, but stepping the scale
        letter by letter along the baseline gets the same read: TIPPING grows
        away to the right, POINT shrinks."""
        n = len(self.text)
        self.items = []
        x = 0.0
        for i, ch in enumerate(self.text):
            s = self.s0 + (self.s1 - self.s0) * (i / max(n - 1, 1))
            w, d = GLYPHS[ch]
            self.items.append({'ch': ch, 'x': x, 's': s, 'w': w, 'd': d})
            x += (w + GAP) * s
        self.advance = x

    def glyph_tf(self, it):
        return ("translate(%.2f,%.2f) rotate(%.3f) translate(%.2f,0) "
                "scale(%.4f) translate(0,-100) skewX(%.2f)"
                % (self.ox, self.oy, self.rot, it['x'], it['s'], -SKEW))

    def point(self, i, px, py):
        """Where a point of glyph i lands on the canvas. Used to hang the
        lens flares off actual letter corners rather than guessed pixels."""
        it = self.items[i]
        gx = px - py * SKEW_T
        gy = py - 100.0
        gx, gy = gx * it['s'], gy * it['s']
        gx += it['x']
        a = math.radians(self.rot)
        rx = gx * math.cos(a) - gy * math.sin(a)
        ry = gx * math.sin(a) + gy * math.cos(a)
        return self.ox + rx, self.oy + ry


TIPPING = Word('TIPPING', 352, 268, 13.0, 1.70, 2.30)
POINT   = Word('POINT',    42, 494,  4.0, 2.14, 1.56)

# --------------------------------------------------------------------------
# The extrusion. Offsets are in SCREEN space so every letter of both words
# recedes the same way, which is what makes them read as one solid object.
# --------------------------------------------------------------------------
DEPTH_STEPS = 44
DEPTH_DX, DEPTH_DY = 0.36, 0.64          # direction, down and to the right
DEPTH_LEN = 44.0                          # total, in canvas units

def lerp_hex(a, b, t):
    a = [int(a[i:i+2], 16) for i in (1, 3, 5)]
    b = [int(b[i:i+2], 16) for i in (1, 3, 5)]
    return '#%02X%02X%02X' % tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

SIDE_FAR, SIDE_NEAR = '#0F1116', '#5C6474'

# --------------------------------------------------------------------------
def defs():
    d = ['<defs>']
    for ch, (w, path) in GLYPHS.items():
        d.append('<path id="g%s" d="%s" fill-rule="evenodd"/>' % (ch, path))

    # The chrome ramp. Bright crown, a dark horizon just under the middle, a
    # hard light break beneath it, then a second bright pass and a dark heel -
    # that break is what reads as polished metal rather than a grey gradient.
    d.append('''<linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.00" stop-color="#F6F9FD"/>
      <stop offset="0.06" stop-color="#E8EDF5"/>
      <stop offset="0.20" stop-color="#C7CFDC"/>
      <stop offset="0.36" stop-color="#ADB5C4"/>
      <stop offset="0.455" stop-color="#7C8496"/>
      <stop offset="0.495" stop-color="#5A6274"/>
      <stop offset="0.520" stop-color="#C7CEDA"/>
      <stop offset="0.60" stop-color="#FBFCFE"/>
      <stop offset="0.68" stop-color="#FFFFFF"/>
      <stop offset="0.79" stop-color="#DCE1EA"/>
      <stop offset="0.89" stop-color="#A5ADBC"/>
      <stop offset="0.96" stop-color="#79818F"/>
      <stop offset="1.00" stop-color="#AEB6C4"/>
    </linearGradient>''')

    # Warm cast across the whole lockup, strongest at the left where the
    # flare is. Deliberately NOT a per-glyph fill: bound to each letter's own
    # box it would restart at every letter, and what the reference actually
    # shows is one wash running across the pair of words.
    d.append('''<linearGradient id="warm" gradientUnits="userSpaceOnUse"
        x1="0" y1="200" x2="1240" y2="480">
      <stop offset="0.00" stop-color="#FFCE86" stop-opacity="0.40"/>
      <stop offset="0.28" stop-color="#FFE0AE" stop-opacity="0.20"/>
      <stop offset="0.60" stop-color="#EAF2FF" stop-opacity="0.05"/>
      <stop offset="1.00" stop-color="#AFCEFF" stop-opacity="0.20"/>
    </linearGradient>''')

    # Inner bevel: run as a STROKE clipped to the glyph, so it hugs every
    # edge including the counters. Light along the top, dark along the heel.
    d.append('''<linearGradient id="bevel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.00" stop-color="#FFFFFF" stop-opacity="0.95"/>
      <stop offset="0.16" stop-color="#FFFFFF" stop-opacity="0.40"/>
      <stop offset="0.38" stop-color="#FFFFFF" stop-opacity="0.00"/>
      <stop offset="0.62" stop-color="#0B0E14" stop-opacity="0.00"/>
      <stop offset="0.85" stop-color="#0B0E14" stop-opacity="0.30"/>
      <stop offset="1.00" stop-color="#0B0E14" stop-opacity="0.55"/>
    </linearGradient>''')

    d.append('<filter id="soft" x="-60%" y="-60%" width="220%" height="220%">'
             '<feGaussianBlur stdDeviation="22"/></filter>')
    d.append('<filter id="rayblur" x="-60%" y="-60%" width="220%" height="220%">'
             '<feGaussianBlur stdDeviation="3.2"/></filter>')
    d.append('<filter id="coreblur" x="-80%" y="-80%" width="260%" height="260%">'
             '<feGaussianBlur stdDeviation="7"/></filter>')

    d.append('<radialGradient id="flareCore">'
             '<stop offset="0" stop-color="#FFFFFF"/>'
             '<stop offset="0.25" stop-color="#FFF6DF" stop-opacity="0.85"/>'
             '<stop offset="0.6" stop-color="#FFD98A" stop-opacity="0.28"/>'
             '<stop offset="1" stop-color="#FFB65C" stop-opacity="0"/></radialGradient>')
    d.append('<radialGradient id="flareCoolCore">'
             '<stop offset="0" stop-color="#FFFFFF"/>'
             '<stop offset="0.28" stop-color="#EAF4FF" stop-opacity="0.8"/>'
             '<stop offset="0.65" stop-color="#A8CBFF" stop-opacity="0.24"/>'
             '<stop offset="1" stop-color="#7FB0FF" stop-opacity="0"/></radialGradient>')

    # A four-point star: two long spokes, two short, plus a bloom. Drawn as
    # thin diamonds so the spokes taper to a point instead of ending flat.
    for name, core in (('flareWarm', 'flareCore'), ('flareCool', 'flareCoolCore')):
        d.append('<g id="%s">' % name)
        d.append('<circle r="150" fill="url(#%s)" opacity="0.55" filter="url(#soft)"/>' % core)
        d.append('<circle r="46" fill="url(#%s)"/>' % core)
        d.append('<g filter="url(#rayblur)" fill="#FFFFFF">')
        d.append('<path d="M-330 0 L0 -9 L330 0 L0 9Z" opacity="0.85"/>')
        d.append('<path d="M0 -190 L7 0 L0 190 L-7 0Z" opacity="0.7"/>')
        d.append('<path d="M-96 -96 L0 -5 L96 96 L0 5Z" opacity="0.4"/>')
        d.append('<path d="M96 -96 L5 0 L-96 96 L-5 0Z" opacity="0.4"/>')
        d.append('</g>')
        d.append('<circle r="20" fill="#FFFFFF" filter="url(#coreblur)"/>')
        d.append('</g>')

    d.append('<radialGradient id="bgWash" cx="0.42" cy="0.34" r="0.85">'
             '<stop offset="0" stop-color="#2B3566"/>'
             '<stop offset="0.45" stop-color="#141A38"/>'
             '<stop offset="1" stop-color="#05060F"/></radialGradient>')

    # clip paths, one per placed glyph, so the bevel stroke stays inside
    for word, tag in ((TIPPING, 'tp'), (POINT, 'pt')):
        for i, it in enumerate(word.items):
            d.append('<clipPath id="c-%s-%d"><use href="#g%s" transform="%s"/></clipPath>'
                     % (tag, i, it['ch'], word.glyph_tf(it)))

    # every face, as one clip - the warm wash is painted through this
    d.append('<clipPath id="allFaces">')
    for word in (TIPPING, POINT):
        for it in word.items:
            d.append('<use href="#g%s" transform="%s"/>' % (it['ch'], word.glyph_tf(it)))
    d.append('</clipPath>')

    d.append('</defs>')
    return '\n'.join(d)


def word_svg(word, tag):
    """One word: shadow, extrusion from far to near, a bright lip, then the
    faces. The depth loop runs across ALL the letters at each step rather than
    finishing one letter at a time - that is the painter's order for a shared
    extrusion direction, and it stops a letter's sides drawing over its
    neighbour's face."""
    s = ['<g id="%s">' % tag]

    off = math.hypot(DEPTH_DX, DEPTH_DY)
    ux, uy = DEPTH_DX / off, DEPTH_DY / off

    # contact shadow
    s.append('<g opacity="0.5" filter="url(#soft)" fill="#03040A">')
    for it in word.items:
        s.append('<use href="#g%s" transform="translate(%.1f,%.1f) %s"/>'
                 % (it['ch'], ux * DEPTH_LEN * 1.5, uy * DEPTH_LEN * 1.5, word.glyph_tf(it)))
    s.append('</g>')

    # extrusion, far to near
    for k in range(DEPTH_STEPS, 0, -1):
        t = k / DEPTH_STEPS
        col = lerp_hex(SIDE_NEAR, SIDE_FAR, t)
        dx, dy = ux * DEPTH_LEN * t, uy * DEPTH_LEN * t
        s.append('<g fill="%s">' % col)
        for it in word.items:
            s.append('<use href="#g%s" transform="translate(%.2f,%.2f) %s"/>'
                     % (it['ch'], dx, dy, word.glyph_tf(it)))
        s.append('</g>')

    # the lit lip where the side wall meets the face
    s.append('<g fill="#CBD3E0">')
    for it in word.items:
        s.append('<use href="#g%s" transform="translate(%.2f,%.2f) %s"/>'
                 % (it['ch'], ux * 3.5, uy * 3.5, word.glyph_tf(it)))
    s.append('</g>')

    # faces
    for i, it in enumerate(word.items):
        tf = word.glyph_tf(it)
        # A thin dark line under the face, so the top and left edges - which
        # have no extrusion behind them - still part from the background.
        s.append('<use href="#g%s" transform="%s" fill="none" stroke="#0E1119" '
                 'stroke-width="4" stroke-opacity="0.55"/>' % (it['ch'], tf))
        s.append('<use href="#g%s" transform="%s" fill="url(#chrome)"/>' % (it['ch'], tf))
        s.append('<g clip-path="url(#c-%s-%d)">'
                 '<use href="#g%s" transform="%s" fill="none" '
                 'stroke="url(#bevel)" stroke-width="9"/></g>'
                 % (tag, i, it['ch'], tf))

    s.append('</g>')
    return '\n'.join(s)


def background():
    return '''<g id="bg">
  <rect width="%d" height="%d" fill="url(#bgWash)"/>
  <g filter="url(#soft)" opacity="0.75">
    <ellipse cx="130" cy="150" rx="180" ry="150" fill="#3A5BD9" opacity="0.5"/>
    <ellipse cx="1120" cy="210" rx="230" ry="190" fill="#4C3AD9" opacity="0.45"/>
    <ellipse cx="640" cy="560" rx="420" ry="120" fill="#1B2A6B" opacity="0.5"/>
  </g>
  <g opacity="0.5" filter="url(#soft)">
    <circle cx="700" cy="40" r="46" fill="#8FA6C8"/>
    <circle cx="612" cy="26" r="30" fill="#6E86AE"/>
  </g>
  <path d="M0 620 L0 545 C120 520 250 512 360 522 L300 620Z" fill="#C9D3E4" opacity="0.5" filter="url(#soft)"/>
</g>''' % (W, H)


MARGIN = 26

def logo_bbox():
    """Extent of the solid lockup, extrusion included.

    Measured rather than eyeballed, so the fit survives any change to the
    wording, the scale ramp or the depth. Sampling each glyph's 0..w by 0..100
    box is enough - the curves stay inside it.

    Flares are deliberately left out. Their rays are 300-odd units long and
    including them would shrink the letters to nothing; in the reference they
    run off the edge of the frame anyway."""
    off = math.hypot(DEPTH_DX, DEPTH_DY)
    ex, ey = DEPTH_DX / off * DEPTH_LEN, DEPTH_DY / off * DEPTH_LEN
    xs, ys = [], []
    for word in (TIPPING, POINT):
        for i, it in enumerate(word.items):
            for px in (0, it['w']):
                for py in (0, 100):
                    x, y = word.point(i, px, py)
                    xs += [x, x + ex]
                    ys += [y, y + ey]
    return min(xs), min(ys), max(xs), max(ys)


def build(with_bg):
    s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">' % (W, H, W, H)]
    s.append(defs())
    if with_bg:
        s.append(background())

    x0, y0, x1, y1 = logo_bbox()
    k = min((W - 2 * MARGIN) / (x1 - x0), (H - 2 * MARGIN) / (y1 - y0))
    tx = W / 2 - k * (x0 + x1) / 2
    ty = H / 2 - k * (y0 + y1) / 2
    s.append('<g id="logo" transform="translate(%.2f,%.2f) scale(%.4f)">' % (tx, ty, k))

    s.append(word_svg(TIPPING, 'tp'))     # behind
    s.append(word_svg(POINT, 'pt'))       # in front, overlapping it

    # one warm-to-cool wash over every face
    s.append('<g clip-path="url(#allFaces)">'
             '<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="url(#warm)"/></g>'
             % (x0 - 40, y0 - 40, x1 - x0 + 80, y1 - y0 + 80))

    # The two catchlights the logo is known for: one riding the top edge of
    # the P in POINT, one off the bottom right of the G in TIPPING. Both are
    # hung off real glyph corners, so they stay put if the layout moves.
    fx, fy = POINT.point(0, 30, 1)
    s.append('<use href="#flareWarm" transform="translate(%.1f,%.1f) scale(0.60) rotate(-8)"/>' % (fx, fy))
    gx, gy = TIPPING.point(6, 66, 97)
    s.append('<use href="#flareCool" transform="translate(%.1f,%.1f) scale(0.40) rotate(6)"/>' % (gx, gy))

    s.append('</g>')
    s.append('</svg>')
    return chr(10).join(s)


os.makedirs(OUT, exist_ok=True)
io.open(os.path.join(OUT, 'tipping-point.svg'), 'w', encoding='utf-8', newline='\n').write(build(False))
io.open(os.path.join(OUT, 'tipping-point-on-set.svg'), 'w', encoding='utf-8', newline='\n').write(build(True))
print('written to', os.path.normpath(OUT))
print('TIPPING advance %.0f, POINT advance %.0f' % (TIPPING.advance, POINT.advance))
print('flare P', POINT.point(0, 8, 2), ' flare G', TIPPING.point(6, 70, 96))
