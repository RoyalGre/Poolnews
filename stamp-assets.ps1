<#
.SYNOPSIS
    Stamps a content hash onto every local asset link, so browsers pick up a
    new stylesheet or script the moment it changes.

.DESCRIPTION
    A browser caches assets/site.css and reuses it on the next visit. That is
    normally what you want -- but when the CSS changes, a visitor who has been
    to the site before keeps the OLD file against the NEW page, and the result
    is a page half-styled by a stylesheet that no longer matches it. Telling
    ten poolers to press Ctrl+F5 is not a fix.

    The fix is to change the URL whenever the file changes, because a URL the
    browser has never seen cannot be in its cache:

        assets/site.css  ->  assets/site.css?v=8f3c1a2b

    The tag is the first 8 hex characters of the file's SHA-256. That matters
    more than it looks: a hand-typed version number only works if someone
    remembers to bump it, and the one time it is forgotten is exactly the time
    something looks broken. A content hash cannot be forgotten -- edit the
    file and the tag changes by itself; leave it alone and the tag stays, so
    browsers keep using their cached copy and nothing is re-downloaded for no
    reason.

    Only local assets/ and data/ links are touched. Google Fonts and anything
    else remote is left alone.

    Safe to run any time: running it twice in a row changes nothing the second
    time. Run it after any change to a file under assets/ or data/, and always
    before pushing. update.ps1 calls it automatically once the data files have
    been rebuilt.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\stamp-assets.ps1

.EXAMPLE
    # Say what would change, without writing anything.
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\stamp-assets.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string[]] $Pages = @(),
    [switch]   $Quiet
)

$ErrorActionPreference = 'Stop'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }

if ($Pages.Count -eq 0) {
    # Every page that loads a local asset. pool-records.template.html is in the
    # list on purpose: build-report.py copies it verbatim, so stamping only the
    # generated page would be undone by the next rebuild.
    $Pages = @(
        'index.html', 'pool.html', 'standings.html', 'poolers.html',
        'funfacts.html', 'defi.html', 'defis.html', 'pool-records.html', 'pool-records.template.html'
    )
}

function Get-Tag([string] $Path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $hash  = $sha.ComputeHash($bytes)
        return -join ($hash[0..3] | ForEach-Object { $_.ToString('x2') })
    } finally { $sha.Dispose() }
}

# href="assets/site.css"  or  src="data/goals.js?v=deadbeef"
# Captures: 1 attribute, 2 path, 3 any existing ?v=...
$rx = [regex]'(href|src)="((?:assets|data)/[A-Za-z0-9._-]+)(\?v=[0-9a-f]+)?"'

$tagCache = @{}
$changed  = 0
$touched  = 0
$missing  = @()

foreach ($page in $Pages) {
    $path = Join-Path $root $page
    if (-not (Test-Path $path)) { continue }

    $text = [System.IO.File]::ReadAllText($path)

    $new = $rx.Replace($text, {
        param($m)
        $attr = $m.Groups[1].Value
        $rel  = $m.Groups[2].Value

        if (-not $tagCache.ContainsKey($rel)) {
            $assetPath = Join-Path $root ($rel -replace '/', '\')
            if (Test-Path $assetPath) {
                $tagCache[$rel] = Get-Tag $assetPath
            } else {
                # A link to a file that is not there is a broken page, not a
                # caching problem -- leave it exactly as it was and say so.
                $tagCache[$rel] = $null
                $script:missing += $rel
            }
        }

        $tag = $tagCache[$rel]
        if ($null -eq $tag) { return $m.Value }
        return '{0}="{1}?v={2}"' -f $attr, $rel, $tag
    })

    if ($new -ne $text) {
        if ($PSCmdlet.ShouldProcess($page, 'restamp asset links')) {
            [System.IO.File]::WriteAllText($path, $new, (New-Object System.Text.UTF8Encoding $false))
        }
        $changed++
        if (-not $Quiet) { Write-Host ("  {0}" -f $page) -ForegroundColor DarkGray }
    }
    $touched++
}

if ($missing.Count -gt 0) {
    $list = ($missing | Sort-Object -Unique) -join ', '
    Write-Host ("  ! linked but not on disk, left unstamped: {0}" -f $list) -ForegroundColor Yellow
}

if (-not $Quiet) {
    if ($changed -eq 0) {
        Write-Host ("Asset tags already current across {0} pages." -f $touched) -ForegroundColor Green
    } else {
        Write-Host ("Restamped {0} of {1} pages ({2} assets)." -f $changed, $touched, $tagCache.Count) -ForegroundColor Green
    }
}
