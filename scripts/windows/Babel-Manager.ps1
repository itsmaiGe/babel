<#
  Babel — Discord translator plugin: Windows graphical manager.

  A tiny WinForms window with Install / Uninstall buttons, for users who don't
  want a terminal. WinForms ships with every Windows install, so no Node.js and
  no build toolchain are required. Launch it by double-clicking Babel.bat.
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

$form = New-Object System.Windows.Forms.Form
$form.Text = "Babel · 巴别"
$form.ClientSize = New-Object System.Drawing.Size(460, 340)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$iconPath = Join-Path $scriptDir "babel.ico"
if (Test-Path $iconPath) {
  try { $form.Icon = New-Object System.Drawing.Icon($iconPath) } catch { }
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "Babel · 巴别"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 18)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Discord 翻译插件 · 安装 / 卸载"
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(22, 50)
$form.Controls.Add($subtitle)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "操作完成后,请完全退出 Discord(托盘图标右键 > Quit Discord)再重新打开。"
$hint.AutoSize = $false
$hint.Location = New-Object System.Drawing.Point(22, 74)
$hint.Size = New-Object System.Drawing.Size(420, 20)
$hint.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($hint)

$installBtn = New-Object System.Windows.Forms.Button
$installBtn.Text = "安装 Install"
$installBtn.Size = New-Object System.Drawing.Size(205, 44)
$installBtn.Location = New-Object System.Drawing.Point(22, 104)
$form.Controls.Add($installBtn)

$uninstallBtn = New-Object System.Windows.Forms.Button
$uninstallBtn.Text = "卸载 Uninstall"
$uninstallBtn.Size = New-Object System.Drawing.Size(205, 44)
$uninstallBtn.Location = New-Object System.Drawing.Point(233, 104)
$form.Controls.Add($uninstallBtn)

$output = New-Object System.Windows.Forms.TextBox
$output.Multiline = $true
$output.ReadOnly = $true
$output.ScrollBars = "Vertical"
$output.Font = New-Object System.Drawing.Font("Consolas", 9)
$output.Location = New-Object System.Drawing.Point(22, 160)
$output.Size = New-Object System.Drawing.Size(416, 160)
$form.Controls.Add($output)

function Invoke-Action {
  param([string]$scriptName, [string]$label)
  $installBtn.Enabled = $false
  $uninstallBtn.Enabled = $false
  $output.Text = "正在$label ...`r`n"
  $form.Refresh()
  try {
    $result = & (Join-Path $scriptDir $scriptName) *>&1 | Out-String
    $output.AppendText($result)
    $output.AppendText("`r`n✅ $label 完成。请完全退出并重启 Discord。")
  } catch {
    $output.AppendText("❌ 出错:" + $_.Exception.Message)
  } finally {
    $installBtn.Enabled = $true
    $uninstallBtn.Enabled = $true
  }
}

$installBtn.Add_Click({ Invoke-Action -scriptName "Install-Babel.ps1" -label "安装" })
$uninstallBtn.Add_Click({ Invoke-Action -scriptName "Uninstall-Babel.ps1" -label "卸载" })

[void]$form.ShowDialog()
$form.Dispose()
