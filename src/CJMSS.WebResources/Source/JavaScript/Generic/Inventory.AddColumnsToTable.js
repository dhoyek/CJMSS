(async () => {
    // =======================
    // SETTINGS
    // =======================
    const ENTITY_LOGICAL_NAME = "pdg_inventory"; // target table
    const LCID = 1033; // label language (1033 = English)
    const API_VERSION = "v9.2";

    // =======================
    // HELPERS
    // =======================
    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl();
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    };

    const api = (path, init = {}) =>
        fetch(`${orgUrl}/api/data/${API_VERSION}/${path}`, { headers, ...init })
            .then(async r => {
                if (!r.ok) {
                    const body = await r.text().catch(() => "");
                    throw new Error(`${init.method ?? "GET"} ${path} failed: ${r.status} ${r.statusText} ${body}`);
                }
                return r.status === 204 ? null : r.json();
            });

    const label = (text) => ({ LocalizedLabels: [{ Label: text, LanguageCode: LCID }] });

    const toSchema = (logicalName) => {
        if (!logicalName.startsWith("pdg_")) return logicalName;
        const [prefix, ...rest] = logicalName.split("_");
        return prefix + "_" + rest.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    };

    // Verify target table exists (helps catch typos early)
    const entityDef = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId,EntitySetName`);
    const entitySetName = entityDef.EntitySetName;
    console.log(`Target entity: ${ENTITY_LOGICAL_NAME} (set: ${entitySetName})`);

    // Escape single quotes for OData string literals
    const escapeODataString = (s) => String(s).replace(/'/g, "''");

    // Quiet existence check: uses $filter so it returns 200 with [] when missing (no 404 noise)
    const attributeExists = async (attrLogicalName) => {
        const safe = escapeODataString(attrLogicalName);
        const res = await api(
            `EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes` +
            `?$select=LogicalName&$filter=LogicalName eq '${safe}'`
        );
        return Array.isArray(res?.value) && res.value.length > 0;
    };

    // Create any non-lookup attribute
    const createAttribute = async (payload) =>
        api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, {
            method: "POST",
            body: JSON.stringify(payload)
        });

    // =======================
    // ATTRIBUTE BUILDERS
    // =======================
    const makeBoolean = (logical, display, required, desc) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
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
        "MaxLength": maxLen
    });

    const makeMemo = (logical, display, required, desc, maxLen = 262144) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MaxLength": maxLen // generous cap for JSON blobs
    });

    const makeMoney = (logical, display, required, desc, min = 0, max = 922337203685477, precision = 2) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MoneyAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MinValue": min,
        "MaxValue": max,
        "Precision": precision
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

    const makeDate = (logical, display, required, desc) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "Format": "DateOnly"
    });

    // =======================
    // REQUIRED LEVEL MAP
    // =======================
    // Your spec -> Dataverse RequiredLevel values
    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    // =======================
    // NEW FIELDS (NON-CHOICE, NON-LOOKUP, NON-CALCULATED)
    // =======================
    const work = [];

    // LOCATION & PHYSICAL MANAGEMENT
    work.push(makeString("pdg_aisle", "Aisle", RECOMMENDED, "Warehouse aisle/location code", 50));
    work.push(makeString("pdg_batchnumber", "Batch Number", REQUIRED, "Batch/Lot identifier for traceability", 100));
    work.push(makeString("pdg_barcodescan", "Barcode Scan", RECOMMENDED, "Captured barcode for fast lookups", 100));
    work.push(makeDate("pdg_manufacturingdate", "Manufacturing Date", RECOMMENDED, "Production/manufacturing date"));
    work.push(makeDate("pdg_receiptdate", "Receipt Date", REQUIRED, "Date item was received into inventory"));
    work.push(makeDate("pdg_expirydate", "Expiry Date", OPTIONAL, "Only for items with shelf life"));

    // ENHANCED QUANTITY MANAGEMENT
    work.push(makeDecimal("pdg_committedquantity", "Committed Quantity", REQUIRED, "Quantity committed to orders or work", -100000000000, 100000000000, 2));
    work.push(makeDecimal("pdg_damagedquantity", "Damaged Quantity", RECOMMENDED, "Quantity flagged as damaged", 0, 100000000000, 2));
    work.push(makeBoolean("pdg_belowminimum", "Below Minimum Stock", REQUIRED, "Triggers reorder alerts"));

    // WEIGHT & DIMENSIONS (JEWELRY-SPECIFIC)
    work.push(makeDecimal("pdg_grossweight", "Gross Weight (g)", REQUIRED, "Total weight incl. findings/stones", 0, 100000000000, 3));
    work.push(makeDecimal("pdg_netweight", "Net Weight (g)", REQUIRED, "