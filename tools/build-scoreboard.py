#!/usr/bin/env python3
"""Score panel: a chrome bezel round a lit screen, name above, score below.

    python tools/build-scoreboard.py

The metal is the SAME ramp as the Tipping Point logo - the stops are copied
from tools/build-logo.py rather than re-invented, because two pieces of chrome
on one screen that catch the light differently read as two different props.

The text is LIVE <text>, not outlined paths. The logo could afford paths
because it never changes; a score changes constantly, so it has to be typeset
by the renderer. That means the font matters: the stack falls back through
what Windows actually ships, and the panel is sized so a four-digit score
still fits inside the screen.
"""

import io, os, sys

# --------------------------------------------------------------------------
# Geometry. The reference photo reads as a chunky bezel round a 4:3-ish screen,
# with the name in the top third and the score filling the rest.
# --------------------------------------------------------------------------
# 560 wide read as too long next to the logo - the panels looked like letter
# boxes rather than score displays. 480 is squarer without going square.
#
# Height then came off by 15%, 400 -> 340. The panel's WIDTH on screen is set
# by the row it sits in, so shortening it here only takes height away: the same
# text in a tighter box, which is what was wanted. The text is deliberately NOT
# scaled down with it - it fills more of the screen now, which is the point.
W, H        = 480, 340
BEZEL       = 30            # frame thickness
R_OUT       = 22            # outer corner radius
R_IN        = 9             # screen corner radius

SCREEN_X    = BEZEL
SCREEN_Y    = BEZEL
SCREEN_W    = W - BEZEL * 2
SCREEN_H    = H - BEZEL * 2

NAME_SIZE   = 58
SCORE_SIZE  = 150

# --------------------------------------------------------------------------
# The two lines are centred AS A BLOCK in the screen, not placed at fixed
# heights. Fixed heights were tried and the pair read as two separate things
# stuck on one panel - a name near the top, a number lower down, and a gap
# between them that belonged to neither.
#
# Cap height, not font size, because that is what the eye actually centres on:
# a line box carries descender space under it that nothing is drawn in, and
# centring on the box leaves the text sitting visibly high.
# --------------------------------------------------------------------------
CAP        = 0.72           # of font size, for this weight of Arial
LINE_GAP   = 0.055 * H

_cap_n = NAME_SIZE * CAP
_cap_s = SCORE_SIZE * CAP
_block = _cap_n + LINE_GAP + _cap_s
_top   = SCREEN_Y + SCREEN_H / 2.0 - _block / 2.0

NAME_BASE  = _top + _cap_n
SCORE_BASE = _top + _cap_n + LINE_GAP + _cap_s

# Condensed where it exists, then the ordinary faces every Windows box has.
FONT = "'Arial Narrow','Haettenschweiler','Arial Bold',Arial,Helvetica,sans-serif"


def defs():
    return '''<defs>
  <!-- The chrome ramp, copied stop for stop from the logo. Bright crown, a
       dark horizon just under the middle, a hard light break beneath it, then
       a second bright pass and a dark heel. That break is what reads as
       polished metal rather than a grey gradient. -->
  <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
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
  </linearGradient>

  <!-- Same bevel as the logo: white at the crown falling to nothing, then
       shadow gathering at the heel. Run as a clipped STROKE so it hugs the
       frame's own edge instead of floating near it. -->
  <linearGradient id="bevel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0.00" stop-color="#FFFFFF" stop-opacity="0.95"/>
    <stop offset="0.16" stop-color="#FFFFFF" stop-opacity="0.40"/>
    <stop offset="0.38" stop-color="#FFFFFF" stop-opacity="0.00"/>
    <stop offset="0.62" stop-color="#0B0E14" stop-opacity="0.00"/>
    <stop offset="0.85" stop-color="#0B0E14" stop-opacity="0.30"/>
    <stop offset="1.00" stop-color="#0B0E14" stop-opacity="0.55"/>
  </linearGradient>

  <!-- The screen. Lit from above and falling away, the way a backlit panel
       actually behaves - a flat fill is what makes a screen look painted on. -->
  <linearGradient id="screen" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0.00" stop-color="#2C3E63"/>
    <stop offset="0.35" stop-color="#22314F"/>
    <stop offset="0.72" stop-color="#1B283F"/>
    <stop offset="1.00" stop-color="#243657"/>
  </linearGradient>

  <!-- Recess: the screen sits BELOW the bezel, so its opening is shaded dark
       at the top and catches light at the bottom - the opposite way round to
       the frame. That inversion is what makes it read as a hole rather than a
       panel laid on top. -->
  <linearGradient id="recess" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0.00" stop-color="#000000" stop-opacity="0.55"/>
    <stop offset="0.30" stop-color="#000000" stop-opacity="0.18"/>
    <stop offset="0.70" stop-color="#FFFFFF" stop-opacity="0.05"/>
    <stop offset="1.00" stop-color="#FFFFFF" stop-opacity="0.22"/>
  </linearGradient>

  <!-- A cool wash across the glass, brightest top-left. -->
  <linearGradient id="sheen" x1="0" y1="0" x2="0.75" y2="1">
    <stop offset="0.00" stop-color="#9FC6FF" stop-opacity="0.20"/>
    <stop offset="0.45" stop-color="#7FA8E8" stop-opacity="0.05"/>
    <stop offset="1.00" stop-color="#0A1428" stop-opacity="0.18"/>
  </linearGradient>

  <filter id="glow" x="-25%%" y="-25%%" width="150%%" height="150%%">
    <feGaussianBlur stdDeviation="9" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <!-- Glow AND a cast shadow. The glow alone left the text looking flat and
       printed on: a lit panel throws light around a letter, but a letter
       sitting in front of one also casts a shadow onto it, and without the
       second half the text has no depth at all.

       The shadow goes down and slightly right, matching the light the chrome
       is lit by - a shadow that disagrees with the metal beside it is worse
       than none. -->
  <filter id="textglow" x="-35%%" y="-35%%" width="170%%" height="180%%">
    <feDropShadow dx="0" dy="7" stdDeviation="5"
                  flood-color="#04070E" flood-opacity="0.72"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="b"/>
    <feFlood flood-color="#BEDCFF" flood-opacity="0.5" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="glow"/>
    <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <!-- The frame's OWN ramp. The chrome gradient above spans the whole panel,
       which is right for a solid plate and wrong for a bezel: a 34px frame
       round a 400px panel samples almost none of it, so the metal came out
       flat grey. This one is mapped in user space across the bezel thickness
       instead, so the full bright-dark-bright cycle happens within the frame
       where it can be seen. Top and bottom edges get their own; the sides
       inherit the top one, which is what a real extrusion does under a light
       that is above it. -->
  <linearGradient id="frameTop" gradientUnits="userSpaceOnUse"
                  x1="0" y1="0" x2="0" y2="%d">
    <stop offset="0.00" stop-color="#FDFEFF"/>
    <stop offset="0.18" stop-color="#DDE3EC"/>
    <stop offset="0.42" stop-color="#AEB6C5"/>
    <stop offset="0.62" stop-color="#767E8E"/>
    <stop offset="0.72" stop-color="#9AA2B1"/>
    <stop offset="0.88" stop-color="#E4E9F1"/>
    <stop offset="1.00" stop-color="#B9C1CE"/>
  </linearGradient>
  <linearGradient id="frameBottom" gradientUnits="userSpaceOnUse"
                  x1="0" y1="%d" x2="0" y2="%d">
    <stop offset="0.00" stop-color="#9098A7"/>
    <stop offset="0.22" stop-color="#C9D0DB"/>
    <stop offset="0.46" stop-color="#F2F5FA"/>
    <stop offset="0.64" stop-color="#AAB2C1"/>
    <stop offset="0.82" stop-color="#6A7180"/>
    <stop offset="1.00" stop-color="#8F97A5"/>
  </linearGradient>

  <clipPath id="frameClip">
    <rect x="1" y="1" width="%d" height="%d" rx="%d"/>
  </clipPath>
  <clipPath id="screenClip">
    <rect x="%d" y="%d" width="%d" height="%d" rx="%d"/>
  </clipPath>
</defs>''' % (BEZEL, H - BEZEL, H,
              W - 2, H - 2, R_OUT,
              SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, R_IN)


def panel(name, score, x=0, y=0, text=True):
    """One score panel, translated to (x, y).

    text=False leaves the screen empty. That is the version the GAME uses: the
    chrome is a static image and the name and score are live HTML laid over it,
    because a score that changes cannot be baked into a file, and injecting the
    same SVG twice would collide on every gradient id it contains.
    """
    g = ['<g transform="translate(%g,%g)">' % (x, y)]

    # Frame. The plate carries the broad chrome ramp; the top and bottom rails
    # are then overlaid with their own tight ramps, because that is where a
    # bezel actually shows its thickness and where the eye reads the metal.
    g.append('<rect x="1" y="1" width="%d" height="%d" rx="%d" fill="url(#chrome)"/>'
             % (W - 2, H - 2, R_OUT))
    g.append('<g clip-path="url(#frameClip)">')
    g.append('<rect x="0" y="0" width="%d" height="%d" fill="url(#frameTop)"/>'
             % (W, BEZEL))
    g.append('<rect x="0" y="%d" width="%d" height="%d" fill="url(#frameBottom)"/>'
             % (H - BEZEL, W, BEZEL))
    # Bevel last, over all of it, so the corners turn properly.
    g.append('<rect x="1" y="1" width="%d" height="%d" rx="%d" fill="none" '
             'stroke="url(#bevel)" stroke-width="9"/>'
             % (W - 2, H - 2, R_OUT))
    g.append('</g>')
    # A hairline to stop the plate dissolving into a light background.
    g.append('<rect x="0.75" y="0.75" width="%.1f" height="%.1f" rx="%d" fill="none" '
             'stroke="#5F6776" stroke-width="1.5" stroke-opacity="0.9"/>'
             % (W - 1.5, H - 1.5, R_OUT))

    # Screen: fill, sheen, then the recess shading on its opening.
    g.append('<rect x="%d" y="%d" width="%d" height="%d" rx="%d" fill="url(#screen)"/>'
             % (SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, R_IN))
    g.append('<g clip-path="url(#screenClip)">'
             '<rect x="%d" y="%d" width="%d" height="%d" fill="url(#sheen)"/></g>'
             % (SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H))
    g.append('<g clip-path="url(#screenClip)">'
             '<rect x="%d" y="%d" width="%d" height="%d" rx="%d" fill="none" '
             'stroke="url(#recess)" stroke-width="13"/></g>'
             % (SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, R_IN))

    if not text:
        g.append('</g>')
        return chr(10).join(g)

    cx = W / 2.0

    # Name. Letter-spaced, because a short word centred in a wide panel reads
    # as lost without it.
    g.append('<text x="%g" y="%.2f" text-anchor="middle" font-family=%s '
             'font-size="%d" font-weight="bold" letter-spacing="4" '
             'fill="#FFFFFF" filter="url(#textglow)">%s</text>'
             % (cx, NAME_BASE, '"%s"' % FONT, NAME_SIZE, esc(name)))

    # No rule between the two. One was tried and it looked tidy, but the panel
    # in the reference photo has nothing there and the name and score are
    # already grouped by being the only two things on the screen.

    g.append('<text x="%g" y="%.2f" text-anchor="middle" font-family=%s '
             'font-size="%d" font-weight="bold" '
             'fill="#FFFFFF" filter="url(#textglow)">%s</text>'
             % (cx, SCORE_BASE, '"%s"' % FONT, SCORE_SIZE, esc(str(score))))

    g.append('</g>')
    return '\n'.join(g)


def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def document(panels, w, h, background=None):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
           'width="%d" height="%d">' % (w, h, w, h)]
    out.append(defs())
    if background:
        out.append('<rect width="%d" height="%d" fill="%s"/>' % (w, h, background))
    out.extend(panels)
    out.append('</svg>')
    return '\n'.join(out)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(here, 'assets', 'scoreboard')
    if len(sys.argv) > 1:
        outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)

    # One on its own, for dropping into the game.
    single = os.path.join(outdir, 'panel-team-a.svg')
    io.open(single, 'w', encoding='utf-8').write(
        document([panel('TEAM A', 150)], W, H))

    io.open(os.path.join(outdir, 'panel-team-b.svg'), 'w', encoding='utf-8').write(
        document([panel('TEAM B', 90)], W, H))

    # The one the game actually uses: chrome only, no text.
    io.open(os.path.join(outdir, 'panel-blank.svg'), 'w', encoding='utf-8').write(
        document([panel('', '', text=False)], W, H))

    # Where the live text has to sit to match the baked version, as fractions
    # of the panel. Printed rather than guessed at the CSS end.
    # The numbers the game's CSS needs, so they are never matched by eye.
    print('  aspect       : %d/%d' % (W, H))
    print('  nameSize     : %.4f   (of panel height)' % (NAME_SIZE / float(H)))
    print('  scoreSize    : %.4f' % (SCORE_SIZE / float(H)))
    print('  lineGap      : %.4f' % (LINE_GAP / float(H)))
    print('  screenInsetX : %.4f' % (BEZEL / float(W)))
    print('  screenInsetY : %.4f' % (BEZEL / float(H)))
    print('  shadowDy     : %.4f   blur %.4f' % (7 / float(H), 5 / float(H)))

    # A review sheet: both teams, on the game's own background, plus the
    # extremes the panel has to survive - a long name and a four-digit score.
    GAP = 48
    sheet_w = W * 2 + GAP * 3
    sheet_h = H * 2 + GAP * 3
    io.open(os.path.join(outdir, 'review.svg'), 'w', encoding='utf-8').write(
        document([panel('TEAM A', 150,  GAP,           GAP),
                  panel('TEAM B', 90,   GAP * 2 + W,   GAP),
                  panel('TEAM A', 1250, GAP,           GAP * 2 + H),
                  panel('BUMBLEBEES', 0, GAP * 2 + W,  GAP * 2 + H)],
                 sheet_w, sheet_h, background='#0B0616'))

    print('wrote %s' % outdir)


if __name__ == '__main__':
    main()
