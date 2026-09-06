import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { locateContractSignatureFields } from "./signature-fields.ts";

function signingColumn(role: string) {
  return React.createElement(
    View,
    { style: { width: "46%" } },
    React.createElement(View, { style: { height: 34 } }),
    React.createElement(Text, null, `${role} signature`),
    React.createElement(View, { style: { height: 26 } }),
    React.createElement(Text, null, "Printed name"),
    React.createElement(View, { style: { height: 26 } }),
    React.createElement(Text, null, "Date"),
  );
}

test("signature fields follow both ruled columns in the generated PDF", async () => {
  const pdf = await renderToBuffer(
    React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "LETTER", style: { padding: 48 } },
        React.createElement(Text, null, "Electrical work agreement"),
        React.createElement(
          View,
          {
            style: {
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 30,
            },
          },
          signingColumn("Customer"),
          signingColumn("Contractor"),
        ),
      ),
    ),
  );

  const fields = await locateContractSignatureFields(pdf);
  assert.deepEqual(fields.customer.map((field) => field.type), ["SIGNATURE", "NAME", "DATE"]);
  assert.deepEqual(fields.contractor.map((field) => field.type), ["SIGNATURE", "NAME", "DATE"]);
  assert.ok(fields.customer.every((field) => field.page === 1));
  assert.ok(fields.contractor.every((field) => field.page === 1));
  assert.ok(fields.customer[0]!.positionX < fields.contractor[0]!.positionX);
  assert.ok(fields.customer.every((field) => field.positionY >= 0 && field.positionY <= 100));
});

test("a PDF without Volteira's signing labels is refused by returning no fields", async () => {
  const pdf = await renderToBuffer(
    React.createElement(
      Document,
      null,
      React.createElement(Page, { size: "LETTER" }, React.createElement(Text, null, "No signing block")),
    ),
  );

  assert.deepEqual(await locateContractSignatureFields(pdf), { customer: [], contractor: [] });
});
