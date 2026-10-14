const https = require('https');
const http = require('http');
const net = require('net');

const CONFIG = {
  storeId: 'STORE_001',
  bridgeToken: 'unipro-pos-bridge-token-2026',
  pollIntervalMs: 1200,
  backends: [
    { name: 'RN POS Railway', url: 'https://kiosk-app-production-511f.up.railway.app' },
    { name: 'Local Backend', url: 'http://localhost:5000' },
    { name: 'QR POS Railway', url: 'https://online-qr-production.up.railway.app' },
    { name: 'ISLAND CAR WASH', url: 'https://smokedb-demo-production.up.railway.app' }
  ]
};

function formatThermalText(rawText) {
  let esc = Buffer.from([0x1B, 0x40]); // ESC @ (init)
  const lines = (rawText || '').split('\n');
  for (const line of lines) {
    if (line.trim() === '') {
      esc = Buffer.concat([esc, Buffer.from('\n')]);
      continue;
    }
    let clean = line;
    let align = Buffer.from([0x1B, 0x61, 0x00]); // left default
    if (clean.startsWith('[C]')) {
      align = Buffer.from([0x1B, 0x61, 0x01]); // center
      clean = clean.substring(3);
    } else if (clean.startsWith('[R]')) {
      align = Buffer.from([0x1B, 0x61, 0x02]); // right
      clean = clean.substring(3);
    } else if (clean.startsWith('[L]')) {
      clean = clean.substring(3);
    }

    const isBold = /<B>/i.test(clean);
    clean = clean.replace(/<\/?B>/gi, '');

    const isBig = /size=['"]big['"]/i.test(clean);
    clean = clean.replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '');

    const boldCode = Buffer.from([0x1B, 0x45, isBold ? 0x01 : 0x00]);
    const sizeCode = Buffer.from([0x1D, 0x21, isBig ? 0x11 : 0x00]);

    esc = Buffer.concat([esc, align, boldCode, sizeCode, Buffer.from(clean + '\n', 'utf8')]);
  }
  // Feed 3 lines and cut
  esc = Buffer.concat([esc, Buffer.from([0x1B, 0x64, 0x03, 0x1D, 0x56, 0x42, 0x00])]);
  return esc;
}

// Global printer locks to ensure we NEVER open multiple concurrent TCP connections to the same thermal printer
const printerLocks = new Map();

function sendToPrinter(targetIp, targetPort, content) {
  // If target IP is offline (192.168.0.245), fallback to online thermal printer (192.168.0.199)
  const ip = (targetIp === '192.168.0.245') ? '192.168.0.199' : targetIp;
  const port = targetPort || 9100;

  return new Promise((resolve) => {
    // Wait for existing connection to this IP to release
    const acquireLock = () => {
      if (printerLocks.get(ip)) {
        setTimeout(acquireLock, 150);
        return;
      }
      printerLocks.set(ip, true);

      const socket = new net.Socket();
      socket.setTimeout(5000);

      const cleanup = (res) => {
        try { socket.destroy(); } catch (e) {}
        // Hold lock for a brief pause so printer buffer flushes before next connection
        setTimeout(() => {
          printerLocks.delete(ip);
          resolve(res);
        }, 300);
      };

      socket.connect(port, ip, () => {
        console.log(`[TCP PRINTER] Connected to ${ip}:${port} (target was ${targetIp})`);
        const data = formatThermalText(content);
        socket.write(data, () => {
          console.log(`[TCP PRINTER] Bytes written successfully to ${ip}:${port}`);
          cleanup({ success: true });
        });
      });

      socket.on('error', (err) => {
        console.log(`[TCP PRINTER] Error on ${ip}:${port} -> ${err.message}`);
        cleanup({ success: false, error: err.message });
      });

      socket.on('timeout', () => {
        console.log(`[TCP PRINTER] Timeout on ${ip}:${port}`);
        cleanup({ success: false, error: 'Connection to printer timed out' });
      });
    };

    acquireLock();
  });
}

function apiRequest(baseUrl, path, method, body) {
  return new Promise((resolve) => {
    try {
      const isHttps = baseUrl.startsWith('https');
      const mod = isHttps ? https : http;
      const u = new URL(baseUrl + path);
      const postData = body ? JSON.stringify(body) : null;
      const req = mod.request(u, {
        method: method || 'GET',
        headers: {
          'authorization': 'Bearer ' + CONFIG.bridgeToken,
          'x-store-id': CONFIG.storeId,
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      if (postData) req.write(postData);
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

const activeJobs = new Set();

async function pollBackend(backend) {
  try {
    const res = await apiRequest(backend.url, '/api/print-jobs/pending?storeId=' + CONFIG.storeId);
    if (!res || !res.success || !Array.isArray(res.data) || res.data.length === 0) return;

    for (const job of res.data) {
      if (activeJobs.has(job.JobId)) continue;
      activeJobs.add(job.JobId);

      console.log(`[${backend.name}] Processing Job: ${job.JobId} for ${job.PrinterName} (${job.PrinterIp})`);
      const printResult = await sendToPrinter(job.PrinterIp, job.PrinterPort, job.Content);

      if (printResult.success) {
        console.log(`[${backend.name}] ✅ Job ${job.JobId} printed successfully!`);
        // Call correct completion endpoint: POST /api/print-jobs/:jobId/complete
        await apiRequest(backend.url, `/api/print-jobs/${job.JobId}/complete`, 'POST');
      } else {
        console.log(`[${backend.name}] ❌ Job ${job.JobId} failed: ${printResult.error}`);
        // Call correct failure endpoint: POST /api/print-jobs/:jobId/failed
        await apiRequest(backend.url, `/api/print-jobs/${job.JobId}/failed`, 'POST', { errorMessage: printResult.error });
      }
      activeJobs.delete(job.JobId);
    }
  } catch (err) {
    console.error('Error polling ' + backend.name + ':', err.message);
  }
}

async function loop() {
  for (const b of CONFIG.backends) {
    await pollBackend(b);
  }
  setTimeout(loop, CONFIG.pollIntervalMs);
}

console.log('🚀 UniPro Background Print Bridge Engine running 24/7 with auto-reroute and endpoint sync...');
loop();
