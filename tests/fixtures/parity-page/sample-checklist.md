## Parity checklist (each line is an e2e assertion; § = section of the reference)

**Controls (§5.3)**
- [ ] Study area: FULL / AK presets → `flyTo(center, zoom)`.
- [ ] Spatial units: `Raster cells (0.05°)` + one entry per `boot.units` row (derived, never hardcoded);
      the note "{ver} predates the BOEM Program Areas" when the primary unit is not `programarea`.

**Map (§6.2–6.4)**
- [x] One PMTiles source + outline per unit, styles from the `zone_style` table.
- [ ] Zone branch: ALL zones of the unit; fill by the 11-bin rule from `ramps.ts`.

## Steps
1. This heading ends the section.
- [ ] This checkbox is OUTSIDE the checklist and must never become a row.
