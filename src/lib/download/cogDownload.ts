// R3-W2 Deliverable 2, "Data layer · GeoTIFF": fetch -> blob -> saveBlob. The brief's own reason a
// plain `<a download href={cogUrl}>` cannot be used: "S3 sends no content-disposition, so a plain
// `<a download>` cross-origin would just navigate" -- the browser opens/renders the TIFF (or offers
// its own save-as for an unrecognized type) instead of honoring `download`, which only applies
// same-origin or when the response opts in. `fetchImpl` is injected so this stays testable without
// a network call (this repo's "inject the transport" rule, `src/lib/analytics/transport.ts`'s own
// header states it for GA4; the same reasoning applies to any network side effect).
export interface CogDownloadCallbacks {
  onStart?: () => void;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export async function downloadCog(
  url: string,
  fileName: string,
  saveBlobImpl: (blob: Blob, name: string) => void,
  callbacks: CogDownloadCallbacks = {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  callbacks.onStart?.();
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    callbacks.onError?.("Couldn't fetch the GeoTIFF (network error).");
    return;
  }
  if (!res.ok) {
    callbacks.onError?.(`Couldn't fetch the GeoTIFF (HTTP ${res.status}).`);
    return;
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    callbacks.onError?.("Couldn't read the GeoTIFF response.");
    return;
  }
  saveBlobImpl(blob, fileName);
  callbacks.onSuccess?.();
}
