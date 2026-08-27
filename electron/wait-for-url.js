const http = require('http');
const https = require('https');

function waitForUrl(targetUrl, timeoutMs = 30_000, intervalMs = 300) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const { protocol } = new URL(targetUrl);
    const requester = protocol === 'https:' ? https : http;

    const check = () => {
      const request = requester
        .get(targetUrl, (response) => {
          response.resume();
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400) {
            resolve();
          } else if (Date.now() - start >= timeoutMs) {
            reject(new Error(`Timed out waiting for ${targetUrl} to become ready.`));
          } else {
            setTimeout(check, intervalMs);
          }
        })
        .on('error', () => {
          if (Date.now() - start >= timeoutMs) {
            reject(new Error(`Timed out waiting for ${targetUrl} to become ready.`));
          } else {
            setTimeout(check, intervalMs);
          }
        });

      request.setTimeout(intervalMs, () => {
        request.destroy();
      });
    };

    check();
  });
}

module.exports = { waitForUrl };
