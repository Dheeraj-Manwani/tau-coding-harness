# Starts all four dev services, each in its own terminal.
#   web            -> pnpm dev   (vite)
#   api            -> bun run dev
#   ws-gateway     -> bun run dev
#   worker-service -> bun run dev
#
# Usage:  ./dev.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$services = @(
    @{ Name = "web";            Dir = "web";            Cmd = "pnpm dev" },
    @{ Name = "api";            Dir = "api";            Cmd = "bun run dev" },
    @{ Name = "ws-gateway";     Dir = "ws-gateway";     Cmd = "bun run dev" },
    @{ Name = "worker-service"; Dir = "worker-service"; Cmd = "bun run dev" }
)

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if ($wt) {
    # Windows Terminal: one window, four tabs.
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
