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

function buildInstruction(s, products) {
  const isInPerson = s.mode === "in_person";
  const settingLine = isInPerson
    ? "The rep has physically walked into your restaurant/shop and is standing in front of you right now — this is a face-to-face, in-person conversation, not a phone call. React as you naturally would to someone showing up unannounced or by appointment at your place of business: notice things like whether they greeted you properly, whether it's a bad time (mid-rush, quiet afternoon, etc.), and whether they respect your space and time."
    : "This is a phone call — the rep dialed in and you picked up. React the way you naturally would to an unexpected or scheduled sales call.";
  const openingLine = isInPerson
    ? "Speak first with a brief, natural in-person greeting appropriate to someone walking up to you at your business (not a phone-style greeting)."
    : "Speak first with a brief phone-style greeting when the call starts (e.g. 'Hello?').";

  let knowledgeBlock = "";
  if (products && products.length > 0) {
    const listed = products.map((p) => `— ${p.name}: ${p.key_facts}`).join("\n");
    knowledgeBlock =
      "PRODUCT KNOWLEDGE YOU HAVE RESEARCHED BEFOREHAND (use this to test the rep, don't just recite it):\n" + listed + "\n" +
      "Whenever the rep mentions any feature, benefit, or claim about a product, ask a genuine follow-up or counter-question that checks whether they actually know it well — don't just accept whatever they say at face value. If the rep is vague, incorrect, or dodges, push back politely but skeptically, the way a real informed buyer would. " +
      "If more than one product exists in your knowledge above, try to naturally bring at least 2 different products into the conversation over the course of the call so the rep is tested across more than one area, not just whichever one they lead with.";
  }

  const pricingRule =
    "Do not ask about price or bring up pricing yourself early in the conversation — a real customer usually explores value and fit first. Only raise pricing near the END of the conversation, once the rep has had a real chance to pitch, and only if it feels natural for you (the customer) to ask at that point. If the rep tries to jump straight to pricing early, you can gently redirect back to understanding the product first, the way a savvy buyer would.";

  return [
    "You are role-playing a sales PROSPECT in a training simulator for Petpooja sales reps.",
    "Stay fully in character as the customer. Never coach, never break character, never say you are an AI.",
    `You are: ${s.persona || "a restaurant owner"}.`,
    settingLine,
    s.product ? `The rep is trying to sell you: ${s.product}.` : "",
    s.traits ? `Your personality: ${s.traits}.` : "",
    s.objections ? `Your main hesitations: ${s.objections}.` : "",
    knowledgeBlock,
    pricingRule,
    "React realistically to how good the rep's pitch is: reward genuine discovery and clear value, push back on weak or pushy lines.",
    `Keep spoken replies short and natural, like a real ${isInPerson ? "in-person conversation" : "phone call"}. ${openingLine}`,
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

  const { data: products } = await supabaseAdmin.from("product_knowledge").select("name, key_facts").order("sort_order", { ascending: true });

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
            systemInstruction: { parts: [{ text: buildInstruction(scenario, products) }] },
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
