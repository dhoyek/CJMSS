(async () => {
    const ENTITY_LOGICAL_NAME = "pdg_purchaseorderreceipt";
    const LCID = 1033;
    const API_VERSION = "v9.2";

    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl();
    const headers = { "Accept": "application/json", "Content-Type": "application/json; charset=utf-8", "OData-MaxVersion": "4.0", "OData-Version": "4.0" };
    const api = (path, init = {}) => fetch(`${orgUrl}/api/data/${API_VERSION}/${path}`, { headers, ...init })
        .then(async r => { if (!r.ok) { const b = await r.text().catch(() => ""); throw new Error(`${init.method ?? "GET"} ${path} failed: ${r.status} ${r.statusText} ${b}`); } return r.status === 204 ? null : r.json(); });
    const label = (t) => ({ LocalizedLabels: [{ Label: t, LanguageCode: LCID }] });
    const toSchema = (l) => { if (!l.startsWith("pdg_")) return l; const [p, ...r] = l.split("_"); return p + "_" + r.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(""); };
    const escapeODataString = (s) => String(s).replace(/'/g, "''");
    const attributeExists = async (a) => { const res = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes?$select=LogicalName&$filter=LogicalName eq '${escapeODataString(a)}'`); return Array.isArray(res?.value) && res.value.length > 0; };
    const createAttribute = async (p) => api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, { method: "POST", body: JSON.stringify(p) });

    const makeString = (l, d, r, ds, max = 100, formatName) => ({ "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), ...(formatName ? { "FormatName": { "Value": formatName } } : {}), "MaxLength": max });
    const makeMemo = (l, d, r, ds, max = 262144) => ({ "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MaxLength": max });
    const makeDecimal = (l, d, r, ds, min = -100000000000, max = 100000000000, precision = 2) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MinValue": min, "MaxValue": max, "Precision": precision });
    const makeDateTime = (l, d, r, ds) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "Format": "DateAndTime" });

    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    const work = [];
    // pdg_receiptnumber is Auto Number (or Single Line). We add as text; configure AutoNumber manually if desired.
    work.push(makeString("pdg_receiptnumber", "Receipt Number", OPTIONAL, "Human-readable receipt number", 100));
    work.push(makeDateTime("pdg_receiptdate", "Receipt Date", OPTIONAL, "When received"));
    work.push(makeDecimal("pdg_quantityreceived", "Quantity Received", OPTIONAL, "Supports partials", 0, 100000000000, 3));
    work.push(makeMemo("pdg_notes", "Notes", OPTIONAL, "Receiving notes", 4000));
    work.push(makeString("pdg_packageref", "Package Reference", OPTIONAL, "Pallet/box id if used", 100));
    work.push(makeString("pdg_documenturl", "Document URL", OPTIONAL, "Link to ASN/CoA or documents", 400, "Url"));

    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
    for (const payload of work) {
        const logical = payload.SchemaName.toLowerCase();
        if (await attributeExists(logical)) { console.log(`Skip (exists): ${logical}`); continue; }
        console.log(`Create: ${logical}`);
        await createAttribute(payload).catch(e => console.warn(`Failed ${logical}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log("PO Receipt fields creation complete (non-lookup, non-choice).");
})();

