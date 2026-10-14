"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollerStats = void 0;
exports.startPoller = startPoller;
const config_1 = require("./config");
const railwayApi_1 = require("./railwayApi");
const printer_1 = require("./printer");
const logger_1 = require("./logger");
const pollingUrls = new Set();
exports.pollerStats = {
    getHealth() {
        const backends = (0, railwayApi_1.getBackendInstances)();
        const enabledBackends = backends.filter(b => b.enabled !== false);
        // Connected if at least one enabled backend is connected (or all if preferred, let's use some/any)
        const connected = enabledBackends.length > 0 ? enabledBackends.some(b => b.connected) : false;
        const totalJobs = backends.reduce((sum, b) => sum + b.jobsProcessed, 0);
        return {
            connected,
            jobsProcessed: totalJobs,
            backends: backends.map(b => ({
                name: b.name,
                url: b.url,
                enabled: b.enabled !== false,
                connected: b.connected,
                authenticated: b.authenticated,
                lastHeartbeat: b.lastHeartbeat,
                lastConnectedTime: b.lastConnectedTime,
                jobsProcessed: b.jobsProcessed
            }))
        };
    }
};
async function processJob(backend, job) {
    try {
        console.log(`\n[${backend.name}] [Job Received]\nJobId: ${job.JobId}\nPrinter: ${job.PrinterName || 'Receipt Printer'}\n`);
        // Connect & Print via TCP socket
        await (0, printer_1.sendToPrinter)(job.PrinterIp, job.PrinterPort, job.Content, job.JobId);
        // Report success to backend
        await backend.markComplete(job.JobId);
        logger_1.logger.info(`[${backend.name}] Job ${job.JobId} printed and reported completed successfully.`);
    }
    catch (err) {
        const errorMsg = err.message || 'TCP Socket Connection Failed';
        logger_1.logger.error(`[${backend.name}] Printing job ${job.JobId} failed: ${errorMsg}`);
        // Report failure to backend
        await backend.markFailed(job.JobId, errorMsg);
    }
}
async function pollBackend(backend) {
    if (backend.enabled === false)
        return;
    // Authenticate if not already authenticated
    if (!backend.authenticated) {
        const success = await backend.authenticate();
        if (!success) {
            logger_1.logger.warn(`[${backend.name}] Authentication failed. Will retry in the next cycle.`);
            return;
        }
    }
    try {
        const jobs = await backend.fetchPendingJobs();
        if (jobs.length > 0) {
            logger_1.logger.info(`[${backend.name}] Retrieved ${jobs.length} pending print job(s) from Railway.`);
            // Process all jobs in parallel
            await Promise.all(jobs.map(job => processJob(backend, job)));
        }
    }
    catch (err) {
        logger_1.logger.error(`[${backend.name}] Poll cycle encountered an error: ${err.message}`);
    }
}
async function pollCycle() {
    const backends = (0, railwayApi_1.getBackendInstances)();
    await Promise.all(backends.map(async (backend) => {
        if (backend.enabled === false)
            return;
        if (pollingUrls.has(backend.url))
            return; // Prevent concurrent cycles for same backend
        pollingUrls.add(backend.url);
        try {
            await pollBackend(backend);
        }
        finally {
            pollingUrls.delete(backend.url);
        }
    }));
    // Reschedule the polling cycle
    setTimeout(pollCycle, config_1.config.pollIntervalMs);
}
async function startPoller() {
    logger_1.logger.info('Initializing UniPro Print Bridge Poller...');
    const backends = (0, railwayApi_1.getBackendInstances)();
    logger_1.logger.info(`Found ${backends.length} configured backend(s). Initializing startup authentication...`);
    await Promise.all(backends.map(async (backend) => {
        if (backend.enabled === false)
            return;
        const success = await backend.authenticate();
        if (success) {
            logger_1.logger.info(`[${backend.name}] Successfully authenticated on startup.`);
        }
        else {
            logger_1.logger.warn(`[${backend.name}] Startup authentication failed. Will retry in background.`);
        }
    }));
    // Start the polling loop
    pollCycle();
}
