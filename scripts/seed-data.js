/**
 * scripts/seed-data.js
 *
 * Seed script for the Cloudflare KV + R2 stores used by the showLandPaging Worker.
 *
 * This file is NOT executed automatically — it serves as:
 *   1. A reference mapping (LinkedIn URL → html filename).
 *   2. A set of copy-pasteable wrangler CLI commands to bulk-populate KV and R2
 *      once you have Cloudflare credentials configured.
 *
 * Prerequisites:
 *   npm install -g wrangler
 *   wrangler login
 *   (Update REPLACE_WITH_YOUR_KV_NAMESPACE_ID in cloudflare/wrangler.toml first)
 *
 * Run this script to print all wrangler commands to stdout:
 *   node scripts/seed-data.js
 */

// ── Seed mapping ──────────────────────────────────────────────────────────────
// Each entry maps an exact LinkedIn profile URL (used as the KV key)
// to the HTML filename stored in the R2 bucket (used as the KV value).
const SEED_MAPPINGS = [
    { linkedinUrl: 'https://linkedin.com/in/alice',   filename: 'alice.html'   },
    { linkedinUrl: 'https://linkedin.com/in/bob',     filename: 'bob.html'     },
    { linkedinUrl: 'https://linkedin.com/in/charlie', filename: 'charlie.html' },
    { linkedinUrl: 'https://linkedin.com/in/diana',   filename: 'diana.html'   },
    { linkedinUrl: 'https://linkedin.com/in/eve',     filename: 'eve.html'     },
];

const R2_BUCKET_NAME = 'html-assets';
const KV_BINDING     = 'LINKEDIN_MAPPING_KV';
const DUMMY_HTML_DIR = './dummy-html';

// ── Print wrangler commands ───────────────────────────────────────────────────
console.log('# ── Step 1: Upload HTML files to R2 ──────────────────────────────────────────');
console.log('# Run from the cloudflare/ directory (where wrangler.toml lives).\n');

SEED_MAPPINGS.forEach(({ filename }) => {
    console.log(
        `wrangler r2 object put ${R2_BUCKET_NAME}/${filename} --file ${DUMMY_HTML_DIR}/${filename}`
    );
});

console.log('\n# ── Step 2: Write LinkedIn URL → filename mappings to KV ─────────────────────');
console.log('# Each key is the exact LinkedIn URL; value is the R2 filename.\n');

SEED_MAPPINGS.forEach(({ linkedinUrl, filename }) => {
    // Shell-quote the URL so special characters (:, /) are handled correctly.
    console.log(
        `wrangler kv key put --binding=${KV_BINDING} "${linkedinUrl}" "${filename}"`
    );
});

console.log('\n# ── Step 3: Verify KV entries ─────────────────────────────────────────────────\n');

SEED_MAPPINGS.forEach(({ linkedinUrl }) => {
    console.log(
        `wrangler kv key get --binding=${KV_BINDING} "${linkedinUrl}"`
    );
});

console.log('\n# Done. Deploy your Worker and test with:\n');
console.log('# node app.js   (from the project root)\n');
console.log('# Then open http://localhost:3000 and simulate with any LinkedIn URL above.\n');
