# Pile Design – AS 2159

A browser-based calculator for the axial (compression) geotechnical design of single piles in accordance with **AS 2159-2009 *Piling – Design and installation***, with load combinations to **AS/NZS 1170.0**.

It finds the **minimum pile length** that satisfies both:

- **Geotechnical strength (ULS):** R\*d,g = φg · Rd,ug ≥ E\*d, where Rd,ug = shaft + end-bearing resistance
- **Serviceability (SLS):** pile head settlement under G + ψsQ ≤ the specified limit

## Features

- **Projects**: multiple projects saved in the browser. Switch with the dropdown in the top-right corner; the ⋯ menu creates, duplicates, deletes, exports and imports projects.
- **Calculation sheets**: each project holds any number of sheets as sub-tabs under *Calculations* (new, duplicate, rename by double-clicking, delete). A new sheet copies the current ground profile and risk ratings.
- **Pile and ground profile graphic**: the soil column with the pile, cut-off, ignored shaft zone and groundwater, beside plots of unit shaft resistance, unit base resistance and capacity against depth. Each layer has its own hatch pattern and colour.
- **Project details** tab: project information and a summary of every sheet's result.
- **Methods & information** tab: equations, learning notes with diagrams, input explanations with test methods, references and version history.
- **Limitations** tab.

## Running

No build step or dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Inputs are saved in the browser automatically. Export projects to JSON from the ⋯ menu to back them up or share them; *Print current tab* produces a calculation printout. Single-sheet files and browser data from v1 are migrated automatically.

## Method

| Item | Basis |
|---|---|
| φg | φg = φgb + (φtf − φgb)K ≥ φgb (Cl. 4.3.1). φgb from the Average Risk Rating using the Table 4.3.2(A) risk factors and weights, low/high redundancy (Cl. 4.3.2). K = 1.33p/(p+3.3) static or 1.13p/(p+3.3) dynamic testing, K ≤ 1. Manual override available. |
| Loads | E\*d = max(1.35G, 1.2G + 1.5Q); SLS = G + ψsQ |
| Clay | Shaft α·su (fixed α, or API RP2A α from su/σ′v); base Nc·su (Nc = 9) |
| Sand | Shaft β-method K·σ′v·tanδ with K = (K/K0)(1 − sinφ′) and δ = (δ/φ′)φ′ (Kulhawy 1984); base Nq·dq·σ′v (Hansen/Vesic) |
| Rock | Shaft a·√qu (Rowe & Armitage 1987, a = 0.45 default); base 4.83·qu^0.51 (Zhang & Einstein 1998), qu in MPa |
| User-defined | Directly specified ultimate fs and qb per layer |
| Limits | Optional fs,max and qb,max per layer; shaft friction ignored above a set depth; weaker-layer check for minimum embedment in the founding stratum and for weaker layers within 3D below the toe |
| Settlement | Randolph & Wroth (1978) elastic compressible-pile solution and Fleming (1992) hyperbolic non-linear method (with elastic shortening); adopt either or the larger |

Default method parameters (K/K0, δ/φ′, α) change with the selected pile type (bored, CFA, driven precast concrete, driven closed-end steel tube) and can be edited under *Method parameters*.

## Not covered

Structural strength (AS 2159 Section 5, AS 3600, AS 4100), negative skin friction/downdrag, group effects, lateral, uplift and cyclic loading, durability (Section 6) and pile self-weight. Check these separately.

> This tool is a design aid. Parameters and results must be reviewed by a qualified geotechnical engineer. Verify the φgb values and intrinsic test factors against your copy of AS 2159.

## Tests

```bash
npm test
```

Hand-check tests for the reduction factor, load combinations, clay/sand/rock capacity, effective stress, the Randolph & Wroth rigid-pile limit, the Fleming curve, the length search and the depth profile are in `test/calc.test.js`.

## Files

- `index.html`: page structure and written content
- `js/calc.js`: calculation engine (browser and Node)
- `js/content.js`: fill patterns, references, version history, learning diagrams
- `js/app.js`: projects, sheets, inputs and results
- `css/styles.css`: styles
