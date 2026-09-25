import { describe, expect, it, vi } from "vitest";
import { downloadCog } from "../../src/lib/download/cogDownload";

function fakeFetch(response: Partial<Response> & { ok: boolean; status?: number }) {
  return vi.fn().mockResolvedValue(response as Response);
}

describe("downloadCog", () => {
  it("fetches, saves the blob, and reports success", async () => {
    const blob = new Blob(["tif bytes"]);
    const fetchImpl = fakeFetch({ ok: true, status: 200, blob: () => Promise.resolve(blob) });
    const saveBlobImpl = vi.fn();
    const onStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await downloadCog(
      "https://cogs/x.tif",
      "x.tif",
      saveBlobImpl,
      { onStart, onSuccess, onError },
      fetchImpl,
    );

    expect(onStart).toHaveBeenCalledOnce();
    expect(saveBlobImpl).toHaveBeenCalledWith(blob, "x.tif");
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports an error on a non-OK response, never saves a blob", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 403 });
    const saveBlobImpl = vi.fn();
    const onError = vi.fn();

    await downloadCog("https://cogs/x.tif", "x.tif", saveBlobImpl, { onError }, fetchImpl);

    expect(saveBlobImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("403"));
  });

  it("reports a network-error message on a rejected fetch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const saveBlobImpl = vi.fn();
    const onError = vi.fn();

    await downloadCog("https://cogs/x.tif", "x.tif", saveBlobImpl, { onError }, fetchImpl);

    expect(saveBlobImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("network error"));
  });
});
