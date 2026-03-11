const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config/config');
const logger = require('./services/logger');
const socket = require('./services/socket');
const webhookRoutes = require('./routes/webhook');
const localWorkerRoutes = require('./routes/localWorker');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/webhook', webhookRoutes);

// Local mock of the Cloudflare Worker — used automatically when
// CLOUDFLARE_WORKER_URL env var is not set (i.e. local development).
app.use('/internal/worker', localWorkerRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: config.app.name });
});

app.use((req, res) => {
    res.status(404).end();
});

const server = app.listen(config.port, () => {
    logger.info(`${config.app.name} server listening on port ${config.port}`);
});

socket.startIo(server);

process.on('uncaughtException', (err) => {
    logger.error('Caught uncaughtException', { error: err.message, stack: err.stack });
});

module.exports = app;
