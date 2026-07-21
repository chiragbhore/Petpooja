import { supabaseAdmin } from "../../../lib/supabaseAdmin";

function guessContentType(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    js: "application/javascript", css: "text/css",
    json: "application/json", xml: "application/xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml",
    mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg",
    ogv: "video/ogg", mov: "video/quicktime", m4v: "video/x-m4v", wav: "audio/wav",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  };
  return map[ext] || "application/octet-stream";
}

// Serves a file straight out of the scorm-content bucket, but sets the
// Content-Type ourselves based on the file extension — this sidesteps
// whatever content-type Supabase Storage actually stored, which turned
// out to be unreliable for this bucket.
export default async function handler(req, res) {
  const parts = req.query.path;
  if (!parts || parts.length === 0) return res.status(400).send("Missing path.");
  const path = parts.join("/");

  const { data, error } = await supabaseAdmin.storage.from("scorm-content").download(path);
  if (error || !data) return res.status(404).send("File not found.");

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = guessContentType(path);
  const total = buffer.length;

  // Video/audio elements request a byte range and expect a 206 partial
  // response — without this, browsers refuse to play the media at all,
  // even though the file itself uploaded and is being found correctly.
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { start = 0; end = total - 1; }

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", end - start + 1);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(buffer.slice(start, end + 1));
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", total);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.status(200).send(buffer);
}
