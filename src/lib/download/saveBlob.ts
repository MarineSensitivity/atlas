// R3-W2: the "save this blob as a file" primitive every download item shares -- CalCOFI explore's
// own `export.ts#saveBlob` (an `<a download>` click on an object URL, revoked after a delay so the
// click has time to start the save on every browser). Kept as its own tiny module rather than
// duplicated per item (`places/download.ts#downloadGeoJson` already has its own similar helper for
// the SAME reason CalCOFI's history explains -- object-URL revocation timing -- but predates this
// module and is left alone: no second caller of it changes here).
export function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
