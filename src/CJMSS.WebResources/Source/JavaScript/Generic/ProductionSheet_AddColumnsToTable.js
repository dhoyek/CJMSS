(async () => {
    // Adds all migration columns to pdg_productionsheet.
    // Run AFTER Production_AddGlobalChoices.js so pdg_ProductionCategory exists.
    const ENTITY_LOGICAL_NAME = "pdg_productionsheet";
    const ENTITY_SCHEMA_NAME = "pdg_ProductionSheet";
    const LCID = 1033;
    const API_VERSION = "v9.2";

    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl();
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    };

    const api = (path, init = {}) => fetch(`${orgUrl}/api/data/${API_VERSION}/${path}`, { headers, ...init })
        .then(async r => {
            if (!r.ok) {
                const body = await r.text().catch(() => "");
                throw new Error(`${init.method ?? "GET"} ${path} failed: ${r.status} ${r.statusText} ${body}`);
            }
            return r.status === 204 ? null : r.json();
        });

    const label = (text) => ({ LocalizedLabels: [{ Label: text, LanguageCode: LCID }] });

    // toSchema: pdg_myfieldname → pdg_Myfieldname
    // pdg_legacycostlbp → pdg_Legacycostlbp  (matches Dataverse convention for single-segment names)
    const toSchema = (logicalName) => {
        if (!logicalName.startsWith("pdg_")) return logicalName;
        const [prefix, ...rest] = logicalName.split("_");
        return prefix + "_" + rest.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    };

    const escapeODataString = (s) => String(s).replace(/'/g, "''");

    const attributeExists = async (logicalName) => {
        const res = await api(
            `EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes` +
            `?$select=LogicalName&$filter=LogicalName eq '${escapeODataString(logicalName)}'`
        );
        return Array.isArray(res?.value) && res.value.length > 0;
    };

    const createAttribute = async (payload) =>
        api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, {
            method: "POST",
            body: JSON.stringify(payload)
        });

    // ── Attribute builder helpers ─────────────────────────────────────────────

    const makeString = (logical, display, required, description, max = 100, formatName) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        ...(formatName ? { "FormatName": { "Value": formatName } } : {}),
        "MaxLength": max
    });

    const makeDecimal = (logical, display, required, description,
        min = -100000000000, max = 100000000000, precision = 8) => ({
            "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
            "SchemaName": toSchema(logical),
            "DisplayName": label(display),
            "RequiredLevel": { "Value": required },
            "Description": label(description),
            "MinValue": min,
            "MaxValue": max,
            "Precision": precision
        });

    const makeMoney = (logical, display, required, description) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MoneyAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        "PrecisionSource": 2    // 2 = inherits from currency record
    });

    const makeInteger = (logical, display, required, description,
        min = -2147483648, max = 2147483647) => ({
            "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
            "SchemaName": toSchema(logical),
            "DisplayName": label(display),
            "RequiredLevel": { "Value": required },
            "Description": label(description),
            "MinValue": min,
            "MaxValue": max
        });

    const makeDateTime = (logical, display, required, description) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        "Format": "DateAndTime"
    });

    const makeBoolean = (logical, display, required, description, defaultValue = false) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        "DefaultValue": defaultValue,
        "OptionSet": {
            "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
            "TrueOption": { "Value": 1, "Label": label("Yes") },
            "FalseOption": { "Value": 0, "Label": label("No") }
        }
    });

    // References an existing global choice by name — run AddGlobalChoices first
    const makePicklist = (logical, display, required, description, globalName, defaultValue) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        ...(typeof defaultValue === "number" ? { "DefaultFormValue": defaultValue } : {}),
        "OptionSet": {
            "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
            "IsGlobal": true,
            "Name": globalName
        }
    });

    // Creates a lookup via RelationshipDefinitions (same approach as sample)
    const ensureLookup = async ({ logical, display, description, targetTable, required = "None" }) => {
        if (await attributeExists(logical)) {
            console.log(`Skip (exists): ${logical}`);
            return;
        }
        const schemaName = toSchema(logical);
        const relationshipSchema =
            `${toSchema(targetTable)}_${toSchema(ENTITY_LOGICAL_NAME)}_${schemaName.replace(/^pdg_/, "")}`;
        const payload = {
            "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            "SchemaName": relationshipSchema,
            "ReferencedEntity": targetTable,
            "ReferencingEntity": ENTITY_LOGICAL_NAME,
            "Lookup": {
                "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
                "SchemaName": schemaName,
                "DisplayName": label(display),
                "RequiredLevel": { "Value": required },
                "Description": label(description),
                "Targets": [targetTable]
            },
            "AssociatedMenuConfiguration": {
                "Behavior": "UseLabel",
                "Group": "Details",
                "Label": label(display),
                "Order": 10000
            },
            "CascadeConfiguration": {
                "Assign": "NoCascade",
                "Delete": "RemoveLink",
                "Merge": "NoCascade",
                "Reparent": "NoCascade",
                "Share": "NoCascade",
                "Unshare": "NoCascade",
                "RollupView": "NoCascade"
            }
        };
        await api("RelationshipDefinitions", { method: "POST", body: JSON.stringify(payload) });
        console.log(`Created lookup: ${logical} -> ${targetTable}`);
        await new Promise(r => setTimeout(r, 300));
    };

    // ── Shorthand constants ───────────────────────────────────────────────────
    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    // ── Confirm entity exists ─────────────────────────────────────────────────
    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
    console.log(`Entity confirmed: ${ENTITY_LOGICAL_NAME}`);

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 1 — Client Lookup
    // Source: client (integer FK → account.pdg_legacyid)
    // Critical: links every production job to its ordering client
    // ─────────────────────────────────────────────────────────────────────────
    await ensureLookup({
        logical: "pdg_clientid",
        display: "Client",
        description: "Client who ordered this production job. Source: client column (Dolphin integer FK).",
        targetTable: "account",
        required: OPTIONAL
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 2 — Scalar attributes
    // Processed in a single loop; skipped individually if already present
    // ─────────────────────────────────────────────────────────────────────────
    const work = [

        // ── Operation tracking ────────────────────────────────────────────────
        // Source: opdate + optime combined ("16-Jan-97" + "11:33:42")
        makeDateTime(
            "pdg_operationdate",
            "Operation Date/Time",
            OPTIONAL,
            "Date and time the operator recorded completion. Migrated from opdate + optime columns."
        ),

        // Source: oper (integer, 12 distinct goldsmith/operator IDs)
        // Stored as string for portability; resolve to salesperson lookup post-migration if needed
        makeString(
            "pdg_legacyoperatorid",
            "Legacy Operator ID",
            OPTIONAL,
            "Dolphin operator/goldsmith ID from the oper column. Raw integer stored as text for future salesperson lookup resolution.",
            10
        ),

        // ── Production classification ─────────────────────────────────────────
        // Source: prdcat (9 values: OLJ, BTJE, PG, PGAL, CSNB, PGNB, OLJNB, BTJENB, CS)
        // Requires pdg_ProductionCategory global choice to exist first
        makePicklist(
            "pdg_productioncategory",
            "Production Category",
            OPTIONAL,
            "Production category from Dolphin legacy system (prdcat column). Classifies jewelry type and finish variant.",
            "pdg_ProductionCategory",
            100100000   // Default: OLJ
        ),

        // ── Posted flag ───────────────────────────────────────────────────────
        // Source: post (boolean — mirrors ended; preserved independently for audit trail)
        makeBoolean(
            "pdg_posted",
            "Posted",
            OPTIONAL,
            "Whether this production sheet was posted to accounts in Dolphin. Source: post column.",
            false
        ),

        // ── Reference strings ─────────────────────────────────────────────────
        // Source: quotation — 22,584 records populated (text reference, not FK)
        makeString(
            "pdg_quotationref",
            "Quotation Reference",
            OPTIONAL,
            "Sales quotation reference associated with this production job. Source: quotation column.",
            100
        ),

        // Source: design — 275 records populated
        makeString(
            "pdg_designref",
            "Design Reference",
            OPTIONAL,
            "Design template or drawing reference used for this job. Source: design column.",
            100
        ),

        // Source: mold — 781 records populated
        makeString(
            "pdg_moldref",
            "Mold Reference",
            OPTIONAL,
            "Mold or die reference used in casting. Source: mold column.",
            100
        ),

        // Source: marking — 23 records populated (e.g. '3007 IND', '301 INT')
        makeString(
            "pdg_marking",
            "Hallmark / Marking",
            OPTIONAL,
            "Hallmark or marking code applied to the piece. IND = indirect, INT = internal. Source: marking column.",
            50
        ),

        // ── Dolphin currency metadata ─────────────────────────────────────────
        // Source: cur (1=USD, 2=LBP, 3=SAR)
        // All Dataverse money fields are stored in USD; this preserves the original denomination
        makeInteger(
            "pdg_dolphincurrencycode",
            "Dolphin Currency Code",
            OPTIONAL,
            "Raw Dolphin currency code from the cur column (1=USD, 2=LBP, 3=SAR). Dataverse transactioncurrencyid is always set to USD for all migrated records.",
            0,
            9999
        ),

        // ── Local selling price (USD — native Dataverse Money field) ──────────
        // Source: lo_sp_f — local price in base/foreign currency
        // Separate from pdg_publicprice which receives the export price (ex_sp_f)
        makeMoney(
            "pdg_localpricef",
            "Local Price",
            OPTIONAL,
            "Local market selling price in USD (base currency). Source: lo_sp_f column. Distinct from export price (pdg_publicprice)."
        ),

        // ── Legacy raw Decimal fields ─────────────────────────────────────────
        // These preserve the original Dolphin values verbatim for audit and historical queries.
        // Named to match the pdg_inventoryitem convention exactly (pdg_legacycost*, pdg_legacyexport*, etc.)
        // Precision 8 to preserve full Dolphin decimal values.

        // Production cost
        makeDecimal(
            "pdg_legacycostforeign",
            "Cost (Foreign Raw)",
            OPTIONAL,
            "Raw legacy production cost in the foreign/base Dolphin currency (costf column). USD for LBP-denominated records.",
            -100000000000, 100000000000, 8
        ),
        makeDecimal(
            "pdg_legacycostlbp",
            "Cost (LBP Raw)",
            OPTIONAL,
            "Raw legacy production cost in Lebanese Pounds (costl column). Historical LBP value at time of production — preserved for audit only.",
            -100000000000, 100000000000, 8
        ),
        makeDecimal(
            "pdg_legacycostsecondary",
            "Cost (Secondary Raw)",
            OPTIONAL,
            "Raw legacy production cost in the secondary Dolphin currency (costs column). SAR for most records.",
            -100000000000, 100000000000, 8
        ),

        // Export selling price
        makeDecimal(
            "pdg_legacyexportpriceforeign",
            "Export Price (Foreign Raw)",
            OPTIONAL,
            "Raw legacy export selling price in the foreign/base Dolphin currency (ex_sp_f column).",
            -100000000000, 100000000000, 8
        ),
        makeDecimal(
            "pdg_legacyexportpricelbp",
            "Export Price (LBP Raw)",
            OPTIONAL,
            "Raw legacy export selling price in Lebanese Pounds (ex_sp_l column). Historical LBP value — preserved for audit only.",
            -100000000000, 100000000000, 8
        ),
        makeDecimal(
            "pdg_legacyexportpricesecondary",
            "Export Price (Secondary Raw)",
            OPTIONAL,
            "Raw legacy export selling price in secondary Dolphin currency (ex_sp_s column).",
            -100000000000, 100000000000, 8
        ),

        // Local selling price
        makeDecimal(
            "pdg_legacylocalpricef",
            "Local Price (Foreign Raw)",
            OPTIONAL,
            "Raw legacy local market selling price in the foreign/base Dolphin currency (lo_sp_f column).",
            -100000000000, 100000000000, 8
        ),
        makeDecimal(
            "pdg_legacylocalpricelbp",
            "Local Price (LBP Raw)",
            OPTIONAL,
            "Raw legacy local selling price in Lebanese Pounds (lo_sp_l column). Historical LBP value — preserved for audit only.",
            -100000000000, 100000000000, 8
        ),
        makeDecimal(
            "pdg_legacylocalpricesecondary",
            "Local Price (Secondary Raw)",
            OPTIONAL,
            "Raw legacy local selling price in secondary Dolphin currency (lo_sp_s column).",
            -100000000000, 100000000000, 8
        )
    ];

    // ── Process all scalar attributes ─────────────────────────────────────────
    for (const payload of work) {
        const logical = payload.SchemaName.toLowerCase();
        if (await attributeExists(logical)) {
            console.log(`Skip (exists): ${logical}`);
            continue;
        }
        console.log(`Creating: ${logical}`);
        await createAttribute(payload).catch(e => console.warn(`Failed ${logical}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }

    console.log([
        "",
        "pdg_productionsheet — migration columns complete.",
        "",
        "Summary of additions:",
        "  Lookups  : pdg_clientid → account",
        "  DateTime : pdg_operationdate",
        "  String   : pdg_legacyoperatorid, pdg_quotationref, pdg_designref, pdg_moldref, pdg_marking",
        "  Picklist : pdg_productioncategory  (global: pdg_ProductionCategory, starts 100100000)",
        "  Boolean  : pdg_posted",
        "  Integer  : pdg_dolphincurrencycode",
        "  Money    : pdg_localpricef",
        "  Decimal  : pdg_legacycostforeign, pdg_legacycostlbp, pdg_legacycostsecondary",
        "             pdg_legacyexportpriceforeign, pdg_legacyexportpricelbp, pdg_legacyexportpricesecondary",
        "             pdg_legacylocalpricef, pdg_legacylocalpricelbp, pdg_legacylocalpricesecondary",
        "",
        "Next step: build and run the SSIS package (PROD_Production_Migration.dtsx)."
    ].join("\n"));
})();