# Turns ROKI off. Used by "Stop ROKI.cmd" in the ROKI folder.

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'roki.pid'
$stopped = $false

if (Test-Path $pidFile) {
	$id = Get-Content $pidFile | Select-Object -First 1
	$proc = Get-Process -Id $id -ErrorAction SilentlyContinue
	if ($proc -and $proc.ProcessName -eq 'node') {
		Stop-Process -Id $id -Force
		$stopped = $true
	}
	Remove-Item $pidFile -ErrorAction SilentlyContinue
}

if ($stopped) {
	Write-Host 'ROKI is off.'
} else {
	Write-Host "ROKI wasn't running from Open ROKI. If you started it in a terminal, close that window instead."
}
Start-Sleep -Seconds 3
