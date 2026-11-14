// Adds a paper to the caller's library from a pasted URL, DOI or arXiv id.
//   POST { input } -> { paper }
// See find.ts for the routes tried to reach the PDF.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { type Found, findPdf } from "./find.ts";
import { titleFromUrl, toUrl } from "./resolve.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const url = typeof body?.input === "string" ? toUrl(body.input) : null;
    if (!url) return fail(400, "invalid_input");

    let found: Found;
    try {
      found = await findPdf(url);
    } catch (error) {
      console.error(error);
      return fail(422, "fetch_failed");
    }
    if (!found.pdf) return fail(422, found.reached ? "no_pdf" : "fetch_failed");
    const pdf = found.pdf;
    const title = found.title ?? titleFromUrl(url);

    // Stored with the caller's own permissions, so the usual access rules apply.
    const id = crypto.randomUUID();
    const path = `${ctx.userClaims!.id}/${id}.pdf`;
    const upload = await ctx.supabase.storage.from("papers").upload(path, pdf, { contentType: "application/pdf" });
    if (upload.error) {
      console.error(upload.error);
      return fail(500, "storage_failed");
    }
    const { data: paper, error } = await ctx.supabase
      .from("papers")
      .insert({ id, title: title.slice(0, 300), file_path: path, source_url: url.href })
      .select("id, title, file_path, created_at")
      .single();
    if (error) {
      console.error(error);
      await ctx.supabase.storage.from("papers").remove([path]);
      return fail(500, "storage_failed");
    }
    return Response.json({ paper });
  }),
};
