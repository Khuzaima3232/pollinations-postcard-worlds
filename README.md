# Postcard worlds

Type a place, then click doors, paths and windows to step into the next generated
view. Explore a small world one picture at a time.

**Play it:** https://khuzaima3232.github.io/pollinations-postcard-worlds/

Two ways in:

- **The demo world needs no sign-in.** It is pre-generated and committed, so
  anyone who opens the link can explore immediately.
- **Sign in with your own Pollen** to type a scene and have it generated, then
  keep stepping through your own world.

## How it works

Each view is an image with two or three clickable spots. A **vision model** finds
those spots and returns them as percentages of the image, so they track the image
at any window size. Clicking a spot generates the next view and looks for spots
again.

The step prompt carries the previous view as a reference image, so the world
continues from where you are.

## Consistency, and a correction

The quest suggests that style consistency across views comes from passing the
previous view as a reference image. Measured on this build, that is only half
true.

Passing the previous view as a reference gives **narrative continuity but not a
stable look**. A step from a warm forest into a snow tunnel came back cool and
monochrome — a vision check called it *"a different scene entirely… shares only
the material of snow"*.

What actually holds the look is a **locked style descriptor** repeated verbatim in
every prompt:

> Shot on 35mm film, natural overcast daylight, muted earthy palette with warm
> amber highlights, visible grain, shallow depth of field, documentary travel
> photography. Photorealistic, not illustrated.

With the descriptor plus the reference, the same step produced a snowy forest in
the source's palette and the vision check said it *"could easily pass as a still
from a nature documentary"* belonging to the same world.

So: the descriptor holds the look, the reference image provides continuity of
place.

## Structure

```
index.html                  the page
app.js                      the app: BYOP sign-in, generation, the walk, replay
worlds/demo.json            the pre-generated demo world
worlds/demo/*.png           its committed views
build_demo_world.py         regenerates the demo world from the API
test/app.test.cjs           checks for the world data and the app logic
```

## Verification

```sh
node test/app.test.cjs
```

84 checks, all passing. They cover the world data (every view's image committed,
every spot a sane percentage, every spot recording where it leads, every
destination existing, every view reachable from the start, at least one branch and
one dead end), the app's own logic (the style descriptor is substantial and names
its medium, the spot prompt asks for the exact JSON the parser reads, the replay
link encodes the path), and the wiring between the page and the script.

Two of those checks are regression guards. The first build matched a spot to its
destination by shared words, which failed: the vision model's `track-curves`
shares no word with the view id `frozen-tracks`, so **the paths crossed** —
clicking the rails led into the shelter. The world now records a destination on
each spot, and the guards assert the correct mapping.

Played through in a browser: the demo world loads with two clickable spots over
the rails and the doorway, each leading where its label says; stepping twice
reaches a dead end; back returns a step and hides itself at the start; the replay
link encodes the trail; and the console reports no errors.

## Honest gaps

- **Live generation with a signed-in account was not run.** The demo world proves
  the whole pipeline — images, vision-found spots, stepping, back, replay — but
  the BYOP sign-in path itself has only been verified up to the consent screen,
  because approving it needs an account owner. GATEKEEPER uses the same flow with
  the same App Key and was approved, but I did not re-approve it here.
- The demo world is five views. It is a taste of the mechanic, not a large world.
- Steps after the first are generated live, so a long walk costs Pollen and can
  hit rate limits. Errors surface as a message rather than a broken board.

## Licence

App code MIT. Demo-world images were generated for this project with Pollinations.
