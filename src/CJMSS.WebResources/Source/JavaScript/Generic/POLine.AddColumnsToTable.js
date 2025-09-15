(async () => {
    const ENTITY_LOGICAL_NAME = "pdg_purchaseorderline";
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
            if (!r.ok) { const body = await r.text().catch(() => ""); throw new Error(`${init.method ?? "GET"} ${path} failed: ${r.status} ${r.statusText} ${body}`); }
            return r.status === 204 ? null : r.json();
        });
    const label = (t) => ({ LocalizedLabels: [{ Label: t, LanguageCode: LCID }] });
    const toSchema = (l) => { if (!l.startsWith("pdg_")) return l; const [p, ...r] = l.split("_"); return p + "_" + r.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(""); };
    const escapeODataString = (s) => String(s).replace(/'/g, "''");
    const attributeExists = async (a) => { const res = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes?$select=LogicalName&$filter=LogicalName eq '${escapeODataString(a)}'`); return Array.isArray(res?.value) && res.value.length > 0; };
    const createAttribute = async (p) => api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, { method: "POST", body: JSON.stringify(p) });

    const makeString = (l, d, r, ds, max = 100, formatName) => ({ "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), ...(formatName ? { "FormatName": { "Value": formatName } } : {}), "MaxLength": max });
    const makeMemo = (l, d, r, ds, max = 262144) => ({ "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MaxLength": max });
    const makeDecimal = (l, d, r, ds, min = -100000000000, max = 100000000000, precision = 2) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MinValue": min, "MaxValue": max, "Precision": precision });
    const makeInteger = (l, d, r, ds, min = -2147483648, max = 2147483647) => ({ "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MinValue": min, "MaxValue": max });
    const makeBoolean = (l, d, r, ds) => ({ "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "OptionSet": { "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata", "TrueOption": { "Label": label("Yes"), "Value": 1 }, "FalseOption": { "Label": label("No"), "Value": 0 } } });
    const makeDateOnly = (l, d, r, ds) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "Format": "DateOnly" });

    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    const work = [];
    work.push(makeDateOnly("pdg_expecteddeliverydate", "Expected Delivery Date", OPTIONAL, "Expected date per line"));
    work.push(makeDateOnly("pdg_promiseddeliverydate", "Promised Delivery Date", OPTIONAL, "Supplier-confirmed date per line"));
    work.push(makeDecimal("pdg_qtyreceived", "Received Quantity", OPTIONAL, "Quantity received so far", 0, 100000000000, 3));
    // pdg_qtyoutstanding is a Calculated column (= qtyordered - qtyreceived); add manually
    work.push(makeDecimal("pdg_unitweight", "Unit Weight", OPTIONAL, "Weight per unit", 0, 100000000000, 3));
    work.push(makeString("pdg_mfgrpartnumber", "Manufacturer Part #", OPTIONAL, "Manufacturer part number", 100));
    work.push(makeString("pdg_customerorprojectref", "Customer/Project Ref", OPTIONAL, "Reference for downstream docs", 200));
    work.push(makeBoolean("pdg_inspectionrequired", "Inspection Required", OPTIONAL, "Controls QC gate"));
    work.push(makeMemo("pdg_qcnotes", "QC Notes", OPTIONAL, "Inspector comments", 4000));
    work.push(makeBoolean("pdg_certificaterequired", "Certificate Required", OPTIONAL, "Material/test certificates required"));
    work.push(makeInteger("pdg_packagecount", "Packages (Line)", OPTIONAL, "Number of packages for this line", 0, 1000000000));

    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
    for (const payload of work) {
        const logical = payload.SchemaName.toLowerCase();
        if (await attributeExists(logical)) { console.log(`Skip (exists): ${logical}`); continue; }
        console.log(`Create: ${logical}`);
        await createAttribute(payload).catch(e => console.warn(`Failed ${logical}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log("PO Line fields creation complete (non-lookup, non-choice).");
})();

