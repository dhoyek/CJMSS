(async () => {
    // ------- SETTINGS -------
    const ENTITY_LOGICAL_NAME = "pdg_inventoryitem";   // target table: items
    const LCID = 1033; // label language (1033 = English)

    // ------- HELPERS -------
    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl();
    const v = "v9.2";

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

    // Quick check the entity exists
    const entityDef = await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')?$select=MetadataId,EntitySetName`);
    console.log(`Target entity: ${ENTITY_LOGICAL_NAME} (set: ${entityDef.EntitySetName})`);

    const attributeExists = async (attrLogicalName) => {
        try {
            await api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes(LogicalName='${attrLogicalName}')?$select=LogicalName`);
            return true;
        } catch {
            return false;
        }
    };

    const createAttribute = async (payload) =>
        api(`EntityDefinitions(LogicalName='${ENTITY_LOGICAL_NAME}')/Attributes`, {
            method: "POST",
            body: JSON.stringify(payload)
        });

    // ---------- ATTRIBUTE PAYLOAD BUILDERS ----------
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

    const makeDecimal = (logical, display, required, desc, min = -100000000000, max = 100000000000, precision = 6) => ({
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

    const OPTIONAL = "None";

    // ---------- FIELDS TO ADD ----------
    const work = [];

    // Money fields sourced from Dolphin (per item currency)
    work.push(makeMoney("pdg_saleprice", "Sale Price", OPTIONAL, "From splc/spfc/spsc based on currency"));
    work.push(makeMoney("pdg_unitcost", "Unit Cost", OPTIONAL, "From costl/costf/costs based on currency"));
    work.push(makeMoney("pdg_purchaseprice", "Purchase Price", OPTIONAL, "From pplc/ppfc/ppsc based on currency"));
    work.push(makeMoney("pdg_exportprice", "Export Price", OPTIONAL, "From exlc/exfc/exsc based on currency"));
    work.push(makeMoney("pdg_previouscost", "Previous Cost", OPTIONAL, "From prevl/prevf/prevs based on currency"));
    work.push(makeMoney("pdg_previouspurchasecost", "Previous Purchase Cost", OPTIONAL, "From pcostl/pcostf/pcosts based on currency"));

    // Preserve original Dolphin rate/date
    work.push(makeDecimal("pdg_dolphinexchangerate", "Dolphin Exchange Rate", OPTIONAL, "Original rate value from Dolphin (rate column)", -100000000000, 100000000000, 6));
    work.push(makeDate("pdg_dolphinratedate", "Dolphin Rate Date", OPTIONAL, "Original rate date from Dolphin (dat column)"));

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

    console.log(`Done. Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);

    // ---------- PUBLISH ----------
    const publishAllReq = {
        getMetadata: function () {
            return {
                boundParameter: null,
                parameterTypes: {},
                operationName: "PublishAllXml",
                operationType: 0
            };
        }
    };
    await Xrm.WebApi.online.execute(publishAllReq);
    console.log("Publish complete.");
})();
