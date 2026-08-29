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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Missing GEMINI_API_KEY." });

  const gate = await requireUser(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { questionId, screenshotPath } = req.body || {};
  if (!questionId || !screenshotPath) return res.status(400).json({ error: "Missing questionId or screenshotPath." });

  // Only ever grade a screenshot that actually belongs to the person
  // submitting it — the storage path is namespaced by their own user id.
  if (!screenshotPath.startsWith(gate.userId + "/")) {
    return res.status(403).json({ error: "That screenshot doesn't belong to you." });
  }

  const { data: question, error: qErr } = await supabaseAdmin
    .from("quiz_questions")
    .select("question, answer_guide, question_type")
    .eq("id", questionId)
    .single();
  if (qErr || !question) return res.status(404).json({ error: "Question not found." });
  if (question.question_type !== "screenshot") return res.status(400).json({ error: "This question isn't a screenshot question." });

  // Pull the image out of storage and encode it for the vision model.
  const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage.from("quiz-screenshots").download(screenshotPath);
  if (dlErr || !fileBlob) return res.status(404).json({ error: "Could not find that screenshot." });
  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const base64 = buffer.toString("base64");
  const ext = (screenshotPath.split(".").pop() || "png").toLowerCase();
  const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";

  const promptText = [
    "You are grading an employee's assessment answer for a restaurant-POS sales training program.",
    "The question was: \"" + question.question + "\"",
    "What a correct answer/screenshot should show: \"" + (question.answer_guide || "") + "\"",
    "Look at the attached screenshot and judge whether it genuinely satisfies what's described above — this may be a screenshot of them performing a task correctly in a software portal, or a screenshot of a written answer they typed elsewhere. Judge the actual content shown, not just that an image was submitted.",
    "Be a fair but real grader: don't pass a screenshot that's blank, unrelated, cut off in a way that hides the key proof, or clearly wrong. Do give credit for reasonable variation in how the correct thing might look (different data, different exact wording) as long as it demonstrates the same correct understanding or action.",
    "Respond with ONLY a JSON object, no markdown, no code fences, in exactly this shape: {\"correct\": true or false, \"feedback\": \"one or two sentences explaining your judgment, addressed directly to the employee\"}",
  ].join("\n");

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
            contents: [{
              parts: [
                { text: promptText },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            }],
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
