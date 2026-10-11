import assert from "node:assert/strict";
import test from "node:test";

import { mayResetPassword, newPasswordProblem, RECOVERY_WINDOW_SECONDS } from "./password-reset.ts";

const NOW = 1_800_000_000;

test("a session from a reset link opened just now may set a new password", () => {
  assert.equal(mayResetPassword([{ method: "recovery", timestamp: NOW - 30 }], NOW), true);
});

test("a session signed in with a password may not skip the current password", () => {
  // Somebody holding an unlocked phone would otherwise lock its owner out.
  assert.equal(mayResetPassword([{ method: "password", timestamp: NOW - 30 }], NOW), false);
  assert.equal(mayResetPassword([{ method: "otp", timestamp: NOW - 30 }], NOW), false);
});

test("a reset session older than an hour may not", () => {
  assert.equal(
    mayResetPassword([{ method: "recovery", timestamp: NOW - RECOVERY_WINDOW_SECONDS - 1 }], NOW),
    false,
  );
  assert.equal(
    mayResetPassword([{ method: "recovery", timestamp: NOW - RECOVERY_WINDOW_SECONDS }], NOW),
    true,
  );
});

test("a session with no sign-in record, or a garbled one, may not", () => {
  assert.equal(mayResetPassword(undefined, NOW), false);
  assert.equal(mayResetPassword([], NOW), false);
  assert.equal(mayResetPassword(["recovery"], NOW), false);
  assert.equal(mayResetPassword([{ method: "recovery" }], NOW), false);
  assert.equal(mayResetPassword([{ method: "recovery", timestamp: "soon" }], NOW), false);
  // Stamped well in the future: not a link anybody opened.
  assert.equal(mayResetPassword([{ method: "recovery", timestamp: NOW + 3_600 }], NOW), false);
});

test("a reset link counts even after another sign-in method in the same session", () => {
  assert.equal(
    mayResetPassword(
      [
        { method: "password", timestamp: NOW - 7_200 },
        { method: "recovery", timestamp: NOW - 60 },
      ],
      NOW,
    ),
    true,
  );
});

test("a new password has to be long enough and typed the same twice", () => {
  assert.match(newPasswordProblem("short", "short"), /at least 10/);
  assert.match(newPasswordProblem("long enough one", "long enough two"), /do not match/);
  assert.equal(newPasswordProblem("long enough one", "long enough one"), "");
});
