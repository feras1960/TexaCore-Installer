'use strict';
// ════════════════════════════════════════════════════════════════
// tunnel-monitor — the HONEST state of the Cloudflare tunnel connector.
//
// 2.0.0 showed «متصل» whenever the local services ran, even with no cloudflared on the machine (Cloudflare error 1033 on the public link). The state the
// launcher shows now comes from here and only from here:
//
//   off         cloud access is not switched on (or there is no subdomain yet)
//   starting    the process is running but cloudflared has NOT yet logged a registered tunnel connection (and has not failed)
//   connected   the process is running AND cloudflared logged «Registered tunnel connection» (and has not unregistered all of them since)
//   error       the binary is missing / cannot run, the process exited, the token is invalid or refused, the edge is unreachable,
//               or no connection was registered within GRACE_MS — always with a reason code the window words for the user
//
// Pure: no I/O, no timers; time comes from `now()` so tests drive it. Lines are redacted before they are kept or logged.
// ════════════════════════════════════════════════════════════════
const GRACE_MS = 60 * 1000;
const KEEP_LINES = 20;

const ERROR_REASONS = ['binary_missing', 'binary_unrunnable', 'spawn_failed', 'token_invalid', 'token_rejected', 'exited', 'network', 'not_registered'];

/** Remove anything credential-shaped from a log line: the tunnel token itself, JWT / base64 blobs, long opaque runs. */
function redact(text, secrets = []) {
  let s = String(text == null ? '' : text);
  for (const sec of secrets) if (sec && String(sec).length >= 8) s = s.split(String(sec)).join('<token>');
  s = s.replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '<token>');
  s = s.replace(/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{60,}={0,2}(?![A-Za-z0-9+/=_-])/g, '<redacted>');
  s = s.replace(/(TUNNEL_TOKEN|--token|token)(\s*[=:]\s*)\S+/gi, '$1$2<token>');
  return s;
}

class TunnelMonitor {
  constructor({ now = Date.now, graceMs = GRACE_MS } = {}) {
    this._now = now;
    this._grace = graceMs;
    this.reset();
  }

  reset() {
    this.state = 'off';
    this.reason = null;          // 'disabled' | 'no_subdomain' | 'stub' | … while off; an ERROR_REASONS code while error
    this.detail = '';            // redacted one-liner for the window's tooltip / small text
    this.pid = null;
    this.version = null;
    this.binary = null;
    this.exitCode = null;
    this.signal = null;
    this.since = this._now();
    this.everConnected = false;
    this._conns = new Set();
    this._serverRejects = 0;
    this._netErrors = 0;
    this._lines = [];
    this._secrets = [];
  }

  /** Tokens (and other secrets) to scrub from every line this monitor sees. */
  setSecrets(list) { this._secrets = (list || []).filter(Boolean).map(String); }

  /** The tunnel is not wanted right now (cloud access off, no subdomain, stopped by the user). */
  off(reason = 'disabled') {
    this._conns.clear(); this._serverRejects = 0; this._netErrors = 0;
    this.state = 'off'; this.reason = reason; this.detail = ''; this.pid = null; this.since = this._now();
  }

  /** The process was spawned. */
  begin({ binary, version, pid } = {}) {
    this._conns.clear(); this._serverRejects = 0; this._netErrors = 0; this.everConnected = false;
    this.state = 'starting'; this.reason = null; this.detail = ''; this.exitCode = null; this.signal = null;
    this.binary = binary || null; this.version = version || null; this.pid = pid || null; this.since = this._now();
    this._lines = [];
  }

  /** Something prevented (or ended) the run: a reason code from ERROR_REASONS and a detail (redacted here). */
  fail(reason, detail = '') {
    if (!ERROR_REASONS.includes(reason)) reason = 'exited';
    this._conns.clear();
    this.state = 'error'; this.reason = reason; this.detail = redact(detail, this._secrets).slice(0, 300); this.since = this._now();
  }

  /** The process ended. `expected` = we stopped it (SIGTERM / SIGKILL from stopCloudflared). */
  exited({ code, signal, expected = false } = {}) {
    this.exitCode = code === undefined ? null : code;
    this.signal = signal || null;
    this.pid = null;
    if (expected || signal === 'SIGTERM' || signal === 'SIGKILL') { this.off('stopped'); return; }
    if (this.state === 'error' && (this.reason === 'token_invalid')) return;   // already explained; keep the sharper reason
    const last = this._lines.slice(-3).join(' | ');
    this.fail('exited', `exit code ${code}${signal ? `, signal ${signal}` : ''}${last ? ' — ' + last : ''}`);
  }

  /** One line of cloudflared's output (stdout or stderr). Returns the redacted line. */
  feed(rawLine) {
    const line = redact(String(rawLine).replace(/\r/g, '').trim(), this._secrets);
    if (!line) return '';
    this._lines.push(line); if (this._lines.length > KEEP_LINES) this._lines.shift();

    let m;
    if ((m = /Registered tunnel connection\b.*?connIndex=(\d+)/.exec(line)) || /Registered tunnel connection\b/.test(line)) {
      this._conns.add(m ? m[1] : String(this._conns.size));
      this._serverRejects = 0; this._netErrors = 0;
      this.everConnected = true;
      this.state = 'connected'; this.reason = null; this.detail = ''; this.since = this._now();
    } else if ((m = /Unregistered tunnel connection\b.*?connIndex=(\d+)/.exec(line)) || /Unregistered tunnel connection\b/.test(line)) {
      if (m) this._conns.delete(m[1]); else this._conns.clear();
      if (this._conns.size === 0 && this.state === 'connected') { this.state = 'starting'; this.since = this._now(); }
    } else if (/Provided Tunnel token is not valid/i.test(line)) {
      this.fail('token_invalid', line);
    } else if (/Register tunnel error from server side|Unauthorized|Failed to get tunnel|tunnel credentials/i.test(line) && /ERR|error=/.test(line)) {
      this._serverRejects++;
      if (this._conns.size === 0 && this._serverRejects >= 3) this.fail('token_rejected', line);
    } else if (/no such host|Unable to establish connection with Cloudflare edge|i\/o timeout|network is unreachable|connection refused|dial tcp .*: /i.test(line) && /ERR|WRN/.test(line)) {
      this._netErrors++;
      if (this._conns.size === 0 && this._netErrors >= 5 && this.state !== 'error') this.fail('network', line);
    }
    return line;
  }

  /** What the window shows. `starting` for longer than the grace period is an error. */
  snapshot() {
    if (this.state === 'starting' && this._now() - this.since > this._grace) {
      this.fail('not_registered', this._lines.slice(-2).join(' | '));
    }
    return {
      state: this.state, reason: this.reason, detail: this.detail, connections: this._conns.size, everConnected: this.everConnected,
      pid: this.pid, version: this.version, exitCode: this.exitCode, since: this.since,
      lastLines: this._lines.slice(-5),
    };
  }
}

module.exports = { TunnelMonitor, redact, ERROR_REASONS, GRACE_MS };
