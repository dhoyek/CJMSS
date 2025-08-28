(async () => {
    const serviceRoot = Xrm.Utility.getGlobalContext().getClientUrl() + "/api/data/v9.2/";
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    };

    try {
        console.log("🏗️ Creating pdg_bin table...");

        // 1. Create the main entity
        const entityDefinition = {
            "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
            LogicalName: "pdg_bin",
            DisplayName: { UserLocalizedLabel: { Label: "Bin", LanguageCode: 1033 }, LocalizedLabels: [{ Label: "Bin", LanguageCode: 1033 }] },
            DisplayCollectionName: { UserLocalizedLabel: { Label: "Bins", LanguageCode: 1033 }, LocalizedLabels: [{ Label: "Bins", LanguageCode: 1033 }] },
            Description: { UserLocalizedLabel: { Label: "Storage bin location for inventory management", LanguageCode: 1033 }, LocalizedLabels: [{ Label: "Storage bin location for inventory management", LanguageCode: 1033 }] },
            OwnershipType: "OrganizationOwned",
            IsAvailableOffline: true,
            HasActivities: false,
            HasNotes: true,
            AutoRouteToOwnerQueue: false,
            CanCreateAttributes: true,
            CanCreateCharts: true,
            CanCreateForms: true,
            CanCreateViews: true,
            CanModifyAdditionalSettings: true,
            // Define the Primary Name Attribute (what users see in lookups)
            Attributes: [
                {
                    "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                    LogicalName: "pdg_bincode",
                    SchemaName: "pdg_bincode",
                    DisplayName: { UserLocalizedLabel: { Label: "Bin Code", LanguageCode: 1033 } },
                    Description: { UserLocalizedLabel: { Label: "Unique bin code/identifier - Primary name field", LanguageCode: 1033 } },
                    RequiredLevel: { Value: "ApplicationRequired" },
                    MaxLength: 50,
                    FormatName: { Value: "Text" },
                    IsPrimaryName: true  // This makes it the Primary Name Field
                }
            ]
        };

        const createEntityResponse = await fetch(serviceRoot + "EntityDefinitions", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(entityDefinition)
        });

        if (!createEntityResponse.ok) {
            const errorText = await createEntityResponse.text();
            throw new Error(`Failed to create entity: ${errorText}`);
        }

        console.log("✅ Entity created successfully");

        // 2. Wait a moment for entity creation to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 3. Create additional custom attributes (pdg_bincode is already created as Primary Name Field)
        const attributes = [
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_bindescription",
                DisplayName: { UserLocalizedLabel: { Label: "Bin Description", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Optional descriptive name for the bin", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 200,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                LogicalName: "pdg_warehouseid",
                DisplayName: { UserLocalizedLabel: { Label: "Warehouse", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Reference to warehouse", LanguageCode: 1033 } },
                RequiredLevel: { Value: "ApplicationRequired" },
                Targets: ["pdg_warehouse"]
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_aisle",
                DisplayName: { UserLocalizedLabel: { Label: "Aisle", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Aisle identifier", LanguageCode: 1033 } },
                RequiredLevel: { Value: "Recommended" },
                MaxLength: 20,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_row",
                DisplayName: { UserLocalizedLabel: { Label: "Row", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Row identifier within aisle", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 20,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_shelf",
                DisplayName: { UserLocalizedLabel: { Label: "Shelf", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Shelf identifier", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 20,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_position",
                DisplayName: { UserLocalizedLabel: { Label: "Position", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Specific position on shelf", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 20,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_zone",
                DisplayName: { UserLocalizedLabel: { Label: "Zone", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Zone classification (A/B/C)", LanguageCode: 1033 } },
                RequiredLevel: { Value: "Recommended" },
                MaxLength: 10,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_rack",
                DisplayName: { UserLocalizedLabel: { Label: "Rack", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Rack identifier", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 20,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
                LogicalName: "pdg_bintype",
                DisplayName: { UserLocalizedLabel: { Label: "Bin Type", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Type of bin", LanguageCode: 1033 } },
                RequiredLevel: { Value: "Recommended" },
                OptionSet: {
                    "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
                    Name: "pdg_bintype",
                    DisplayName: { UserLocalizedLabel: { Label: "Bin Type", LanguageCode: 1033 } },
                    Description: { UserLocalizedLabel: { Label: "Type of storage bin", LanguageCode: 1033 } },
                    OptionSetType: "Picklist",
                    IsGlobal: false,
                    Options: [
                        { Value: 1, Label: { UserLocalizedLabel: { Label: "Standard", LanguageCode: 1033 } } },
                        { Value: 2, Label: { UserLocalizedLabel: { Label: "Quarantine", LanguageCode: 1033 } } },
                        { Value: 3, Label: { UserLocalizedLabel: { Label: "Damaged", LanguageCode: 1033 } } },
                        { Value: 4, Label: { UserLocalizedLabel: { Label: "Return", LanguageCode: 1033 } } },
                        { Value: 5, Label: { UserLocalizedLabel: { Label: "Overflow", LanguageCode: 1033 } } },
                        { Value: 6, Label: { UserLocalizedLabel: { Label: "Pick", LanguageCode: 1033 } } },
                        { Value: 7, Label: { UserLocalizedLabel: { Label: "Reserve", LanguageCode: 1033 } } }
                    ]
                },
                DefaultFormValue: 1
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_capacity",
                DisplayName: { UserLocalizedLabel: { Label: "Capacity", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Maximum storage capacity", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_currentoccupancy",
                DisplayName: { UserLocalizedLabel: { Label: "Current Occupancy", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Current storage usage", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                LogicalName: "pdg_capacityuom",
                DisplayName: { UserLocalizedLabel: { Label: "Capacity UOM", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Unit of measure for capacity", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Targets: ["uom"]
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_length",
                DisplayName: { UserLocalizedLabel: { Label: "Length (mm)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Physical length", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_width",
                DisplayName: { UserLocalizedLabel: { Label: "Width (mm)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Physical width", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_height",
                DisplayName: { UserLocalizedLabel: { Label: "Height (mm)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Physical height", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_volume",
                DisplayName: { UserLocalizedLabel: { Label: "Volume (mm³)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Calculated volume", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_weightcapacity",
                DisplayName: { UserLocalizedLabel: { Label: "Weight Capacity (kg)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Maximum weight capacity", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 2,
                MinValue: 0,
                MaxValue: 999999
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_barcode",
                DisplayName: { UserLocalizedLabel: { Label: "Barcode", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Scannable barcode for bin", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 100,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                LogicalName: "pdg_qrcode",
                DisplayName: { UserLocalizedLabel: { Label: "QR Code", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "QR code data", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 500,
                FormatName: { Value: "Text" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
                LogicalName: "pdg_isactive",
                DisplayName: { UserLocalizedLabel: { Label: "Is Active", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Whether bin is active", LanguageCode: 1033 } },
                RequiredLevel: { Value: "ApplicationRequired" },
                DefaultValue: true,
                OptionSet: {
                    TrueOption: { Value: 1, Label: { UserLocalizedLabel: { Label: "Yes", LanguageCode: 1033 } } },
                    FalseOption: { Value: 0, Label: { UserLocalizedLabel: { Label: "No", LanguageCode: 1033 } } }
                }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
                LogicalName: "pdg_isrestricted",
                DisplayName: { UserLocalizedLabel: { Label: "Is Restricted", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Requires special authorization", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                DefaultValue: false,
                OptionSet: {
                    TrueOption: { Value: 1, Label: { UserLocalizedLabel: { Label: "Yes", LanguageCode: 1033 } } },
                    FalseOption: { Value: 0, Label: { UserLocalizedLabel: { Label: "No", LanguageCode: 1033 } } }
                }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_temperature",
                DisplayName: { UserLocalizedLabel: { Label: "Temperature (°C)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Required temperature", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 1,
                MinValue: -50,
                MaxValue: 100
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
                LogicalName: "pdg_humidity",
                DisplayName: { UserLocalizedLabel: { Label: "Humidity (%)", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Required humidity level", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Precision: 1,
                MinValue: 0,
                MaxValue: 100
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
                LogicalName: "pdg_notes",
                DisplayName: { UserLocalizedLabel: { Label: "Notes", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Additional notes", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                MaxLength: 2000
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
                LogicalName: "pdg_lastcountdate",
                DisplayName: { UserLocalizedLabel: { Label: "Last Count Date", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Last physical count date", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                DateTimeBehavior: { Value: "UserLocal" },
                Format: { Value: "DateAndTime" }
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                LogicalName: "pdg_lastcountby",
                DisplayName: { UserLocalizedLabel: { Label: "Last Count By", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "User who did last count", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                Targets: ["systemuser"]
            },
            {
                "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
                LogicalName: "pdg_nextcyclecount",
                DisplayName: { UserLocalizedLabel: { Label: "Next Cycle Count", LanguageCode: 1033 } },
                Description: { UserLocalizedLabel: { Label: "Next scheduled count", LanguageCode: 1033 } },
                RequiredLevel: { Value: "None" },
                DateTimeBehavior: { Value: "UserLocal" },
                Format: { Value: "DateAndTime" }
            }
        ];

        // Create attributes one by one
        for (let i = 0; i < attributes.length; i++) {
            const attr = attributes[i];
            console.log(`📝 Creating attribute ${i + 1}/${attributes.length}: ${attr.LogicalName}`);

            try {
                const response = await fetch(serviceRoot + "EntityDefinitions(LogicalName='pdg_bin')/Attributes", {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify(attr)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`⚠️ Failed to create ${attr.LogicalName}: ${errorText}`);
                } else {
                    console.log(`✅ Created ${attr.LogicalName}`);
                }

                // Small delay between attribute creation
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`❌ Error creating ${attr.LogicalName}:`, error.message);
            }
        }

        console.log("🎉 pdg_bin table creation completed!");
        console.log("📋 Next steps:");
        console.log("1. Publish customizations");
        console.log("2. Create ALTERNATE KEY: pdg_bincode + pdg_warehouseid (for compound uniqueness)");
        console.log("   - Go to table settings > Keys > New alternate key");
        console.log("   - Add both pdg_bincode and pdg_warehouseid fields");
        console.log("3. Create forms and views for the bin entity");
        console.log("4. Update other tables to use bin lookups");
        console.log("");
        console.log("🔑 Key Points:");
        console.log("- pdg_bincode is the Primary Name Field (shows in lookups)");
        console.log("- Same bin codes allowed across different warehouses");
        console.log("- Alternate key prevents duplicate bin codes within same warehouse");

    } catch (error) {
        console.error("❌ Error creating pdg_bin table:", error.message);
    }
})();