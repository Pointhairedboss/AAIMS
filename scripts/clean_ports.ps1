# AAIMS Port Cleaning Helper
# Forcefully terminates any process holding ports 4000 (backend) or 5173 (frontend)

param(
    [int[]]$Ports = @(4000, 5173)
)

foreach ($port in $Ports) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                $pidToKill = $conn.OwningProcess
                if ($pidToKill -gt 0 -and $pidToKill -ne $PID) {
                    Write-Host "[clean_ports] Stopping process $pidToKill listening on port $port..."
                    Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                }
            }
        } else {
            Write-Host "[clean_ports] Port $port is clean."
        }
    } catch {
        Write-Warning "[clean_ports] Error checking port ${port}: $_"
    }
}
