import { describe, expect, it, vi } from "vitest";
import { postFeedback } from "../../src/lib/feedback/postFeedback";

describe("postFeedback", () => {
  it("POSTs the JSON payload with a text/plain content-type (CORS simple request)", async () => {
    const doFetch = vi.fn().mockResolvedValue({ ok: true });
    const payload = { appVersion: "0.10.16", lens: "scores" };
    const ok = await postFeedback("https://script.google.com/exec", payload, doFetch);

    expect(ok).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe("https://script.google.com/exec");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("text/plain;charset=UTF-8");
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('never sets `keepalive` (U3 fix: a keepalive fetch silently rejects over the 64 KiB body quota, which a screenshot-carrying payload routinely exceeds)', async () => {
    const doFetch = vi.fn().mockResolvedValue({ ok: true });
    await postFeedback("https://script.google.com/exec", { image: "x".repeat(200_000) }, doFetch);
    const [, init] = doFetch.mock.calls[0];
    expect(init.keepalive).toBeUndefined();
  });

  it("resolves false when the response is not ok -- the caller falls back to the GitHub link", async () => {
    const doFetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await postFeedback("https://x/exec", {}, doFetch)).toBe(false);
  });

  it("resolves false (never throws) when fetch itself rejects -- network error, CORS, endpoint down", async () => {
    const doFetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(postFeedback("https://x/exec", {}, doFetch)).resolves.toBe(false);
  });
});
