import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SIGNATURE_LENGTH,
  contractorSignature,
  documentSignature,
  fingerprintOf,
  isPngDataUri,
  readPrintedName,
  readSignature,
  readSignerTitle,
  signingLinkMessage,
  unsignableBecause,
} from "./contract-signing.ts";

/** A real 1x1 PNG, the smallest honest thing the pad could send. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A GIF, claiming to be a PNG. The label is the sender's; the bytes are not. */
const GIF_CALLED_PNG = "data:image/png;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

test("a real PNG is accepted and anything wearing its label is not", () => {
  assert.equal(isPngDataUri(PNG), true);

  // The one this check exists for: the data URI says png, the bytes say GIF.
  assert.equal(isPngDataUri(GIF_CALLED_PNG), false);

  assert.equal(isPngDataUri("data:image/jpeg;base64,/9j/4AAQSkZJRg=="), false);
  assert.equal(isPngDataUri("data:image/png;base64,"), false);
  assert.equal(isPngDataUri("data:image/png;base64,not base64 at all!"), false);
  assert.equal(isPngDataUri(""), false);
  assert.equal(isPngDataUri(null), false);
  assert.equal(isPngDataUri(42), false);
});

test("a signature is bounded, because it is stored in a row and posted anonymously", () => {
  // Padding a real PNG past the ceiling: valid bytes, unreasonable size.
  const huge = PNG + "A".repeat(MAX_SIGNATURE_LENGTH);
  assert.equal(isPngDataUri(huge), false);
});

test("a printed name has to be a name", () => {
  assert.equal(readPrintedName("  Mayra   Sarabia "), "Mayra Sarabia");
  // Accented names are names. A letter check written as [a-z] would refuse her.
  assert.equal(readPrintedName("José Núñez"), "José Núñez");

  // What people type to get past a required field.
  for (const junk of ["", "   ", "---", "123", "...", "x".repeat(121)]) {
    assert.equal(readPrintedName(junk), "", JSON.stringify(junk));
  }
  assert.equal(readPrintedName(undefined), "");
});

test("a typed signature needs only the name", () => {
  const result = readSignature({ method: "typed", name: " Adam Kane " });
  assert.deepEqual(result, {
    ok: true,
    signature: { method: "typed", name: "Adam Kane", image: "" },
  });

  const blank = readSignature({ method: "typed", name: "  " });
  assert.equal(blank.ok, false);
});

test("a drawn signature needs the drawing and the printed name", () => {
  // The PDF has a signature line and a "Printed name" line under it. A scrawl
  // with no name beside it identifies nobody.
  const ok = readSignature({ method: "drawn", name: "Adam Kane", image: PNG });
  assert.equal(ok.ok, true);

  const noName = readSignature({ method: "drawn", name: "", image: PNG });
  assert.equal(noName.ok, false);
  assert.match(noName.ok ? "" : noName.reason, /name/);

  const noDrawing = readSignature({ method: "drawn", name: "Adam Kane", image: "" });
  assert.equal(noDrawing.ok, false);
  // Offers the way out rather than only the complaint.
  assert.match(noDrawing.ok ? "" : noDrawing.reason, /type your name/i);

  const disguised = readSignature({ method: "drawn", name: "Adam Kane", image: GIF_CALLED_PNG });
  assert.equal(disguised.ok, false);
});

test("an unknown method is refused rather than guessed at", () => {
  for (const method of ["stamped", "", null, undefined, "DRAWN"]) {
    assert.equal(readSignature({ method, name: "Adam Kane", image: PNG }).ok, false, String(method));
  }
});

const SIGNABLE = {
  status: "draft",
  unfilled: [] as string[],
  signatureProvider: null,
  signedAt: null,
};

test("a clean draft is signable", () => {
  assert.equal(unsignableBecause(SIGNABLE), "");
  assert.equal(unsignableBecause({ ...SIGNABLE, status: "sent" }), "");
  // A contract texted for in-app signing is still signable in the app.
  assert.equal(unsignableBecause({ ...SIGNABLE, signatureProvider: "in_app" }), "");
});

test("each refusal says why, in the words of the person looking at it", () => {
  assert.match(
    unsignableBecause({ ...SIGNABLE, signedAt: "2026-09-27T12:00:00Z" }),
    /already been signed/,
  );
  assert.match(unsignableBecause({ ...SIGNABLE, status: "void" }), /cancelled/);
  assert.match(
    unsignableBecause({ ...SIGNABLE, signatureProvider: "documenso" }),
    /email/,
  );

  // The PDF already prints "Not ready to sign — N blanks". Signing anyway would
  // make that warning a lie, so the count is said here too.
  assert.match(unsignableBecause({ ...SIGNABLE, unfilled: ["permit_number"] }), /1 detail is/);
  assert.match(
    unsignableBecause({ ...SIGNABLE, unfilled: ["permit_number", "start_date"] }),
    /2 details are/,
  );
});

test("already signed wins over everything else", () => {
  // The same precedence the database uses: once signed, nothing else matters.
  assert.match(
    unsignableBecause({
      status: "void",
      unfilled: ["x"],
      signatureProvider: "documenso",
      signedAt: "2026-09-27T12:00:00Z",
      superseded: true,
    }),
    /already been signed/,
  );
});

test("an old link cannot sign terms that have since been redrafted", () => {
  // Texted contract A, then B drafted because the price changed: A's link is
  // still on the customer's phone, and must not sign the old price.
  assert.match(unsignableBecause({ ...SIGNABLE, superseded: true }), /replaced by a newer version/);
  assert.match(
    unsignableBecause({ ...SIGNABLE, status: "sent", signatureProvider: "in_app", superseded: true }),
    /replaced by a newer version/,
  );

  // Said before the blanks: filling them in would not make it signable.
  assert.match(
    unsignableBecause({ ...SIGNABLE, unfilled: ["permit_number"], superseded: true }),
    /replaced by a newer version/,
  );

  // Signed before the newer draft existed: it is a signed contract, not a
  // replaced one.
  assert.match(
    unsignableBecause({ ...SIGNABLE, signedAt: "2026-09-27T12:00:00Z", superseded: true }),
    /already been signed/,
  );

  // Only true counts. A read that came back without the field changes nothing.
  assert.equal(unsignableBecause({ ...SIGNABLE, superseded: false }), "");
  assert.equal(unsignableBecause({ ...SIGNABLE, superseded: undefined }), "");
});

test("a fingerprint is short enough to compare by eye", () => {
  const hash = "A1B2C3D4E5F60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  assert.equal(fingerprintOf(hash), "a1b2 c3d4 e5f6 0718");
  assert.equal(fingerprintOf(""), "");
});

const SIGNED_ROW = {
  signature_provider: "in_app",
  signed_at: "2026-09-27T21:14:00Z",
  signature_method: "drawn",
  signature_name: "Mayra Sarabia",
  signature_image: PNG,
  signed_body_hash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
};

test("an in-app signature is printed with its moment and its fingerprint", () => {
  const printed = documentSignature(SIGNED_ROW, "America/Los_Angeles")!;

  assert.equal(printed.method, "drawn");
  assert.equal(printed.name, "Mayra Sarabia");
  assert.equal(printed.image, PNG);
  assert.equal(printed.fingerprint, "a1b2 c3d4 e5f6 0718");
  // In the business's timezone, and with the time — 21:14 UTC is 2:14 PM Pacific.
  assert.match(printed.signedLabel, /Sep 27, 2026/);
  assert.match(printed.signedLabel, /2:14/);
  assert.match(printed.signedLabel, /PDT/);
});

test("a typed signature is printed without an image", () => {
  const printed = documentSignature(
    { ...SIGNED_ROW, signature_method: "typed", signature_image: null },
    "America/Los_Angeles",
  )!;
  assert.equal(printed.method, "typed");
  assert.equal(printed.image, "");
});

test("a Documenso signature is never redrawn over its sealed copy", () => {
  assert.equal(
    documentSignature({ ...SIGNED_ROW, signature_provider: "documenso" }, "America/Los_Angeles"),
    undefined,
  );
});

test("nothing is printed unless every part of the signature is there", () => {
  // A signature line with a name and no date is worse than a blank one.
  for (const missing of [
    { signed_at: null },
    { signed_at: "not a date" },
    { signature_name: "  " },
    { signed_body_hash: "" },
    { signature_method: "stamped" },
    { signature_image: "" },
    { signature_provider: null },
  ]) {
    assert.equal(
      documentSignature({ ...SIGNED_ROW, ...missing }, "America/Los_Angeles"),
      undefined,
      JSON.stringify(missing),
    );
  }
});

test("the signing text says which job it is for, as the database numbers it", () => {
  const link = "https://volteira.com/contract/aeb0da97-aadc-45c7-87f5-cd6cfd2152f8";
  // PostgREST hands job_number back as a number. That is the case that went
  // missing: every text read as if there were no job number at all.
  assert.equal(
    signingLinkMessage({ businessName: "Test Electric Co", jobNumber: 2, link }),
    `Test Electric Co: here is your contract for job #2 to read and sign: ${link}`,
  );
  assert.equal(
    signingLinkMessage({ businessName: "Test Electric Co", jobNumber: "14", link }),
    `Test Electric Co: here is your contract for job #14 to read and sign: ${link}`,
  );
});

test("the signing text still goes out without a job number or a business name", () => {
  const link = "https://volteira.com/contract/x";
  for (const jobNumber of [null, undefined, "", Number.NaN, {}]) {
    assert.equal(
      signingLinkMessage({ businessName: "Test Electric Co", jobNumber, link }),
      `Test Electric Co: here is your contract to read and sign: ${link}`,
      String(jobNumber),
    );
  }
  assert.equal(
    signingLinkMessage({ businessName: "  ", jobNumber: 3, link }),
    `Your electrician: here is your contract for job #3 to read and sign: ${link}`,
  );
});

// The business's signature, as `sign_contract_as_contractor` leaves it on a
// contract when it is sent.
const BUSINESS_SIGNED = {
  contractor_signed_at: "2026-10-01T16:02:00Z",
  contractor_signature_method: "typed",
  contractor_signature_name: "Nicholas Kane",
  contractor_signature_title: "Owner",
  contractor_signature_image: null,
};

test("the business's signature is printed with who, their title and when", () => {
  const printed = contractorSignature(BUSINESS_SIGNED, "America/Los_Angeles")!;
  assert.equal(printed.method, "typed");
  assert.equal(printed.name, "Nicholas Kane");
  assert.equal(printed.title, "Owner");
  assert.equal(printed.image, "");
  // In the business's timezone, to the minute, like the customer's.
  assert.equal(printed.signedLabel, "Oct 1, 2026, 9:02 AM PDT");
});

test("a drawn business signature carries its image, and only a real PNG", () => {
  const drawn = { ...BUSINESS_SIGNED, contractor_signature_method: "drawn", contractor_signature_image: PNG };
  assert.equal(contractorSignature(drawn, "America/Los_Angeles")?.image, PNG);
  assert.equal(
    contractorSignature({ ...drawn, contractor_signature_image: GIF_CALLED_PNG }, "America/Los_Angeles"),
    undefined,
  );
});

test("nothing is printed for the business until every part of its signature is there", () => {
  assert.equal(contractorSignature({}, "America/Los_Angeles"), undefined);
  for (const missing of [
    { contractor_signed_at: null },
    { contractor_signature_name: "  " },
    { contractor_signature_method: "stamped" },
  ]) {
    assert.equal(contractorSignature({ ...BUSINESS_SIGNED, ...missing }, "America/Los_Angeles"), undefined);
  }
  // A title is optional; its absence is not a missing part.
  assert.equal(
    contractorSignature({ ...BUSINESS_SIGNED, contractor_signature_title: null }, "America/Los_Angeles")?.title,
    "",
  );
});

test("a signer's title is one tidy line, kept short", () => {
  assert.equal(readSignerTitle("  Owner \n  & Master Electrician "), "Owner & Master Electrician");
  assert.equal(readSignerTitle(undefined), "");
  assert.equal(readSignerTitle("x".repeat(200)).length, 80);
});

test("a change order's link says it is a change order, not the contract", () => {
  const link = "https://example.test/contract/abc";
  assert.equal(
    signingLinkMessage({ businessName: "Test Electric Co", jobNumber: 15, link, kind: "change_order" }),
    `Test Electric Co: here is a change order for job #15 to read and sign: ${link}`,
  );
  assert.equal(
    signingLinkMessage({ businessName: "Test Electric Co", jobNumber: 15, link, kind: "agreement" }),
    `Test Electric Co: here is your contract for job #15 to read and sign: ${link}`,
  );
});
