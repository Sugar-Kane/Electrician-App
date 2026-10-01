"use client";

import { useCallback, useState } from "react";

/**
 * Whether a picture could not be drawn, and the two props that find out.
 *
 * Mostly a HEIC: Safari draws it, Chrome, Edge and Samsung Internet do not.
 * An iPhone photo saved through a page that named HEIC, or a photo from a
 * Samsung phone with "High efficiency pictures" on, shows on the phone that
 * took it and as a broken box everywhere else — the office PC included. The
 * same goes for a signed link that expired on a page left open.
 *
 * A picture that failed before the page's JavaScript ran fired its error with
 * nothing listening, and React does not replay it. That happens whenever the
 * picture beats the JavaScript, which a small one on a slow connection easily
 * does. So when the image attaches, one that has already failed is asked for
 * once more, off to the side, and that failure is heard. One that loaded or is
 * still loading is left alone.
 *
 * Remembered by the file, not the link. Every refresh signs the same file
 * again with a new token in the query, and forgetting on each one meant a HEIC
 * flashed a broken box, for as long as it took to download again, every time
 * another photo was added. A new picture in the same place is a new path, or a
 * new `blob:` link, and gets a fresh chance.
 */
export function useImageFallback(src: string) {
  const file = src.split("?")[0] ?? "";
  const [failedFile, setFailedFile] = useState("");

  const onError = useCallback(() => setFailedFile(file), [file]);

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img?.complete || img.naturalWidth > 0) return;
      const probe = new Image();
      probe.onerror = () => setFailedFile(file);
      probe.src = img.src;
    },
    [file],
  );

  return { failed: file !== "" && failedFile === file, imageProps: { ref, onError } };
}
