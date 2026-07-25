<#
.SYNOPSIS
  Config for Latham Lady Bison White 10U. Writes into its own subfolder
  (reports/latham-lady-bison-white-10u/) rather than the reports/ root, since that
  root is already Bethlehem Boom's namespace. Every NEW team after Bethlehem should
  follow this subfolder pattern.
#>

& "$PSScriptRoot\..\generate_team_reports.ps1" `
    -TeamName "Latham Lady Bison White 10U" `
    -Coaches @("TBD") `
    -Players @(
        @{ Number = 10; Name = "Emily C"; Slug = "emily_c" }
    ) `
    -OutDir "latham-lady-bison-white-10u"
