(async () => {
    // ------- SETTINGS -------
    const ENTITY_LOGICAL_NAME = "pdg_inventoryitem";   // change if needed
    const LCID = 1033; // label language (1033 = English). Change if you want localized labels.

    // ------- HELPERS -------
    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl(); // base URL (auth handled by app) [5](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/authenticate-web-api)
    const v = "v9.2"; // API version

    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    };

    const api = (path, init = {}) =>
        fetch(`${orgUrl}/api/data/${v}/${path}`, { headers, ...init })
            .then(async r => {
                if (!r.ok) {
                    const body = await r.text().catch(() => "");
                    throw new Error(`${init.method || "GET"} ${path} failed: ${r.status} ${r.statusText} ${body}`);
                }
                return r.status === 204 ? null : r.json();
            });

    const label = (text) => ({
        LocalizedLabels: [{ Label: text, LanguageCode: LCID }]
    });

    const toSchema = (logicalName) => {
        if (!logicalName.startsWith("pdg_")) return logicalName;
        const [prefix, ...rest] = logicalName.split("_");
        return prefix + "_" + rest.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    };

    // Quick check the entity exists (and to avoid typos)
    const entityDef = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId,EntitySetName`);
    const entitySetName = entityDef.EntitySetName;
    console.log(`Target entity: ${ENTITY_LOGICAL_NAME} (set: ${entitySetName})`); // [3](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api)

    // Check if an attribute already exists
    const attributeExists = async (attrLogicalName) => {
        try {
            // Direct addressing by logical name if present; returns 200 if it exists
            await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes(LogicalName='${attrLogicalName}')?$select=LogicalName`);
            return true;
        } catch {
            return false;
        }
    };

    // Create any non-lookup attribute
    const createAttribute = async (payload) => {
        const res = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, {
            method: "POST",
            body: JSON.stringify(payload)
        }); // POST …/EntityDefinitions(...)/Attributes [1](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api)
        return res;
    };

    // Create a lookup via OneToMany deep insert to RelationshipDefinitions
    const createLookup = async ({ schemaName, displayName, requiredLevel, description, targetTable, referencingNavName, referencedNavName }) => {
        const relationshipSchema = `${toSchema(targetTable)}_${toSchema(ENTITY_LOGICAL_NAME)}_${schemaName.replace(/^pdg_/, "")}`;
        const body = {
            "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            "SchemaName": relationshipSchema,
            "ReferencedEntity": targetTable,
            "ReferencingEntity": ENTITY_LOGICAL_NAME,
            "Lookup": {
                "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                "SchemaName": schemaName,
                "DisplayName": label(displayName),
                "RequiredLevel": { "Value": requiredLevel },
                "Description": label(description),
                "Targets": [targetTable]
            },
            // Reasonable defaults for required complex props
            "AssociatedMenuConfiguration": {
                "Behavior": "UseLabel",
                "Group": "Details",
                "Label": label(displayName),
                "Order": 10000
            },
            "CascadeConfiguration": {
                "Assign": "NoCascade",
                "Delete": "Referential",
                "Merge": "NoCascade",
                "Reparent": "NoCascade",
                "Share": "NoCascade",
                "Unshare": "NoCascade",
                "RollupView": "NoCascade"
            },
            ...(referencingNavName ? { "ReferencingEntityNavigationPropertyName": referencingNavName } : {}),
            ...(referencedNavName ? { "ReferencedEntityNavigationPropertyName": referencedNavName } : {})
        };
        // Create the relationship + lookup attribute in one POST (deep insert) [4](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-relationships-using-web-api)
        return api(`RelationshipDefinitions`, { method: "POST", body: JSON.stringify(body) });
    };

    // ---------- ATTRIBUTE PAYLOAD BUILDERS (Web API metadata types) ----------
    // Reference metadata entity types: StringAttributeMetadata, MemoAttributeMetadata, MoneyAttributeMetadata,
    // DecimalAttributeMetadata, IntegerAttributeMetadata, DateTimeAttributeMetadata, BooleanAttributeMetadata. [7](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/stringattributemetadata?view=dataverse-latest)
    const makeBoolean = (logical, display, required, desc) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        // Provide True/False labels for the two options [8](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/booleanattributemetadata?view=dataverse-latest)
        "OptionSet": {
            "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
            "TrueOption": { "Label": label("Yes"), "Value": 1 },
            "FalseOption": { "Label": label("No"), "Value": 0 }
        }
    });

    const makeString = (logical, display, required, desc, maxLen = 100) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MaxLength": maxLen // typical for string columns [7](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/stringattributemetadata?view=dataverse-latest)
    });

    const makeMemo = (logical, display, required, desc, maxLen = 2000) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MaxLength": maxLen // common memo length; format omitted (optional) [9](https://learn.microsoft.com/en-us/dotnet/api/microsoft.xrm.sdk.metadata.memoattributemetadata?view=dataverse-sdk-latest)
    });

    const makeMoney = (logical, display, required, desc, min = 0, max = 922337203685477, precision = 2) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MoneyAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MinValue": min,
        "MaxValue": max,
        "Precision": precision // defaults to 2 if not specified; set explicitly here. [10](https://learn.microsoft.com/en-us/dotnet/api/microsoft.xrm.sdk.metadata.moneyattributemetadata.precision?view=dataverse-sdk-latest)
    });

    const makeDecimal = (logical, display, required, desc, min = -100000000000, max = 100000000000, precision = 2) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MinValue": min,
        "MaxValue": max,
        "Precision": precision
    });

    const makeInteger = (logical, display, required, desc, min = -2147483648, max = 2147483647) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MinValue": min,
        "MaxValue": max
    });

    const makeDate = (logical, display, required, desc) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "Format": "DateOnly" // per your template; set to DateOnly vs. DateAndTime [1](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api)
    });

    // Map your “Business Recommended” → Web API value "Recommended", “Optional” → "None"
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    // ---------- YOUR FIELDS (Choice fields excluded on purpose) ----------
    const work = [];

    // Quality & Compliance (no choice fields)
    work.push(makeBoolean("pdg_qualitycontrolrequired", "Quality Control Required", RECOMMENDED, "Requires QC inspection"));
    work.push(makeBoolean("pdg_testcertificaterequired", "Test Certificate Required", RECOMMENDED, "Needs COA/COC"));
    work.push(makeBoolean("pdg_fdaregulated", "FDA Regulated", RECOMMENDED, "Subject to FDA rules"));
    work.push(makeBoolean("pdg_msdsrequired", "MSDS Required", RECOMMENDED, "Needs safety data sheet"));
    work.push(makeMemo("pdg_specialhandlinginstructions", "Special Handling", RECOMMENDED, "Handling requirements"));

    // Barcode & Analytics (no choice fields)
    work.push(makeString("pdg_supplierbarcode", "Supplier Barcode", RECOMMENDED, "Supplier's barcode"));
    work.push(makeMoney("pdg_annualusagevalue", "Annual Usage Value", RECOMMENDED, "Yearly usage cost"));
    work.push(makeDate("pdg_lastmovementdate", "Last Movement Date", RECOMMENDED, "Last transaction date"));

    // Advanced Barcode
    work.push(makeString("pdg_secondarybarcode", "Secondary Barcode", OPTIONAL, "Alternative barcode"));
    work.push(makeString("pdg_internalitemnumber", "Internal Item Number", OPTIONAL, "Internal reference"));
    work.push(makeString("pdg_alternativesku", "Alternative SKU", OPTIONAL, "Secondary SKU"));
    work.push(makeBoolean("pdg_autogeneratebarcode", "Auto Generate Barcode", OPTIONAL, "Auto-create from SKU"));
    work.push(makeString("pdg_barcode_scan", "Scan Barcode", OPTIONAL, "Temporary scanning field"));

    // Advanced Quality (lookup handled separately for QC Template)
    work.push(makeBoolean("pdg_quarantinerequired", "Quarantine Required", OPTIONAL, "Hold until cleared"));

    // Advanced Inventory
    work.push(makeBoolean("pdg_consignment", "Consignment Item", OPTIONAL, "Supplier-owned inventory"));

    // Advanced Ordering
    work.push(makeDecimal("pdg_maximumorderqty", "Maximum Order Quantity", OPTIONAL, "Largest order allowed"));
    work.push(makeDecimal("pdg_batchsize", "Batch Size", OPTIONAL, "Standard production batch"));
    work.push(makeDecimal("pdg_ordermultiple", "Order Multiple", OPTIONAL, "Order in multiples of"));
    work.push(makeInteger("pdg_planningtimefence", "Planning Time Fence", OPTIONAL, "Days for planning"));

    // Advanced Production
    work.push(makeBoolean("pdg_phantomitem", "Phantom Item", OPTIONAL, "Skip inventory level"));
    work.push(makeDecimal("pdg_setuptime", "Setup Time", OPTIONAL, "Setup time in minutes"));
    work.push(makeDecimal("pdg_cycletime", "Cycle Time", OPTIONAL, "Production time per unit"));
    work.push(makeMemo("pdg_productionnotes", "Production Notes", OPTIONAL, "Manufacturing notes"));

    // Advanced Analytics
    work.push(makeBoolean("pdg_fastmoving", "Fast Moving", OPTIONAL, "High turnover item"));
    work.push(makeBoolean("pdg_newitem", "New Item", OPTIONAL, "Recently introduced"));

    // Advanced Costing
    work.push(makeMoney("pdg_replacementcost", "Replacement Cost", OPTIONAL, "Current replacement cost"));

    // Dimensions (lookup handled separately for Weight UOM)
    work.push(makeDecimal("pdg_dimensionalweight", "Dimensional Weight", OPTIONAL, "Calculated shipping weight"));
    work.push(makeDecimal("pdg_length", "Length", OPTIONAL, "Item length"));
    work.push(makeDecimal("pdg_width", "Width", OPTIONAL, "Item width"));
    work.push(makeDecimal("pdg_height", "Height", OPTIONAL, "Item height"));
    work.push(makeDecimal("pdg_volume", "Volume", OPTIONAL, "Item volume"));

    // ---------- CREATE COLUMNS ----------
    let created = 0, skipped = 0, errors = 0;
    for (const payload of work) {
        const logicalName = payload.SchemaName.toLowerCase();
        if (await attributeExists(logicalName)) {
            console.log(`Skip (exists): ${logicalName}`);
            skipped++;
            continue;
        }
        try {
            await createAttribute(payload);
            console.log(`Created: ${logicalName}`);
            created++;
        } catch (e) {
            console.error(`Error creating ${logicalName}`, e);
            errors++;
        }
    }

    // ---------- LOOKUPS ----------
    // 1) QC Template: pdg_qualitycontroltemplateid -> pdg_qualitycontrol  (you confirmed the target table) 
    //    Created via deep-insert of OneToMany relationship + LookupAttributeMetadata. [4](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-relationships-using-web-api)
    const qcLookupLogical = "pdg_qualitycontroltemplateid";
    const qcSchema = toSchema(qcLookupLogical);
    const qcExists = await attributeExists(qcLookupLogical);
    if (!qcExists) {
        try {
            await createLookup({
                schemaName: qcSchema,
                displayName: "QC Template",
                requiredLevel: OPTIONAL,
                description: "QC template reference",
                targetTable: "pdg_qualitycontrol",
                referencingNavName: qcLookupLogical,  // navigation name on the referencing entity
                referencedNavName: `${ENTITY_LOGICAL_NAME}s` // plural-ish nav prop on the referenced entity
            });
            console.log(`Created lookup: ${qcLookupLogical} -> pdg_qualitycontrol`);
            created++;
        } catch (e) {
            console.error(`Error creating lookup ${qcLookupLogical}`, e);
            errors++;
        }
    } else {
        console.log(`Skip (exists): ${qcLookupLogical}`);
        skipped++;
    }

    // 2) Weight UOM: pdg_weightuom -> pdg_unitofmeasure
    const wLookupLogical = "pdg_weightuom";
    const wSchema = toSchema(wLookupLogical);
    const wExists = await attributeExists(wLookupLogical);
    if (!wExists) {
        try {
            await createLookup({
                schemaName: wSchema,
                displayName: "Weight UOM",
                requiredLevel: OPTIONAL,
                description: "Weight unit of measure",
                targetTable: "pdg_unitofmeasure",
                referencingNavName: wLookupLogical,
                referencedNavName: `${ENTITY_LOGICAL_NAME}s`
            });
            console.log(`Created lookup: ${wLookupLogical} -> pdg_unitofmeasure`);
            created++;
        } catch (e) {
            console.error(`Error creating lookup ${wLookupLogical}`, e);
            errors++;
        }
    } else {
        console.log(`Skip (exists): ${wLookupLogical}`);
        skipped++;
    }

    console.log(`Done. Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);

    // ---------- PUBLISH ----------
    // Use the Web API 'PublishAllXml' action so your new columns show up without manual publish. [6](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/publishallxml?view=dataverse-latest)[11](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-webapi/online/execute)
    const publishAllReq = {
        getMetadata: function () {
            return {
                boundParameter: null,
                parameterTypes: {},
                operationName: "PublishAllXml",
                operationType: 0 // Action
            };
        }
    };
    await Xrm.WebApi.online.execute(publishAllReq);
    console.log("Publish complete.");
})();
