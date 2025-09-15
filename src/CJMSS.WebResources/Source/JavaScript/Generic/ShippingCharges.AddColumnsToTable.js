(async () => {
    const ENTITY_LOGICAL_NAME = "pdg_shippingcharges";
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
    const makeMoney = (l, d, r, ds, min = 0, max = 922337203685477, precision = 2) => ({ "@odata.type": "Microsoft.Dynamics.CRM.MoneyAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MinValue": min, "MaxValue": max, "Precision": precision });
    const makeDecimal = (l, d, r, ds, min = -100000000000, max = 100000000000, precision = 2) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MinValue": min, "MaxValue": max, "Precision": precision });
    const makeInteger = (l, d, r, ds, min = -2147483648, max = 2147483647) => ({ "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MinValue": min, "MaxValue": max });
    const makeDateOnly = (l, d, r, ds) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "Format": "DateOnly" });

    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    const work = [];
    work.push(makeDateOnly("pdg_actualdeliverydate", "Actual Delivery Date", OPTIONAL, "Landed completion date"));
    work.push(makeDecimal("pdg_shippingweight", "Shipping Weight", OPTIONAL, "Total actual shipped weight", 0, 100000000000, 3));
    work.push(makeInteger("pdg_numberofpackages", "Number of Packages", OPTIONAL, "Total parcel count", 0, 1000000000));
    work.push(makeMoney("pdg_damageclaimsamount", "Damage Claims", OPTIONAL, "Claimed amount"));
    work.push(makeMoney("pdg_demurragecharges", "Demurrage Charges", OPTIONAL, "Port/terminal storage fees"));
    work.push(makeString("pdg_trackingnumber", "Tracking Number", OPTIONAL, "Carrier tracking number", 200));
    // pdg_carrier is a Lookup (recommended) or text alternate; leave to manual per normalization decision

    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
    for (const payload of work) {
        const logical = payload.SchemaName.toLowerCase();
        if (await attributeExists(logical)) { console.log(`Skip (exists): ${logical}`); continue; }
        console.log(`Create: ${logical}`);
        await createAttribute(payload).catch(e => console.warn(`Failed ${logical}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log("Shipping Charges fields creation complete (non-lookup, non-choice).");
})();

