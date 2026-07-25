<#
.SYNOPSIS
  Config for Bethlehem Boom 10U. Writes to reports/ root (".") rather than a subfolder,
  since that's where this team's files already live and its team_summary.html URL is
  already shared with coaches — moving it would break that link.
#>

& "$PSScriptRoot\..\generate_team_reports.ps1" `
    -TeamName "Bethlehem Boom 10U" `
    -Coaches @("Bill Lynch", "Doron Bruns", "Kathleen Turner", "Katie Melnikoff", "Kayla Lupi") `
    -Players @(
        @{ Number = 1;  Name = "Maggie M";  Slug = "maggie_m" }
        @{ Number = 2;  Name = "Ellie T";   Slug = "ellie_t" }
        @{ Number = 3;  Name = "Clare C";   Slug = "clare_c" }
        @{ Number = 5;  Name = "Felicia A"; Slug = "felicia_a" }
        @{ Number = 10; Name = "Anya O";    Slug = "anya_o" }
        @{ Number = 12; Name = "Payton M";  Slug = "payton_m" }
        @{ Number = 16; Name = "Lucy L";    Slug = "lucy_l" }
        @{ Number = 23; Name = "Harper B";  Slug = "harper_b" }
        @{ Number = 25; Name = "Emily Y";   Slug = "emily_y" }
        @{ Number = 44; Name = "Chloe R";   Slug = "chloe_r" }
        @{ Number = 66; Name = "Madison W"; Slug = "madison_w" }
    ) `
    -OutDir "."
