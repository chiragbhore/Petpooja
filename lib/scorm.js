import JSZip from "jszip";
import { supabase } from "./supabaseClient";

const ENTRY_CANDIDATES = ["index.html", "index_lms.html", "story.html", "launch.html", "story_html5.html"];

function guessContentType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const map = {
    html: "text/html", htm: "text/html", js: "application/javascript", css: "text/css",
    json: "application/json", xml: "application/xml", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", mp3: "audio/mpeg",
    mp4: "video/mp4", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
  };
  return map[ext] || "application/octet-stream";
}

// Unzips a SCORM package in the browser and uploads every file to Supabase
// Storage under scorm-content/<lessonId>/..., then returns the public URL
// of the detected entry (launch) file.
export async function uploadScormPackage(file, lessonId, onProgress) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  if (entries.length === 0) throw new Error("The zip file appears to be empty.");

  // Every upload gets its own version folder, so the resulting URL is
  // always brand new. This sidesteps two separate problems we hit:
  // Supabase Storage sometimes keeping an old file's content-type when a
  // path is reused, AND Cloudflare's CDN caching a stale response for a
  // URL that's technically "the same" even after the file underneath it
  // changes. A fresh path can't collide with either.
  const version = Date.now();
  const basePath = `${lessonId}/${version}`;

  let done = 0;
  for (const name of entries) {
    const rawBlob = await zip.files[name].async("blob");
    const contentType = guessContentType(name);
    // Rebuild the blob with an explicit type — some browsers/zip libraries
    // leave the type blank, and Supabase Storage then falls back to
    // text/plain, which makes .html files show as raw source instead of
    // rendering. Setting it explicitly here fixes that.
    const typedBlob = new Blob([rawBlob], { type: contentType });
    const path = `${basePath}/${name}`;
    const { error } = await supabase.storage
      .from("scorm-content")
      .upload(path, typedBlob, { contentType, upsert: false, cacheControl: "3600" });
    if (error) throw new Error(`Failed uploading ${name}: ${error.message}`);
    done += 1;
    if (onProgress) onProgress(done, entries.length);
  }

  // Best-effort cleanup of any older versions for this lesson, so storage
  // doesn't grow forever. Safe to skip on failure — it's just housekeeping.
  try {
    const { data: oldVersions } = await supabase.storage.from("scorm-content").list(lessonId, { limit: 1000 });
    const stale = (oldVersions || []).filter((f) => f.name !== String(version));
    for (const v of stale) {
      const { data: files } = await supabase.storage.from("scorm-content").list(`${lessonId}/${v.name}`, { limit: 1000 });
      if (files && files.length > 0) {
        await supabase.storage.from("scorm-content").remove(files.map((f) => `${lessonId}/${v.name}/${f.name}`));
      }
    }
  } catch (cleanupErr) { /* non-fatal */ }

  // Find the launch file: prefer common SCORM entry filenames, else the
  // first .html file we find, searching at any folder depth.
  const lower = entries.map((e) => e.toLowerCase());
  let entryFile = null;
  for (const candidate of ENTRY_CANDIDATES) {
    const idx = lower.findIndex((e) => e.endsWith("/" + candidate) || e === candidate);
    if (idx !== -1) { entryFile = entries[idx]; break; }
  }
  if (!entryFile) {
    const idx = lower.findIndex((e) => e.endsWith(".html"));
    if (idx !== -1) entryFile = entries[idx];
  }
  if (!entryFile) throw new Error("Could not find an index.html (or similar) entry file inside the package.");

  // Serve through our own /api/scorm-file proxy so we control the
  // Content-Type header ourselves — Supabase's own public URL was
  // unreliably serving these as text/plain instead of text/html.
  return `/api/scorm-file/${basePath}/${entryFile}`;
}
