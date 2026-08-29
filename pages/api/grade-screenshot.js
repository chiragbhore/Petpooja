import { supabaseAdmin } from "../../lib/supabaseAdmin";

const GEMINI_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Not signed in.", status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { error: "Session invalid.", status: 401 };
  return { userId: data.user.id };
}

function mimeFor(path) {
  const ext = (path.split(".").pop() || "png").toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
}

async function downloadAsBase64(bucket, path) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer.toString("base64");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing GEMINI_API_KEY." });

  const gate = await requireUser(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { questionId, screenshotPaths } = req.body || {};
  const paths = Array.isArray(screenshotPaths) ? screenshotPaths.filter(Boolean) : (screenshotPaths ? [screenshotPaths] : []);
  if (!questionId || paths.length === 0) return res.status(400).json({ error: "Missing questionId or screenshots." });

  for (const p of paths) {
    if (!p.startsWith(gate.userId + "/")) {
      return res.status(403).json({ error: "One of those screenshots doesn't belong to you." });
    }
  }

  const { data: question, error: qErr } = await supabaseAdmin
    .from("quiz_questions")
    .select("question, answer_guide, question_type, reference_images")
    .eq("id", questionId)
    .single();
  if (qErr || !question) return res.status(404).json({ error: "Question not found." });
  if (question.question_type !== "screenshot") return res.status(400).json({ error: "This question isn't a screenshot question." });

  const submittedImages = [];
  for (const path of paths.slice(0, 5)) {
    const b64 = await downloadAsBase64("quiz-screenshots", path);
    if (b64) submittedImages.push({ path, base64: b64 });
  }
  if (submittedImages.length === 0) return res.status(404).json({ error: "Could not find those screenshots." });

  const referencePaths = Array.isArray(question.reference_images) ? question.reference_images.slice(0, 5) : [];
  const referenceImages = [];
  for (const path of referencePaths) {
    const b64 = await downloadAsBase64("quiz-reference-images", path);
    if (b64) referenceImages.push({ path, base64: b64 });
  }

  // Build the prompt + image parts. When reference examples exist, this
  // becomes a genuine image-to-image content comparison (item names,
  // prices, contact details, on-screen values, etc.) rather than judging
  // against a text description alone.
  const parts = [];
  const introText = [
    "You are grading an employee's assessment answer for a restaurant-POS sales training program.",
    "The question was: \"" + question.question + "\"",
    question.answer_guide ? "Additional context on what a correct answer should show: \"" + question.answer_guide + "\"" : "",
  ].filter(Boolean).join("\n");
  parts.push({ text: introText });

  if (referenceImages.length > 0) {
    parts.push({ text: "Here " + (referenceImages.length === 1 ? "is a CORRECT reference example" : "are " + referenceImages.length + " CORRECT reference examples") + " showing what a right answer looks like. Pay close attention to the actual on-screen content in these — things like item names, prices, statuses, contact details, or any other specific data visible — since the employee's submission should match this same real content, not just look superficially similar." });
    referenceImages.forEach((ref) => { parts.push({ inline_data: { mime_type: mimeFor(ref.path), data: ref.base64 } }); });
  }

  parts.push({ text: "Now here " + (submittedImages.length === 1 ? "is the EMPLOYEE'S submitted screenshot" : "are the EMPLOYEE'S " + submittedImages.length + " submitted screenshots, together forming their one answer") + " to grade" + (referenceImages.length > 0 ? " — compare its actual content (item names, prices, statuses, contact details, or whatever specific data is relevant to this question) against the reference example(s) above" : "") + ":" });
  submittedImages.forEach((img) => { parts.push({ inline_data: { mime_type: mimeFor(img.path), data: img.base64 } }); });

  parts.push({
    text: [
      "Judge whether the submission genuinely satisfies the question — this may be a screenshot of a task performed correctly in a software portal, or a screenshot of a written answer typed elsewhere.",
      referenceImages.length > 0
        ? "Since reference examples were provided, ground your judgment in the actual content shown — if specific values like an item name, price, or contact detail are visible in the references, check whether the employee's screenshot shows matching or reasonably equivalent real content, not just a similar-looking screen."
        : "Be a fair but real grader: don't pass a screenshot that's blank, unrelated, cut off in a way that hides the key proof, or clearly wrong.",
      "Give credit for reasonable variation (different but equally valid data, different exact wording) as long as it demonstrates the same correct understanding or action.",
      "Respond with ONLY a JSON object, no markdown, no code fences, in exactly this shape: {\"correct\": true or false, \"feedback\": \"one or two sentences explaining your judgment, addressed directly to the employee\"}",
    ].join(" "),
  });

  try {
    let text = null;
    let lastErr = null;
    for (const model of GEMINI_MODELS) {
      try {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + process.env.GEMINI_API_KEY;
        const gRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 500, temperature: 0.2 },
          }),
        });
        const data = await gRes.json();
        if (!gRes.ok) throw new Error((data && data.error && data.error.message) || ("Gemini error (" + gRes.status + ")"));
        const candidate = data.candidates && data.candidates[0];
        text = candidate?.content?.parts?.[0]?.text;
        if (text) break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!text) throw lastErr || new Error("No Gemini model responded.");

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return res.status(200).json({ graded: false, error: "Could not review the screenshot — please try submitting it again." });
    }

    return res.status(200).json({
      graded: true,
      correct: !!parsed.correct,
      feedback: String(parsed.feedback || "").slice(0, 400),
    });
  } catch (e) {
    return res.status(500).json({ error: "Could not review the screenshot: " + (e.message || e) });
  }
}
