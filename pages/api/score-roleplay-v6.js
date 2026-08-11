import { supabaseAdmin } from "../../lib/supabaseAdmin";

const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];

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
    var settingWord = scenario.mode === "in_person" ? "in-person visit" : scenario.mode === "demo" ? "full product demo session" : "phone call";
    scenarioLine = "Scenario: " + scenario.title + " (a " + settingWord + "). The rep's goal was: " + scenario.goal + ". Prospect persona: " + scenario.persona + ".";
  }
  var previousLine = "This is the rep's first scored call - there is no previous call to compare.";
  if (previous) {
    previousLine = "The rep's PREVIOUS call scored " + previous.overall + "/100. Their prior weak areas: " + JSON.stringify(previous.improvements) + ". Prior summary: " + JSON.stringify(previous.executive_summary) + ".";
  }

  // Fetch the operational pain points this scenario was set up to surface.
  // If specific services were hand-picked, grade against just those.
  // Otherwise, as long as a restaurant type is set, grade against every
  // catalog service for that type.
  var vasEntries = [];
  if (scenario && scenario.restaurant_type) {
    var vasQuery = supabaseAdmin
      .from("vas_catalog")
      .select("service_name, problem_solved")
      .eq("restaurant_type", scenario.restaurant_type);
    if (Array.isArray(scenario.selected_services) && scenario.selected_services.length > 0) {
      vasQuery = vasQuery.in("service_name", scenario.selected_services);
    }
    var vasRes = await vasQuery;
    vasEntries = vasRes.data || [];
  }

  var vasLine = "";
  if (vasEntries.length > 0) {
    var vasList = vasEntries.map(function (v) { return "- " + v.service_name + ": the prospect was scripted to be frustrated about \"" + v.problem_solved + "\""; }).join("\n");
    vasLine =
      "This scenario was specifically set up to test discovery skill: the prospect was instructed to naturally mention " + vasEntries.length + " real operational pain points during the conversation, each one matching a specific Petpooja product. Here is the list, with the exact product each pain point maps to:\n" + vasList + "\n" +
      "For EACH of these, determine from the transcript: did the rep notice when the prospect mentioned or hinted at that problem, and did they correctly connect it to the matching product and explain the benefit? Judge generously — the rep doesn't need to use the exact service name, just correctly identify the problem and offer a relevant solution. If the prospect never actually got a chance to mention a particular pain point in this conversation (the call may have ended early, or the topic never came up naturally), mark it as not identified but note in the comment that it wasn't raised, don't penalize the rep for something that was never surfaced.";
  }

  var stageLine = "";
  if (scenario && Array.isArray(scenario.demo_stages) && scenario.demo_stages.length > 0) {
    var stageList = scenario.demo_stages.map(function (st, i) {
      var cps = (st.checkpoints || []).filter(Boolean);
      var cpText = cps.length > 0 ? " Must-cover points: " + cps.map(function (c) { return "\"" + c + "\""; }).join("; ") + "." : "";
      return "Section " + (i + 1) + " - " + (st.title || "Untitled") + ": " + (st.brief || "") + cpText;
    }).join("\n");
    stageLine =
      "This scenario also had a required sequence of pitch sections the rep was supposed to work through IN ORDER, each with specific must-cover points:\n" + stageList + "\n" +
      "For EACH section, judge from the transcript whether the rep actually covered its must-cover points (their own wording is fine, exact phrasing not required) BEFORE the conversation moved on — and whether they followed the sections roughly in order rather than jumping around or skipping ahead. A rep who skips a section's points and moves on anyway should be marked as not fully covering that section, even if they circle back later. Judge process discipline here, not just whether the right words eventually got said somewhere in the call.";
  }

  var schemaExample = {
    overall: "0-100",
    priority_action: "one specific actionable sentence",
    executive_summary: "2-3 sentence summary",
    progress_note: "1-2 sentences comparing to previous call",
    strengths: ["short phrase", "short phrase"],
    improvements: ["short phrase", "short phrase", "short phrase"],
    parameter_scores: {},
    vas_coverage: [],
    stage_coverage: [],
    empathy_score: "0-100",
    adaptability_score: "0-100",
    ei_feedback: "one sentence",
    coachable_moments: [
      { turn: 1, said: "quote", why_it_matters: "one sentence", better_approach: "one sentence", competency: "one of the 7 parameter names" },
    ],
  };
  PARAMETERS.forEach(function (p) {
    schemaExample.parameter_scores[p] = { score: "0-100", comment: "one sentence" };
  });
  if (vasEntries.length > 0) {
    schemaExample.vas_coverage = vasEntries.map(function (v) {
      return { service_name: v.service_name, identified: "true or false", comment: "one short sentence on whether/how the rep caught this and pitched the right product" };
    });
  }
  if (scenario && Array.isArray(scenario.demo_stages) && scenario.demo_stages.length > 0) {
    schemaExample.stage_coverage = scenario.demo_stages.map(function (st, i) {
      return { section_title: st.title || ("Section " + (i + 1)), covered: "true or false", followed_order: "true or false", comment: "one short sentence" };
    });
  }

  var promptParts = [];
  promptParts.push("You are a senior sales trainer auditing a roleplay conversation for a restaurant-POS sales team.");
  promptParts.push(scenarioLine);
  promptParts.push(previousLine);
  promptParts.push("Score the conversation strictly against these 7 audit parameters, each 0-100: " + PARAMETERS.join(", ") + ".");
  promptParts.push("If this was a full product demo session, weigh Product Knowledge and breadth of feature coverage heavily — a good demo should cover multiple product areas, not just one.");
  if (vasLine) {
    promptParts.push(vasLine);
    promptParts.push("Let how well the rep handled these specific opportunities meaningfully influence your score for \"Mapping Customer Pain Points to Solutions\" in particular.");
  }
  if (stageLine) {
    promptParts.push(stageLine);
    promptParts.push("Let how well the rep followed this required sequence meaningfully influence your score for \"Overall Sales Readiness\" and \"Communication & Confidence\" — a rep who skips required ground and barrels ahead is not demonstrating real readiness, even if they eventually said the right things out of order.");
  }
  promptParts.push("Be honest and specific - do not inflate scores. If the rep responded incoherently, off-topic, or in the wrong language for the context, scores should be very low and say so plainly.");
  var hasStages = scenario && Array.isArray(scenario.demo_stages) && scenario.demo_stages.length > 0;
  promptParts.push("Respond with ONLY a JSON object, no markdown, no code fences, matching exactly this shape (values are placeholders showing type/format, replace them with real content" +
    (vasEntries.length > 0 ? "; vas_coverage must have exactly one entry per pain point listed above, same order" : "; omit vas_coverage or leave it as an empty array, this scenario has none") +
    (hasStages ? "; stage_coverage must have exactly one entry per section listed above, same order" : "; omit stage_coverage or leave it as an empty array, this scenario has none") +
    "):");
  promptParts.push(JSON.stringify(schemaExample));
  promptParts.push("Include at most 3 coachable_moments, the most instructive ones.");
  promptParts.push("Transcript:");
  promptParts.push(transcript);

  var prompt = promptParts.join("\n");

  try {
    var text = null;
    var lastErr = null;
    for (var i = 0; i < GEMINI_MODELS.length; i++) {
      var model = GEMINI_MODELS[i];
      try {
        var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + process.env.GEMINI_API_KEY;
        var gRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0.3 },
          }),
        });
        var data = await gRes.json();
        if (!gRes.ok) throw new Error((data && data.error && data.error.message) || ("Gemini error (" + gRes.status + ")"));
        var candidate = data.candidates && data.candidates[0];
        text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
        if (text) break;
      } catch (e) {
        lastErr = e;
        text = null;
      }
    }
    if (!text) throw lastErr || new Error("No Gemini model responded.");
    text = text.replace(/```json|```/g, "").trim();

    var r;
    try {
      r = JSON.parse(text);
    } catch (parseErr) {
      var start = text.indexOf("{");
      var end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try { r = JSON.parse(text.slice(start, end + 1)); }
        catch (secondErr) { return res.status(200).json({ saved: false, error: "Could not parse the report. Raw start: " + text.slice(0, 300) }); }
      } else {
        return res.status(200).json({ saved: false, error: "Could not parse the report. Raw start: " + text.slice(0, 300) });
      }
    }

    var clamp = function (n) { return Math.max(0, Math.min(100, Math.round(Number(n) || 0))); };
    var cleanParams = {};
    PARAMETERS.forEach(function (p) {
      var v = (r.parameter_scores && r.parameter_scores[p]) || {};
      cleanParams[p] = { score: clamp(v.score), comment: String(v.comment || "").slice(0, 300) };
    });

    var cleanVas = Array.isArray(r.vas_coverage) ? r.vas_coverage.slice(0, 15).map(function (v) {
      return {
        service_name: String(v.service_name || "").slice(0, 100),
        identified: !!v.identified,
        comment: String(v.comment || "").slice(0, 300),
      };
    }) : [];

    var cleanStageCoverage = Array.isArray(r.stage_coverage) ? r.stage_coverage.slice(0, 15).map(function (v) {
      return {
        section_title: String(v.section_title || "").slice(0, 150),
        covered: !!v.covered,
        followed_order: !!v.followed_order,
        comment: String(v.comment || "").slice(0, 300),
      };
    }) : [];

    var row = {
      user_id: gate.userId,
      scenario_id: scenarioId || null,
      overall: clamp(r.overall),
      priority_action: String(r.priority_action || "").slice(0, 400),
      executive_summary: String(r.executive_summary || "").slice(0, 800),
      progress_note: String(r.progress_note || "").slice(0, 400),
      strengths: Array.isArray(r.strengths) ? r.strengths.slice(0, 6) : [],
      improvements: Array.isArray(r.improvements) ? r.improvements.slice(0, 6) : [],
      parameter_scores: cleanParams,
      vas_coverage: cleanVas,
      stage_coverage: cleanStageCoverage,
      coachable_moments: Array.isArray(r.coachable_moments) ? r.coachable_moments.slice(0, 3) : [],
      empathy_score: clamp(r.empathy_score),
      adaptability_score: clamp(r.adaptability_score),
      ei_feedback: String(r.ei_feedback || "").slice(0, 400),
      verdict: String(r.executive_summary || "").slice(0, 300),
    };

    var insertResult = await supabaseAdmin.from("roleplay_results").insert(row).select().single();
    var inserted = insertResult.data;
    var insErr = insertResult.error;
    if (insErr) return res.status(500).json({ error: insErr.message });

    return res.status(200).json({ saved: true, report: Object.assign({}, row, { id: inserted.id }) });
  } catch (e) {
    return res.status(500).json({ error: "Scoring failed: " + (e.message || e) });
  }
}
