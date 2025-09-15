(async () => {
    const ENTITY_LOGICAL_NAME = "pdg_purchaseorderchange";
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

    const makeString = (l, d, r, ds, max = 200) => ({ "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MaxLength": max });
    const makeMemo = (l, d, r, ds, max = 262144) => ({ "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "MaxLength": max });
    const makeDateTime = (l, d, r, ds) => ({ "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", "SchemaName": toSchema(l), "DisplayName": label(d), "RequiredLevel": { "Value": r }, "Description": label(ds), "Format": "DateAndTime" });

    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    const work = [];
    work.push(makeDateTime("pdg_changedate", "Change Date", OPTIONAL, "When the change happened"));
    work.push(makeString("pdg_entityname", "Entity Name", OPTIONAL, "purchaseorder or line", 100));
    work.push(makeString("pdg_recordid", "Record Id", OPTIONAL, "Target record GUID", 100));
    work.push(makeString("pdg_fieldname", "Field Name", OPTIONAL, "Logical name of the changed field", 100));
    work.push(makeMemo("pdg_oldvalue", "Old Value", OPTIONAL, "Serialized old value"));
    work.push(makeMemo("pdg_newvalue", "New Value", OPTIONAL, "Serialized new value"));
    work.push(makeMemo("pdg_reason", "Reason", OPTIONAL, "Why changed"));
    work.push(makeString("pdg_changegroup", "Change Group", OPTIONAL, "Group multiple field edits from one action", 100));

    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
    for (const payload of work) {
        const logical = payload.SchemaName.toLowerCase();
        if (await attributeExists(logical)) { console.log(`Skip (exists): ${logical}`); continue; }
        console.log(`Create: ${logical}`);
        await createAttribute(payload).catch(e => console.warn(`Failed ${logical}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log("PO Change fields creation complete (non-lookup, non-choice).");
})();

