import test from "node:test";
import assert from "node:assert/strict";

import {
  attachmentKind,
  fileSizeLabel,
  refuseAttachment,
  storedOnlyNote,
  MAX_ATTACHMENTS,
} from "./attachment-kinds.ts";

const MB = 1024 * 1024;

test("the formats the model can actually see are the ones marked readable", () => {
  for (const type of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
    assert.equal(attachmentKind(type, "panel.bin")?.reading, "image", type);
  }
  assert.equal(attachmentKind("application/pdf", "permit.pdf")?.reading, "document");
});

test("HEIC is kept but not read, because the model cannot open it", () => {
  // The one that bites: an iPhone camera writes HEIC by default. Calling it an
  // image would mean answering about a photo nothing looked at.
  assert.equal(attachmentKind("image/heic", "IMG_0001.HEIC")?.reading, "stored");
  assert.equal(attachmentKind("image/heif", "IMG_0001.heif")?.reading, "stored");
});

test("video is kept but not read", () => {
  for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
    assert.equal(attachmentKind(type, "clip.bin")?.reading, "stored", type);
  }
});

test("a browser that reports nothing useful falls back to the file name", () => {
  // Several Android browsers send an empty type or octet-stream for a camera
  // capture. Trusting the declared type alone makes the button do nothing.
  assert.equal(attachmentKind("", "panel.jpg")?.mimeType, "image/jpeg");
  assert.equal(attachmentKind("application/octet-stream", "permit.PDF")?.mimeType, "application/pdf");
  assert.equal(attachmentKind("", "clip.MOV")?.mimeType, "video/quicktime");
});

test("anything else is refused rather than uploaded and puzzled over", () => {
  assert.equal(attachmentKind("application/zip", "stuff.zip"), null);
  assert.equal(attachmentKind("", "notes.docx"), null);
  assert.equal(attachmentKind("", ""), null);
});

test("a PDF is capped tighter than a photo, because base64 is a third bigger", () => {
  assert.equal(attachmentKind("application/pdf", "a.pdf")?.maxBytes, 10 * MB);
  assert.equal(attachmentKind("image/png", "a.png")?.maxBytes, 20 * MB);
});

test("refusals say which limit was hit, in megabytes", () => {
  assert.equal(refuseAttachment({ mimeType: "image/png", fileName: "a.png", sizeBytes: 3 * MB }), "");
  assert.match(
    refuseAttachment({ mimeType: "application/pdf", fileName: "a.pdf", sizeBytes: 12 * MB }),
    /over 10 MB/,
  );
  assert.match(
    refuseAttachment({ mimeType: "image/png", fileName: "a.png", sizeBytes: 21 * MB }),
    /over 20 MB/,
  );
});

test("an empty or nonsense size is refused before anything moves", () => {
  for (const sizeBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.notEqual(
      refuseAttachment({ mimeType: "image/png", fileName: "a.png", sizeBytes }),
      "",
      String(sizeBytes),
    );
  }
});

test("an unsupported type is refused by type, not by size", () => {
  assert.match(
    refuseAttachment({ mimeType: "application/zip", fileName: "a.zip", sizeBytes: 10 }),
    /not supported/,
  );
});

test("the stored-only note names what was kept and offers the way round it", () => {
  const one = storedOnlyNote(["arcing.mp4"]);
  assert.match(one, /arcing\.mp4/);
  assert.match(one, /send a photo/);

  assert.match(storedOnlyNote(["a.mp4", "b.mov"]), /2 files/);
  // Nothing stored-only, nothing said — a photo alone gets no caveat.
  assert.equal(storedOnlyNote([]), "");
});

test("sizes read the way a person would say them", () => {
  assert.equal(fileSizeLabel(900), "900 B");
  assert.equal(fileSizeLabel(2048), "2 KB");
  assert.equal(fileSizeLabel(3.4 * MB), "3.4 MB");
  assert.equal(fileSizeLabel(12 * MB), "12 MB");
  assert.equal(fileSizeLabel(0), "");
});

test("there is a ceiling on how many can ride on one question", () => {
  assert.equal(MAX_ATTACHMENTS, 5);
});
