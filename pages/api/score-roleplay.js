import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const TEXT_MODEL_FALLBACKS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
const RECORDING_DAYS = 30;

// Petpooja's audit parameters — the exact rubric every call is scored against.
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

  const { scenarioId, transcript, recordingPath } = req.body || {};
  if (!transcript || transcript.length < 20) return res.status(400).json({ error: "Not enough conversation to score." });

  const { data: scenario } = await supabaseAdmin.from("scenarios").select("*").eq("id", scenarioId).single();

  const { data: prevCalls } = await supabaseAdmin
    .from("roleplay_results")
    .select("overall, executive_summary, improvements, created_at")
    .eq("user_id", gate.userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const previous = prevCalls?.[0] || null;

  const prompt = `You are a senior sales trainer auditing a roleplay call for a restaurant-POS sales team.
${scenario ? `Scenario: ${scenario.title}. The rep's goal was: ${scenario.goal}. Prospect persona: ${scenario.persona}.` : ""}
${previous ? `The rep's PREVIOUS call scored ${previous.overall}/100. Their prior weak areas: ${JSON.stringify(previous.improvements)}. Prior summary: "${previous.executive_summary}".` : "This is the rep's first scored call — there is no previous call to compare."}

Score the call strictly against these 7 audit parameters, each 0-100: ${PARAMETERS.join(", ")}.
Be honest and specific — do not inflate scores. If the rep responded incoherently, off-topic, or in the wrong language for the context, scores should be very low and say so plainly.

Respond with ONLY a JSON object, no markdown, in this EXACT shape:
{
  "overall": 0-100,
  "priority_action": "one specific, actionable sentence — the single most important thing to fix next",
  "executive_summary": "2-3 sentence summary of how the call went",
  "progress_note": "1-2 sentences comparing this call to the previous one (or note this is their first call)",
  "strengths": ["short phrase", "short phrase"],
  "improvements": ["short phrase", "short phrase", "short phrase"],
  "parameter_scores": {
    "Product Knowledge": {"score": 0-100, "comment": "one sentence"},
    "Understanding Customer Needs": {"score": 0-100, "comment": "one sentence"},
    "Mapping Customer Pain Points to Solutions": {"score": 0-100, "comment": "one sentence"},
    "Communication & Confidence": {"score": 0-100, "comment": "one sentence"},
    "Objection Handling": {"score": 0-100, "comment": "one sentence"},
    "Rapport Building": {"score": 0-100, "comment": "one sentence"},
    "Overall Sales Readiness": {"score": 0-100, "comment": "one sentence"}
  },
  "empathy_score": 0-100,
  "adaptability_score": 0-100,
  "ei_feedback": "one sentence on emotional intelligence during the call",
  "coachable_moments": [
    {"turn": 1, "said": "quote or paraphrase of what the rep said", "why_it_matters": "one sentence", "better_approach": "one sentence alternative", "competency": "one of the 7 parameter names above"}
  ]
}
Include at most 3 coachable_moments, the most instructive ones.

Transcript:
${transcript}`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const modelsToTry = [TEXT_MODEL, ...TEXT_MODEL_FALLBACKS.filter((m) => m !== TEXT_MODEL)];
    let result = null;
    let lastErr = null;
    for (const model of modelsToTry) {
      try {
        result = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });
        break;
      } catch (e) {
        lastErr = e;
        result = null;
      }
    }
    if (!result) throw lastErr || new Error("No Gemini model responded.");
    const text = (result.text || "").replace(/```json|```/g, "").trim();
    let r;
    try { r = JSON.parse(text); } catch { return res.status(200).json({ saved: false, error: "Could not parse the report." }); }

    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const cleanParams = {};
    PARAMETERS.forEach((p) => {
      const v = r.parameter_scores?.[p] || {};
      cleanParams[p] = { score: clamp(v.score), comment: String(v.comment || "").slice(0, 300) };
    });

    const expiresAt = recordingPath ? new Date(Date.now() + RECORDING_DAYS * 86400000).toISOString() : null;

    const row = {
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
      recording_path: recordingPath || null,
      recording_expires_at: expiresAt,
      verdict: String(r.executive_summary || "").slice(0, 300),
    };

    const { data: inserted, error: insErr } = await supabaseAdmin.from("roleplay_results").insert(row).select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    let recording_url = null;
    if (recordingPath) {
      const { data: signed } = await supabaseAdmin.storage.from("call-recordings").createSignedUrl(recordingPath, 3600);
      recording_url = signed?.signedUrl || null;
    }

    return res.status(200).json({ saved: true, report: { ...row, recording_url } });
  } catch (e) {
    return res.status(500).json({ error: `Scoring failed: ${e.message || e}` });
  }
}
