const https = require('https');
const http = require('http');
const net = require('net');

const CONFIG = {
  storeId: 'STORE_001',
  bridgeToken: 'unipro-pos-bridge-token-2026',
  pollIntervalMs: 1200,
  backends: [
    { name: 'Kiosk Native Railway', url: 'https://kiosk-native-production.up.railway.app' }
  ]
};

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

function isUsbPrinterConnected(printerName = '') {
  if (process.platform !== 'win32') return false;
  // Fast Path 1: query Windows Registry directly via cmd in <50ms (never hangs/times out)
  try {
    const regCmd = 'cmd /c reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers" /s /f "Port"';
    const regOut = execSync(regCmd, { timeout: 4000 }).toString();
    if (regOut.includes('USB')) {
      if (!printerName || regOut.toLowerCase().includes(printerName.toLowerCase())) {
        return true;
      }
    }
  } catch (e) {}

  // Fallback 2: Get-Printer with 6000ms timeout
  try {
    const stdout = execSync('powershell -NoProfile -Command Get-Printer', { timeout: 6000 }).toString();
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      if (/USB/i.test(line)) {
        if (!printerName || line.toLowerCase().includes(printerName.toLowerCase())) {
          return true;
        }
      }
    }
  } catch (e) {
    return false;
  }
  return false;
}

function sendToWindowsSpooler(printerName, content) {
  return new Promise((resolve, reject) => {
    let cleanName = printerName.trim();
    if (cleanName.toLowerCase().startsWith('\\\\localhost\\')) {
      cleanName = cleanName.substring(13);
    } else if (cleanName.startsWith('\\\\')) {
      const parts = cleanName.split('\\').filter(Boolean);
      if (parts.length === 1) cleanName = parts[0];
    }

    if (!isUsbPrinterConnected(cleanName)) {
      const msg = `USB printer '${cleanName}' is NOT physically connected to this system. Printing skipped.`;
      console.warn(`[sendToWindowsSpooler] ${msg}`);
      return reject(new Error(msg));
    }

    const tmpFile = path.join(os.tmpdir(), `bridge_usb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.bin`);
    const payload = formatThermalText(content);

    try {
      fs.writeFileSync(tmpFile, payload);
    } catch (e) {
      return reject(e);
    }

    const safePrinterName = cleanName.replace(/'/g, "''");
    const safeFilePath = tmpFile.replace(/'/g, "''");

    const psScript = `
$p = '${safePrinterName}';
$f = '${safeFilePath}';
if (-not (Test-Path $f)) { exit 1 }
$b = [System.IO.File]::ReadAllBytes($f);
$c = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO1 { public string pDocName; public string pOutputFile; public string pDataType; }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, DOCINFO1 pDocInfo);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        DOCINFO1 di = new DOCINFO1(); di.pDocName = "Kiosk USB Receipt"; di.pDataType = "RAW";
        if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
        if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
        int written = 0; bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written);
        EndPagePrinter(hPrinter); EndDocPrinter(hPrinter); ClosePrinter(hPrinter);
        return ok && (written == bytes.Length);
    }
}
'@;
if (-not ([System.Management.Automation.PSTypeName]'RawPrinter').Type) { Add-Type -TypeDefinition $c }
if ([RawPrinter]::SendBytes($p, $b)) { Write-Host "SUCCESS" } else { Write-Host "FAILED"; exit 1 }
`;

    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err || stdout.trim() !== 'SUCCESS') {
        const errorMsg = stderr.trim() || stdout.trim() || (err ? err.message : 'Spooler failed');
        console.error(`[sendToWindowsSpooler] USB Printer '${cleanName}' print error:`, errorMsg);
        reject(new Error(errorMsg));
      } else {
        console.log(`[sendToWindowsSpooler] USB Printer '${cleanName}' print SUCCESS.`);
        resolve();
      }
    });
  });
}

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
  const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(String(targetIp || '').trim());
  if (!isIp) {
    const printerName = targetIp || 'TD80 Printer';
    console.log(`[USB PRINTER] Routing print to Windows Spooler: '${printerName}'`);
    return sendToWindowsSpooler(printerName, content)
      .then(() => ({ success: true }))
      .catch((err) => ({ success: false, error: err.message }));
  }

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
const completedJobIds = new Set();

async function pollBackend(backend) {
  try {
    const res = await apiRequest(backend.url, '/api/print-jobs/pending?storeId=' + CONFIG.storeId);
    if (!res || !res.success || !Array.isArray(res.data) || res.data.length === 0) return;

    for (const job of res.data) {
      if (activeJobs.has(job.JobId) || completedJobIds.has(job.JobId)) continue;
      activeJobs.add(job.JobId);

      console.log(`[${backend.name}] Processing Job: ${job.JobId} for ${job.PrinterName} (${job.PrinterIp})`);
      const printResult = await sendToPrinter(job.PrinterIp, job.PrinterPort, job.Content);

      if (printResult.success) {
        console.log(`[${backend.name}] ✅ Job ${job.JobId} printed successfully!`);
        completedJobIds.add(job.JobId);
        // Call completion endpoint on this backend and all shared backends
        for (const b of CONFIG.backends) {
          apiRequest(b.url, `/api/print-jobs/${job.JobId}/complete`, 'POST').catch(() => {});
        }
      } else {
        console.log(`[${backend.name}] ❌ Job ${job.JobId} failed: ${printResult.error}`);
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
