import { supabaseAdmin } from "../../lib/supabaseAdmin";

const GROQ_MODEL = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";
const GROQ_MODEL_FALLBACKS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
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
  const previous = prevCalls && prevCalls[0] ? prevCalls[0] : null;

  var scenarioLine = "";
  if (scenario) {
    scenarioLine = "Scenario: " + scenario.title + ". The rep's goal was: " + scenario.goal + ". Prospect persona: " + scenario.persona + ".";
  }
  var previousLine = "This is the rep's first scored call - there is no previous call to compare.";
  if (previous) {
    previousLine = "The rep's PREVIOUS call scored " + previous.overall + "/100. Their prior weak areas: " + JSON.stringify(previous.improvements) + ". Prior summary: " + JSON.stringify(previous.executive_summary) + ".";
  }

  var promptParts = [];
  promptParts.push("You are a senior sales trainer auditing a roleplay call for a restaurant-POS sales team.");
  promptParts.push(scenarioLine);
  promptParts.push(previousLine);
  promptParts.push("Score the call strictly against these 7 audit parameters, each 0-100: " + PARAMETERS.join(", ") + ".");
  promptParts.push("Be honest and specific - do not inflate scores. If
