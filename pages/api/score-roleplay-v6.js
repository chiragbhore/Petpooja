import { supabaseAdmin } from "../../lib/supabaseAdmin";

const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const RECORDING_DAYS = 30;

const PARAMETERS = [
  "Product Knowledge",
  "Understanding Customer Needs",
  "Mapping Customer Pain Points to Solutions",
  "Communication & Confidence",
  "Objection Handling",
  "Rapport Building",
  "Overall Sales Readiness",
];

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

  const { scenarioId, transcript } = req.body || {};
  if (!transcript || transcript.length < 20) return res.status(400).json({ error: "Not enough conversation to score." });

  const { data: scenario } = await supabaseAdmin.from("scenarios").select("*").eq("id", scenarioId).single();

  const { data: prevCalls } = await supabaseAdmin
    .from("roleplay_results")
    .select("overall, executive_summary, improvements, created_at")
    .eq("user_id", gate.userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const previous = prevCalls && prevCalls[0] ? prevCalls[0] : null;

  var scenarioLine = "";
  if (scenario) {
    var settingWord = scenario.mode === "in_person" ? "in-person visit" : "phone call";
    scenarioLine = "Scenario: " + scenario.title + " (an " + settingWord + "). The rep's goal was: " + scenario.goal + ". Prospect persona: " + scenario.persona + ".";
  }
  var previousLine = "This is the rep's first scored call - there is no previous call to compare.";
  if (previous) {
    previousLine = "The rep's PREVIOUS call scored " + previous.overall + "/100. Their prior weak areas: " + JSON.stringify(previous.improvements) + ". Prior summary: " + JSON.stringify(previous.executive_summary) + ".";
  }

  var schemaExample = {
    overall: "0-100",
    priority_action: "one specific actionable sentence",
    executive_summary: "2-3 sentence summary",
    progress_note: "1-2 sentences comparing to previous call",
    strengths: ["short phrase", "short phrase"],
    improvements: ["short phrase", "short phrase", "short phrase"],
    parameter_scores: {},
    empathy_score: "0-100",
    adaptability_score: "0-100",
    ei_feedback: "one sentence",
    coachable_moments: [
      { turn: 1, said: "quote", why_it_matters: "one sentence", better_approach: "one sentence", competency: "one of the 7 parameter names" },
    ],
  };
  PARAMETERS.forEach(function (p) {
    schemaExample.parameter_scores[p] = { score: "0-100", comment: "one sentence" };
  });

  var promptParts = [];
  promptParts.push("You are a senior sales trainer auditing a roleplay call for a restaurant-POS sales team.");
  promptParts.push(scenarioLine);
  promptParts.push(previousLine);
  promptParts.push("Score the conversation strictly against these 7 audit parameters, each 0-100: " + PARAMETERS.join(", ") + ".");
  promptParts.push("Be honest and specific - do not inflate scores. If the rep responded incoherently, off-topic, or in the wrong language for the context, scores should be very low and say so plainly.");
  promptParts.push("Respond with ONLY a JSON object, no markdown, no code fences, matching exactly this shape (values are placeholders showing type/format, replace them with real content):");
  promptParts.push(JSON.stringify(schemaExample));
  promptParts.push("Include at most 3 coachable_moments, the most instructive ones.");
  promptParts.push("Transcript:");
  promptParts.push(transcript);

  var prompt = promptParts.join("\n");

  try {
    var text = null;
    var lastErr = null;
    for (var i = 0; i < GEMINI_MODELS.length; i++) {
      var model = GEMINI_MODELS[i];
      try {
        var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + process.env.GEMINI_API_KEY;
        var gRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0.3 },
          }),
        });
        var data = await gRes.json();
        if (!gRes.ok) throw new Error((data && data.error && data.error.message) || ("Gemini error (" + gRes.status + ")"));
        var candidate = data.candidates && data.candidates[0];
        text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
        if (text) break;
      } catch (e) {
        lastErr = e;
        text = null;
      }
    }
    if (!text) throw lastErr || new Error("No Gemini model responded.");
    text = text.replace(/```json|```/g, "").trim();

    var r;
    try {
      r = JSON.parse(text);
    } catch (parseErr) {
      // Salvage attempt: some responses include stray text before/after the JSON,
      // or get cut off mid-way. Try extracting just the outermost {...} block.
      var start = text.indexOf("{");
      var end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          r = JSON.parse(text.slice(start, end + 1));
        } catch (secondErr) {
          var snippet = text.slice(0, 300);
          return res.status(200).json({ saved: false, error: "Could not parse the report. Raw start: " + snippet });
        }
      } else {
        var snippet2 = text.slice(0, 300);
        return res.status(200).json({ saved: false, error: "Could not parse the report. Raw start: " + snippet2 });
      }
    }

    var clamp = function (n) { return Math.max(0, Math.min(100, Math.round(Number(n) || 0))); };
    var cleanParams = {};
    PARAMETERS.forEach(function (p) {
      var v = (r.parameter_scores && r.parameter_scores[p]) || {};
      cleanParams[p] = { score: clamp(v.score), comment: String(v.comment || "").slice(0, 300) };
    });

    var row = {
      user_id: gate.userId,
      scenario_id: scenarioId || null,
      overall: clamp(r.overall),
      priority_action: String(r.priority_action || "").slice(0, 400),
      executive_summary: String(r.executive_summary || "").slice(0, 800),
      progress_note: String(r.progress_note || "").slice(0, 400),
      strengths: Array.isArray(r.strengths) ? r.strengths.slice(0, 6) : [],
      improvements: Array.isArray(r.improvements) ? r.improvements.slice(0, 6) : [],
      parameter_scores: cleanParams,
      coachable_moments: Array.isArray(r.coachable_moments) ? r.coachable_moments.slice(0, 3) : [],
      empathy_score: clamp(r.empathy_score),
      adaptability_score: clamp(r.adaptability_score),
      ei_feedback: String(r.ei_feedback || "").slice(0, 400),
      verdict: String(r.executive_summary || "").slice(0, 300),
    };

    var insertResult = await supabaseAdmin.from("roleplay_results").insert(row).select().single();
    var inserted = insertResult.data;
    var insErr = insertResult.error;
    if (insErr) return res.status(500).json({ error: insErr.message });

    return res.status(200).json({ saved: true, report: Object.assign({}, row, { id: inserted.id }) });
  } catch (e) {
    return res.status(500).json({ error: "Scoring failed: " + (e.message || e) });
  }
}
