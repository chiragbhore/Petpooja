import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const VOICE = process.env.GEMINI_VOICE || "Kore";

// Confirm the caller is a signed-in user.
async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Not signed in.", status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { error: "Session invalid.", status: 401 };
  return { userId: data.user.id };
}

function buildInstruction(s) {
  return [
    "You are role-playing a sales PROSPECT in a training simulator for Petpooja sales reps.",
    "Stay fully in character as the customer. Never coach, never break character, never say you are an AI.",
    `You are: ${s.persona || "a restaurant owner"}.`,
    s.product ? `The rep is trying to sell you: ${s.product}.` : "",
    s.traits ? `Your personality: ${s.traits}.` : "",
    s.objections ? `Your main hesitations: ${s.objections}.` : "",
    "React realistically to how good the rep's pitch is: reward genuine discovery and clear value, push back on weak or pushy lines.",
    "Keep spoken replies short and natural, like a real phone call. Speak first with a brief greeting when the call starts.",
  ].filter(Boolean).join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server not configured: missing GEMINI_API_KEY." });

  const gate = await requireUser(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { scenarioId } = req.body || {};
  if (!scenarioId) return res.status(400).json({ error: "Missing scenarioId." });

  const { data: scenario } = await supabaseAdmin.from("scenarios").select("*").eq("id", scenarioId).single();
  if (!scenario) return res.status(404).json({ error: "Scenario not found." });

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
    const expireTime = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min cap

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
            systemInstruction: { parts: [{ text: buildInstruction(scenario) }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    return res.status(200).json({ token: token.name, model: LIVE_MODEL });
  } catch (e) {
    return res.status(500).json({ error: `Could not start the practice line: ${e.message || e}` });
  }
}
