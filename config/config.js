const config = {
    app: {
        name: 'showLandPaging',
    },
    port: process.env.PORT || 3000,
    log_level: process.env.LOG_LEVEL || 'debug',
    cloudflare: {
        // In production: set CLOUDFLARE_WORKER_URL to your deployed Worker URL.
        // Locally: defaults to the in-process mock Worker route — no Cloudflare account needed.
        workerUrl: process.env.CLOUDFLARE_WORKER_URL || 'http://localhost:3000/internal/worker',
    },
};

module.exports = config;
