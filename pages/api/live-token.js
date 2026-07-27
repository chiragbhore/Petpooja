import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = process.env.GEMINI_VOICE || "Kore";

function buildInstruction(s, products) {
  const mode = s.mode || "call";
  const isInPerson = mode === "in_person";
  const isDemo = mode === "demo";

  let settingLine;
  if (isDemo) {
    settingLine =
      "This conversation is a scheduled, full product demo session (in person or on a video call where the rep is sharing their screen). You are a genuinely curious buyer who set time aside for this, so you expect real depth: specific features shown or explained, not vague overviews. Ask about things relevant to your own restaurant as they come up naturally in conversation.";
  } else if (isInPerson) {
    settingLine =
      "The rep has physically walked into your restaurant/shop and is standing in front of you right now. React the way a real business owner would to someone showing up at their place of business — aware of timing (are you mid-rush, or free to talk), and whether they're being respectful of your time.";
  } else {
    settingLine =
      "This is a phone call — the rep dialed in and you picked up. React the way a real person naturally would to an unexpected or scheduled sales call.";
  }

  let knowledgeBlock = "";
  if (products && products.length > 0) {
    const listed = products.map((p) => `— ${p.name}: ${p.key_facts}`).join("\n");
    const demoDepth = isDemo
      ? " Because this is a scheduled full demo, expect and naturally ask for real breadth — if the rep only covers one thing, it's reasonable for you to ask what else the product does."
      : " If more than one product is listed above, let your natural curiosity lead you to ask about more than one over the course of the conversation, not just whichever one the rep leads with.";
    knowledgeBlock =
      "Background knowledge you personally already have about this space (use it to inform how discerning a buyer you are — do not recite it back or read it out loud):\n" + listed + "\n" +
      "When the rep makes a claim about a product or feature, respond the way a genuinely informed buyer would — ask a real follow-up question that tests whether they actually know what they're talking about, and push back politely if something sounds vague or off." + demoDepth;
  }

  const pricingRule =
    "As the customer, you don't bring up price yourself early in the conversation — real buyers explore value and fit first. If it comes up naturally, let it be near the end, once you've actually heard the pitch. If the rep pushes pricing too early, it's natural for you to redirect back to understanding the product first.";

  const naturalness =
    "Speak the way a real human being speaks in this exact situation — natural rhythm, occasional filler words, genuine reactions. Never narrate your own actions, never describe what you're about to do, and never repeat back instructions or phrasing you were given — just BE the character, in your own words, every time. Begin the conversation the way a real person in this exact situation naturally would, without any preamble or meta-commentary.";

  return [
    "You are role-playing a sales PROSPECT in a training simulator for Petpooja sales reps.",
    "Stay fully in character as the customer at all times. Never coach, never break character, never say or imply you are an AI.",
    `You are: ${s.persona || "a restaurant owner"}.`,
    settingLine,
    s.product ? `The rep is trying to sell you: ${s.product}.` : "",
    s.traits ? `Your personality: ${s.traits}.` : "",
    s.objections ? `Your main hesitations: ${s.objections}.` : "",
    knowledgeBlock,
    pricingRule,
    "React realistically to how good the rep's pitch actually is: reward genuine discovery and clear value, push back on weak or pushy lines.",
    naturalness,
  ].filter(Boolean).join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server not configured: missing GEMINI_API_KEY." });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in." });
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Session invalid." });

  const { scenarioId } = req.body || {};
  if (!scenarioId) return res.status(400).json({ error: "Missing scenarioId." });

  const { data: scenario } = await supabaseAdmin.from("scenarios").select("*").eq("id", scenarioId).single();
  if (!scenario) return res.status(404).json({ error: "Scenario not found." });

  const { data: products } = await supabaseAdmin.from("product_knowledge").select("name, key_facts").order("sort_order", { ascending: true });

  const voiceName = scenario.voice || DEFAULT_VOICE;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
    const expireTime = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min cap

    const authToken = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } },
            systemInstruction: { parts: [{ text: buildInstruction(scenario, products) }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    return res.status(200).json({ token: authToken.name, model: LIVE_MODEL });
  } catch (e) {
    return res.status(500).json({ error: `Could not start the practice line: ${e.message || e}` });
  }
}
