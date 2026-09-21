# Goose posture sheet — ChatGPT image prompts

Reference: `src/assets/chef-goose-schedule-loading-v1.png` (the existing Toque sheet). Attach it to every request so the style locks. Generate **one row of 3–4 poses per image**, all at the same scale, feet on one baseline, so they can be cut into equal cells. Player geese in these sheets wear **no hat** — the toque is the agent's only. Beak and feet stay orange; the neckerchief is the one colour slot and is drawn in **#E58A1F (Leo's orange)** here; Mia's blue and the agent's purple are recoloured later in SVG.

---

## Base style block (paste at the top of every prompt)

```
Character sheet of a cartoon goose, same character in every pose, in the exact style of the attached reference: bold single-weight black outline, flat white body, flat orange beak and feet, no gradients, no shading, no texture, no text, no background — transparent PNG. One small black dot eye, no eyebrows, no mouth curve; the goose is deadpan and expression comes only from neck posture, wing position and the object it holds. It wears a single triangular neckerchief knotted at the side of the neck, filled flat #E58A1F — this is the only coloured clothing. No chef hat. Front three-quarter view, standing, feet on a common baseline, every pose the same scale, generous even spacing between poses, nothing overlapping. Props (pot, spatula, counter, card) are drawn in the same black outline with at most one flat warm fill. Each pose must still read as a silhouette at 32 pixels tall.
```

## Sheet 1 — working (G1 · G2 · G4)

```
[base style block]

Draw three poses side by side:
1. "On it" — the goose leans forward over a small stockpot on a burner, neck arched down toward the pot, one wing holding a spatula, the other wing on the pot's rim. Focused, not frantic.
2. "Up next" — the goose stands upright, neck straight, one wing raised to shoulder height like a student ready to be called on, the other wing at its side.
3. "Free hands" — the goose stands upright with BOTH wings raised high and open, neck slightly forward, offering. Still deadpan.
```

## Sheet 2 — resting (G3 · G5 · G6)

```
[base style block]

Draw three poses side by side:
1. "Waiting" — the goose slumps against the edge of a kitchen counter, body leaning on it with one wing, neck lowered to horizontal, head resting flat on the counter. Bored, patient.
2. "Done for the night" — the goose sits down on its folded legs, head tucked backwards under one wing, asleep. A compact rounded silhouette.
3. "Up for grabs" — the goose stands with its head tilted to one side, neck curved, looking sideways down at a small playing card lying on the counter in front of it, one wing hovering over the card as if about to take it.
```

## Sheet 3 — alarm & victory (G7 · G9)

```
[base style block]

Draw two poses side by side, with more space between them:
1. "Honk" — the goose stands rigid with its neck stretched fully straight up, beak wide open, wings clamped tight to the body; three short black motion lines beside the beak. This is the alarm pose; it must read as loud from far away.
2. "Victory" — the goose stands tall with its neck up and BOTH wings spread wide open to the sides, beak closed. The only pose where neck and both wings are all up. Calm triumph, not jumping.
```

## Sheet 4 — the agent, Toque (G8)

```
[base style block, but replace "No chef hat" with: "It wears a tall white pleated chef's toque exactly as in the reference, and its neckerchief is filled flat #7C5CE0 (purple)."]

Draw three poses side by side:
1. "Idle" — standing upright, neck straight, wings at its sides, neutral.
2. "Speaking left" — same stance, but the neck is extended forward and to the viewer's left, beak slightly open, as if addressing someone standing there.
3. "Speaking right" — the mirror of pose 2, neck extended to the viewer's right.
```

## After generating

- Check every pose at 32px (resize the row to 32px tall): if two poses look the same, regenerate with the *neck angle* changed, not the props.
- Cut into cells, name `goose-g1-on-it.png` … `goose-g9-victory.png`, `goose-toque-idle.png`, `goose-toque-left.png`, `goose-toque-right.png`.
- Then redraw as SVG with `stroke="currentColor"` and the neckerchief as `fill="var(--kp-cook-a)"` so the same file serves both players and dark mode.
