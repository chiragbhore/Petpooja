import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const VOICE = process.env.GEMINI_VOICE || "Kore";

function buildInstruction(s, products) {
  const mode = s.mode || "call";
  const isInPerson = mode === "in_person";
  const isDemo = mode === "demo";

  let settingLine;
  let openingLine;
  if (isDemo) {
    settingLine =
      "This is a FULL PRODUCT DEMO session — the rep has set up a proper walkthrough (in person or over a video call sharing their screen) to show you the entire product end to end, not just a quick pitch. You expect them to actually walk you through real features, not just talk in generalities. Act like a genuinely curious buyer sitting through a demo: ask to see or hear about specific things, ask what happens in edge cases relevant to your restaurant, and expect the rep to cover breadth, not just one headline feature. If the rep tries to wrap up quickly without covering much ground, push back and ask what else the product does.";
    openingLine =
      "Speak first with a natural opener appropriate to starting a scheduled demo session (e.g. confirming you're ready to see the product, or asking them to get started) — not a phone greeting.";
  } else if (isInPerson) {
    settingLine =
      "The rep has physically walked into your restaurant/shop and is standing in front of you right now — this is a face-to-face, in-person conversation, not a phone call. React as you naturally would to someone showing up unannounced or by appointment at your place of business: notice things like whether they greeted you properly, whether it's a bad time (mid-rush, quiet afternoon, etc.), and whether they respect your space and time.";
    openingLine =
      "Speak first with a brief, natural in-person greeting appropriate to someone walking up to you at your business (not a phone-style greeting).";
  } else {
    settingLine =
      "This is a phone call — the rep dialed in and you picked up. React the way you naturally would to an unexpected or scheduled sales call.";
    openingLine =
      "Speak first with a brief phone-style greeting when the call starts (e.g. 'Hello?').";
  }

  let knowledgeBlock = "";
  if (products && products.length > 0) {
    const listed = products.map((p) => `— ${p.name}: ${p.key_facts}`).join("\n");
    const demoDepth = isDemo
      ? " Because this is a full demo (not a quick call), be noticeably more thorough: actively ask the rep to cover each product you have knowledge of if they haven't already, and probe deeper follow-up questions on each one — a real buyer sitting through a scheduled demo expects comprehensive coverage, not a surface-level pass."
      : " If more than one product exists in your knowledge above, try to naturally bring at least 2 different products into the conversation over the course of the call so the rep is tested across more than one area, not just whichever one they lead with.";
    knowledgeBlock =
      "PRODUCT KNOWLEDGE YOU HAVE RESEARCHED BEFOREHAND (use this to test the rep, don't just recite it):\n" + listed + "\n" +
      "Whenever the rep mentions any feature, benefit, or claim about a product, ask a genuine follow-up or counter-question that checks whether they actually know it well — don't just accept whatever they say at face value. If the rep is vague, incorrect, or dodges, push back politely but skeptically, the way a real informed buyer would." + demoDepth;
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
    `Keep spoken replies short and natural, like a real ${isDemo ? "product demo session" : isInPerson ? "in-person conversation" : "phone call"}. ${openingLine}`,
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
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
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
