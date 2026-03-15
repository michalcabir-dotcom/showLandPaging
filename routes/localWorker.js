const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('../services/logger');

const router = express.Router();

/**
 * Local in-process mirror of the Cloudflare Worker.
 * Used automatically when CLOUDFLARE_WORKER_URL is not set.
 *
 * Replicates the Worker's exact logic:
 *   linkedinUrl → KV lookup (in-memory map) → R2 fetch (local dummy-html/ file)
 *
 * In production this route is never called — the real Cloudflare Worker handles it.
 */

const DUMMY_HTML_DIR = path.join(__dirname, '..', 'dummy-html');

// Local equivalent of the KV namespace (mirrors scripts/seed-data.js)
const LINKEDIN_KV_MAP = {
    'https://linkedin.com/in/alice':   'alice.html',
    'https://linkedin.com/in/bob':     'bob.html',
    'https://linkedin.com/in/charlie': 'charlie.html',
    'https://linkedin.com/in/diana':   'diana.html',
    'https://linkedin.com/in/eve':     'eve.html',
};

/**
 * POST /internal/worker
 *
 * Expected body: { linkedinUrl: string }
 * Returns:       raw HTML text (200) or JSON error (400 / 404)
 */
router.post('/', (req, res) => {
    const { linkedinUrl } = req.body;
    logger.debug('Local Worker received request', { linkedinUrl });

    if (!linkedinUrl || typeof linkedinUrl !== 'string') {
        return res.status(400).json({ error: 'Missing required field: linkedinUrl' });
    }

    // ── KV lookup — fall back to default.html for unrecognised visitors ────────
    const filename = LINKEDIN_KV_MAP[linkedinUrl] || 'default.html';
    if (!LINKEDIN_KV_MAP[linkedinUrl]) {
        logger.info('Local Worker: no specific mapping, serving default', { linkedinUrl });
    }

    // ── R2 fetch (reads from dummy-html/) ────────────────────────────────────
    const filePath = path.join(DUMMY_HTML_DIR, filename);
    if (!fs.existsSync(filePath)) {
        logger.warn('Local Worker: file not found in dummy-html', { filename, filePath });
        return res.status(404).json({ error: `File not found: ${filename}` });
    }

    const html = fs.readFileSync(filePath, 'utf8');
    logger.debug('Local Worker: serving file', { linkedinUrl, filename });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
});

module.exports = router;
