# Starts the dev services, each in its own terminal.
#   landing -> pnpm dev     (vite, http://localhost:5173)
#   web     -> pnpm dev     (vite, http://localhost:5174)
#   admin   -> pnpm dev     (vite, http://localhost:5175)
#   server  -> bun run dev  (api + worker + SSE in ONE process)
#
# Usage:  ./dev.ps1
#
# This used to launch api, ws-gateway and worker-service as three separate
# processes, which is the `master` (Redis) topology. On `economy` that layout is
# broken, not merely redundant: the event bus is `server/src/lib/bus.ts`, plain
# in-memory EventEmitters. Run in separate processes they would get separate
# buses, so the api would never dispatch a job the worker could see and worker
# events would never reach the SSE stream. `server/src/index.ts` is the only
# correct way to run the backend.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$services = @(
    @{ Name = "landing"; Dir = "landing"; Cmd = "pnpm dev" },
    @{ Name = "web";    Dir = "web";    Cmd = "pnpm dev" },
    @{ Name = "admin";  Dir = "admin";  Cmd = "pnpm dev" },
    @{ Name = "server"; Dir = "server"; Cmd = "bun run dev" }
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
