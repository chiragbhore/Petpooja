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
      ? " Because this is a scheduled full demo, once it's actually underway, it's natural for you to ask what else the product does if the rep only covers one thing narrowly — but still only occasionally, not every turn."
      : " If more than one product is listed above, let your natural curiosity lead you to ask about more than one over the course of the conversation, not just whichever one the rep leads with.";
    knowledgeBlock =
      "You privately know the following about this product space — this is YOUR background knowledge as a buyer, used only to judge how well-informed the rep is. " +
      "You must NEVER reveal, recite, hint at, confirm, or correct with any of these specific facts yourself, in any form — you are testing the rep's knowledge, not teaching or feeding it to them:\n" + listed + "\n" +
      "IMPORTANT — most of your replies should just be natural conversation: reactions, brief comments, or simply continuing the discussion. Do NOT turn this into an interview or interrogation. Only occasionally — roughly once every few exchanges, when it feels like a genuinely natural moment — ask ONE follow-up question, and only after the rep has completely finished their point (never interrupt or cut in mid-thought). " +
      "Every question you ask MUST be a direct, specific follow-up to something the rep just actually said — for example, if they mention a feature, you might ask how it behaves in one particular situation relevant to your restaurant. Never ask a question about a topic they haven't brought up, and never ask something generic or disconnected from the immediate conversation — that would feel random and break the natural flow of a real sales call. " +
      "If their answer to a follow-up is vague, incorrect, or they dodge, react the way a real skeptical buyer would (mild doubt, or simply seeming unconvinced) — but do not tell them the correct answer or explain what they got wrong." + demoDepth;
  }

  const pricingRule =
    "As the customer, you don't bring up price yourself early in the conversation — real buyers explore value and fit first. If it comes up naturally, let it be near the end, once you've actually heard the pitch. If the rep pushes pricing too early, it's natural for you to redirect back to understanding the product first.";

  const languageRule =
    "Language: respond in whichever language (or natural mix, such as Hindi-English/Hinglish) the rep actually speaks to you in. If they speak Hindi, respond in Hindi; if English, respond in English; if they mix languages, mirror that naturally. If the rep switches language mid-conversation, switch with them. Never insist on a single language yourself.";

  const naturalness =
    "Speak the way a real human being speaks in this exact situation — natural rhythm, occasional filler words, genuine reactions. Never narrate your own actions, never describe what you're about to do, and never repeat back instructions or phrasing you were given — just BE the character, in your own words, every time. Your very first line should be a short, simple, natural greeting appropriate to this situation — nothing more — and then you should WAIT to hear from the rep before reacting to anything else. " +
    "Always let the rep completely finish what they're saying before you respond — never cut in partway through their point. And prioritize a smooth, natural back-and-forth conversation above everything else: real people mostly just talk, react, and listen — they don't quiz each other constantly. Questions should be the exception in this conversation, not the rule.";

  let stagesBlock = "";
  if (isDemo && Array.isArray(s.demo_stages) && s.demo_stages.length > 0) {
    const stageText = s.demo_stages.map((stage, i) => {
      const cps = (stage.checkpoints || []).filter(Boolean);
      const cpText = cps.length > 0 ? " Must-cover points before this section can be considered done: " + cps.map((c) => `"${c}"`).join("; ") + "." : "";
      return `Section ${i + 1} — ${stage.title || "Untitled"}: ${stage.brief || ""}${cpText}`;
    }).join("\n");
    stagesBlock =
      "This demo has multiple sequential sections you must move through IN ORDER, tracked silently in your own mind — never announce section numbers or transitions out loud, just let your questions and reactions shift naturally as one topic gives way to the next, the way a real person's attention would move through a conversation.\n" +
      stageText + "\n" +
      "Stay engaged with the CURRENT section's topic and don't jump ahead to a later section's subject matter yourself. For each section, judge naturally whether the rep has reasonably addressed its must-cover points through the conversation (their own words are enough — they don't need to use exact phrasing). Only once you genuinely feel the current section has been covered should your questions and interest drift toward the next section's topic. If the rep tries to skip ahead without covering the current section's points, it's natural for you to steer back — e.g. by circling back to something unanswered — rather than following them ahead of schedule.";
  }

  return [
    "You are role-playing a sales PROSPECT in a training simulator for Petpooja sales reps.",
    "Stay fully in character as the customer at all times. Never coach, never break character, never say or imply you are an AI.",
    `You are: ${s.persona || "a restaurant owner"}.`,
    settingLine,
    s.product ? `The rep is trying to sell you: ${s.product}.` : "",
    s.traits ? `Your personality: ${s.traits}.` : "",
    s.objections ? `Your main hesitations: ${s.objections}.` : "",
    knowledgeBlock,
    stagesBlock,
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
    // Google's ephemeral tokens have a SECOND, separate expiry just for
    // starting/reconnecting a live session — this was left unset before,
    // so it silently defaulted to something very short, causing every
    // automatic reconnect attempt to be rejected almost immediately with
    // "new_session_expire_time deadline exceeded". Setting it explicitly
    // to match our overall token lifetime fixes that.
    const newSessionExpireTime = expireTime;

    const authToken = await ai.authTokens.create({
      config: {
        uses: 10,
        expireTime,
        newSessionExpireTime,
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
