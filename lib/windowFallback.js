'use strict';
// Plan B: when CDP is unavailable, read the Steam foreground window title via
// Win32 and try to resolve a game name -> appid through Steam's search endpoint.
// Less reliable (no appid guarantee); used only if CDP fails.

const { execFile } = require('child_process');

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$h = [Win32Fg]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][Win32Fg]::GetWindowText($h, $sb, 512)
$pid2 = 0
[void][Win32Fg]::GetWindowThreadProcessId($h, [ref]$pid2)
$proc = ""
try { $proc = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch {}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output ($proc + "\`t" + $sb.ToString())
`;

function getForegroundWindow() {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) return resolve({ process: null, title: null });
        const line = stdout.trim();
        const tab = line.indexOf('\t');
        if (tab === -1) return resolve({ process: null, title: line || null });
        resolve({ process: line.slice(0, tab).trim() || null, title: line.slice(tab + 1).trim() || null });
      }
    );
  });
}

async function searchAppid(name) {
  if (!name) return null;
  try {
    const url = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(name)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arr = await res.json();
    if (Array.isArray(arr) && arr.length > 0 && arr[0].appid) {
      return { appid: String(arr[0].appid), name: arr[0].name || name };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Best-effort guess of the game the user is viewing in Steam.
// Returns { appid, title } or null.
async function getFallbackGame() {
  const fg = await getForegroundWindow();
  if (!fg.process || !/steam/i.test(fg.process)) return null; // Steam must be foreground
  const title = fg.title;
  if (!title || /^steam$/i.test(title.trim())) return null; // generic shell title, no game
  const hit = await searchAppid(title);
  if (!hit) return null;
  return { appid: hit.appid, title: hit.name };
}

module.exports = { getForegroundWindow, searchAppid, getFallbackGame };
