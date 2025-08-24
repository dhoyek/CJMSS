(async () => {
    const serviceRoot = Xrm.Utility.getGlobalContext().getClientUrl() + "/api/data/v9.2/";
    const headers = { Accept: "application/json" };

    async function fetchAll(url) {
        let all = [];
        while (url) {
            const resp = await fetch(url, { headers });
            const data = await resp.json();
            all.push(...(data.value || []));
            url = data["@odata.nextLink"] || null;
        }
        return all;
    }

    async function fetchAllEntities() {
        const url = serviceRoot + "EntityDefinitions?$select=LogicalName,DisplayName,OwnershipType,IsAvailableOffline";
        return await fetchAll(url);
    }

    async function fetchAttributes(entityName) {
        const url = `${serviceRoot}EntityDefinitions(LogicalName='${entityName}')/Attributes?$select=LogicalName,DisplayName,AttributeType,RequiredLevel,Description`;
        return await fetchAll(url);
    }

    function label(lbl) {
        return lbl?.UserLocalizedLabel?.Label || "";
    }

    function isRequired(attr) {
        const v = attr.RequiredLevel?.Value;
        return v === "SystemRequired" || v === "ApplicationRequired";
    }

    function downloadFile(filename, content) {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    try {
        const entities = await fetchAllEntities();
        const pdgEntities = entities.filter(e => e.LogicalName.startsWith("pdg_"));

        let report = "";

        for (const ent of pdgEntities) {
            const attrs = await fetchAttributes(ent.LogicalName);

            const filtered = attrs.filter(attr =>
                attr.LogicalName.startsWith("pdg_") || isRequired(attr)
            ).map(attr => ({
                "Column Name": attr.LogicalName,
                "Display Name": label(attr.DisplayName),
                "Type": attr.AttributeType,
                "Description": label(attr.Description) || "N/A",
                "Is Required": isRequired(attr) ? "Yes" : "No"
            }));

            // Console preview
            console.group(`📋 ${ent.LogicalName} (${label(ent.DisplayName) || "No Display Name"})`);
            console.log(`Available Offline: ${ent.IsAvailableOffline}`);
            console.log(`Ownership: ${ent.OwnershipType}`);
            if (filtered.length) {
                console.table(filtered);
            } else {
                console.log("No required or pdg_ columns found.");
            }
            console.groupEnd();

            // Word/Excel-friendly output
            report += `\n=== Table: ${ent.LogicalName} (${label(ent.DisplayName) || "No Display Name"}) ===\n`;
            report += `Available Offline: ${ent.IsAvailableOffline}\n`;
            report += `Ownership: ${ent.OwnershipType}\n`;
            report += `Column Name\tDisplay Name\tType\tDescription\tIs Required\n`;
            filtered.forEach(f => {
                report += `${f["Column Name"]}\t${f["Display Name"]}\t${f["Type"]}\t${f["Description"]}\t${f["Is Required"]}\n`;
            });
        }

        // Save to file instead of clipboard
        downloadFile("pdg_tables_report.txt", report);
        console.log("✅ Report downloaded as pdg_tables_report.txt");
    } catch (err) {
        console.error("❌ Error retrieving metadata:", err?.message || err);
    }
})();
