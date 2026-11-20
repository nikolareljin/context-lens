# Install or update the ContextLens Chrome extension (Windows PowerShell 5.1 or PowerShell 7).
#
#   irm https://raw.githubusercontent.com/nikolareljin/context-lens/main/scripts/extension-install.ps1 | iex
#
# 1. Downloads context-lens-extension.zip from the newest release, checks it against its
#    .sha256 and unpacks it into %USERPROFILE%\context-lens\extension (running it again updates it).
# 2. With Chromium or Chrome for Testing installed, starts it with the extension loaded, in its
#    own profile (%USERPROFILE%\context-lens\browser-profile). Nothing else to do.
# 3. Otherwise (Google Chrome no longer loads extensions from the command line), copies the
#    folder path, opens chrome://extensions and prints the four clicks that load it.
#
# Options through environment variables (the piped form takes no parameters):
#   CONTEXTLENS_VERSION=X.Y.Z  a given release instead of the newest
#   CONTEXTLENS_NO_LAUNCH=1    only print what to do
#   CONTEXTLENS_RELEASE_URL, CONTEXTLENS_BROWSER, CONTEXTLENS_CHROME: for tests

# Runs in its own scope, so the piped form leaves the PowerShell session as it was.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $ExtensionId = 'ibebpiolnohegpeabdgikjjnolphpbcd'
  $Releases = 'https://github.com/nikolareljin/context-lens/releases'
  $Help = 'https://nikolareljin.github.io/context-lens/docs/extension/'

  function Step([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }
  function Fail([string]$text) { Write-Host "context-lens: $text" -ForegroundColor Red; throw $text }

  $version = $env:CONTEXTLENS_VERSION
  if ($version -and $version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { Fail 'CONTEXTLENS_VERSION must look like 0.3.0' }
  $base = if ($env:CONTEXTLENS_RELEASE_URL) { $env:CONTEXTLENS_RELEASE_URL } elseif ($version) { "$Releases/download/$version" } else { "$Releases/latest/download" }
  $root = Join-Path $env:USERPROFILE 'context-lens'
  # A fixed folder: the only one this script ever replaces.
  $dir = Join-Path $root 'extension'
  $launch = $env:CONTEXTLENS_NO_LAUNCH -ne '1'

  # ---- download, check, unpack ---------------------------------------------------------------
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  # The download waits next to the install folder and is removed afterwards.
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $tmp = Join-Path $root ('.download-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Step "Downloading the ContextLens extension $version"
    $zip = Join-Path $tmp 'ext.zip'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$base/context-lens-extension.zip" -OutFile $zip
      $sumText = (Invoke-WebRequest -UseBasicParsing -Uri "$base/context-lens-extension.zip.sha256").Content
    } catch {
      $status = $null
      try { $status = [int]$_.Exception.Response.StatusCode } catch { }
      if ($status -eq 404) { Fail "$(if ($version) { $version } else { 'the newest release' }) has no Chrome extension yet; see $Help" }
      Fail "download failed from $base ($($_.Exception.Message))"
    }
    if ($sumText -is [byte[]]) { $sumText = [Text.Encoding]::ASCII.GetString($sumText) }
    $expected = ($sumText.Trim() -split '\s+')[0].ToLowerInvariant()
    if ($expected -notmatch '^[0-9a-f]{64}$') { Fail 'the checksum file is not valid' }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Fail 'checksum mismatch: the download is damaged or not the released file' }
    Write-Host 'checksum ok'

    $unpacked = Join-Path $tmp 'unpacked'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
    $manifestPath = Join-Path $unpacked 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { Fail 'the download is not the ContextLens extension' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($manifest.name -ne 'ContextLens') { Fail 'the download is not the ContextLens extension' }

    # Only a folder that holds an earlier copy of this extension (or nothing) is replaced.
    if (Test-Path -LiteralPath $dir) {
      $old = Join-Path $dir 'manifest.json'
      $isOurs = (Test-Path -LiteralPath $old) -and ((Get-Content -Raw -LiteralPath $old | ConvertFrom-Json).name -eq 'ContextLens')
      $isEmpty = -not (Get-ChildItem -Force -LiteralPath $dir | Select-Object -First 1)
      if (-not ($isOurs -or $isEmpty)) { Fail "$dir exists and is not a ContextLens extension folder; move it away and run this again" }
      Remove-Item -Recurse -Force -LiteralPath $dir
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dir) | Out-Null
    Move-Item -LiteralPath $unpacked -Destination $dir
    $dir = (Resolve-Path -LiteralPath $dir).Path
    Write-Host "ContextLens $($manifest.version) is in $dir"
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  }

  # ---- load it --------------------------------------------------------------------------------
  function First-Existing([string[]]$paths) {
    foreach ($p in $paths) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
    return $null
  }
  $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $loader = if ($env:CONTEXTLENS_BROWSER) { if ($env:CONTEXTLENS_BROWSER -eq 'none') { $null } else { $env:CONTEXTLENS_BROWSER } } else {
    $cft = @(Get-ChildItem -ErrorAction SilentlyContinue -LiteralPath (Join-Path $env:USERPROFILE '.cache\puppeteer\chrome') -Recurse -Filter chrome.exe | ForEach-Object FullName)
    First-Existing (@(
      (Join-Path $env:LOCALAPPDATA 'Chromium\Application\chrome.exe'),
      (Join-Path $env:ProgramFiles 'Chromium\Application\chrome.exe'),
      (Join-Path $env:LOCALAPPDATA 'Google\Chrome for Testing\Application\chrome.exe')
    ) + $cft)
  }
  $chrome = if ($env:CONTEXTLENS_CHROME) { if ($env:CONTEXTLENS_CHROME -eq 'none') { $null } else { $env:CONTEXTLENS_CHROME } } else {
    First-Existing @(
      (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
      $(if ($pf86) { Join-Path $pf86 'Google\Chrome\Application\chrome.exe' }),
      (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
      $(if ($pf86) { Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe' }),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
  }

  if ($loader) {
    $profileDir = Join-Path (Split-Path -Parent $dir) 'browser-profile'
    $arguments = @("--user-data-dir=`"$profileDir`"", "--load-extension=`"$dir`"", '--no-first-run', "chrome-extension://$ExtensionId/sidepanel.html")
    if ($launch) {
      Step "Starting $(Split-Path -Leaf $loader) with ContextLens loaded"
      Start-Process -FilePath $loader -ArgumentList $arguments | Out-Null
    } else {
      Step 'Start it with ContextLens loaded:'
    }
    Write-Host "  `"$loader`" --user-data-dir=`"$profileDir`" --load-extension=`"$dir`""
    Write-Host 'It uses its own profile, so your usual browser profile is left alone. The ContextLens page'
    Write-Host 'opens in a tab; for the side panel, click the puzzle icon, pin ContextLens and click its icon.'
    Write-Host 'To update later, run the same install command again and restart that browser.'
  } else {
    $copied = $false
    try { Set-Clipboard -Value $dir; $copied = $true } catch { }
    if ($launch -and $chrome) {
      Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions' | Out-Null
      Step 'Chrome is opening chrome://extensions. Load ContextLens there:'
    } else {
      Step 'Open chrome://extensions in Chrome (type it in the address bar), then:'
    }
    Write-Host '  1. Turn on "Developer mode" (the switch in the top-right corner).'
    Write-Host '  2. Click "Load unpacked" (top left).'
    if ($copied) {
      Write-Host '  3. Choose this folder (the path is already copied: click the folder bar at the top of the'
      Write-Host '     window, press Ctrl+V and Enter) and click "Select Folder":'
    } else {
      Write-Host '  3. Choose this folder and click "Select Folder":'
    }
    Write-Host "       $dir"
    Write-Host '  4. Click the puzzle icon next to the address bar, pin ContextLens, and click its icon'
    Write-Host '     to open the side panel.'
    Write-Host 'To update later: run the same install command again, then click the reload arrow on the'
    Write-Host 'ContextLens card in chrome://extensions.'
  }
  Write-Host ''
  Write-Host "Step-by-step guide: $Help"
}
