(async () => {
    const ENTITY_LOGICAL_NAME = "pdg_purchaseorderreceipt";
    const ENTITY_SCHEMA_NAME = "pdg_PurchaseOrderReceipt";
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
    const toSchema = (logicalName) => {
        if (!logicalName.startsWith("pdg_")) return logicalName;
        const [prefix, ...rest] = logicalName.split("_");
        return prefix + "_" + rest.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    };
    const escapeODataString = (s) => String(s).replace(/'/g, "''");

    const attributeExists = async (logicalName) => {
        const res = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes?$select=LogicalName&$filter=LogicalName eq '${escapeODataString(logicalName)}'`);
        return Array.isArray(res?.value) && res.value.length > 0;
    };

    const ensureEntityExists = async () => {
        try {
            await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
            console.log(`Entity exists: ${ENTITY_LOGICAL_NAME}`);
        } catch (err) {
            const message = err?.message || "";
            if (!message.includes("404")) throw err;
            console.log(`Creating entity: ${ENTITY_LOGICAL_NAME}`);
            const entityPayload = {
                "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
                "SchemaName": ENTITY_SCHEMA_NAME,
                "DisplayName": label("Purchase Order Receipt"),
                "DisplayCollectionName": label("Purchase Order Receipts"),
                "Description": label("Receipts recorded against purchase order lines."),
                "OwnershipType": "OrganizationOwned",
                "HasActivities": false,
                "HasNotes": true,
                "PrimaryAttribute": {
                    "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
                    "SchemaName": "pdg_Name",
                    "DisplayName": label("Receipt Name"),
                    "RequiredLevel": { "Value": "ApplicationRequired" },
                    "MaxLength": 200
                }
            };
            await api("EntityDefinitions", { method: "POST", body: JSON.stringify(entityPayload) });
            console.log(`Entity created: ${ENTITY_LOGICAL_NAME}`);
            await new Promise(r => setTimeout(r, 500));
        }
    };

    const createAttribute = async (payload) => api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, { method: "POST", body: JSON.stringify(payload) });

    const makeString = (logical, display, required, description, max = 100, formatName) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        ...(formatName ? { "FormatName": { "Value": formatName } } : {}),
        "MaxLength": max
    });
    const makeMemo = (logical, display, required, description, max = 262144) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        "MaxLength": max
    });
    const makeDecimal = (logical, display, required, description, min = -100000000000, max = 100000000000, precision = 2) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        "MinValue": min,
        "MaxValue": max,
        "Precision": precision
    });
    const makeDateTime = (logical, display, required, description) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(description),
        "Format": "DateAndTime"
    });
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

    const ensureLookup = async ({ logical, display, description, targetTable, required = "None" }) => {
        if (await attributeExists(logical)) {
            console.log(`Skip (exists): ${logical}`);
            return;
        }
        const schemaName = toSchema(logical);
        const relationshipSchema = `${toSchema(targetTable)}_${toSchema(ENTITY_LOGICAL_NAME)}_${schemaName.replace(/^pdg_/, "")}`;
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
                "Delete": "Referential",
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

    const REQUIRED = "ApplicationRequired";
    const RECOMMENDED = "Recommended";
    const OPTIONAL = "None";

    await ensureEntityExists();

    const work = [];
    work.push(makeString("pdg_receiptnumber", "Receipt Number", OPTIONAL, "Human-readable receipt number", 100));
    work.push(makeDateTime("pdg_receiptdate", "Receipt Date", OPTIONAL, "When received"));
    work.push(makeDecimal("pdg_quantityreceived", "Quantity Received", OPTIONAL, "Supports partial receipts", 0, 100000000000, 3));
    work.push(makePicklist("pdg_qcstatus", "QC Status", OPTIONAL, "Quality control status for the receipt", "pdg_QCStatus", 100000000));
    work.push(makeMemo("pdg_notes", "Notes", OPTIONAL, "Receiving notes", 4000));
    work.push(makeString("pdg_packageref", "Package Reference", OPTIONAL, "Pallet/box id if used", 100));
    work.push(makeString("pdg_documenturl", "Document URL", OPTIONAL, "Link to ASN/CoA or documents", 400, "Url"));

    await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId`);
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

    await ensureLookup({
        logical: "pdg_receivedby",
        display: "Received By",
        description: "User who confirmed the receipt",
        targetTable: "systemuser",
        required: OPTIONAL
    });

    console.log("PO Receipt metadata ensured (core fields, QC status, received by).");
})();
