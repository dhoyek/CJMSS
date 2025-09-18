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

    async function fetchRelationships(entityName) {
        try {
            const [oneToMany, manyToOne, manyToMany] = await Promise.all([
                fetchAll(`${serviceRoot}EntityDefinitions(LogicalName='${entityName}')/OneToManyRelationships?$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencedAttribute,ReferencingAttribute`),
                fetchAll(`${serviceRoot}EntityDefinitions(LogicalName='${entityName}')/ManyToOneRelationships?$select=SchemaName,ReferencedEntity,ReferencingEntity,ReferencedAttribute,ReferencingAttribute`),
                fetchAll(`${serviceRoot}EntityDefinitions(LogicalName='${entityName}')/ManyToManyRelationships?$select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName`)
            ]);
            return { oneToMany, manyToOne, manyToMany };
        } catch (e) {
            console.warn(`Failed to fetch relationships for ${entityName}:`, e?.message || e);
            return { oneToMany: [], manyToOne: [], manyToMany: [] };
        }
    }

    async function fetchDefaultViewId(entityLogicalName) {
        try {
            const url = `${serviceRoot}savedqueries?$select=savedqueryid,name,returnedtypecode,isdefault,statecode,querytype&$filter=returnedtypecode eq '${entityLogicalName}' and isdefault eq true and statecode eq 0 and querytype eq 0`;
            const views = await fetchAll(url);
            // Prefer the one named like Active* if multiple
            const active = views.find(v => (v.name || "").toLowerCase().startsWith("active")) || views[0];
            return active?.savedqueryid || "";
        } catch (e) {
            console.warn(`Failed to fetch default view for ${entityLogicalName}:`, e?.message || e);
            return "";
        }
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
            const relsRaw = await fetchRelationships(ent.LogicalName);
            const defaultViewId = await fetchDefaultViewId(ent.LogicalName);
            // Limit relationships to only those involving pdg_ entities on both sides
            const isPdg = (n) => (typeof n === "string") && n.startsWith("pdg_");
            const rels = {
                oneToMany: (relsRaw.oneToMany || []).filter(r => isPdg(r.ReferencedEntity) && isPdg(r.ReferencingEntity)),
                manyToOne: (relsRaw.manyToOne || []).filter(r => isPdg(r.ReferencedEntity) && isPdg(r.ReferencingEntity)),
                manyToMany: (relsRaw.manyToMany || []).filter(r => isPdg(r.Entity1LogicalName) && isPdg(r.Entity2LogicalName))
            };

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
            console.log(`Default View Id: ${defaultViewId || ""}`);
            if (filtered.length) {
                console.table(filtered);
            } else {
                console.log("No required or pdg_ columns found.");
            }
            const relSummary = {
                "1:N": rels.oneToMany?.length || 0,
                "N:1": rels.manyToOne?.length || 0,
                "N:N": rels.manyToMany?.length || 0
            };
            console.log("Relationships:", relSummary);
            if ((rels.oneToMany?.length || 0) > 0) {
                console.group("1:N");
                console.table((rels.oneToMany || []).map(r => ({
                    SchemaName: r.SchemaName,
                    ReferencedEntity: r.ReferencedEntity,
                    ReferencingEntity: r.ReferencingEntity,
                    ReferencedAttribute: r.ReferencedAttribute,
                    ReferencingAttribute: r.ReferencingAttribute
                })));
                console.groupEnd();
            }
            if ((rels.manyToOne?.length || 0) > 0) {
                console.group("N:1");
                console.table((rels.manyToOne || []).map(r => ({
                    SchemaName: r.SchemaName,
                    ReferencedEntity: r.ReferencedEntity,
                    ReferencingEntity: r.ReferencingEntity,
                    ReferencedAttribute: r.ReferencedAttribute,
                    ReferencingAttribute: r.ReferencingAttribute
                })));
                console.groupEnd();
            }
            if ((rels.manyToMany?.length || 0) > 0) {
                console.group("N:N");
                console.table((rels.manyToMany || []).map(r => ({
                    SchemaName: r.SchemaName,
                    Entity1: r.Entity1LogicalName,
                    Entity2: r.Entity2LogicalName,
                    Intersect: r.IntersectEntityName
                })));
                console.groupEnd();
            }
            console.groupEnd();

            // Word/Excel-friendly output
            report += `\n=== Table: ${ent.LogicalName} (${label(ent.DisplayName) || "No Display Name"}) ===\n`;
            report += `Available Offline: ${ent.IsAvailableOffline}\n`;
            report += `Ownership: ${ent.OwnershipType}\n`;
            report += `Default View Id: ${defaultViewId || ""}\n`;
            report += `Column Name\tDisplay Name\tType\tDescription\tIs Required\tChoices\n`;
            filtered.forEach(f => {
                report += `${f["Column Name"]}\t${f["Display Name"]}\t${f["Type"]}\t${f["Description"]}\t${f["Is Required"]}\t${f["Choices"] || ""}\n`;
            });
            const fmt = (v) => v ?? "";
            report += `Relationships (counts): 1:N=${rels.oneToMany.length}, N:1=${rels.manyToOne.length}, N:N=${rels.manyToMany.length}\n`;
            if (rels.oneToMany.length) {
                report += `1:N Relationships\n`;
                report += `SchemaName\tReferencedEntity\tReferencingEntity\tReferencedAttribute\tReferencingAttribute\n`;
                rels.oneToMany.forEach(r => {
                    report += `${fmt(r.SchemaName)}\t${fmt(r.ReferencedEntity)}\t${fmt(r.ReferencingEntity)}\t${fmt(r.ReferencedAttribute)}\t${fmt(r.ReferencingAttribute)}\n`;
                });
            }
            if (rels.manyToOne.length) {
                report += `N:1 Relationships\n`;
                report += `SchemaName\tReferencedEntity\tReferencingEntity\tReferencedAttribute\tReferencingAttribute\n`;
                rels.manyToOne.forEach(r => {
                    report += `${fmt(r.SchemaName)}\t${fmt(r.ReferencedEntity)}\t${fmt(r.ReferencingEntity)}\t${fmt(r.ReferencedAttribute)}\t${fmt(r.ReferencingAttribute)}\n`;
                });
            }
            if (rels.manyToMany.length) {
                report += `N:N Relationships\n`;
                report += `SchemaName\tEntity1\tEntity2\tIntersectEntity\n`;
                rels.manyToMany.forEach(r => {
                    report += `${fmt(r.SchemaName)}\t${fmt(r.Entity1LogicalName)}\t${fmt(r.Entity2LogicalName)}\t${fmt(r.IntersectEntityName)}\n`;
                });
            }
        }

        // Save to file instead of clipboard
        downloadFile("pdg_tables_report.txt", report);
        console.log("✅ Report downloaded as pdg_tables_report.txt");
    } catch (err) {
        console.error("❌ Error retrieving metadata:", err?.message || err);
    }
})();
