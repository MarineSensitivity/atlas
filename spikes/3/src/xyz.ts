// standard slippy-map (Web Mercator / EPSG:3857) XYZ tile math, used to fetch the same
// {z}/{x}/{y} tiles from titiler that a real MapLibre client would request.
export interface TileBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function tileToBBox(x: number, y: number, z: number): TileBBox {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = tileYToLat(y, n);
  const south = tileYToLat(y + 1, n);
  return { west, south, east, north };
}

function tileYToLat(y: number, n: number): number {
  const yFrac = Math.PI * (1 - (2 * y) / n);
  return (Math.atan(Math.sinh(yFrac)) * 180) / Math.PI;
}
