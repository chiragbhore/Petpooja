import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = process.env.GEMINI_VOICE || "Kore";
// Security tokens always need SOME expiry — there's no way to request a
// truly unlimited one. 4 hours is set here as a ceiling that should never
// realistically be hit during a practice session, effectively removing
// any practical time limit while keeping a sane technical safety net.
const TOKEN_LIFETIME_MS = 4 * 60 * 60 * 1000;

function buildInstruction(s, products) {
  const mode = s.mode || "call";
  const isInPerson = mode === "in_person";
  const isDemo = mode === "demo";

  let settingLine;
  if (isDemo) {
    settingLine =
      "A rep has arrived (in person, or on a video call sharing their screen) for what you understand is some kind of meeting, but you have not yet been told exactly why they're there or what they want to show you. Do NOT assume a demo has already started or jump into asking about specific features. Simply greet them naturally and let THEM explain the purpose of the visit first. Only once they've actually introduced themselves and stated what they're there to show you should you engage as a curious buyer who expects real depth, not vague overviews.";
  } else if (isInPerson) {
    settingLine =
      "The rep has physically walked into your restaurant/shop and is standing in front of you right now. You do not know yet why they're here. React the way a real business owner would to someone showing up at their place of business — greet them, and let THEM explain why they've come before you react to anything about a product or pitch. Stay aware of timing (are you mid-rush, or free to talk), and whether they're being respectful of your time.";
  } else {
    settingLine =
      "This is a phone call — the rep dialed in and you picked up. You do not know yet why they're calling. Answer naturally the way a real person would, and let THEM state the reason for the call before you react to anything about a product or pitch.";
  }

  let knowledgeBlock = "";
  if (products && products.length > 0) {
    const listed = products.map((p) => `— ${p.name}: ${p.key_facts}`).join("\n");
    const demoDepth = isDemo
      ? " Because this is a scheduled full demo, once it's actually underway, it's natural for you to ask what else the product does if the rep only covers one thing narrowly."
      : " If more than one product is listed above, let your natural curiosity lead you to ask about more than one over the course of the conversation, not just whichever one the rep leads with.";
    knowledgeBlock =
      "You privately know the following about this product space — this is YOUR background knowledge as a buyer, used only to judge how well-informed the rep is. " +
      "You must NEVER reveal, recite, hint at, confirm, or correct with any of these specific facts yourself, in any form — you are testing the rep's knowledge, not teaching or feeding it to them:\n" + listed + "\n" +
      "When the rep makes a claim about a product or feature, ask ONE natural, genuine follow-up question that would reveal whether they actually know what they're talking about — for example asking how something works in a specific situation, or what happens if a certain condition applies. " +
      "If their answer is vague, incorrect, or they dodge, react the way a real skeptical buyer would (mild doubt, asking them to clarify, or simply seeming unconvinced) — but do not tell them the correct answer, do not explain what they got wrong, and do not supply the information yourself under any circumstance. Ask at most one such question at a time, and let the conversation breathe naturally between questions rather than interrogating them line after line." + demoDepth;
  }

  const pricingRule =
    "As the customer, you don't bring up price yourself early in the conversation — real buyers explore value and fit first. If it comes up naturally, let it be near the end, once you've actually heard the pitch. If the rep pushes pricing too early, it's natural for you to redirect back to understanding the product first.";

  const languageRule =
    "Language: respond in whichever language (or natural mix, such as Hindi-English/Hinglish) the rep actually speaks to you in. If they speak Hindi, respond in Hindi; if English, respond in English; if they mix languages, mirror that naturally. If the rep switches language mid-conversation, switch with them. Never insist on a single language yourself.";

  const naturalness =
    "Speak the way a real human being speaks in this exact situation — natural rhythm, occasional filler words, genuine reactions. Never narrate your own actions, never describe what you're about to do, and never repeat back instructions or phrasing you were given — just BE the character, in your own words, every time. Your very first line should be a short, simple, natural greeting appropriate to this situation — nothing more — and then you should WAIT to hear from the rep before reacting to anything else.";

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
    languageRule,
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
    const expireTime = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();

    const authToken = await ai.authTokens.create({
      config: {
        uses: 10,
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
