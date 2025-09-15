(async () => {
    // SETTINGS
    const ENTITY_LOGICAL_NAME = "pdg_purchaseorder";
    const LCID = 1033;
    const API_VERSION = "v9.2";

    // HELPERS
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
    const toSchema = (logical) => {
        if (!logical.startsWith("pdg_")) return logical;
        const [p, ...rest] = logical.split("_");
        return p + "_" + rest.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    };
    const escapeODataString = (s) => String(s).replace(/'/g, "''");
    const attributeExists = async (attr) => {
        const safe = escapeODataString(attr);
        const res = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes?$select=LogicalName&$filter=LogicalName eq '${safe}'`);
        return Array.isArray(res?.value) && res.value.length > 0;
    };
    const createAttribute = async (payload) => api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, { method: "POST", body: JSON.stringify(payload) });

    // BUILDERS
    const makeString = (logical, display, required, desc, maxLen = 100, formatName) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        ...(formatName ? { "FormatName": { "Value": formatName } } : {}),
        "MaxLength": maxLen
    });
    const makeMemo = (logical, display, required, desc, maxLen = 262144) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MaxLength": maxLen
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
    const makeInteger = (logical, display, required, desc, min = -2147483648, max = 2147483647) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "MinValue": min,
        "MaxValue": max
    });
    const makeDateOnly = (logical, display, required, desc) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "Format": "DateOnly"
    });
    const makeDateTime = (logical, display, required, desc) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "Format": "DateAndTime"
    });

    // REQUIRED LEVEL MAP
    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    // FIELDS (exclude lookups and choice fields per instructions)
    const work = [];
    work.push(makeDateOnly("pdg_expecteddeliverydate", "Expected Delivery Date", OPTIONAL, "Overall ETA from vendor confirmation"));
    work.push(makeDateOnly("pdg_requesteddeliverydate", "Requested Delivery Date", OPTIONAL, "Business-requested date"));
    work.push(makeString("pdg_paymenttermsnotes", "Payment Terms Notes", OPTIONAL, "Override or additional payment terms notes", 200));
    work.push(makeMemo("pdg_specialinstructions", "Special Instructions", OPTIONAL, "Delivery / packing / site notes", 4000));
    work.push(makeInteger("pdg_printcount", "Print Count", OPTIONAL, "Number of times the PO was printed", 0, 2147483647));
    work.push(makeDateTime("pdg_lastprintdate", "Last Print Date", OPTIONAL, "Date/time last printed"));
    work.push(makeInteger("pdg_revisionnumber", "Revision #", OPTIONAL, "Revision counter", 0, 2147483647));
    work.push(makeMoney("pdg_originalpoamount", "Original PO Amount", OPTIONAL, "Snapshot of first approved total"));
    work.push(makeDateTime("pdg_approvaldate", "Approval Date", OPTIONAL, "Date/time when approved"));
    work.push(makeMemo("pdg_rejectionreason", "Rejection Reason", OPTIONAL, "Reason for rejection", 4000));

    // EXECUTION
    // Verify table exists
    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId,EntitySetName`);
    for (const payload of work) {
        const logical = payload.SchemaName.toLowerCase();
        if (await attributeExists(logical)) {
            console.log(`Skip (exists): ${logical}`);
            continue;
        }
        console.log(`Create: ${logical}`);
        await createAttribute(payload).catch(e => console.warn(`Failed ${logical}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log("Purchase Order fields creation complete (non-lookup, non-choice).");
})();

