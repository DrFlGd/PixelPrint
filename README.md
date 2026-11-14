# Pixel Print

Turn video game sprite sheets into 3D-printable pixel figures with real filament colors.

1. **Library** – import sprite sheets (PNG/GIF/WebP; drag, drop or paste). Sheets and saved figures are kept in your browser (IndexedDB).
2. **Slice** – find sprites automatically (islands of non-background pixels, with nearby pieces joined) or with a fixed grid. Transparent and solid-color backdrops both work; pick the backdrop color from the sheet if needed. Upscaled rips (2×, 3×…) are detected and reduced back to one cell per art pixel.
3. **Build** – map each sprite color to a filament, preview in 3D, and export.

## Figure styles

| Style | What prints |
| --- | --- |
| 1-sided | Colored face on top of a core in the backing filament. Color changes only happen in the last few layers, so it's the fastest multi-color print. |
| 2-sided | Colored faces on both sides around the core. The back shows the mirrored sprite. |
| Stacked | Each filament sits at its own height (levels set per filament), so colors read as raised layers. |
| Flat | One level; every pixel is a full-thickness column of its color. |

**Stand:** optional round, oval, square or rectangular base with slots. Auto picks the smallest common miniature base (20/25/32/40/50/60 mm) that fits the post and any base magnets. Height and edge bevel are adjustable.

**Post:** the part of the figure that slots into the base. Choose one bar (matching the sprite's bottom row or a custom width) or two pegs, and set its thickness, how far it reaches into the base, and the slot clearance.

**Magnets:** add round pockets for common disc magnets (5×2 up to 12×3 mm, or any size) in the bottom of the base, the back of the figure, or both.
- *Open* pockets open onto the print bed; glue the magnets in afterwards.
- *Sealed* pockets start 0.6 mm above the bed and are closed over. The app shows the Z height to add a pause at in your slicer so you can drop the magnets in.
- Base magnets go in the middle, beside the slot, or spread around the base. If the slot leaves no room, the app tells you how tall the base needs to be.
- Figure magnets are placed automatically where there's enough solid plastic: anywhere in the core for 1-sided figures, or on a single-color patch for the other styles.

**Filaments:** edit the list under *Edit my filaments*, tick the ones you have loaded, and set *Max filaments* (e.g. 4 for one AMS). Auto-match picks the nearest owned filament for each color (CIE Lab distance) and merges the smallest groups until it's under the limit. Click any pixel on the 3D model to change its filament.

## Exports

- **3MF (multi-color)** – the figure is one object with one part per filament (each part carries its display color), plus the stand as a separate object. In Bambu Studio / OrcaSlicer / PrusaSlicer, assign each part to the matching AMS slot or extruder.
- **STL** – everything merged into one file.
- **STL per color** – a zip with one STL per filament plus the stand, for slicers that build multi-color objects from separate files.

Models are exported lying flat (front face up), in millimetres.

## Develop

```sh
npm install
npm run dev     # local dev server
npm test        # geometry, slicing and export tests
npm run build   # static site in dist/
```

Stack: Vite, React, TypeScript, three.js, fflate (3MF zip), idb-keyval (storage), earcut (stand triangulation).

## Deploy

`.github/workflows/pages.yml` publishes `dist/` to GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.
