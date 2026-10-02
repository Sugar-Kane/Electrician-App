import test from "node:test";
import assert from "node:assert/strict";

import {
  DESCRIPTION_LIMIT,
  POSTER_PATHNAME,
  TITLE_LIMIT,
  VIDEO_MAX_BYTES,
  durationLabel,
  frameRatio,
  isSiteVideoPathname,
  mayNotPlayEverywhere,
  moveInOrder,
  readVideoWords,
  uploadRuleFor,
  videoFileProblem,
  videoPathname,
  videoTypeOf,
} from "./site-videos.ts";

test("a video's type comes from the browser, or from its name when the browser says nothing", () => {
  assert.equal(videoTypeOf({ name: "walkthrough.mp4", type: "video/mp4" }), "video/mp4");
  assert.equal(videoTypeOf({ name: "RPReplay_Final1.MP4", type: "" }), "video/mp4");
  assert.equal(videoTypeOf({ name: "clip.m4v", type: "video/x-m4v" }), "video/mp4");
  assert.equal(videoTypeOf({ name: "clip.webm", type: "" }), "video/webm");
  assert.equal(videoTypeOf({ name: "IMG_0042.MOV", type: "video/quicktime" }), "video/quicktime");
  assert.equal(videoTypeOf({ name: "clip.mov", type: "application/octet-stream" }), "video/quicktime");
});

test("anything that is not one of those videos is refused", () => {
  assert.equal(videoTypeOf({ name: "photo.jpg", type: "image/jpeg" }), null);
  assert.equal(videoTypeOf({ name: "notes.txt", type: "text/plain" }), null);
  assert.equal(videoTypeOf({ name: "clip.mkv", type: "video/x-matroska" }), null);
  assert.equal(videoTypeOf({ name: "clip.avi", type: "" }), null);
  assert.equal(videoTypeOf({ name: "photo.mp4", type: "image/png" }), null, "the browser's word wins over the name");
});

test("the console says what is wrong with a file before anything is uploaded", () => {
  assert.equal(videoFileProblem({ name: "a.mp4", type: "video/mp4", size: 5_000_000 }), null);
  assert.match(videoFileProblem({ name: "a.jpg", type: "image/jpeg", size: 5_000 }) ?? "", /MP4/);
  assert.match(videoFileProblem({ name: "a.mp4", type: "video/mp4", size: 0 }) ?? "", /empty/);
  assert.match(
    videoFileProblem({ name: "a.mp4", type: "video/mp4", size: VIDEO_MAX_BYTES + 1 }) ?? "",
    /The limit is 250 MB/,
  );
  assert.equal(videoFileProblem({ name: "a.mp4", type: "video/mp4", size: VIDEO_MAX_BYTES }), null);
});

test("a MOV is accepted with a warning, because some of them only play in Safari", () => {
  assert.equal(mayNotPlayEverywhere("video/quicktime"), true);
  assert.equal(mayNotPlayEverywhere("video/mp4"), false);
  assert.equal(mayNotPlayEverywhere("video/webm"), false);
});

test("an upload token is only given for the two names the console uploads under", () => {
  assert.equal(videoPathname("video/mp4"), "site-videos/video.mp4");
  assert.equal(videoPathname("video/webm"), "site-videos/video.webm");
  assert.equal(videoPathname("video/quicktime"), "site-videos/video.mov");

  for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
    const rule = uploadRuleFor(videoPathname(type));
    assert.ok(rule, type);
    assert.ok(rule.allowedContentTypes.includes(type));
    assert.equal(rule.maximumSizeInBytes, VIDEO_MAX_BYTES);
  }

  const poster = uploadRuleFor(POSTER_PATHNAME);
  assert.deepEqual(poster?.allowedContentTypes, ["image/jpeg"]);

  for (const pathname of ["site-videos/anything.exe", "site-videos/video.mp4/../x", "other/video.mp4", "video.mp4", "", "site-videos/poster.png"]) {
    assert.equal(uploadRuleFor(pathname), null, pathname);
  }
});

test("only files under the front page's folder count as its files", () => {
  assert.equal(isSiteVideoPathname("site-videos/video-AbC123.mp4"), true);
  assert.equal(isSiteVideoPathname("site-videos/poster-XyZ.jpg"), true);
  assert.equal(isSiteVideoPathname("logos/acme.png"), false);
  assert.equal(isSiteVideoPathname("site-videos/../logos/acme.png"), false);
  assert.equal(isSiteVideoPathname("site-videosx/video.mp4"), false);
});

test("a title is needed and the description is optional, each with a length limit", () => {
  assert.deepEqual(readVideoWords({ title: "  Maya   books a  diagnostic ", description: "" }), {
    ok: true,
    title: "Maya books a diagnostic",
    description: "",
  });

  const noTitle = readVideoWords({ title: "   ", description: "Something" });
  assert.equal(noTitle.ok, false);
  assert.match(noTitle.ok ? "" : noTitle.error, /title/);

  const longTitle = readVideoWords({ title: "x".repeat(TITLE_LIMIT + 1), description: "" });
  assert.match(longTitle.ok ? "" : longTitle.error, new RegExp(`${TITLE_LIMIT} characters. It is ${TITLE_LIMIT + 1}`));

  const longDescription = readVideoWords({ title: "Fine", description: "y".repeat(DESCRIPTION_LIMIT + 1) });
  assert.equal(longDescription.ok, false);

  assert.equal(readVideoWords({ title: "x".repeat(TITLE_LIMIT), description: "y".repeat(DESCRIPTION_LIMIT) }).ok, true);
});

test("lengths read the way a video player shows them", () => {
  assert.equal(durationLabel(0), "");
  assert.equal(durationLabel(Number.NaN), "");
  assert.equal(durationLabel(Number.POSITIVE_INFINITY), "");
  assert.equal(durationLabel(4.4), "0:04");
  assert.equal(durationLabel(59.6), "1:00");
  assert.equal(durationLabel(102), "1:42");
  assert.equal(durationLabel(3725), "1:02:05");
});

test("a video is framed in its own shape, so a phone recording stands upright", () => {
  assert.equal(frameRatio({ width: 1920, height: 1080 }), 1920 / 1080);
  assert.equal(frameRatio({ width: 886, height: 1920 }), 886 / 1920);
  assert.equal(frameRatio({ width: 0, height: 0 }), 16 / 9);
});

test("moving a video swaps it with its neighbour, and the ends stay put", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveInOrder(ids, "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(moveInOrder(ids, "b", "down"), ["a", "c", "b"]);
  assert.deepEqual(moveInOrder(ids, "a", "up"), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(ids, "c", "down"), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(ids, "missing", "up"), ["a", "b", "c"]);
  assert.deepEqual(ids, ["a", "b", "c"], "the list passed in is left alone");
});
