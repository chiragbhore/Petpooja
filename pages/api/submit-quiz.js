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

async function gradeOneScreenshotQuestion(question, submittedPaths) {
  const submittedImages = [];
  for (const path of (submittedPaths || []).slice(0, 5)) {
    const b64 = await downloadAsBase64("quiz-screenshots", path);
    if (b64) submittedImages.push({ path, base64: b64 });
  }
  if (submittedImages.length === 0) return { correct: false, feedback: "No screenshot was submitted for this question." };

  const referencePaths = Array.isArray(question.reference_images) ? question.reference_images.slice(0, 5) : [];
  const referenceImages = [];
  for (const path of referencePaths) {
    const b64 = await downloadAsBase64("quiz-reference-images", path);
    if (b64) referenceImages.push({ path, base64: b64 });
  }

  const parts = [];
  const introText = [
    "You are grading an employee's assessment answer for a restaurant-POS sales training program.",
    "The question was: \"" + question.question + "\"",
    question.answer_guide ? "Additional context on what a correct answer should show: \"" + question.answer_guide + "\"" : "",
  ].filter(Boolean).join("\n");
  parts.push({ text: introText });

  if (referenceImages.length > 0) {
    parts.push({ text: "Here " + (referenceImages.length === 1 ? "is a CORRECT reference example" : "are " + referenceImages.length + " CORRECT reference examples") + " showing what a right answer looks like. Pay close attention to the actual on-screen content — item names, prices, statuses, contact details, or any other specific data visible." });
    referenceImages.forEach((ref) => { parts.push({ inline_data: { mime_type: mimeFor(ref.path), data: ref.base64 } }); });
  }

  parts.push({ text: "Now here " + (submittedImages.length === 1 ? "is the EMPLOYEE'S submitted screenshot" : "are the EMPLOYEE'S " + submittedImages.length + " submitted screenshots, together forming their one answer") + " to grade:" });
  submittedImages.forEach((img) => { parts.push({ inline_data: { mime_type: mimeFor(img.path), data: img.base64 } }); });

  parts.push({
    text: [
      "Judge whether the submission genuinely satisfies the question.",
      referenceImages.length > 0
        ? "Ground your judgment in the actual content shown — check whether real values like item names, prices, or contact details match or are reasonably equivalent to the references."
        : "Be a fair but real grader: don't pass a screenshot that's blank, unrelated, or clearly wrong.",
      "Give credit for reasonable variation as long as it demonstrates the same correct understanding.",
      "Respond with ONLY a JSON object, no markdown, no code fences: {\"correct\": true or false, \"feedback\": \"one or two sentences addressed directly to the employee\"}",
    ].join(" "),
  });

  let text = null;
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + process.env.GEMINI_API_KEY;
      const gRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 500, temperature: 0.2 } }),
      });
      const data = await gRes.json();
      if (!gRes.ok) throw new Error((data && data.error && data.error.message) || ("Gemini error (" + gRes.status + ")"));
      const candidate = data.candidates && data.candidates[0];
      text = candidate?.content?.parts?.[0]?.text;
      if (text) break;
    } catch (e) { lastErr = e; }
  }
  if (!text) return { correct: false, feedback: "Could not be reviewed automatically — needs admin attention. (" + (lastErr?.message || "no response") + ")" };

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { correct: !!parsed.correct, feedback: String(parsed.feedback || "").slice(0, 400) };
  } catch {
    return { correct: false, feedback: "Could not be reviewed automatically — needs admin attention." };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing GEMINI_API_KEY." });

  const gate = await requireUser(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { attemptId } = req.body || {};
  if (!attemptId) return res.status(400).json({ error: "Missing attemptId." });

  const { data: attempt, error: aErr } = await supabaseAdmin.from("quiz_attempts").select("*").eq("id", attemptId).single();
  if (aErr || !attempt) return res.status(404).json({ error: "Attempt not found." });
  if (attempt.user_id !== gate.userId) return res.status(403).json({ error: "This isn't your attempt." });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "This attempt was already submitted." });

  const { data: quiz } = await supabaseAdmin.from("quizzes").select("*").eq("id", attempt.quiz_id).single();
  const { data: questions } = await supabaseAdmin.from("quiz_questions").select("*").eq("quiz_id", attempt.quiz_id).order("sort_order", { ascending: true });

  const answers = attempt.answers || {};
  let correctCount = 0;
  const aiReview = [];
  let hasScreenshots = false;

  for (const q of questions || []) {
    const a = answers[q.id];
    if (q.question_type === "screenshot") {
      hasScreenshots = true;
      const paths = a?.paths || [];
      const verdict = await gradeOneScreenshotQuestion(q, paths);
      aiReview.push({ questionId: q.id, question: q.question, paths, correct: verdict.correct, feedback: verdict.feedback, adminOverride: null });
      if (verdict.correct) correctCount += 1;
    } else {
      const chosen = a?.chosenIndex;
      if (chosen === q.correct_index) correctCount += 1;
    }
  }

  const total = (questions || []).length;
  const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const passed = score >= (quiz?.pass_percent || 70);
  const status = hasScreenshots ? "pending_review" : "completed";

  const { error: updErr } = await supabaseAdmin.from("quiz_attempts").update({
    status, score, passed, submitted_at: new Date().toISOString(), ai_review: aiReview,
  }).eq("id", attemptId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  return res.status(200).json({ submitted: true, status, score, passed, needsReview: hasScreenshots });
}
