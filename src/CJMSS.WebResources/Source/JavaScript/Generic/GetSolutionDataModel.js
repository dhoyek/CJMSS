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

    function isChoiceType(attrType) {
        return [
            "Picklist",
            "MultiSelectPicklist",
            "Status",
            "State"
            // Note: Boolean is a choice as well, but handled differently.
        ].includes(attrType);
    }

    async function fetchChoiceOptions(entityLogicalName, attributeLogicalName, attributeType) {
        try {
            const typeMap = {
                Picklist: "PicklistAttributeMetadata",
                MultiSelectPicklist: "MultiSelectPicklistAttributeMetadata",
                Status: "StatusAttributeMetadata",
                State: "StateAttributeMetadata"
            };

            const metaType = typeMap[attributeType];
            if (!metaType) return "";

            const url = `${serviceRoot}EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes(LogicalName='${attributeLogicalName}')/Microsoft.Dynamics.CRM.${metaType}?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)`;
            const resp = await fetch(url, { headers });
            const data = await resp.json();
            let options = data?.OptionSet?.Options || [];
            if ((!Array.isArray(options) || options.length === 0) && data?.GlobalOptionSet?.Options) {
                options = data.GlobalOptionSet.Options;
            }
            if (!Array.isArray(options) || options.length === 0) return "";

            // Format as: Label (Value), comma separated
            const formatted = options.map(o => {
                const lbl = o?.Label?.UserLocalizedLabel?.Label || "";
                const val = o?.Value;
                return lbl ? `${lbl} (${val})` : `${val}`;
            });
            return formatted.join(", ");
        } catch (e) {
            console.warn(`Failed to fetch options for ${entityLogicalName}.${attributeLogicalName}:`, e?.message || e);
            return "";
        }
    }

    try {
        const entities = await fetchAllEntities();
        const pdgEntities = entities.filter(e => e.LogicalName.startsWith("pdg_"));

        let report = "";

        for (const ent of pdgEntities) {
            const attrs = await fetchAttributes(ent.LogicalName);

            const filtered = await Promise.all(
                attrs
                    .filter(attr => attr.LogicalName.startsWith("pdg_") || isRequired(attr))
                    .map(async attr => {
                        const base = {
                            "Column Name": attr.LogicalName,
                            "Display Name": label(attr.DisplayName),
                            "Type": attr.AttributeType,
                            "Description": label(attr.Description) || "N/A",
                            "Is Required": isRequired(attr) ? "Yes" : "No",
                            "Choices": ""
                        };
                        if (isChoiceType(attr.AttributeType)) {
                            base["Choices"] = await fetchChoiceOptions(ent.LogicalName, attr.LogicalName, attr.AttributeType);
                        }
                        return base;
                    })
            );

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
            report += `Column Name\tDisplay Name\tType\tDescription\tIs Required\tChoices\n`;
            filtered.forEach(f => {
                report += `${f["Column Name"]}\t${f["Display Name"]}\t${f["Type"]}\t${f["Description"]}\t${f["Is Required"]}\t${f["Choices"] || ""}\n`;
            });
        }

        // Save to file instead of clipboard
        downloadFile("pdg_tables_report.txt", report);
        console.log("✅ Report downloaded as pdg_tables_report.txt");
    } catch (err) {
        console.error("❌ Error retrieving metadata:", err?.message || err);
    }
})();
