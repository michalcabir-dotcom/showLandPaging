const { performance } = require('perf_hooks');
const express = require('express');
const config = require('../config/config');
const logger = require('../services/logger');
const { pushToSession } = require('../services/socket');

const router = express.Router();

const RB2B_SIMULATION_DELAY_MS = 2500;

/**
 * Calls the Cloudflare Worker with the raw LinkedIn URL and returns the HTML string.
 * The Worker does: linkedinUrl → KV lookup (filename) → R2 fetch (HTML content).
 *
 * @param {string} linkedinUrl
 * @returns {Promise<string>} raw HTML content
 * @throws {Error} with a `status` property when the Worker returns a non-2xx response
 */
const fetchHtmlFromWorker = async (linkedinUrl) => {
    const response = await fetch(config.cloudflare.workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedinUrl }),
    });

    if (!response.ok) {
        const err = new Error(`Cloudflare Worker returned ${response.status}`);
        err.status = response.status;
        throw err;
    }

    return response.text();
};

/**
 * Shared resolution logic used by both the real and mock webhook endpoints.
 * Fetches personalised HTML from the Cloudflare Worker, measures its latency,
 * and pushes the result to the correct frontend session via WebSocket.
 *
 * @param {string} linkedinUrl
 * @param {string} sessionId
 * @param {object} res - Express response object
 */
const resolveAndPush = async (linkedinUrl, sessionId, res) => {
    const startTime = performance.now();

    let html;
    try {
        html = await fetchHtmlFromWorker(linkedinUrl);
    } catch (err) {
        logger.error('Cloudflare Worker fetch failed', { linkedinUrl, status: err.status, error: err.message });

        if (err.status === 404) {
            return res.status(404).json({ error: `No content found for linkedinUrl "${linkedinUrl}"` });
        }
        return res.status(502).json({ error: 'Upstream Cloudflare Worker error' });
    }

    const resolutionLatency = performance.now() - startTime;
    logger.info('Cloudflare Worker fetch succeeded', { linkedinUrl, resolutionLatency });

    const pushed = pushToSession(sessionId, { html, linkedinUrl, resolutionLatency });
    if (!pushed) {
        logger.warn('Session not connected', { sessionId });
        return res.status(404).json({ error: 'Session not connected — WebSocket may not be ready yet' });
    }

    res.json({ ok: true });
};

/**
 * POST /webhook/rb2b
 *
 * Real RB2B server-to-server webhook endpoint.
 * RB2B calls this once it has identified the visitor, sending their LinkedIn URL.
 * The sessionId is extracted from the "Captured URL" field that RB2B includes —
 * the client embeds it as ?sid=SESSION_ID in the page URL via history.replaceState.
 *
 * Expected body: { "LinkedIn URL": string, "Captured URL": string, ... }
 */
router.post('/rb2b', async (req, res) => {
    const linkedinUrl = req.body['LinkedIn URL'];
    const capturedUrl = req.body['Captured URL'];
    logger.info('RB2B webhook received', { linkedinUrl, capturedUrl, body: req.body });

    if (!linkedinUrl) {
        logger.warn('Missing LinkedIn URL in webhook payload', { body: req.body });
        return res.status(400).json({ error: 'Missing required field: LinkedIn URL' });
    }

    // Extract sessionId from the ?sid= query param RB2B captured in the page URL
    let sessionId = null;
    if (capturedUrl) {
        try {
            sessionId = new URL(capturedUrl).searchParams.get('sid');
        } catch {
            logger.warn('Could not parse Captured URL', { capturedUrl });
        }
    }

    if (!sessionId) {
        logger.warn('No sessionId found in Captured URL', { capturedUrl });
        return res.status(400).json({ error: 'No sessionId found in Captured URL' });
    }

    await resolveAndPush(linkedinUrl, sessionId, res);
});

/**
 * POST /webhook/mock/simulate
 *
 * Local-testing convenience endpoint — simulates the real RB2B flow including:
 *   1. A 2500ms artificial delay (mirrors average RB2B identification time).
 *   2. The full Cloudflare Worker round-trip (KV lookup → R2 fetch → WebSocket push).
 *
 * The HTTP response is sent immediately (202 Accepted) so the browser is not
 * blocked during the delay — the result arrives later via WebSocket.
 *
 * Expected body: { linkedinUrl: string, sessionId: string }
 */
router.post('/mock/simulate', (req, res) => {
    const { linkedinUrl, sessionId } = req.body;
    logger.info('Mock webhook simulation triggered', { linkedinUrl, sessionId, delayMs: RB2B_SIMULATION_DELAY_MS });

    if (!linkedinUrl || !sessionId) {
        return res.status(400).json({ error: 'Missing required fields: linkedinUrl, sessionId' });
    }

    // Respond immediately so the browser is not blocked waiting for the delay + Worker round-trip.
    res.json({ ok: true, message: `Simulating RB2B delay of ${RB2B_SIMULATION_DELAY_MS}ms…` });

    // Fire-and-forget: delay simulates RB2B identification time, then resolve.
    setTimeout(() => {
        resolveAndPush(linkedinUrl, sessionId, {
            // Dummy res shim — the real response was already sent above.
            status: () => ({ json: (body) => logger.warn('resolveAndPush error after 202 already sent', body) }),
            json:   (body) => logger.warn('resolveAndPush completion after 202 already sent', body),
        });
    }, RB2B_SIMULATION_DELAY_MS);
});

module.exports = router;
