const winston = require('winston');
const config = require('../config/config');

const level = config.log_level;

const logger = winston.createLogger({
    level: level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
    ],
});

module.exports = logger;
