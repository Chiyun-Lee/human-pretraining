// Pure helpers for turning what a user pasted into a PDF address.
// No Deno-specific imports, so they are unit-tested with the app.

/** Turns a pasted URL, DOI or arXiv id into the web address to fetch, or null. */
export function toUrl(input: string): URL | null {
  const value = input.trim();
  const doi = value.match(/^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i);
  if (doi) return new URL(`https://doi.org/${doi[1]}`);
  const arxiv = value.match(/^(?:arxiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
  if (arxiv) return new URL(`https://arxiv.org/abs/${arxiv[1]}`);

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return isPublicHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Rejects addresses that point at this server or a private network. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return false;
  if (host.includes(":")) return false; // IPv6 literals are never needed for papers
  if (/\.(local|internal|localhost)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // IPv4 literals likewise
  return true;
}

const decode = (value: string) =>
  value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Reads a <meta name="..." content="..."> value, as publishers provide for Google Scholar. */
export function metaContent(html: string, name: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!new RegExp(`\\bname\\s*=\\s*["']${name}["']`, "i").test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (content) return decode(content[1] ?? content[2] ?? "").trim() || null;
  }
  return null;
}

export const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"

/** A readable title from the last part of a web address. */
export function titleFromUrl(url: URL): string {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? url.hostname);
  return last.replace(/\.pdf$/i, "") || url.hostname;
}

/** The PubMed Central id in a PMC article address, such as "PMC9197487". */
export function pmcIdFromUrl(url: URL): string | null {
  if (!/(^|\.)ncbi\.nlm\.nih\.gov$/.test(url.hostname) && url.hostname !== "europepmc.org") return null;
  return url.pathname.match(/\/(PMC\d+)(\/|$)/i)?.[1]?.toUpperCase() ?? null;
}

/** The DOI an address stands for, when the address itself gives it away. */
export function doiFromUrl(url: URL): string | null {
  const path = decodeURIComponent(url.pathname);
  if (url.hostname === "doi.org" || url.hostname === "dx.doi.org") return path.slice(1) || null;
  const embedded = path.match(/\b(10\.\d{4,9}\/[^\s?#]+?)(?:\/(?:full|pdf|abstract|epdf))?$/i);
  if (embedded) return embedded[1]!;
  // Oxford University Press article pages: /<journal>/article/<volume>/<issue>/<article id>/<number>
  const oup = url.hostname === "academic.oup.com" && path.match(/^\/([a-z]+)\/(?:advance-)?article\/(?:\d+\/)*([a-z]+\d+)\//i);
  return oup ? `10.1093/${oup[1]}/${oup[2]}` : null;
}

/** From a listing of PubMed Central's open-data bucket, the newest PDF for an article. */
export function newestPmcPdf(listingXml: string, pmcId: string): string | null {
  let best: { key: string; version: number } | null = null;
  for (const [, key] of listingXml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
    const version = key!.match(new RegExp(`^${pmcId}\\.(\\d+)/${pmcId}\\.\\1\\.pdf$`))?.[1];
    if (version && (!best || Number(version) > best.version)) best = { key: key!, version: Number(version) };
  }
  return best?.key ?? null;
}
