# Starts the dev services, each in its own terminal.
#   web       -> pnpm dev            (vite)
#   economy   -> bun run dev:economy (api + worker + SSE in ONE process)
#
# Usage:  ./dev.ps1
#
# This used to launch api, ws-gateway and worker-service as three separate
# processes, which is the `master` (Redis) topology. On `economy` that layout is
# broken, not merely redundant: both services' `lib/bus.ts` re-export
# `deploy/in-process-bus.ts`, which is plain in-memory EventEmitters. Run in
# separate processes they get separate buses, so the api never dispatches a job
# the worker can see and the worker's events never reach the api's SSE stream.
# `deploy/combined.ts` is the only correct way to run the backend here.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$services = @(
    @{ Name = "web";     Dir = "web"; Cmd = "pnpm dev" },
    @{ Name = "economy"; Dir = ".";   Cmd = "bun run dev:economy" }
)

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($wt) {
    # Windows Terminal: one window, one tab per service.
    $wtArgs = @()
    for ($i = 0; $i -lt $services.Count; $i++) {
        $s = $services[$i]
        $path = Join-Path $root $s.Dir
        if ($i -gt 0) { $wtArgs += ";" }
        $wtArgs += @(
            "new-tab", "--title", $s.Name, "-d", $path,
            "powershell", "-NoExit", "-Command", $s.Cmd
        )
    }
    & $wt.Source $wtArgs
} else {
    # Fallback: a separate PowerShell window per service.
    foreach ($s in $services) {
        $path = Join-Path $root $s.Dir
        Start-Process powershell -ArgumentList @(
            "-NoExit", "-Command",
            "Set-Location '$path'; Write-Host 'Starting $($s.Name)...' -ForegroundColor Cyan; $($s.Cmd)"
        )
    }
}

Write-Host "Launched: $($services.Name -join ', ')" -ForegroundColor Green
