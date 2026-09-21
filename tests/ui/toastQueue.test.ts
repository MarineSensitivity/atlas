import { describe, expect, it } from "vitest";
import { dismissToast, enqueueToast, remainingMs } from "../../src/lib/ui/toastQueue";

describe("toast queue (one polite live region, several messages over time)", () => {
  it("enqueues onto the end, oldest first", () => {
    let queue = enqueueToast([], 1, "first");
    queue = enqueueToast(queue, 2, "second");
    expect(queue.map((t) => t.text)).toEqual(["first", "second"]);
  });

  it("dismisses by id, wherever it is in the queue", () => {
    const queue = [
      { id: 1, text: "a" },
      { id: 2, text: "b" },
      { id: 3, text: "c" },
    ];
    expect(dismissToast(queue, 2).map((t) => t.id)).toEqual([1, 3]);
  });

  it("dismissing an id not present is a no-op", () => {
    const queue = [{ id: 1, text: "a" }];
    expect(dismissToast(queue, 999)).toEqual(queue);
  });

  it("never mutates the input array (both are pure)", () => {
    const queue = [{ id: 1, text: "a" }];
    const after = enqueueToast(queue, 2, "b");
    expect(queue).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe("remainingMs (SC 2.2.1: resume with whatever time was actually left)", () => {
  it("subtracts elapsed time from the total", () => {
    expect(remainingMs(5000, 2000)).toBe(3000);
  });

  it("never goes negative -- clamps to 0 once the elapsed time exceeds the total", () => {
    expect(remainingMs(5000, 9000)).toBe(0);
  });

  it("no time elapsed leaves the full duration", () => {
    expect(remainingMs(5000, 0)).toBe(5000);
  });
});
