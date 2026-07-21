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

  // Clear out anything already stored for this lesson first. Replacing a
  // file in place (upsert) can leave its OLD content-type metadata behind
  // even though the bytes change — deleting first guarantees a clean,
  // correctly-typed upload every time, including re-uploads.
  const { data: existing } = await supabase.storage.from("scorm-content").list(lessonId, { limit: 1000 });
  if (existing && existing.length > 0) {
    const paths = existing.map((f) => `${lessonId}/${f.name}`);
    await supabase.storage.from("scorm-content").remove(paths);
  }

  let done = 0;
  for (const name of entries) {
    const rawBlob = await zip.files[name].async("blob");
    const contentType = guessContentType(name);
    // Rebuild the blob with an explicit type — some browsers/zip libraries
    // leave the type blank, and Supabase Storage then falls back to
    // text/plain, which makes .html files show as raw source instead of
    // rendering. Setting it explicitly here fixes that.
    const typedBlob = new Blob([rawBlob], { type: contentType });
    const path = `${lessonId}/${name}`;
    const { error } = await supabase.storage
      .from("scorm-content")
      .upload(path, typedBlob, { contentType, upsert: false, cacheControl: "3600" });
    if (error) throw new Error(`Failed uploading ${name}: ${error.message}`);
    done += 1;
    if (onProgress) onProgress(done, entries.length);
  }

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

  const { data } = supabase.storage.from("scorm-content").getPublicUrl(`${lessonId}/${entryFile}`);
  return data.publicUrl;
}
