// Fetching a paper's PDF from the web. Uses only standard web APIs, so it is
// type-checked with the app and can be tried from Node.
import { doiFromUrl, isPdf, isPublicHost, metaContent, newestPmcPdf, pmcIdFromUrl } from "./resolve.ts";

const MAX_BYTES = 50 * 1024 * 1024;
async function get(url: URL): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; paper-reader/1.0)",
      accept: "text/html,application/pdf,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!isPublicHost(new URL(response.url).hostname)) throw new Error("redirected to a private address");
  return response;
}

async function readPdf(response: Response): Promise<Uint8Array | null> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length <= MAX_BYTES && isPdf(bytes) ? bytes : null;
}

export interface Found {
  pdf: Uint8Array | null;
  title: string | null;
  doi: string | null;
  /** Whether the address answered at all. */
  reached: boolean;
}

const PMC_BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com/";

/** An open-access article's PDF from PubMed Central's public data bucket, which is meant for programs. */
async function pmcPdf(pmcId: string): Promise<Uint8Array | null> {
  const listing = await get(new URL(`${PMC_BUCKET}?list-type=2&prefix=${pmcId}.`));
  const key = listing.ok ? newestPmcPdf(await listing.text(), pmcId) : null;
  if (!key) return null;
  const file = await get(new URL(PMC_BUCKET + key));
  return file.ok ? readPdf(file) : null;
}

/** Looks an article up by DOI in Europe PMC, for its PubMed Central id and title. */
async function lookUpDoi(doi: string): Promise<{ pmcId: string | null; title: string | null }> {
  const query = encodeURIComponent(`DOI:"${doi}"`);
  const response = await get(new URL(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=lite`));
  const result = response.ok ? (await response.json())?.resultList?.result?.[0] : null;
  return { pmcId: typeof result?.pmcid === "string" ? result.pmcid : null, title: typeof result?.title === "string" ? result.title.replace(/<[^>]+>/g, "") : null };
}

const attempt = <T>(task: Promise<T>): Promise<T | null> => task.catch(() => null);

/**
 * Finds the PDF behind an address. In order: PubMed Central's open-data copy
 * when the address is a PMC article; the address itself, or the PDF link in
 * the page's metadata; the publisher's page via the DOI; and PubMed Central's
 * copy looked up by DOI. Sites that put a browser check in front of their
 * pages are not worked around; the later routes cover many of them.
 */
export async function findPdf(url: URL): Promise<Found> {
  const pmcId = pmcIdFromUrl(url);
  const direct = pmcId ? await attempt(pmcPdf(pmcId)) : null;

  const page = await attempt(readPage(url));
  const pdf = direct ?? page?.pdf ?? null;
  let title = page?.title ?? null;
  const doi = page?.doi ?? doiFromUrl(url);
  if (pdf) return { pdf, title, doi, reached: true };

  if (doi) {
    const alreadyAtDoi = url.hostname === "doi.org";
    const viaPublisher = alreadyAtDoi ? null : await attempt(readPage(new URL(`https://doi.org/${doi}`)));
    title ??= viaPublisher?.title ?? null;
    if (viaPublisher?.pdf) return { pdf: viaPublisher.pdf, title, doi, reached: true };

    const found = await attempt(lookUpDoi(doi));
    title ??= found?.title?.replace(/\.$/, "") ?? null;
    const viaPmc = found?.pmcId ? await attempt(pmcPdf(found.pmcId)) : null;
    if (viaPmc) return { pdf: viaPmc, title, doi, reached: true };
  }
  return { pdf: null, title, doi, reached: page !== null || doi !== null };
}

interface Page {
  pdf: Uint8Array | null;
  title: string | null;
  doi: string | null;
}

/** Fetches one address: the PDF itself, or a web page and the PDF its metadata links to. */
async function readPage(url: URL): Promise<Page | null> {
  const page = await get(url);
  if (!page.ok) return null;
  if (!(page.headers.get("content-type") ?? "").includes("html")) {
    return { pdf: await readPdf(page), title: null, doi: null };
  }

  const html = await page.text();
  const doi = metaContent(html, "citation_doi")?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") ?? null;
  const link = metaContent(html, "citation_pdf_url");
  let pdf: Uint8Array | null = null;
  if (link) {
    const pdfUrl = new URL(link, page.url);
    const response = isPublicHost(pdfUrl.hostname) ? await attempt(get(pdfUrl)) : null;
    pdf = response?.ok ? await readPdf(response) : null;
  }
  return { pdf, title: metaContent(html, "citation_title"), doi };
}
