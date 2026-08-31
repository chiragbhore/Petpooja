import { supabaseAdmin } from "../../lib/supabaseAdmin";

async function requireAdmin(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Not signed in.", status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { error: "Session invalid.", status: 401 };
  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", data.user.id).single();
  if (profile?.role !== "admin") return { error: "Admins only.", status: 403 };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const gate = await requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { questionId } = req.body || {};
  if (!questionId) return res.status(400).json({ error: "Missing questionId." });

  const { data: question, error: qErr } = await supabaseAdmin.from("quiz_questions").select("*").eq("id", questionId).single();
  if (qErr || !question) return res.status(404).json({ error: "Question not found." });

  const { data: allQuestions } = await supabaseAdmin.from("quiz_questions").select("*").eq("quiz_id", question.quiz_id);
  const { data: quiz } = await supabaseAdmin.from("quizzes").select("pass_percent").eq("id", question.quiz_id).single();
  const { data: attempts } = await supabaseAdmin
    .from("quiz_attempts").select("*")
    .eq("quiz_id", question.quiz_id)
    .in("status", ["pending_review", "completed"]);

  let updatedCount = 0;
  for (const attempt of attempts || []) {
    const answers = attempt.answers || {};
    let correctCount = 0;

    for (const q of allQuestions || []) {
      if (q.question_type === "screenshot") {
        const reviewEntry = (attempt.ai_review || []).find((r) => r.questionId === q.id);
        if (reviewEntry) {
          const finalCorrect = reviewEntry.adminOverride !== null && reviewEntry.adminOverride !== undefined ? reviewEntry.adminOverride : reviewEntry.correct;
          if (finalCorrect) correctCount += 1;
        }
      } else {
        const a = answers[q.id];
        const correctSet = new Set(Array.isArray(q.correct_indices) ? q.correct_indices : [q.correct_index]);
        if (q.multi_correct) {
          const chosen = new Set(a?.chosenIndices || []);
          const matches = chosen.size === correctSet.size && [...chosen].every((i) => correctSet.has(i));
          if (matches) correctCount += 1;
        } else {
          if (a?.chosenIndex !== undefined && correctSet.has(a.chosenIndex)) correctCount += 1;
        }
      }
    }

    const total = (allQuestions || []).length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed = score >= (quiz?.pass_percent || 70);

    await supabaseAdmin.from("quiz_attempts").update({ score, passed }).eq("id", attempt.id);
    updatedCount += 1;
  }

  return res.status(200).json({ ok: true, attemptsUpdated: updatedCount });
}
