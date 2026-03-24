(async () => {
    // ------- SETTINGS -------
    const ENTITY_LOGICAL_NAME = "pdg_inventoryitem";
    const LCID = 1033;

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

    // ---------- PAYLOAD BUILDERS ----------
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

    const makeInteger = (logical, display, required, desc, min = -2147483648, max = 2147483647) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "Format": "None",
        "MinValue": min,
        "MaxValue": max
    });

    const makePicklist = (logical, display, required, desc, options) => ({
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        "SchemaName": toSchema(logical),
        "DisplayName": label(display),
        "RequiredLevel": { "Value": required },
        "Description": label(desc),
        "OptionSet": {
            "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
            "IsGlobal": false,
            "OptionSetType": "Picklist",
            "Options": options.map(([value, label_text]) => ({
                "Value": value,
                "Label": label(label_text)
            }))
        }
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

    // ========================================
    // SECTION 1: ACTIVE MONEY FIELDS (for operations)
    // These use Dataverse currency conversion
    // ========================================
    work.push(makeMoney("pdg_saleprice", "Sale Price", OPTIONAL,
        "Active sale price in item's currency (from spfc/splc/spsc based on cur)", 0, 922337203685477, 4));
    work.push(makeMoney("pdg_unitcost", "Unit Cost", OPTIONAL,
        "Current cost in item's currency (from costf/costl/costs based on cur)", 0, 922337203685477, 4));
    work.push(makeMoney("pdg_purchaseprice", "Purchase Price", OPTIONAL,
        "Purchase price in item's currency (from ppfc/pplc/ppsc based on cur)", 0, 922337203685477, 4));
    work.push(makeMoney("pdg_exportprice", "Export Price", OPTIONAL,
        "Export price in item's currency (from exfc/exlc/exsc based on cur)", 0, 922337203685477, 4));
    work.push(makeMoney("pdg_previouscost", "Previous Cost", OPTIONAL,
        "Previous cost in item's currency (from prevf/prevl/prevs based on cur)", 0, 922337203685477, 4));
    work.push(makeMoney("pdg_previouspurchasecost", "Previous Purchase Cost", OPTIONAL,
        "Previous purchase cost (from pcostf/pcostl/pcosts based on cur)", 0, 922337203685477, 4));

    // ========================================
    // SECTION 2: RAW LEGACY CURRENCY FIELDS (exact preservation)
    // Store all three currency values as-is from Dolphin
    // ========================================

    // Cost - Triple Currency
    work.push(makeDecimal("pdg_legacy_cost_lbp", "Cost (LBP Raw)", OPTIONAL,
        "Raw legacy cost in LBP (costl column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_cost_foreign", "Cost (Foreign Raw)", OPTIONAL,
        "Raw legacy cost in foreign currency (costf column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_cost_secondary", "Cost (Secondary Raw)", OPTIONAL,
        "Raw legacy cost in secondary currency (costs column)", -100000000000, 100000000000, 4));

    // Sale Price - Triple Currency
    work.push(makeDecimal("pdg_legacy_saleprice_lbp", "Sale Price (LBP Raw)", OPTIONAL,
        "Raw legacy sale price in LBP (splc column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_saleprice_foreign", "Sale Price (Foreign Raw)", OPTIONAL,
        "Raw legacy sale price in foreign currency (spfc column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_saleprice_secondary", "Sale Price (Secondary Raw)", OPTIONAL,
        "Raw legacy sale price in secondary currency (spsc column)", -100000000000, 100000000000, 4));

    // Export Price - Triple Currency
    work.push(makeDecimal("pdg_legacy_exportprice_lbp", "Export Price (LBP Raw)", OPTIONAL,
        "Raw legacy export price in LBP (exlc column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_exportprice_foreign", "Export Price (Foreign Raw)", OPTIONAL,
        "Raw legacy export price in foreign currency (exfc column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_exportprice_secondary", "Export Price (Secondary Raw)", OPTIONAL,
        "Raw legacy export price in secondary currency (exsc column)", -100000000000, 100000000000, 4));

    // Purchase Price - Triple Currency
    work.push(makeDecimal("pdg_legacy_purchaseprice_lbp", "Purchase Price (LBP Raw)", OPTIONAL,
        "Raw legacy purchase price in LBP (pplc column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_purchaseprice_foreign", "Purchase Price (Foreign Raw)", OPTIONAL,
        "Raw legacy purchase price in foreign currency (ppfc column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_purchaseprice_secondary", "Purchase Price (Secondary Raw)", OPTIONAL,
        "Raw legacy purchase price in secondary currency (ppsc column)", -100000000000, 100000000000, 4));

    // Previous Cost - Triple Currency
    work.push(makeDecimal("pdg_legacy_previouscost_lbp", "Previous Cost (LBP Raw)", OPTIONAL,
        "Raw legacy previous cost in LBP (prevl column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_previouscost_foreign", "Previous Cost (Foreign Raw)", OPTIONAL,
        "Raw legacy previous cost in foreign currency (prevf column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_previouscost_secondary", "Previous Cost (Secondary Raw)", OPTIONAL,
        "Raw legacy previous cost in secondary currency (prevs column)", -100000000000, 100000000000, 4));

    // ========================================
    // SECTION 3: LEGACY RATES & METADATA
    // ========================================
    work.push(makeDecimal("pdg_dolphinexchangerate", "Dolphin Exchange Rate", OPTIONAL,
        "Exchange rate stored on item in Dolphin (rate column) - historical LBP rate", -100000000000, 100000000000, 6));
    work.push(makeDecimal("pdg_dolphinsecondaryrate", "Dolphin Secondary Rate", OPTIONAL,
        "Secondary exchange rate stored on item (srate column) - historical LBP rate", -100000000000, 100000000000, 6));
    work.push(makeDate("pdg_dolphinratedate", "Dolphin Rate Date", OPTIONAL,
        "Date item was created in Dolphin (dat column) - context for exchange rate"));
    work.push(makeInteger("pdg_dolphincurrencycode", "Dolphin Currency Code", OPTIONAL,
        "Raw currency code from Dolphin (cur column): 2=LBP, 3=USD, 4/5/6/7=other", 1, 10));

    // ========================================
    // SECTION 4: OTHER MISSING FIELDS
    // ========================================
    work.push(makeDecimal("pdg_cbfactor", "CB Factor", OPTIONAL,
        "Cost basis factor from legacy system (cbfact column) - purpose unknown, preserved for reference", -100000000000, 100000000000, 6));

    work.push(makePicklist("pdg_customerpricecategory", "Customer Price Category", OPTIONAL,
        "Customer pricing category from Dolphin (custcat column)", [
        [100100001, "Category 1"],
        [100100002, "Category 2"],
        [100100003, "Category 3"],
        [100100004, "Category 4"],
        [100100005, "Category 5"],
        [100100006, "Category 6"]
    ]));

    // ========================================
    // SECTION 5: PRODUCTION COST FIELDS
    // Note: these are stored in Dolphin but computed in CJMSS
    // Storing legacy values for historical reference
    // ========================================
    work.push(makeDecimal("pdg_legacy_productioncost_lbp", "Production Cost (LBP Raw)", OPTIONAL,
        "Legacy production cost in LBP (pcostl column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_productioncost_foreign", "Production Cost (Foreign Raw)", OPTIONAL,
        "Legacy production cost in foreign currency (pcostf column)", -100000000000, 100000000000, 4));
    work.push(makeDecimal("pdg_legacy_productioncost_secondary", "Production Cost (Secondary Raw)", OPTIONAL,
        "Legacy production cost in secondary currency (pcosts column)", -100000000000, 100000000000, 4));

    // ---------- CREATE COLUMNS ----------
    console.log(`Total fields to create: ${work.length}`);
    console.log("========================================");

    let created = 0, skipped = 0, errors = 0;
    for (const payload of work) {
        const logicalName = payload.SchemaName.toLowerCase();
        if (await attributeExists(logicalName)) {
            console.log(`✓ Skip (exists): ${logicalName}`);
            skipped++;
            continue;
        }
        try {
            await createAttribute(payload);
            console.log(`✓ Created: ${logicalName} (${payload.DisplayName.LocalizedLabels[0].Label})`);
            created++;
        } catch (e) {
            console.error(`✗ Error creating ${logicalName}:`, e.message);
            errors++;
        }
    }

    console.log("========================================");
    console.log(`SUMMARY: Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
    console.log("========================================");

    // ---------- PUBLISH ----------
    console.log("Publishing customizations...");
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
    console.log("✓ Publish complete.");
    console.log("========================================");
    console.log("MIGRATION READY - All legacy fields created");
})();