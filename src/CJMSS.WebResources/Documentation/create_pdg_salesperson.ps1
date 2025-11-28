
# Creates the pdg_salesperson table plus core columns using the Dataverse Web API.
# Usage:
#   $env:DATAVERSE_URL="https://org.crm.dynamics.com"
#   $token = (Get-Content token.txt) # bearer token with user_impersonation
#   ./create_pdg_salesperson.ps1 -EnvironmentUrl $env:DATAVERSE_URL -AccessToken $token
param(
    [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
    [Parameter(Mandatory = $true)][string]$AccessToken
)

$headers = @{
    Authorization      = "Bearer $AccessToken"
    "Content-Type"     = "application/json"
    "OData-MaxVersion" = "4.0"
    "OData-Version"    = "4.0"
}

function Invoke-DvApi {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("GET", "POST", "PATCH")] [string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        $Body = $null
    )

    $uri = "$EnvironmentUrl/api/data/v9.2/$Path"
    if ($Body) {
        $json = $Body | ConvertTo-Json -Depth 25
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Add-Attribute {
    param($Definition)
    Invoke-DvApi -Method POST -Path "EntityDefinitions(LogicalName='pdg_salesperson')/Attributes" -Body $Definition
}

# 1) Create the table
$entityDefinition = @{
    SchemaName             = "pdg_salesperson"
    DisplayName            = @{ LocalizedLabels = @(@{ Label = "Salesperson"; LanguageCode = 1033 }) }
    DisplayCollectionName  = @{ LocalizedLabels = @(@{ Label = "Salespeople"; LanguageCode = 1033 }) }
    Description            = @{ LocalizedLabels = @(@{ Label = "Hybrid salesperson (user or contact)"; LanguageCode = 1033 }) }
    OwnershipType          = "UserOwned"
    PrimaryNameAttribute   = "pdg_name"
    HasActivities          = $false
    HasNotes               = $true
}

Invoke-DvApi -Method POST -Path "EntityDefinitions" -Body $entityDefinition

# 2) Primary name
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.StringAttributeMetadata"
    SchemaName    = "pdg_name"
    LogicalName   = "pdg_name"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Name"; LanguageCode = 1033 }) }
    RequiredLevel = @{ Value = "ApplicationRequired" }
    MaxLength     = 150
}

# 3) Type (User/Contact)
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.PicklistAttributeMetadata"
    SchemaName    = "pdg_salespersontype"
    LogicalName   = "pdg_salespersontype"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Type"; LanguageCode = 1033 }) }
    RequiredLevel = @{ Value = "ApplicationRequired" }
    OptionSet     = @{
        Options = @(
            @{ Value = 100000000; Label = @{ LocalizedLabels = @(@{ Label = "System User"; LanguageCode = 1033 }) } },
            @{ Value = 100000001; Label = @{ LocalizedLabels = @(@{ Label = "Contact"; LanguageCode = 1033 }) } }
        )
    }
}

# 4) Is Salesman flag
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.BooleanAttributeMetadata"
    SchemaName    = "pdg_issalesman"
    LogicalName   = "pdg_issalesman"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Is Salesman"; LanguageCode = 1033 }) }
    RequiredLevel = @{ Value = "None" }
    DefaultValue  = $true
    OptionSet     = @{
        TrueOption  = @{ Value = 1; Label = @{ LocalizedLabels = @(@{ Label = "Yes"; LanguageCode = 1033 }) } }
        FalseOption = @{ Value = 0; Label = @{ LocalizedLabels = @(@{ Label = "No"; LanguageCode = 1033 }) } }
    }
}

# 5) Salesman Code
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.StringAttributeMetadata"
    SchemaName    = "pdg_salesmancode"
    LogicalName   = "pdg_salesmancode"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Salesman Code"; LanguageCode = 1033 }) }
    RequiredLevel = @{ Value = "None" }
    MaxLength     = 20
}

# 6) Salesman Category (lookup to pdg_accountcategory)
Add-Attribute @{
    "@odata.type"  = "Microsoft.Dynamics.CRM.LookupAttributeMetadata"
    SchemaName     = "pdg_salesmancategoryid"
    LogicalName    = "pdg_salesmancategoryid"
    DisplayName    = @{ LocalizedLabels = @(@{ Label = "Salesman Category"; LanguageCode = 1033 }) }
    Targets        = @("pdg_accountcategory")
    RequiredLevel  = @{ Value = "None" }
}

# 7) Commission Rate (%)
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.DecimalAttributeMetadata"
    SchemaName    = "pdg_commissionrate"
    LogicalName   = "pdg_commissionrate"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Commission Rate (%)"; LanguageCode = 1033 }) }
    RequiredLevel = @{ Value = "None" }
    MinValue      = 0
    MaxValue      = 100
    Precision     = 4
}

# 8) Zone (lookup to pdg_zone)
Add-Attribute @{
    "@odata.type"  = "Microsoft.Dynamics.CRM.LookupAttributeMetadata"
    SchemaName     = "pdg_zoneid"
    LogicalName    = "pdg_zoneid"
    DisplayName    = @{ LocalizedLabels = @(@{ Label = "Zone"; LanguageCode = 1033 }) }
    Targets        = @("pdg_zone")
    RequiredLevel  = @{ Value = "None" }
}

# 9) User (lookup)
Add-Attribute @{
    "@odata.type"  = "Microsoft.Dynamics.CRM.LookupAttributeMetadata"
    SchemaName     = "pdg_userid"
    LogicalName    = "pdg_userid"
    DisplayName    = @{ LocalizedLabels = @(@{ Label = "User"; LanguageCode = 1033 }) }
    Targets        = @("systemuser")
    RequiredLevel  = @{ Value = "None" }
}

# 11) Target Amount (money)
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.MoneyAttributeMetadata"
    SchemaName    = "pdg_targetamount"
    LogicalName   = "pdg_targetamount"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Target Amount"; LanguageCode = 1033 }) }
    MinValue      = 0
    MaxValue      = 100000000000
    Precision     = 2
    RequiredLevel = @{ Value = "None" }
}

# 12) YTD Sales (money)
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.MoneyAttributeMetadata"
    SchemaName    = "pdg_ytdsales"
    LogicalName   = "pdg_ytdsales"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "YTD Sales"; LanguageCode = 1033 }) }
    MinValue      = 0
    MaxValue      = 100000000000
    Precision     = 2
    RequiredLevel = @{ Value = "None" }
}

# 13) Legacy ID
Add-Attribute @{
    "@odata.type" = "Microsoft.Dynamics.CRM.StringAttributeMetadata"
    SchemaName    = "pdg_legacyid"
    LogicalName   = "pdg_legacyid"
    DisplayName   = @{ LocalizedLabels = @(@{ Label = "Legacy ID"; LanguageCode = 1033 }) }
    RequiredLevel = @{ Value = "None" }
    MaxLength     = 50
}

Write-Host "pdg_salesperson table created with core attributes." -ForegroundColor Green
