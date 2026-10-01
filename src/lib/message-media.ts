/** Only accept Twilio image references from the signed message itself. */
export type MessagePhoto = { url: string; contentType: string };
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export function readMessagePhotos(params: Record<string, string>): MessagePhoto[] {
  const account = params.AccountSid ?? "";
  const message = params.MessageSid ?? "";
  if (!/^AC[0-9a-f]{32}$/i.test(account) || !/^(SM|MM)[0-9a-f]{32}$/i.test(message)) return [];
  const prefix = `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${message}/Media/`;
  const photos: MessagePhoto[] = [];
  for (let i = 0; i < Math.min(Number(params.NumMedia) || 0, 10); i++) {
    const url = params[`MediaUrl${i}`] ?? "";
    const contentType = params[`MediaContentType${i}`] ?? "";
    if (url.startsWith(prefix) && /^ME[0-9a-f]{32}$/i.test(url.slice(prefix.length)) && PHOTO_TYPES.has(contentType)) {
      photos.push({ url, contentType });
    }
  }
  return photos;
}
