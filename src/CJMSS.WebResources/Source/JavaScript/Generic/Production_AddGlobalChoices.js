(async () => {
    // Creates global choice sets for production sheet migration.
    // All value sequences start at 100100000 per CJMSS project convention.
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
                const b = await r.text().catch(() => "");
                throw new Error(`${init.method ?? "GET"} ${path} failed: ${r.status} ${r.statusText} ${b}`);
            }
            return r.status === 204 ? null : r.json();
        });

    const label = (t) => ({ LocalizedLabels: [{ Label: t, LanguageCode: LCID }] });

    const globalExists = async (name) => {
        try {
            await api(`GlobalOptionSetDefinitions(Name='${name}')?$select=Name`);
            return true;
        } catch {
            return false;
        }
    };

    const createGlobal = async ({ name, displayName, options, description }) => {
        const body = {
            "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
            "Name": name,
            "DisplayName": label(displayName),
            "Description": label(description ?? displayName),
            "IsGlobal": true,
            "OptionSetType": "Picklist",
            "Options": options.map(([value, text]) => ({ Value: value, Label: label(text) }))
        };
        return api("GlobalOptionSetDefinitions", { method: "POST", body: JSON.stringify(body) });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Global choice definitions — all sequences start at 100100000
    // ─────────────────────────────────────────────────────────────────────────
    const sets = [
        {
            // Dolphin source column: prdcat
            // 9 distinct values found across 62,243 production records
            name: "pdg_ProductionCategory",
            displayName: "Production Category",
            description: "Production category from Dolphin legacy system (prdcat column). Classifies the jewelry type and finish variant (NB = No Bright, AL = Alloyed, PG = Plated Gold, etc.).",
            options: [
                [100100000, "OLJ"],
                [100100001, "BTJE"],
                [100100002, "PG"],
                [100100003, "PGAL"],
                [100100004, "CSNB"],
                [100100005, "PGNB"],
                [100100006, "OLJNB"],
                [100100007, "BTJENB"],
                [100100008, "CS"]
            ]
        }
    ];

    for (const set of sets) {
        const { name, displayName, description, options } = set;
        if (await globalExists(name)) {
            console.log(`Skip (exists): ${name}`);
            continue;
        }
        console.log(`Creating global choice: ${name}`);
        await createGlobal({ name, displayName, options, description })
            .catch(e => console.warn(`Failed to create ${name}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }

    console.log("Production global choices complete — run ProductionSheet_AddColumnsToTable.js next.");
})();
