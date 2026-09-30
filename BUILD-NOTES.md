# Explorable postcard worlds — build notes (quest #15728)

Reward: **8 Pollen** (highest on the board). Zero rivals when picked.

## Verified facts (measured)

| Thing | Result |
|---|---|
| Vision for hotspots | `openai/gpt-5.4-nano`, `z-ai/glm-5.3-flash`, `openai/gpt-6-luna` all returned **200** with clean minified JSON: `{"spots":[{"label","x","y","hint"}]}` — percentage coordinates, parseable, sane. |
| Vision model count | 59 models accept image input. |
| i2i step | `POST /v1/images/edits` works on `flux.2-klein-4b` (16s) and `gpt-image-1-mini` (36s). |
| Cost | gpt-image-1-mini ≈ 1056 output tokens per image; klein-4b ≈ 99 KB file at 16s. |

## The finding that shaped the design

Passing the previous view as a reference image gives **narrative continuation but
not a stable look**. A snow-tunnel step came back cool and monochrome when the
source was a warm forest — a vision check called it *"a different scene entirely…
shares only the material of snow"*.

Adding a **locked style descriptor** to every prompt fixed it. The same step with
the descriptor plus the reference produced a snowy forest with the muted earthy
palette, warm highlights, film grain and overcast light of the source, and the
vision check said it *"could easily pass as a still from a nature documentary"*
belonging to the same world.

So consistency comes from the **locked descriptor**, and the reference image
provides continuity of place. That is a correction to the quest's own suggestion,
which attributes consistency to the reference image alone.

## Design

- **BYOP sign-in**, because the goal says players "pay with their own Pollen".
  Reuses the OAuth PKCE flow proven with GATEKEEPER, including the registered App
  Key `pk_SApp5…` (redirect URI must match exactly).
- **Type a scene to begin**, then click hotspots to step. 2–3 spots per view,
  found by a vision model.
- **Breadcrumb map** of the path walked, and a **shareable replay link** encoding
  the path, since both are suggested and both are cheap to add.
- **Locked style** carried through every step prompt.
- Single static page, no build step, like GATEKEEPER and Spot-the-fake.

## Rejected

- Relying on the reference image alone for style (disproved above).
- Pre-generating worlds: the goal is that the player types the scene, so it must
  be generated live per session.
