/**
 * What may be attached to a question, and what the assistant can do with it.
 *
 * Three answers, not two. A file can be refused outright, it can be read by the
 * model, or it can be kept without being read — and that third case is the one
 * worth being careful about. A video of a panel arcing is genuinely useful to
 * the business and genuinely unreadable to this model, so it is stored and said
 * so. Silently accepting it and answering as though it had been watched is the
 * failure this table exists to prevent.
 *
 * Import-free, so the rules can be tested without a network, a bucket or a key.
 */

/** What the model does with a file, once it is uploaded. */
export type Reading =
  /** Claude sees it. */
  | "image"
  /** Claude reads it as a document. */
  | "document"
  /** Kept against the business, but nothing looks at it yet. */
  | "stored";

export type AttachmentKind = {
  reading: Reading;
  /** Normalised, because browsers report the same file half a dozen ways. */
  mimeType: string;
  extension: string;
  maxBytes: number;
};

const MB = 1024 * 1024;

/**
 * Caps.
 *
 * A whole request to Claude has to fit in 32 MB, and a PDF is sent base64 —
 * which is a third bigger than the file. Ten megabytes of PDF is thirteen on
 * the wire, so five of those would not fit and the failure would arrive after
 * the upload rather than before it. Images go by URL and cost the request
 * almost nothing, so they get the more generous limit.
 */
const IMAGE_MAX = 20 * MB;
const DOCUMENT_MAX = 10 * MB;
const STORED_MAX = 100 * MB;

/** Enough to show a panel from three angles; not enough to blow the request. */
export const MAX_ATTACHMENTS = 5;

/*
 * Only the four formats Claude actually sees are `image`.
 *
 * HEIC is the one that bites: it is what an iPhone camera writes by default,
 * and the model cannot read it. iOS usually converts to JPEG when a photo is
 * chosen through a file input, so most of the time this never comes up — but
 * when it does, the honest answer is that the photo was kept and not read,
 * rather than an answer invented about an image nothing looked at.
 */
const KINDS = new Map<string, { reading: Reading; extension: string }>([
  ["image/jpeg", { reading: "image", extension: "jpg" }],
  ["image/png", { reading: "image", extension: "png" }],
  ["image/gif", { reading: "image", extension: "gif" }],
  ["image/webp", { reading: "image", extension: "webp" }],
  ["image/heic", { reading: "stored", extension: "heic" }],
  ["image/heif", { reading: "stored", extension: "heif" }],
  ["application/pdf", { reading: "document", extension: "pdf" }],
  ["video/mp4", { reading: "stored", extension: "mp4" }],
  ["video/quicktime", { reading: "stored", extension: "mov" }],
  ["video/webm", { reading: "stored", extension: "webm" }],
]);

/** The other direction, for browsers that report nothing useful. */
const BY_EXTENSION = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["pdf", "application/pdf"],
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
]);

function capFor(reading: Reading): number {
  if (reading === "image") return IMAGE_MAX;
  if (reading === "document") return DOCUMENT_MAX;
  return STORED_MAX;
}

/**
 * What this file is, by what the browser said and then by its name.
 *
 * Several Android browsers report an empty type for a camera capture and some
 * report `application/octet-stream`. Trusting the declared type alone means the
 * attach button does nothing on those phones, with a message about file types
 * that blames the electrician for their browser.
 */
export function attachmentKind(mimeType: string, fileName: string): AttachmentKind | null {
  const declared = (mimeType ?? "").trim().toLowerCase();
  const found = KINDS.get(declared);
  if (found) {
    return { reading: found.reading, mimeType: declared, extension: found.extension, maxBytes: capFor(found.reading) };
  }

  const extension = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  const guessedType = BY_EXTENSION.get(extension);
  const guessed = guessedType ? KINDS.get(guessedType) : undefined;
  if (guessedType && guessed) {
    return {
      reading: guessed.reading,
      mimeType: guessedType,
      extension: guessed.extension,
      maxBytes: capFor(guessed.reading),
    };
  }

  return null;
}

/**
 * Why this file cannot be attached, in words, or "" if it can.
 *
 * One function so the browser and the server refuse for identical reasons. The
 * browser check is the courtesy — it saves somebody uploading forty megabytes
 * before being told — and the server check is the one that counts.
 */
export function refuseAttachment(input: {
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}): string {
  const kind = attachmentKind(input.mimeType, input.fileName);
  if (!kind) {
    return "That file type is not supported. Photos, PDFs and video all work.";
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return "That file looks empty.";
  }

  if (input.sizeBytes > kind.maxBytes) {
    const limit = Math.round(kind.maxBytes / MB);
    return `That file is over ${limit} MB.`;
  }

  return "";
}

/**
 * What to tell somebody about a file that was kept but not read.
 *
 * Said once per question rather than per file, and only about the files it
 * applies to, so attaching a photo and a video does not get a caveat about the
 * photo.
 */
export function storedOnlyNote(fileNames: string[]): string {
  if (fileNames.length === 0) return "";

  const names = fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`;
  return `I saved ${names}, but I cannot open that format yet — send a photo of the same thing and I will look at it.`;
}

/** "3.4 MB", for a chip under somebody's thumb. */
export function fileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;

  const megabytes = bytes / MB;
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}
