/**
 * showLandPaging — Cloudflare Worker
 *
 * Receives a POST request from the Node.js backend with a raw LinkedIn profile URL,
 * resolves it to an HTML filename via KV, fetches that file from R2, and
 * returns the raw HTML content.
 *
 * Bindings required (configure in wrangler.toml / Cloudflare dashboard):
 *   LINKEDIN_MAPPING_KV — KV namespace : linkedinUrl (key) → filename.html (value)
 *   HTML_ASSETS_BUCKET  — R2 bucket    : stores the personalised HTML files
 */

export default {
    /**
     * @param {Request} request
     * @param {{ LINKEDIN_MAPPING_KV: KVNamespace, HTML_ASSETS_BUCKET: R2Bucket }} env
     * @returns {Promise<Response>}
     */
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── 1. Parse linkedinUrl from request body ───────────────────────────────
        let linkedinUrl;
        try {
            const body = await request.json();
            linkedinUrl = body.linkedinUrl;
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!linkedinUrl || typeof linkedinUrl !== 'string') {
            return new Response(JSON.stringify({ error: 'Missing required field: linkedinUrl' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── 2. KV lookup: raw linkedinUrl → html filename ────────────────────────
        // KV key is the exact raw LinkedIn URL string (case-sensitive as stored).
        // Example key: "https://linkedin.com/in/alice"
        const filename = await env.LINKEDIN_MAPPING_KV.get(linkedinUrl);

        if (!filename) {
            return new Response(JSON.stringify({ error: `No mapping found for linkedinUrl: ${linkedinUrl}` }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── 3. R2 fetch: filename → HTML content ─────────────────────────────────
        const object = await env.HTML_ASSETS_BUCKET.get(filename);

        if (!object) {
            return new Response(JSON.stringify({ error: `File not found in R2: ${filename}` }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const html = await object.text();

        // ── 4. Return raw HTML to the Node.js backend ────────────────────────────
        return new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    },
};
