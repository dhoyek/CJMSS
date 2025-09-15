(async () => {
    // Creates global choice sets for procurement scenario (no attribute bindings here)
    const LCID = 1033;
    const API_VERSION = "v9.2";
    const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl();
    const headers = { "Accept": "application/json", "Content-Type": "application/json; charset=utf-8", "OData-MaxVersion": "4.0", "OData-Version": "4.0" };
    const api = (path, init = {}) => fetch(`${orgUrl}/api/data/${API_VERSION}/${path}`, { headers, ...init })
        .then(async r => { if (!r.ok) { const b = await r.text().catch(() => ""); throw new Error(`${init.method ?? "GET"} ${path} failed: ${r.status} ${r.statusText} ${b}`); } return r.status === 204 ? null : r.json(); });
    const label = (t) => ({ LocalizedLabels: [{ Label: t, LanguageCode: LCID }] });

    // Helpers for Global Option Sets
    const globalExists = async (name) => {
        try {
            await api(`GlobalOptionSetDefinitions(Name='${name}')?$select=Name`);
            return true;
        } catch { return false; }
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

    // Define global sets (exclude local-only: pdg_status, pdg_linestatus)
    const sets = [
        {
            name: "pdg_PaymentTerms",
            display: "Payment Terms",
            description: "Standard payment terms",
            options: [
                [100000000, "Net 30"],
                [100000001, "Net 45"],
                [100000002, "Net 60"],
                [100000003, "COD"],
                [100000004, "Advance"],
                [100000005, "Other"]
            ]
        },
        {
            name: "pdg_Priority",
            display: "Priority",
            description: "Priority levels",
            options: [
                [100000000, "Emergency"],
                [100000001, "High"],
                [100000002, "Normal"],
                [100000003, "Low"]
            ]
        },
        {
            name: "pdg_QCStatus",
            display: "QC Status",
            description: "Quality control status",
            options: [
                [100000000, "Pending"],
                [100000001, "Passed"],
                [100000002, "Failed"],
                [100000003, "N/A"]
            ]
        },
        {
            name: "pdg_Incoterms",
            display: "Incoterms",
            description: "Incoterms (2020)",
            options: [
                [100000000, "EXW"],
                [100000001, "FCA"],
                [100000002, "FOB"],
                [100000003, "CFR"],
                [100000004, "CIF"],
                [100000005, "CPT"],
                [100000006, "CIP"],
                [100000007, "DAP"],
                [100000008, "DPU"],
                [100000009, "DDP"]
            ]
        },
        {
            name: "pdg_ShippingMethod",
            display: "Shipping Method",
            description: "Transport method",
            options: [
                [100000000, "Air"],
                [100000001, "Sea"],
                [100000002, "Ground"],
                [100000003, "Express"],
                [100000004, "Courier"],
                [100000005, "Other"]
            ]
        },
        {
            name: "pdg_LandedCostAllocationMethod",
            display: "Landed Cost Allocation Method",
            description: "Allocation formula",
            options: [
                [100000000, "By Value"],
                [100000001, "By Weight"],
                [100000002, "By Volume"]
            ]
        }
    ];

    for (const set of sets) {
        const { name, display, description, options } = set;
        if (await globalExists(name)) { console.log(`Skip global (exists): ${name}`); continue; }
        console.log(`Create global: ${name}`);
        await createGlobal({ name, displayName: display, options, description }).catch(e => console.warn(`Failed global ${name}: ${e.message}`));
        await new Promise(r => setTimeout(r, 300));
    }
    console.log("Global choices created (payment terms, priority, QC status, incoterms, shipping method, landed-cost allocation).");
})();

