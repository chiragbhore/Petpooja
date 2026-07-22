import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "./supabaseClient";

function homeFor(role) {
  if (role === "admin") return "/admin";
  if (role === "trainer") return "/trainer";
  return "/employee";
}

// Guards a page. requireRole can be a single role ("admin"), or an array
// of allowed roles (["admin", "trainer"]) for pages shared by both staff
// tiers. Returns { loading, me }. Redirects to /login if not signed in,
// or to the correct home if the role doesn't match.
export function useProfile(requireRole) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (!active) return;

      if (!profile) {
        // Logged in but no profile row yet
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }
      if (requireRole) {
        const allowed = Array.isArray(requireRole) ? requireRole : [requireRole];
        if (!allowed.includes(profile.role)) {
          router.replace(homeFor(profile.role));
          return;
        }
      }
      setMe(profile);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [requireRole, router]);

  return { loading, me };
}

// True if this profile is allowed to manage a given content area.
// Admins can always do everything; trainers only if that flag is set.
export function hasPermission(me, key) {
  if (!me) return false;
  if (me.role === "admin") return true;
  if (me.role === "trainer") return !!(me.permissions && me.permissions[key]);
  return false;
}
