// ambient type for the harness's window.__s2 (see ../src/main.ts), duplicated here (not imported)
// because Playwright's own TS program for e2e/** is separate from Vite's for src/**.
interface Window {
  __s2: {
    seed: string | null;
    marks: Record<string, number>;
    boot?: unknown;
    map?: import("maplibre-gl").Map;
  };
}
