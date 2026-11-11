# Starts ROKI in the background (if it isn't running yet) and opens it in your browser.
# Used by "Open ROKI.cmd" in the ROKI folder.

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$url = 'http://localhost:8080'
$pidFile = Join-Path $root 'roki.pid'
$outLog = Join-Path $root 'roki-log.txt'
$errLog = Join-Path $root 'roki-errors.txt'
$fastify = Join-Path $root 'node_modules\fastify\package.json'

function Test-Roki {
	try {
		Invoke-WebRequest -Uri "$url/login" -UseBasicParsing -TimeoutSec 2 | Out-Null
		return $true
	} catch {
		return $false
	}
}

function Stop-WithMessage($message) {
	Write-Host ''
	Write-Host $message
	Read-Host 'Press Enter to close'
	exit 1
}

if (-not (Test-Roki)) {
	# First run (or after moving the folder): the packages need setting up
	if (-not (Test-Path $fastify)) {
		Write-Host 'Getting ROKI ready. The first time takes a minute...'
		$modules = Join-Path $root 'node_modules'
		if (Test-Path $modules) { cmd /c rmdir /s /q "$modules" }
		# --ignore-workspace: your home folder has its own pnpm workspace, and ROKI must not be installed as part of it
		if (Get-Command pnpm -ErrorAction SilentlyContinue) { & pnpm install --ignore-workspace } else { & npm install }
		if (-not (Test-Path $fastify)) {
			Stop-WithMessage "Couldn't set up ROKI's packages. Check your internet connection, then double-click Open ROKI again."
		}
	}

	$node = Get-Command node -ErrorAction SilentlyContinue
	if (-not $node) {
		Stop-WithMessage 'Node.js is not installed. Install it from nodejs.org, then double-click Open ROKI again.'
	}

	Write-Host 'Starting ROKI...'
	$proc = Start-Process -FilePath $node.Source -ArgumentList 'src\index.js' -WorkingDirectory $root `
		-WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
	Set-Content -Path $pidFile -Value $proc.Id

	$started = $false
	for ($i = 0; $i -lt 40; $i++) {
		Start-Sleep -Milliseconds 500
		if (Test-Roki) { $started = $true; break }
		if ($proc.HasExited) { break }
	}
	if (-not $started) {
		Write-Host ''
		Write-Host "ROKI didn't start. This is what it said:"
		if (Test-Path $errLog) { Get-Content $errLog -Tail 15 }
		Stop-WithMessage 'Send a screenshot of this window if you need help.'
	}
}

# Open ROKI with its invite link (made on first run in roki-key.txt), which logs this browser in
$open = $url
$keyFile = Join-Path $root 'roki-key.txt'
if (Test-Path $keyFile) {
	$key = (Get-Content $keyFile -Raw).Trim()
	if ($key -match '^[A-Za-z0-9_-]{16,128}$') { $open = "$url/join/$key" }
}
Start-Process $open
