import { describe, expect, it } from "vitest";
import { announce, getLastAnnouncerMessage, subscribeAnnouncer } from "../../src/lib/ui/announcer";

describe("announcer", () => {
  it("delivers an announcement to every subscriber", () => {
    const received: string[] = [];
    const unsubscribe = subscribeAnnouncer((text) => received.push(text));
    announce("Species table loaded, 1,234 rows");
    unsubscribe();
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("Species table loaded, 1,234 rows");
  });

  it("a removed subscriber receives nothing further", () => {
    const received: string[] = [];
    const unsubscribe = subscribeAnnouncer((text) => received.push(text));
    unsubscribe();
    announce("Filtered to 0 rows");
    expect(received).toHaveLength(0);
  });

  it("getLastAnnouncerMessage reflects the most recent announcement, for a late-mounted region", () => {
    announce("Filtered to 3 rows");
    expect(getLastAnnouncerMessage()).toContain("Filtered to 3 rows");
  });

  it("two consecutive, character-identical announcements still change the delivered text", () => {
    const received: string[] = [];
    const unsubscribe = subscribeAnnouncer((text) => received.push(text));
    announce("Filtered to 0 rows");
    announce("Filtered to 0 rows");
    unsubscribe();
    expect(received[0]).not.toBe(received[1]); // the toggled zero-width space differs
    // strip the trailing zero-width space (U+200B) by code point, not a literal character in
    // this file's own source (no-irregular-whitespace)
    const zeroWidthSpace = String.fromCharCode(0x200b);
    expect(received[0].replaceAll(zeroWidthSpace, "")).toBe("Filtered to 0 rows");
    expect(received[1].replaceAll(zeroWidthSpace, "")).toBe("Filtered to 0 rows");
  });

  it("supports several independent subscribers at once", () => {
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = subscribeAnnouncer((t) => a.push(t));
    const unsubB = subscribeAnnouncer((t) => b.push(t));
    announce("hello");
    unsubA();
    unsubB();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
