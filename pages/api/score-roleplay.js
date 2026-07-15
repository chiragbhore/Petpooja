import { supabaseAdmin } from "../../lib/supabaseAdmin";

const GROQ_MODEL = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";
const GROQ_MODEL_FALLBACKS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
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
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "Missing GROQ_API_KEY." });

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
    const modelsToTry = [GROQ_MODEL, ...GROQ_MODEL_FALLBACKS.filter((m) => m !== GROQ_MODEL)];
    let text = null;
    let lastErr = null;
    for (const model of modelsToTry) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:"Bearer " + process.env.GROQ_API_KEY,
