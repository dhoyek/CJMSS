// Add pdg_legacyid (Legacy ID, text) to all pdg_* tables that don't have it yet
// Run this in the browser console while logged into your Dataverse environment.

(async () => {
    // ---------- SETTINGS ----------
    const PUBLISHER_PREFIX = "pdg_";     // change if your prefix is different
    const ATTR_NAME = "LegacyID";        // schema suffix
    const LCID = 1033;                   // label language (1033 = EN). Change if needed.

    const ATTR_LOGICAL = (PUBLISHER_PREFIX + ATTR_NAME).toLowerCase(); // e.g. pdg_legacyid
    const ATTR_SCHEMA = PUBLISHER_PREFIX + ATTR_NAME;                  // e.g. pdg_LegacyID
    const ATTR_DISPLAY = "Legacy ID";
    const ATTR_DESCRIPTION = "Legacy identifier from the old Dolphin system (migration).";

    // ---------- LOW-LEVEL HELPERS ----------
    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl();
    const v = "v9.2";

    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    };

    const api = async (path, init = {}) => {
        const url = path.startsWith("http")
            ? path
            : `${orgUrl}/api/data/${v}/${path}`;

        const resp = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
        const text = await resp.text();
        if (!resp.ok) {
            throw new Error(`${init.method || "GET"} ${url} failed: ${resp.status} ${resp.statusText} – ${text}`);
        }
        if (!text) return null;
        try { return JSON.parse(text); } catch { return null; }
    };

    const label = (text) => ({
        LocalizedLabels: [{ Label: text, LanguageCode: LCID }]
    });

    // ---------- METADATA HELPERS ----------
    // FIXED: no "startswith" in $filter; we pull all custom entities and filter client-side
    async function listCustomTablesWithPrefix(prefix) {
        console.log(`🔎 Fetching custom EntityDefinitions and filtering by prefix '${prefix}'...`);
        const tables = [];
        let query = `EntityDefinitions?$select=LogicalName,IsCustomEntity&$filter=IsCustomEntity eq true`;

        while (query) {
            const page = await api(query);
            (page.value || []).forEach(e => {
                if (e.IsCustomEntity && e.LogicalName && e.LogicalName.startsWith(prefix)) {
                    tables.push(e.LogicalName);
                }
            });
            const next = page["@odata.nextLink"];
            query = next ? next.replace(`${orgUrl}/api/data/${v}/`, "") : null;
        }

        console.log(`✅ Found ${tables.length} tables with prefix '${prefix}'`, tables);
        return tables;
    }

    async function attributeExists(tableLogicalName, attrLogicalName) {
        try {
            await api(
                `EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes(LogicalName='${attrLogicalName}')?$select=LogicalName`
            );
            return true; // 200 OK → attribute exists
        } catch (e) {
            // 404 = not found → treat as not existing
            if (e.message && e.message.indexOf("404") >= 0) return false;
            console.warn(`⚠️ Could not check attribute on ${tableLogicalName}:`, e.message || e);
            throw e;
        }
    }

    async function createLegacyIdAttribute(tableLogicalName) {
        const payload = {
            "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
            "SchemaName": ATTR_SCHEMA,
            "LogicalName": ATTR_LOGICAL,
            "DisplayName": label(ATTR_DISPLAY),
            "Description": label(ATTR_DESCRIPTION),
            "RequiredLevel": { "Value": "None" },          // not required; change if you want
            "MaxLength": 100,                              // adjust if you need longer IDs
            "AttributeType": "String",
            "AttributeTypeName": { "Value": "StringType" },
            "FormatName": { "Value": "Text" }
        };

        console.log(`➕ Creating ${ATTR_LOGICAL} on ${tableLogicalName}...`);
        await api(
            `EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes`,
            { method: "POST", body: JSON.stringify(payload) }
        );
        console.log(`   ✅ Created on ${tableLogicalName}`);
    }

    // ---------- MAIN ----------
    try {
        console.log("=== PDG LegacyID bulk column creator ===");
        console.log(`Target column: ${ATTR_LOGICAL} (${ATTR_SCHEMA})`);
        const tables = await listCustomTablesWithPrefix(PUBLISHER_PREFIX);

        const results = [];

        for (const tbl of tables) {
            try {
                const exists = await attributeExists(tbl, ATTR_LOGICAL);
                if (exists) {
                    console.log(`⏭️  Skipping ${tbl} – column already exists.`);
                    results.push({ table: tbl, status: "SKIPPED (exists)" });
                    continue;
                }

                await createLegacyIdAttribute(tbl);
                results.push({ table: tbl, status: "CREATED" });
            } catch (err) {
                console.error(`❌ Error on table ${tbl}:`, err.message || err);
                results.push({ table: tbl, status: "ERROR", error: err.message || String(err) });
            }
        }

        console.log("=== Done. Summary ===");
        console.table(results);

        console.warn("⚠️ IMPORTANT: Run a Publish All Customizations afterwards (Solution explorer or Power Apps maker).");
    } catch (e) {
        console.error("💥 Fatal error in LegacyID bulk script:", e);
    }
})();
