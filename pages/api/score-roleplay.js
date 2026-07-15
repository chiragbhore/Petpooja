import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

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

  const prompt = `You are a sales coach. Score this roleplay between a REP (the trainee) and a PROSPECT.
${scenario ? `The rep's goal was: ${scenario.goal}. Scenario: ${scenario.title}.` : ""}
Respond with ONLY a JSON object, no markdown, in this exact shape:
{"overall":0-100,"rapport":0-100,"discovery":0-100,"objection":0-100,"closing":0-100,"verdict":"one sentence"}

Transcript:
${transcript}`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const text = (result.text || "").replace(/```json|```/g, "").trim();
    let scores;
    try { scores = JSON.parse(text); } catch { return res.status(200).json({ saved: false, error: "Could not parse score." }); }

    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const row = {
      user_id: gate.userId,
      scenario_id: scenarioId || null,
      overall: clamp(scores.overall),
      rapport: clamp(scores.rapport),
      discovery: clamp(scores.discovery),
      objection: clamp(scores.objection),
      closing: clamp(scores.closing),
      verdict: (scores.verdict || "").slice(0, 300),
    };
    await supabaseAdmin.from("roleplay_results").insert(row);
    return res.status(200).json({ saved: true, scores: row });
  } catch (e) {
    return res.status(500).json({ error: `Scoring failed: ${e.message || e}` });
  }
}
