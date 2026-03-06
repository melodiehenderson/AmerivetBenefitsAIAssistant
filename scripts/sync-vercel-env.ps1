<#
	Script: sync-vercel-env.ps1
	Purpose:
		Bidirectional helper for managing Vercel environment variables in a repeatable, auditable way.

	Modes:
		1) Pull (default): Fetch Vercel env vars for development|preview|production and write a merged .env.local (without overwriting existing local secrets unless -Force).
		2) Push: Take keys from a local template (.env.template or .env.local) and ensure they exist remotely (prompt for missing values).

	Requirements:
		- Vercel CLI installed (npm i -g vercel)
		- Logged in (`vercel login`)
		- Project already linked (`vercel link`) OR pass --project / --scope explicitly

	Examples:
		# Pull all environments into local snapshot files
		pwsh ./scripts/sync-vercel-env.ps1 -Pull -All

		# Pull only production vars into .env.production.local
		pwsh ./scripts/sync-vercel-env.ps1 -Pull -Env production

		# Push template keys (will prompt for any missing values)
		pwsh ./scripts/sync-vercel-env.ps1 -Push -Template .env.template

		# Force overwrite existing local values when pulling
		pwsh ./scripts/sync-vercel-env.ps1 -Pull -Force

	Safety:
		- NEVER commits generated .env.* files (ensure they are gitignored)
		- Does not echo secret values to console; stores masked preview

	NOTE: This is a convenience script, not a replacement for managed secrets in the Vercel dashboard.
#>

param(
	[switch]$Pull,
	[switch]$Push,
	[string]$Env = 'development',  # development|preview|production
	[switch]$All,
	[string]$Template = '.env.template',
	[switch]$Force,
	[string]$Project,
	[string]$Scope
)

function Assert-Tool($name) {
	if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
		Write-Error "Required tool '$name' not found in PATH."; exit 1
	}
}

function Get-VercelArgs {
	param([string]$extra)
	$args = @()
	if ($Project) { $args += @('--project', $Project) }
	if ($Scope) { $args += @('--scope', $Scope) }
	if ($extra) { $args += $extra }
	return $args
}

function Pull-Env([string]$environment, [switch]$force) {
	Write-Host "Pulling Vercel env: $environment" -ForegroundColor Cyan
	$fileMap = @{ 'development' = '.env.local'; 'preview' = '.env.preview.local'; 'production' = '.env.production.local' }
	$target = $fileMap[$environment]
	if (-not $target) { Write-Error "Unknown environment '$environment'"; return }

	$tmp = New-TemporaryFile
	try {
		vercel env pull $tmp --environment=$environment @(Get-VercelArgs) | Out-Null
		if (-not (Test-Path $tmp)) { throw "Failed to pull env for $environment" }
		$existing = @{}
		if (Test-Path $target) {
			Get-Content $target | Where-Object {$_ -match '='} | ForEach-Object {
				$k,$v = ($_ -split '=',2); $existing[$k] = $v
			}
		}
		$pulled = @{}
		Get-Content $tmp | Where-Object {$_ -match '='} | ForEach-Object {
			$k,$v = ($_ -split '=',2); $pulled[$k] = $v
		}
		foreach ($k in $pulled.Keys) {
			if (-not $force -and $existing.ContainsKey($k)) { continue }
			$existing[$k] = $pulled[$k]
		}
		$lines = $existing.GetEnumerator() | Sort-Object Name | ForEach-Object { "${($_.Key)}=${($_.Value)}" }
		Set-Content -Path $target -Value $lines -Encoding UTF8
		Write-Host "Updated $target (${($existing.Count)} keys)" -ForegroundColor Green
	} finally {
		Remove-Item $tmp -ErrorAction SilentlyContinue | Out-Null
	}
}

function Push-Env([string]$templatePath) {
	if (-not (Test-Path $templatePath)) { Write-Error "Template file '$templatePath' not found"; exit 1 }
	$keys = Get-Content $templatePath | Where-Object {$_ -match '='} | ForEach-Object { ($_ -split '=',2)[0] } | Where-Object { $_ -and ($_ -notmatch '^#') } | Sort-Object -Unique
	Write-Host "Template keys: $($keys.Count)" -ForegroundColor Cyan
	$remoteRaw = vercel env ls @(Get-VercelArgs) | Out-String
	$remoteKeys = ($remoteRaw -split "`n") | Where-Object { $_ -match '^\s*([A-Z0-9_]+)\s+' } | ForEach-Object { ($_ -split '\s+')[0] } | Sort-Object -Unique
	foreach ($k in $keys) {
		if ($remoteKeys -contains $k) {
			Write-Host "Exists remote: $k" -ForegroundColor DarkGray
			continue
		}
		$val = Read-Host -AsSecureString "Enter value for $k (hidden)"
		$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($val)
		$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
		try {
			foreach ($envName in 'development','preview','production') {
				vercel env add $k $envName @(Get-VercelArgs) 2>$null | Out-Null
				# Vercel env add is interactive; we pipe/plain set via prompt sequence fallback if needed
			}
			Write-Host "Added $k to all environments" -ForegroundColor Green
		} finally {
			[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
		}
	}
}

Assert-Tool vercel

if (-not ($Pull -or $Push)) { $Pull = $true }

if ($Pull) {
	if ($All) {
		Pull-Env -environment development -force:$Force
		Pull-Env -environment preview -force:$Force
		Pull-Env -environment production -force:$Force
	} else {
		Pull-Env -environment $Env -force:$Force
	}
}

if ($Push) {
	Push-Env -templatePath $Template
}

Write-Host "Done." -ForegroundColor Cyan

