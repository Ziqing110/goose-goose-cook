# Goose posture assets

Open `preview.html` for all 11 SVGs, actual 32px samples, player recolouring, dark background, and generated sheets.

- `sheets/`: four imagegen-generated reference sheets, always using the original Toque reference. Working sheet was regenerated to separate G4 from G9 by neck angle.
- `png/`: 11 equal-cell transparent cuts, original generated pixels preserved. Three-pose cells are 724 × 724; two-pose cells are 887 × 887. Display using equal CSS dimensions.
- `svg/`: simplified native vector redraws, 200 × 200 viewBox, common baseline, white body, orange beak/feet, fixed black dot eye, `stroke="currentColor"`, neckerchief `fill="var(--kp-cook-a)"`.
- `qa/`: alpha results, whole rows reduced to 32px tall, browser screenshots.

Use SVG inline so it inherits CSS variables. Set `--kp-cook-a: #E58A1F` for Leo, your project blue for Mia, and `#7C5CE0` for Toque. The preview blue #458CCC is illustrative. Set `color` deliberately for the goose; inheriting white page text erases internal outlines against its white body. The dark preview keeps dark outlines and adds a subtle external CSS edge for contrast.

G8 is represented by the three named Toque variants; there is no additional ninth player pose. Names follow the requested G1/G2/G4, G3/G5/G6, G7/G9 order.

Limitations: generated PNGs retain slight texture, approximate colour fills, and model-driven proportions; they are not strict flat-colour masters. SVGs are simplified redraws, not exact vector traces of the raster art. At 32px neck and wing poses remain the primary cues; small prop details are secondary. No existing app component was replaced.

Validation: alpha extrema 0–255 in every PNG cell; browser image loading; Leo/Mia CSS fill change; light/dark screenshots and actual-size samples reviewed.
