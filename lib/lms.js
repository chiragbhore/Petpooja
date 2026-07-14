import { supabase } from "./supabaseClient";

// Load an employee's assigned courses, their lessons, and completed set.
export async function loadEmployeeData(userId) {
  const { data: enr } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("user_id", userId);
  const courseIds = (enr || []).map((e) => e.course_id);
  if (courseIds.length === 0)
    return { courses: [], lessonsByCourse: {}, completed: new Set() };

  const { data: courses } = await supabase
    .from("courses")
    .select("*")
    .in("id", courseIds)
    .order("sort_order", { ascending: true });

  const { data: lessons } = await supabase
    .from("lessons")
    .select("*")
    .in("course_id", courseIds)
    .order("sort_order", { ascending: true });

  const { data: prog } = await supabase
    .from("lesson_progress")
    .select("lesson_id")
    .eq("user_id", userId);

  const completed = new Set((prog || []).map((p) => p.lesson_id));
  const lessonsByCourse = {};
  (lessons || []).forEach((l) => {
    (lessonsByCourse[l.course_id] = lessonsByCourse[l.course_id] || []).push(l);
  });
  return { courses: courses || [], lessonsByCourse, completed };
}

export function courseProgress(lessons, completed) {
  const total = lessons.length;
  const done = lessons.filter((l) => completed.has(l.id)).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Simple SVG progress ring
export function Ring({ value, size = 64, stroke = 7 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f3" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#d42b3a" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c - (value / 100) * c} strokeLinecap="round"
        />
      </svg>
      <span className="ring-num">{Math.round(value)}%</span>
    </span>
  );
}
